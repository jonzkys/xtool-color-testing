"""Demo account — read-only showcase access enforcement.

The middleware recognises the demo API key by its exact header value
(configurable) and rejects any write method outside the allowlist with
``403 {"detail": "demo account is read-only"}``.

Identification of the demo user (returning the target owner_id from
``get_current_user``) lives in ``deps.py`` — this module is only the
write-enforcement gate. Split intentionally so the two concerns can be
understood and tested independently: identification is about auth,
enforcement is about HTTP verb policing.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


# Methods that can mutate state. HEAD/OPTIONS/TRACE are never blocked
# so that CORS preflight and browser HEAD probes work normally.
WRITE_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})


# ``(method, path)`` tuples for writes that demo users ARE allowed to
# make. Every endpoint here must be verified to not persist anything to
# the database — they compute and return bytes only.
DEMO_SAFE_WRITES: frozenset[tuple[str, str]] = frozenset({
    ("POST", "/api/svg-layers"),
    ("POST", "/api/svg-preview"),
    ("POST", "/api/svg-stack"),
    ("POST", "/api/results/preflight"),
})


class DemoReadOnlyMiddleware(BaseHTTPMiddleware):
    """Blocks non-allowlisted writes from the demo API key.

    Runs outermost in the stack (added last in ``create_app``) so that
    a violation is 403'd before any body is read, any DB query runs, or
    any other middleware consumes work.
    """

    def __init__(
        self,
        app,
        *,
        demo_api_key: str,
        user_header: str,
    ) -> None:
        super().__init__(app)
        self._key = demo_api_key
        self._header = user_header

    async def dispatch(self, request: Request, call_next) -> Response:
        if self._key and request.method in WRITE_METHODS:
            if request.headers.get(self._header, "").strip() == self._key:
                route = (request.method, request.url.path)
                if route not in DEMO_SAFE_WRITES:
                    return JSONResponse(
                        {"detail": "demo account is read-only"},
                        status_code=403,
                    )
        return await call_next(request)
