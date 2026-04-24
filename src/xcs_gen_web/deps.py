"""FastAPI dependencies that carry request-level context.

Kept tiny on purpose — any dependency that touches auth or user
identity should live here so the blast-radius of a future auth rewrite
stays obvious.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from .config import Settings
from .repositories import users as u_repo


def get_current_user(request: Request) -> int:
    """Resolve the integer owner_id for the current request.

    Standalone mode: always returns ``settings.standalone_user_id``.

    Multi-user mode: reads the configured header (``X-User-Id`` by
    default). The literal ``settings.demo_api_key`` (when non-empty) is
    recognised as a virtual "demo" user and resolves to
    ``settings.demo_target_user_id`` without a DB lookup. Any other
    value is validated against the users table; malformed or
    unregistered keys return 401. Successful multi-user resolution
    bumps ``last_seen_at``; the demo path does not.
    """
    settings: Settings = request.app.state.settings
    if settings.mode == "standalone":
        return settings.standalone_user_id
    raw = request.headers.get(settings.user_header, "").strip()
    if not raw:
        raise HTTPException(
            status_code=401,
            detail=(
                f"missing {settings.user_header} header — "
                "this server runs in multi_user mode"
            ),
        )
    # Virtual demo user — recognised before DB validation so the demo
    # key doesn't have to be a valid-shape api_key.
    if settings.demo_api_key and raw == settings.demo_api_key:
        return int(settings.demo_target_user_id)
    if not u_repo.is_valid_api_key(raw):
        raise HTTPException(
            status_code=401,
            detail="api key must be 16 url-safe base64 chars",
        )
    user = u_repo.get_by_api_key(raw)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="api key not registered — claim or load one from the welcome screen",
        )
    u_repo.touch_last_seen(user["id"])
    return int(user["id"])
