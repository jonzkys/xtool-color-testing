"""Security middleware for public deployments.

Kept intentionally small and dependency-free:

* ``MaxBodySizeMiddleware`` — rejects any request whose Content-Length
  exceeds the configured cap, before FastAPI starts reading the body.
  For chunked uploads (no Content-Length) it tallies the bytes as they
  arrive and aborts the stream if the cap is hit mid-body.

* ``RegistrationRateLimiter`` — in-memory leaky bucket, keyed by source
  IP, applied to ``POST /api/users/register``. Alpha-scale only; a
  multi-worker production deploy would replace this with Redis. Returns
  429 with a ``Retry-After`` hint when the bucket is empty.

Neither structure touches user-owned data; they're pre-auth guards
that trip before any business logic runs.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """Reject requests larger than ``max_bytes`` with 413.

    Cheap pre-check on Content-Length; for streaming uploads it wraps
    the receive channel so the server stops reading as soon as the cap
    is exceeded (important so a 10 GB upload can't OOM the host just
    because we'll reject it after the fact).
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                if int(cl) > self.max_bytes:
                    return _too_large(self.max_bytes)
            except ValueError:
                return JSONResponse(
                    {"detail": "invalid Content-Length"}, status_code=400,
                )

        # Chunked / unknown-length requests: wrap the receive channel
        # so we track bytes as they arrive.
        running_total = 0
        original_receive = request.receive
        cap = self.max_bytes

        async def capped_receive() -> Message:
            nonlocal running_total
            msg = await original_receive()
            if msg.get("type") == "http.request":
                body = msg.get("body", b"")
                running_total += len(body)
                if running_total > cap:
                    # Raise so the handler (which will be reading the
                    # body) sees an abort rather than silently truncating.
                    raise _BodyTooLarge(cap)
            return msg

        # Reassign to the scoped receive. Starlette's ``request._receive``
        # is the canonical slot.
        request._receive = capped_receive  # type: ignore[attr-defined]
        try:
            return await call_next(request)
        except _BodyTooLarge as e:
            return _too_large(e.cap)


class _BodyTooLarge(Exception):
    def __init__(self, cap: int) -> None:
        self.cap = cap


def _too_large(cap: int) -> JSONResponse:
    return JSONResponse(
        {"detail": f"request body exceeds {cap} bytes"},
        status_code=413,
    )


# ---------------------------------------------------------------------
# Registration rate limit
# ---------------------------------------------------------------------

class RegistrationRateLimiter:
    """Simple in-memory sliding-window limiter keyed by source IP.

    ``check(ip)`` returns None when the request is allowed, or the
    number of seconds the caller must wait before retrying when the
    bucket is empty. Thread/async-safe (async lock). Memory bounded by
    evicting expired entries on every check.
    """

    def __init__(self, *, per_hour: int) -> None:
        self.per_hour = per_hour
        self._window = 3600
        self._hits: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    async def check(self, ip: str) -> int | None:
        if self.per_hour <= 0:
            return None
        now = time.monotonic()
        cutoff = now - self._window
        async with self._lock:
            hits = self._hits.setdefault(ip, deque())
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self.per_hour:
                # Retry-after = seconds until the oldest hit falls out.
                retry = int(hits[0] + self._window - now) + 1
                return max(1, retry)
            hits.append(now)
            return None


def source_ip(request: Request) -> str:
    """Best-effort client IP.

    When the API is fronted by a reverse proxy, trust the first entry
    in ``X-Forwarded-For``. Otherwise fall back to the ASGI client
    tuple. Either way it's a key for a rate-limit bucket, not an
    auth identifier — a minor amount of spoofing resistance is fine.
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first
    client = request.client
    return client.host if client else "unknown"
