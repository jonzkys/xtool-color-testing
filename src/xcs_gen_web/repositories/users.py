"""Users repository.

``id`` is the canonical user identifier used throughout the app (it's
the ``owner_id`` stored on every data table). ``api_key`` is the
credential the caller presents in the ``X-User-Id`` header; it has a
unique index so the header→user lookup is O(log N) on every request.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import users


class DuplicateKeyError(Exception):
    """Raised when register is called with an api_key that already exists."""


# Exactly 16 url-safe base64 chars. The frontend generates keys of this
# shape; pasted keys that don't match get a clean 400 instead of a
# cryptic collation error down the stack.
API_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{16}$")


def is_valid_api_key(s: str) -> bool:
    return bool(API_KEY_PATTERN.match(s))


def _row(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "api_key": r.api_key,
        "first_name": r.first_name,
        "created_at": r.created_at,
        "last_seen_at": r.last_seen_at,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def register(*, api_key: str, first_name: str = "") -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        existing = s.execute(
            select(users).where(users.c.api_key == api_key)
        ).one_or_none()
        if existing is not None:
            raise DuplicateKeyError("api_key already registered")
        res = s.execute(users.insert().values(
            api_key=api_key, first_name=first_name,
            created_at=ts, last_seen_at=ts,
        ))
        uid = res.inserted_primary_key[0]
    return get_by_id(uid)  # type: ignore[return-value]


def get_by_api_key(api_key: str) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(users).where(users.c.api_key == api_key)
        ).one_or_none()
        return _row(row) if row else None


def get_by_id(uid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(users).where(users.c.id == uid)
        ).one_or_none()
        return _row(row) if row else None


def update_first_name(uid: int, first_name: str) -> dict[str, Any] | None:
    with session_scope() as s:
        s.execute(
            users.update().where(users.c.id == uid)
            .values(first_name=first_name)
        )
    return get_by_id(uid)


def touch_last_seen(uid: int) -> None:
    """Bump last_seen_at. Called from the current-user dep on every
    authenticated request. Cheap single-row UPDATE, no SELECT first."""
    with session_scope() as s:
        s.execute(
            users.update().where(users.c.id == uid)
            .values(last_seen_at=_now())
        )


def delete(uid: int) -> None:
    with session_scope() as s:
        s.execute(users.delete().where(users.c.id == uid))


def _new_mobile_id() -> str:
    """Random 24-char URL-safe token. Independent from the api_key
    pattern (which is 16 chars) so the two are visually distinguishable
    in logs and never confused."""
    return secrets.token_urlsafe(18)


def get_or_create_mobile_id(uid: int) -> str:
    """Return the user's mobile_id, generating + persisting one on first
    call. Subsequent calls return the same value until rotated.

    Concurrency: the UPDATE is guarded by ``mobile_id IS NULL`` so that
    if two callers race the lazy-create path, the loser's UPDATE matches
    zero rows; we then re-fetch and hand back the winner's token. The
    unique index on ``mobile_id`` makes the alternative — both writes
    succeeding — impossible."""
    with session_scope() as s:
        row = s.execute(
            select(users.c.mobile_id).where(users.c.id == uid)
        ).one_or_none()
        if row is None:
            raise ValueError(f"no such user: {uid}")
        if row.mobile_id:
            return row.mobile_id
        new = _new_mobile_id()
        result = s.execute(
            users.update()
            .where(users.c.id == uid, users.c.mobile_id.is_(None))
            .values(mobile_id=new)
        )
        if result.rowcount == 0:
            # Lost the race — fetch the winner's value.
            winner = s.execute(
                select(users.c.mobile_id).where(users.c.id == uid)
            ).one()
            return winner.mobile_id
        return new


def rotate_mobile_id(uid: int) -> str:
    """Replace the user's mobile_id with a fresh value. The old value
    stops resolving immediately because get_by_mobile_id is an exact
    match on a unique-indexed column. Raises ValueError if the uid
    doesn't exist (consistent with get_or_create_mobile_id)."""
    new = _new_mobile_id()
    with session_scope() as s:
        result = s.execute(
            users.update().where(users.c.id == uid).values(mobile_id=new)
        )
        if result.rowcount == 0:
            raise ValueError(f"no such user: {uid}")
    return new


def get_by_mobile_id(mid: str) -> dict[str, Any] | None:
    """Resolve a mobile_id to a user row, or None if no match. Treats
    empty string as no match (defensive — a NULL column compared to
    '' would already not match, but the early return saves the query)."""
    if not mid:
        return None
    with session_scope() as s:
        row = s.execute(
            select(users).where(users.c.mobile_id == mid)
        ).one_or_none()
        return _row(row) if row else None
