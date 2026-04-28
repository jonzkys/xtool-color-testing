"""Sentry initialisation — env-driven, no-op when DSN is unset.

The SDK is initialised exactly once per process, at app creation time.
When ``XCS_GEN_SENTRY_DSN`` is empty/unset we skip initialisation
entirely so dev/test/CI runs incur zero network or memory overhead.

What we capture:

- Unhandled exceptions in request handlers (the FastAPI integration
  installs an exception hook).
- 4xx + 5xx responses (FastAPI integration auto-attaches request
  context). Trialling users tend to drop off without reporting bugs,
  so silent telemetry on validation-class failures matters more than
  avoiding noise. Tune in Sentry's dashboard via inbound filters if
  a particular status/path proves too chatty.

What we deliberately do NOT capture:

- ``/api/health`` regardless of status — it's the load-balancer poll
  path and any failures there will already be visible via uptime
  monitoring.
- Sensitive request bodies / headers (``send_default_pii=False`` and
  the body is stripped via the ``before_send`` hook).
"""

from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)


def init_sentry(
    *,
    dsn: str | None,
    environment: str,
    release: str | None,
    traces_sample_rate: float,
) -> None:
    """Initialise the Sentry SDK once per process.

    Idempotent — Sentry's own ``is_initialized()`` check skips the
    second call when ``init_sentry`` runs again with the same (or any)
    DSN. Calls with no DSN never initialise.
    """
    if not dsn:
        _log.info("sentry: XCS_GEN_SENTRY_DSN unset — error reporting disabled")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except Exception as e:
        # Hard dependency, but be defensive — a misinstalled wheel
        # shouldn't crash the app on boot.
        _log.warning("sentry: SDK import failed (%s) — disabling", e)
        return

    if sentry_sdk.is_initialized():
        # Already configured this process (e.g. tests that build the app
        # multiple times in one run). Skip — re-init would tear down the
        # existing client and lose any in-flight events.
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        # PII stripped by default — no user IPs, headers, or cookies.
        # The before_send hook below drops any captured request body
        # too, in case an integration re-attaches it later.
        send_default_pii=False,
        # Capture every non-2xx response. 4xx tells us about
        # validation bugs and unexpected client states (the original
        # rationale for this PR was a silent 422 on the SVG
        # matched-export path); 5xx is the obvious server-side win.
        # Routine noise gets filtered in ``before_send`` below.
        integrations=[
            StarletteIntegration(failed_request_status_codes=set(range(400, 600))),
            FastApiIntegration(failed_request_status_codes=set(range(400, 600))),
        ],
        before_send=_before_send,
    )
    _log.info("sentry: initialised env=%s release=%s", environment, release or "<unset>")


_SILENCED_PATHS = ("/api/health",)


def _before_send(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    """Drop noisy events + scrub sensitive request data.

    Returning ``None`` from ``before_send`` tells the SDK to swallow
    the event without sending. Used here to:

    1. Skip events from URLs in ``_SILENCED_PATHS`` (load-balancer
       polls and similar). Match by path so query strings don't break
       the comparison.
    2. Trim the bits most likely to contain secrets so a future API
       key, OAuth token, or upload payload can't leak into Sentry's
       UI.
    """
    req = event.get("request") or {}
    url = req.get("url") or ""
    # The integration provides the absolute URL; strip query for the
    # path-prefix match so silenced paths apply regardless of trailing
    # ``?since=…`` etc.
    path_only = url.split("?", 1)[0]
    for silenced in _SILENCED_PATHS:
        if path_only.endswith(silenced):
            return None
    if "data" in req:
        req["data"] = "<stripped>"
    headers = req.get("headers") or {}
    if isinstance(headers, dict):
        for k in list(headers.keys()):
            kl = k.lower()
            if kl in {"authorization", "cookie", "x-user-id", "x-api-key"}:
                headers[k] = "<stripped>"
    return event
