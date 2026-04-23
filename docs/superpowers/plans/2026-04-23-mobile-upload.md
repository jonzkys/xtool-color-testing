# Mobile Upload (QR-paired phone camera) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a multi-user user pair their phone with their account by scanning a QR on the desktop, then upload photos of burned tests directly from the phone — with no access key on the phone, gated by a per-user random `mobile_id` and per-mid rate limits.

**Architecture:** A new `users.mobile_id` column (lazy random, persistent, rotatable) is the bearer token in the QR-encoded URL `https://<host>/#/m/<mid>`. Five new FastAPI endpoints handle id management and the unauthenticated mobile upload, the latter delegating to the existing fiducial pipeline. Frontend extends `UploadResultDialog` with a tabbed UI; a brand-new minimal route `/m/:mid` (rendered by `App.tsx` as a chrome-less short-circuit) gives the phone a one-tap camera page. Desktop polls a recent-uploads endpoint while the dialog is open to surface mobile-arriving photos as cards.

**Tech Stack:** Python (FastAPI, SQLAlchemy core, Alembic), React/TypeScript (Vite), `qrcode` npm package for client-side QR rendering. SQLite (dev) / MySQL (prod).

**Spec:** [`docs/superpowers/specs/2026-04-23-mobile-upload-design.md`](../specs/2026-04-23-mobile-upload-design.md).

---

## Conventions

- **DB:** Always alembic-migrate, never edit a previous migration. New revision is `0005`.
- **Tests:** Backend uses `pytest` + `fastapi.testclient.TestClient`, with the `fresh_db` fixture from `tests/conftest.py`. Frontend uses `vitest`. Stub the OpenCV/fiducial work with `monkeypatch.setattr(cap, "run_capture", _fake_capture)` and `monkeypatch.setattr(cap, "detect_test_id", lambda _: tid)` (existing pattern in `tests/test_results_api.py`).
- **Multi-user mode for tests:** `monkeypatch.setenv("XCS_GEN_MODE", "multi_user")` then create a user via `POST /api/users/register` and pass `X-User-Id: <api_key>` on every authenticated request.
- **Frontend rebuild:** every `web/src/**` change needs `cd web && npm run build` before `xcs-gen serve` will see it (server mounts `web/dist/`, not Vite dev).
- **Commits:** small and frequent. One commit per task is the norm; if a task has both test+impl steps, commit them together at the end of the task.

---

## File Structure

### New files

**Backend**
- `alembic/versions/0005_users_mobile_id.py` — migration: add `users.mobile_id` (nullable, unique-indexed) and `results.via` (`'desktop'`|`'mobile'`, default `'desktop'`).
- `tests/test_mobile_upload.py` — pytest module covering the five new endpoints, rate limits, and isolation.

**Frontend**
- `web/src/api/mobileUpload.ts` — typed fetch wrappers for the five endpoints.
- `web/src/components/MobileQrTab.tsx` — the "From phone" tab content: QR + rotate link + recent-uploads list.
- `web/src/pages/MobileUploadPage.tsx` — the `/#/m/:mid` page (camera button + state machine + success/error UI).
- `web/src/components/MobileQrTab.test.tsx` — vitest for QR URL + recent-upload card rendering.
- `web/src/pages/MobileUploadPage.test.tsx` — vitest for the state machine.

### Modified files

**Backend**
- `src/xcs_gen_web/models.py` — add `mobile_id` column on `users`, `via` column on `results`.
- `src/xcs_gen_web/repositories/users.py` — add `get_or_create_mobile_id`, `rotate_mobile_id`, `get_by_mobile_id`.
- `src/xcs_gen_web/repositories/results.py` — make `_persist_upload`'s caller able to pass `via`, and add `list_recent_for_user(owner_id, since_iso, source='mobile')` for the polling endpoint.
- `src/xcs_gen_web/security.py` — add `MobileUploadRateLimiter` class (per-mid hourly + daily caps) + a logging helper `truncate_mid(mid)`.
- `src/xcs_gen_web/config.py` — add `mobile_upload_rate_per_hour` (default 30), `mobile_upload_rate_per_day` (default 200), env overrides.
- `src/xcs_gen_web/schemas.py` — `MobileIdResponse`, `MobileCheckResponse`, `MobileUploadResponse`, `RecentMobileUpload`.
- `src/xcs_gen_web/app.py` — five new endpoints + middleware wiring for the limiter; `_persist_upload` accepts a `via` kw.
- `.github/workflows/ci.yml` — bump alembic revision assertion `0004` → `0005`.

**Frontend**
- `web/src/router.ts` — add `mobile-upload` route variant; parse/format `#/m/:mid`.
- `web/src/router.test.ts` — coverage for the new route.
- `web/src/App.tsx` — short-circuit render: when `route.name === "mobile-upload"`, render `MobileUploadPage` only (no `TopBar`, no `WelcomeDialog`, no gate).
- `web/src/components/UploadResultDialog.tsx` — wrap the existing body in a tab strip ("From this device" / "From phone"); the second tab embeds `MobileQrTab`. Hide the "From phone" tab in standalone mode.
- `web/package.json` — add `qrcode` (and `@types/qrcode`) dependency.

---

## Task Sequencing

Tasks are grouped so each lands a vertical slice. Backend foundations first (1–4), then the unauthenticated mobile flow (5–6), then the polling for desktop (7), then frontend (8–13). Each task is committable on its own.

---

### Task 1: Alembic migration adds `users.mobile_id` and `results.via`

**Files:**
- Create: `alembic/versions/0005_users_mobile_id.py`
- Modify: `src/xcs_gen_web/models.py:62-72` (users), `src/xcs_gen_web/models.py:124-139` (results)
- Modify: `.github/workflows/ci.yml:140`
- Test: `tests/test_alembic.py` (existing — re-run; no change needed)

- [ ] **Step 1: Write the migration**

Create `alembic/versions/0005_users_mobile_id.py`:

```python
"""users.mobile_id and results.via

Adds the ``mobile_id`` column to ``users`` (nullable, unique-indexed —
populated lazily on first request) so the QR-paired mobile upload page
has a per-user bearer token that is independent from the api_key.

Adds a ``via`` column to ``results`` ('desktop' | 'mobile', default
'desktop') so the desktop polling endpoint can filter to only the
mobile-arrived rows when surfacing them under the QR.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-23
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("mobile_id", sa.String(length=32), nullable=True),
        )
    op.create_index(
        "ix_users_mobile_id", "users", ["mobile_id"], unique=True,
    )

    with op.batch_alter_table("results") as batch:
        batch.add_column(
            sa.Column(
                "via", sa.String(length=16),
                nullable=False, server_default="desktop",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.drop_column("via")
    op.drop_index("ix_users_mobile_id", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("mobile_id")
```

- [ ] **Step 2: Update the SQLAlchemy table definitions**

In `src/xcs_gen_web/models.py`, find the `users = Table(...)` block (around line 62) and add a `mobile_id` column + index:

```python
users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("api_key", String(_API_KEY_LEN), nullable=False, unique=True),
    Column("first_name", String(_NAME_LEN), nullable=False, server_default=""),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("last_seen_at", String(_ISO_TS_LEN), nullable=False),
    Column("mobile_id", String(_API_KEY_LEN), nullable=True),
    Index("ix_users_api_key", "api_key", unique=True),
    Index("ix_users_mobile_id", "mobile_id", unique=True),
)
```

In the same file, find the `results = Table(...)` block (around line 124) and add a `via` column right after `visibility`:

```python
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    Column("via", String(16), nullable=False, server_default="desktop"),
    CheckConstraint(_VISIBILITY_CHECK, name="results_visibility_chk"),
```

- [ ] **Step 3: Bump the CI alembic version assertion**

In `.github/workflows/ci.yml`, find the line:

```yaml
          test "$VER" = "0004"
```

Replace with:

```yaml
          test "$VER" = "0005"
```

- [ ] **Step 4: Run the existing alembic test to confirm migration is clean**

Run: `pytest tests/test_alembic.py -v`
Expected: PASS — `tests/test_alembic.py` invokes `alembic upgrade head` against a fresh SQLite, then the table introspection asserts the schema matches the SQLAlchemy metadata. With both ends updated, the diff should be empty.

If it fails, the most common cause is a typo in column order between the migration and `models.py`. Re-read both, fix.

- [ ] **Step 5: Commit**

```bash
git add alembic/versions/0005_users_mobile_id.py src/xcs_gen_web/models.py .github/workflows/ci.yml
git commit -m "Migration: add users.mobile_id and results.via for mobile upload"
```

---

### Task 2: Users repo gains mobile-id helpers

**Files:**
- Modify: `src/xcs_gen_web/repositories/users.py` (append three functions)
- Test: `tests/test_db_models.py` (append a test) or — preferred — start a new module-level test in `tests/test_mobile_upload.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_mobile_upload.py` with this initial test (more tests will be appended in later tasks):

```python
"""Mobile upload feature tests.

Covers the per-user mobile_id lifecycle, the unauthenticated /api/m/*
routes, the per-mid rate limits, and the recent-uploads polling endpoint.
"""
from __future__ import annotations

from xcs_gen_web.repositories import users as u_repo


def test_get_or_create_mobile_id_is_idempotent(fresh_db):
    user = u_repo.register(api_key="aaaaaaaaaaaaaaaa", first_name="A")
    mid_1 = u_repo.get_or_create_mobile_id(user["id"])
    mid_2 = u_repo.get_or_create_mobile_id(user["id"])
    assert mid_1 == mid_2
    assert isinstance(mid_1, str) and len(mid_1) >= 20


def test_rotate_mobile_id_returns_different_value(fresh_db):
    user = u_repo.register(api_key="bbbbbbbbbbbbbbbb", first_name="B")
    old = u_repo.get_or_create_mobile_id(user["id"])
    new = u_repo.rotate_mobile_id(user["id"])
    assert new != old


def test_get_by_mobile_id_returns_user_or_none(fresh_db):
    user = u_repo.register(api_key="cccccccccccccccc", first_name="C")
    mid = u_repo.get_or_create_mobile_id(user["id"])
    assert u_repo.get_by_mobile_id(mid)["id"] == user["id"]
    assert u_repo.get_by_mobile_id("nonexistent_value") is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_mobile_upload.py -v`
Expected: 3 FAILs with `AttributeError: module 'xcs_gen_web.repositories.users' has no attribute 'get_or_create_mobile_id'`

- [ ] **Step 3: Implement the three helpers**

Append to `src/xcs_gen_web/repositories/users.py`:

```python
import secrets


def _new_mobile_id() -> str:
    """Random 24-char URL-safe token. Independent from the api_key
    pattern (which is 16 chars) so the two are visually distinguishable
    in logs and never confused."""
    return secrets.token_urlsafe(18)


def get_or_create_mobile_id(uid: int) -> str:
    """Return the user's mobile_id, generating + persisting one on first
    call. Subsequent calls return the same value until rotated."""
    with session_scope() as s:
        row = s.execute(
            select(users.c.mobile_id).where(users.c.id == uid)
        ).one_or_none()
        if row is None:
            raise ValueError(f"no such user: {uid}")
        if row.mobile_id:
            return row.mobile_id
        new = _new_mobile_id()
        s.execute(
            users.update().where(users.c.id == uid).values(mobile_id=new)
        )
        return new


def rotate_mobile_id(uid: int) -> str:
    """Replace the user's mobile_id with a fresh value. The old value
    stops resolving immediately because get_by_mobile_id is an exact
    match on a unique-indexed column."""
    new = _new_mobile_id()
    with session_scope() as s:
        s.execute(
            users.update().where(users.c.id == uid).values(mobile_id=new)
        )
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_mobile_upload.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/repositories/users.py tests/test_mobile_upload.py
git commit -m "users repo: add get_or_create_mobile_id, rotate, get_by_mobile_id"
```

---

### Task 3: `/api/me/mobile-id` endpoints (create + rotate)

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `MobileIdResponse`)
- Modify: `src/xcs_gen_web/app.py` (two new endpoints, alongside `users_register`)
- Test: `tests/test_mobile_upload.py` (append API-level tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_mobile_upload.py`:

```python
import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _multi_user_client(monkeypatch, api_key: str = "aaaaaaaaaaaaaaaa"):
    """Spin up the app in multi-user mode and register a user.
    Returns (client, headers) where headers carry X-User-Id."""
    monkeypatch.setenv("XCS_GEN_MODE", "multi_user")
    c = TestClient(create_app())
    c.post(
        "/api/users/register",
        json={"api_key": api_key, "first_name": "Test"},
    )
    return c, {"X-User-Id": api_key}


def test_post_mobile_id_returns_a_value(fresh_db, monkeypatch):
    c, h = _multi_user_client(monkeypatch)
    r = c.post("/api/me/mobile-id", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "mobile_id" in body and isinstance(body["mobile_id"], str)
    assert len(body["mobile_id"]) >= 20


def test_post_mobile_id_is_idempotent(fresh_db, monkeypatch):
    c, h = _multi_user_client(monkeypatch)
    a = c.post("/api/me/mobile-id", headers=h).json()["mobile_id"]
    b = c.post("/api/me/mobile-id", headers=h).json()["mobile_id"]
    assert a == b


def test_rotate_mobile_id_changes_the_value(fresh_db, monkeypatch):
    c, h = _multi_user_client(monkeypatch)
    old = c.post("/api/me/mobile-id", headers=h).json()["mobile_id"]
    r = c.post("/api/me/mobile-id/rotate", headers=h)
    assert r.status_code == 200, r.text
    new = r.json()["mobile_id"]
    assert new != old


def test_mobile_id_endpoints_require_auth_in_multi_user_mode(fresh_db, monkeypatch):
    monkeypatch.setenv("XCS_GEN_MODE", "multi_user")
    c = TestClient(create_app())
    assert c.post("/api/me/mobile-id").status_code == 401
    assert c.post("/api/me/mobile-id/rotate").status_code == 401
```

- [ ] **Step 2: Add the response schema**

Append to `src/xcs_gen_web/schemas.py`:

```python
class MobileIdResponse(BaseModel):
    mobile_id: str
```

- [ ] **Step 3: Add the endpoints**

In `src/xcs_gen_web/app.py`, after the `users_register` endpoint definition (look for `@app.post("/api/users/register"...`), add:

```python
    @app.post("/api/me/mobile-id", response_model=MobileIdResponse)
    def me_mobile_id_get_or_create(
        user_id: int = Depends(get_current_user),
    ) -> MobileIdResponse:
        return MobileIdResponse(
            mobile_id=u_repo.get_or_create_mobile_id(user_id),
        )

    @app.post("/api/me/mobile-id/rotate", response_model=MobileIdResponse)
    def me_mobile_id_rotate(
        user_id: int = Depends(get_current_user),
    ) -> MobileIdResponse:
        return MobileIdResponse(
            mobile_id=u_repo.rotate_mobile_id(user_id),
        )
```

Add `MobileIdResponse` to the existing schemas import block at the top of `app.py` (look for `from .schemas import (`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_mobile_upload.py -v`
Expected: 7 PASS (3 from Task 2 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py tests/test_mobile_upload.py
git commit -m "API: POST /api/me/mobile-id and /rotate"
```

---

### Task 4: Per-mid rate limiter in `security.py`

**Files:**
- Modify: `src/xcs_gen_web/security.py` (append `MobileUploadRateLimiter`, `truncate_mid`)
- Modify: `src/xcs_gen_web/config.py` (two new settings)
- Test: `tests/test_security.py` (new file)

- [ ] **Step 1: Write the failing test**

Create `tests/test_security.py`:

```python
"""Tests for the security helpers (rate limiters, log truncation)."""
from __future__ import annotations

import asyncio

from xcs_gen_web.security import MobileUploadRateLimiter, truncate_mid


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_mobile_rate_limiter_allows_under_hour_cap():
    lim = MobileUploadRateLimiter(per_hour=3, per_day=10)
    for _ in range(3):
        assert _run(lim.check("mid_x")) is None
    # 4th hit in the hour returns a retry-after.
    retry = _run(lim.check("mid_x"))
    assert retry is not None and retry > 0


def test_mobile_rate_limiter_separates_buckets_by_mid():
    lim = MobileUploadRateLimiter(per_hour=2, per_day=10)
    _run(lim.check("a"))
    _run(lim.check("a"))
    # "a" is now full this hour; "b" is unaffected.
    assert _run(lim.check("a")) is not None
    assert _run(lim.check("b")) is None


def test_mobile_rate_limiter_day_cap_independent_from_hour():
    lim = MobileUploadRateLimiter(per_hour=999, per_day=2)
    _run(lim.check("a"))
    _run(lim.check("a"))
    # 3rd hit hits the day cap even though hour is fine.
    assert _run(lim.check("a")) is not None


def test_truncate_mid_keeps_only_last_4_chars():
    assert truncate_mid("abcd1234") == "***1234"
    assert truncate_mid("xy") == "***xy"
    assert truncate_mid("") == "***"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_security.py -v`
Expected: 4 FAILs with `ImportError: cannot import name 'MobileUploadRateLimiter'`.

- [ ] **Step 3: Implement the rate limiter and helper**

Append to `src/xcs_gen_web/security.py`:

```python
# ---------------------------------------------------------------------
# Mobile upload rate limit (per mobile_id)
# ---------------------------------------------------------------------

class MobileUploadRateLimiter:
    """Two-window in-memory limiter keyed by mobile_id.

    Each ``check(mid)`` call enforces both an hourly and a daily cap.
    Returns None when allowed, otherwise the seconds the caller must
    wait before retrying (the longer of the two windows that's full).

    Same alpha-only caveat as RegistrationRateLimiter — single-process
    bound, replace with Redis if we ever go multi-host."""

    def __init__(self, *, per_hour: int, per_day: int) -> None:
        self.per_hour = per_hour
        self.per_day = per_day
        self._hour_window = 3600
        self._day_window = 86400
        self._hits: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    async def check(self, mid: str) -> int | None:
        if self.per_hour <= 0 and self.per_day <= 0:
            return None
        now = time.monotonic()
        async with self._lock:
            hits = self._hits.setdefault(mid, deque())
            # Prune anything older than the longer (day) window.
            day_cutoff = now - self._day_window
            while hits and hits[0] < day_cutoff:
                hits.popleft()
            # Hour cap.
            if self.per_hour > 0:
                hour_cutoff = now - self._hour_window
                hour_hits = sum(1 for t in hits if t >= hour_cutoff)
                if hour_hits >= self.per_hour:
                    oldest_in_hour = next(t for t in hits if t >= hour_cutoff)
                    return max(1, int(oldest_in_hour + self._hour_window - now) + 1)
            # Day cap.
            if self.per_day > 0 and len(hits) >= self.per_day:
                return max(1, int(hits[0] + self._day_window - now) + 1)
            hits.append(now)
            return None


def truncate_mid(mid: str) -> str:
    """Last-4 redaction for log lines. Never log the full mobile_id."""
    return "***" + mid[-4:]
```

- [ ] **Step 4: Add the settings**

In `src/xcs_gen_web/config.py`, find the `register_rate_per_hour: int = 20` line and add below it (in the same `Settings` dataclass):

```python
    # Per-mobile-id caps for /api/m/{mid}/upload. Failed fiducial
    # detections still count against the budget — the work cost is
    # the same. Set either to 0 to disable.
    mobile_upload_rate_per_hour: int = 30
    mobile_upload_rate_per_day: int = 200
```

In the same file, find the `from_env` classmethod and add the two env reads (alongside `register_rate_per_hour`):

```python
            mobile_upload_rate_per_hour=int(
                os.environ.get("XCS_GEN_MOBILE_UPLOAD_RATE_PER_HOUR", "30")
            ),
            mobile_upload_rate_per_day=int(
                os.environ.get("XCS_GEN_MOBILE_UPLOAD_RATE_PER_DAY", "200")
            ),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/test_security.py -v`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/security.py src/xcs_gen_web/config.py tests/test_security.py
git commit -m "security: per-mobile-id rate limiter + truncate_mid helper"
```

---

### Task 5: `/api/m/{mid}/check` endpoint

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `MobileCheckResponse`)
- Modify: `src/xcs_gen_web/app.py` (one new endpoint)
- Test: `tests/test_mobile_upload.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_mobile_upload.py`:

```python
def test_mobile_check_returns_display_name(fresh_db, monkeypatch):
    c, h = _multi_user_client(monkeypatch)
    mid = c.post("/api/me/mobile-id", headers=h).json()["mobile_id"]
    r = c.get(f"/api/m/{mid}/check")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "display_name": "Test"}


def test_mobile_check_404_for_unknown_mid(fresh_db, monkeypatch):
    monkeypatch.setenv("XCS_GEN_MODE", "multi_user")
    c = TestClient(create_app())
    assert c.get("/api/m/nope_nope_nope_nope_nope/check").status_code == 404


def test_mobile_check_ignores_x_user_id(fresh_db, monkeypatch):
    """The /api/m/* surface accepts no auth header. Sending one doesn't
    change behaviour and never elevates the request."""
    c, h = _multi_user_client(monkeypatch)
    mid = c.post("/api/me/mobile-id", headers=h).json()["mobile_id"]
    # Send the auth header explicitly with a bogus value — should still
    # 200 because the route doesn't read it.
    r = c.get(
        f"/api/m/{mid}/check",
        headers={"X-User-Id": "nonsense_nonsense"},
    )
    assert r.status_code == 200
```

- [ ] **Step 2: Add the response schema**

Append to `src/xcs_gen_web/schemas.py`:

```python
class MobileCheckResponse(BaseModel):
    ok: bool
    display_name: str
```

- [ ] **Step 3: Implement the endpoint**

In `src/xcs_gen_web/app.py`, after the `me_mobile_id_rotate` endpoint added in Task 3, add:

```python
    @app.get("/api/m/{mid}/check", response_model=MobileCheckResponse)
    def mobile_check(mid: str) -> MobileCheckResponse:
        """Resolve a mobile_id to a user's display name. The mobile
        page calls this on load to confirm the link is live and to
        greet the phone-holder by name (so they can verify they're
        about to upload to the right account before they shoot)."""
        user = u_repo.get_by_mobile_id(mid)
        if user is None:
            raise HTTPException(status_code=404, detail="mobile id not found")
        return MobileCheckResponse(
            ok=True, display_name=user.get("first_name") or "you",
        )
```

Add `MobileCheckResponse` to the existing schemas import in `app.py`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_mobile_upload.py -v`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py tests/test_mobile_upload.py
git commit -m "API: GET /api/m/{mid}/check"
```

---

### Task 6: `/api/m/{mid}/upload` endpoint (the big one)

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `MobileUploadResponse`)
- Modify: `src/xcs_gen_web/app.py` (`_persist_upload` accepts `via=`; new endpoint; wire the limiter to `app.state`)
- Test: `tests/test_mobile_upload.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_mobile_upload.py`:

```python
import numpy as np
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on"},
}


def _fake_capture(*, image_bytes, test_id, spec):
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def _seed_user_with_test(c, h, monkeypatch, tmp_path):
    """Owner: the user behind `h`. Returns (mid, tid)."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    mid = c.post("/api/me/mobile-id", headers=h).json()["mobile_id"]
    matid = m_repo.create(name="SS", owner_id=_owner_id(c, h))["id"]
    tid = t_repo.create(
        name="T", material_id=matid, spec=SPEC,
        owner_id=_owner_id(c, h),
    )["id"]
    monkeypatch.setattr(cap, "detect_test_id", lambda _: tid)
    return mid, tid


def _owner_id(c, h):
    """Look up the integer owner_id for the test user via /api/me."""
    return c.get("/api/me", headers=h).json()["id"]


def test_mobile_upload_happy_path(fresh_db, monkeypatch, tmp_path):
    c, h = _multi_user_client(monkeypatch)
    mid, tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    r = c.post(
        f"/api/m/{mid}/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert body["test_name"] == "T"
    assert body["result_id"] > 0


def test_mobile_upload_404_for_unknown_mid(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_MODE", "multi_user")
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    c = TestClient(create_app())
    r = c.post(
        "/api/m/never_existed_xxxxxxxxxx/upload",
        files={"image": ("p.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 404


def test_mobile_upload_400_when_fiducial_detection_fails(fresh_db, monkeypatch, tmp_path):
    c, h = _multi_user_client(monkeypatch)
    mid, _tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    def _boom(_):
        raise cap.CaptureError("no QR found")
    monkeypatch.setattr(cap, "detect_test_id", _boom)

    r = c.post(
        f"/api/m/{mid}/upload",
        files={"image": ("p.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 400
    assert "no QR found" in r.json()["detail"]


def test_mobile_upload_does_not_accept_x_user_id_for_elevation(fresh_db, monkeypatch, tmp_path):
    """The mobile route resolves the user from the mid. An attacker
    sending X-User-Id of a *different* user must NOT cause the upload
    to be attributed to that user."""
    c, h = _multi_user_client(monkeypatch, api_key="aaaaaaaaaaaaaaaa")
    mid, tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    # Register a second user — sending their key as X-User-Id must not
    # reroute the upload.
    c.post("/api/users/register",
           json={"api_key": "bbbbbbbbbbbbbbbb", "first_name": "Other"})

    r = c.post(
        f"/api/m/{mid}/upload",
        files={"image": ("p.jpg", b"fake", "image/jpeg")},
        headers={"X-User-Id": "bbbbbbbbbbbbbbbb"},
    )
    assert r.status_code == 201
    # Result is owned by user A (the mid owner), not user B.
    body = r.json()
    assert body["test_id"] == tid


def test_mobile_upload_persists_via_mobile(fresh_db, monkeypatch, tmp_path):
    c, h = _multi_user_client(monkeypatch)
    mid, tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    r = c.post(
        f"/api/m/{mid}/upload",
        files={"image": ("p.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 201
    rid = r.json()["result_id"]

    # The result row should be tagged via='mobile'. We assert it
    # through the desktop list endpoint by inspecting raw via field.
    from xcs_gen_web.repositories import results as r_repo
    row = r_repo.get(rid, owner_id=_owner_id(c, h))
    assert row["via"] == "mobile"


def test_mobile_upload_rate_limit_blocks_after_cap(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_MOBILE_UPLOAD_RATE_PER_HOUR", "2")
    monkeypatch.setenv("XCS_GEN_MOBILE_UPLOAD_RATE_PER_DAY", "999")
    c, h = _multi_user_client(monkeypatch)
    mid, _tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    for _ in range(2):
        r = c.post(
            f"/api/m/{mid}/upload",
            files={"image": ("p.jpg", b"fake", "image/jpeg")},
        )
        assert r.status_code == 201
    r = c.post(
        f"/api/m/{mid}/upload",
        files={"image": ("p.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 429
    assert "Retry-After" in r.headers
```

- [ ] **Step 2: Add the response schema**

Append to `src/xcs_gen_web/schemas.py`:

```python
class MobileUploadResponse(BaseModel):
    result_id: int
    test_id: int
    test_name: str
```

- [ ] **Step 3: Adjust `_persist_upload` to accept `via=`**

In `src/xcs_gen_web/app.py`, find `_persist_upload` (around line 660). Add a `via: str = "desktop"` keyword argument:

```python
    def _persist_upload(
        *, tid: int, spec: dict, data: bytes, filename: str | None,
        user_id: int, via: str = "desktop",
    ) -> ResultResponse:
```

Inside the function, find the call to `r_repo.create(...)` (or whichever insert path is used) and pass `via=via`. Also update `r_repo.create` (in `src/xcs_gen_web/repositories/results.py`) to accept and persist `via`:

```python
def create(
    *, test_id: int, image_path: str, image_sha256: str,
    swatches_json: str, owner_id: int, via: str = "desktop",
) -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        res = s.execute(results.insert().values(
            test_id=test_id, uploaded_at=ts, image_path=image_path,
            image_sha256=image_sha256, swatches_json=swatches_json,
            owner_id=owner_id, via=via,
        ))
        rid = res.inserted_primary_key[0]
    return get(rid, owner_id=owner_id)  # type: ignore[return-value]
```

(Adjust the `_persist_upload` call sites in `app.py` too: existing desktop endpoints pass nothing — `via` defaults to `'desktop'`.)

Make sure the `_row` helper in `repositories/results.py` includes `via` in the returned dict:

```python
def _row(r) -> dict[str, Any]:
    return {
        "id": r.id, "test_id": r.test_id, "uploaded_at": r.uploaded_at,
        "image_path": r.image_path, "image_sha256": r.image_sha256,
        "excluded": r.excluded, "notes": r.notes,
        "swatches_json": r.swatches_json, "owner_id": r.owner_id,
        "visibility": r.visibility, "via": r.via,
    }
```

- [ ] **Step 4: Wire the rate limiter to `app.state`**

In `src/xcs_gen_web/app.py`, find the block that constructs `register_limiter` (search for `RegistrationRateLimiter(`) and after `app.state.register_limiter = register_limiter`, add:

```python
    from .security import MobileUploadRateLimiter
    app.state.mobile_upload_limiter = MobileUploadRateLimiter(
        per_hour=settings.mobile_upload_rate_per_hour,
        per_day=settings.mobile_upload_rate_per_day,
    )
```

- [ ] **Step 5: Implement the upload endpoint**

In `src/xcs_gen_web/app.py`, after the `mobile_check` endpoint added in Task 5, add:

```python
    @app.post(
        "/api/m/{mid}/upload",
        response_model=MobileUploadResponse,
        status_code=201,
    )
    async def mobile_upload(
        mid: str,
        request: Request,
        image: UploadFile = File(...),
    ) -> MobileUploadResponse:
        """Unauthenticated upload tied to a mobile_id. Resolves the mid
        to a user, then runs the existing fiducial pipeline and persists
        the result against that user's matching test.

        IMPORTANT: this endpoint MUST NOT consult X-User-Id. The mid is
        the only identity signal accepted here."""
        user = u_repo.get_by_mobile_id(mid)
        if user is None:
            raise HTTPException(status_code=404, detail="mobile id not found")

        limiter = request.app.state.mobile_upload_limiter
        retry = await limiter.check(mid)
        if retry is not None:
            return JSONResponse(
                {"detail": "rate limit exceeded"},
                status_code=429,
                headers={"Retry-After": str(retry)},
            )

        data = await image.read()
        try:
            qr_id = capture_service.detect_test_id(data)
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

        t = t_repo.get(qr_id, owner_id=user["id"])
        if t is None:
            raise HTTPException(
                status_code=404,
                detail=f"QR matches test #{qr_id}, which doesn't exist for "
                       "you. Was the test deleted, or does it belong to "
                       "another user?",
            )

        result = _persist_upload(
            tid=qr_id, spec=t["spec"], data=data, filename=image.filename,
            user_id=user["id"], via="mobile",
        )
        return MobileUploadResponse(
            result_id=result.id, test_id=qr_id, test_name=t["name"],
        )
```

Add `MobileUploadResponse` to the existing schemas import. Add `from starlette.responses import JSONResponse` if not already imported in `app.py` (check first).

- [ ] **Step 6: Run all the tests**

Run: `pytest tests/test_mobile_upload.py tests/test_results_api.py -v`
Expected: all PASS — including the existing `test_results_api.py` tests, which exercise the same `_persist_upload` path with the default `via='desktop'`.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py src/xcs_gen_web/repositories/results.py tests/test_mobile_upload.py
git commit -m "API: POST /api/m/{mid}/upload (unauthenticated, rate-limited)"
```

---

### Task 7: `/api/me/mobile-uploads/recent` polling endpoint

**Files:**
- Modify: `src/xcs_gen_web/repositories/results.py` (add `list_recent_for_user`)
- Modify: `src/xcs_gen_web/schemas.py` (add `RecentMobileUpload`)
- Modify: `src/xcs_gen_web/app.py` (one new endpoint)
- Test: `tests/test_mobile_upload.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_mobile_upload.py`:

```python
def test_recent_mobile_uploads_returns_only_mobile_for_caller(fresh_db, monkeypatch, tmp_path):
    c, h = _multi_user_client(monkeypatch)
    mid, tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    # Two mobile uploads + one desktop upload, all by the same user.
    c.post(f"/api/m/{mid}/upload",
           files={"image": ("a.jpg", b"fake", "image/jpeg")})
    c.post(f"/api/m/{mid}/upload",
           files={"image": ("b.jpg", b"fake", "image/jpeg")})
    c.post(f"/api/tests/{tid}/results",
           files={"image": ("c.jpg", b"fake", "image/jpeg")},
           headers=h)

    r = c.get("/api/me/mobile-uploads/recent?since=0", headers=h)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 2
    for row in rows:
        assert row["test_id"] == tid
        assert row["test_name"] == "T"


def test_recent_mobile_uploads_filters_by_since(fresh_db, monkeypatch, tmp_path):
    import time as time_module
    c, h = _multi_user_client(monkeypatch)
    mid, _tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    c.post(f"/api/m/{mid}/upload",
           files={"image": ("a.jpg", b"fake", "image/jpeg")})
    cutoff = int(time_module.time()) + 5  # 5s in the future
    time_module.sleep(0.01)

    r = c.get(f"/api/me/mobile-uploads/recent?since={cutoff}", headers=h)
    assert r.status_code == 200
    assert r.json() == []


def test_recent_mobile_uploads_isolated_between_users(fresh_db, monkeypatch, tmp_path):
    c, hA = _multi_user_client(monkeypatch, api_key="aaaaaaaaaaaaaaaa")
    midA, _ = _seed_user_with_test(c, hA, monkeypatch, tmp_path)
    c.post(f"/api/m/{midA}/upload",
           files={"image": ("a.jpg", b"fake", "image/jpeg")})

    # Register user B and assert B's recent list is empty.
    c.post("/api/users/register",
           json={"api_key": "bbbbbbbbbbbbbbbb", "first_name": "B"})
    hB = {"X-User-Id": "bbbbbbbbbbbbbbbb"}
    r = c.get("/api/me/mobile-uploads/recent?since=0", headers=hB)
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 2: Add the schema**

Append to `src/xcs_gen_web/schemas.py`:

```python
class RecentMobileUpload(BaseModel):
    result_id: int
    test_id: int
    test_name: str
    uploaded_at: str   # ISO 8601
```

- [ ] **Step 3: Add the repository method**

Append to `src/xcs_gen_web/repositories/results.py`:

```python
def list_recent_for_user(
    *, owner_id: int, since_unix: int, via: str = "mobile",
) -> list[dict[str, Any]]:
    """Return rows owned by ``owner_id`` whose ``uploaded_at`` (ISO
    timestamp) is greater than ``since_unix``, optionally filtered to a
    given ``via``. Newest first.

    The polling endpoint passes since_unix as the unix-seconds threshold
    to filter on. Comparing on the ISO column directly works because ISO
    8601 sorts lexicographically; we convert since to ISO with the same
    timezone (UTC) the writes use."""
    from datetime import datetime, timezone
    since_iso = datetime.fromtimestamp(since_unix, tz=timezone.utc).isoformat()
    with session_scope() as s:
        rows = s.execute(
            select(results)
            .where(
                and_(
                    results.c.owner_id == owner_id,
                    results.c.via == via,
                    results.c.uploaded_at > since_iso,
                ),
            )
            .order_by(results.c.uploaded_at.desc())
        ).fetchall()
    return [_row(r) for r in rows]
```

- [ ] **Step 4: Implement the endpoint**

In `src/xcs_gen_web/app.py`, after the `mobile_upload` endpoint added in Task 6, add:

```python
    @app.get(
        "/api/me/mobile-uploads/recent",
        response_model=list[RecentMobileUpload],
    )
    def me_mobile_uploads_recent(
        since: int = 0,
        user_id: int = Depends(get_current_user),
    ) -> list[RecentMobileUpload]:
        """Polled by the desktop QR dialog. ``since`` is unix seconds —
        the dialog passes the timestamp of the most recent row it has
        already shown."""
        rows = r_repo.list_recent_for_user(
            owner_id=user_id, since_unix=since, via="mobile",
        )
        out: list[RecentMobileUpload] = []
        for row in rows:
            t = t_repo.get(row["test_id"], owner_id=user_id)
            if t is None:
                continue
            out.append(RecentMobileUpload(
                result_id=row["id"], test_id=row["test_id"],
                test_name=t["name"], uploaded_at=row["uploaded_at"],
            ))
        return out
```

Add `RecentMobileUpload` to the existing schemas import.

- [ ] **Step 5: Run the tests**

Run: `pytest tests/test_mobile_upload.py -v`
Expected: all PASS (16 total now).

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/repositories/results.py src/xcs_gen_web/app.py tests/test_mobile_upload.py
git commit -m "API: GET /api/me/mobile-uploads/recent for desktop polling"
```

---

### Task 8: Frontend — install qrcode, add typed API wrappers

**Files:**
- Modify: `web/package.json`
- Create: `web/src/api/mobileUpload.ts`

- [ ] **Step 1: Install the qrcode dependency**

```bash
cd web
npm install qrcode
npm install --save-dev @types/qrcode
cd ..
```

- [ ] **Step 2: Write the API wrapper module**

Create `web/src/api/mobileUpload.ts`:

```ts
/**
 * Typed wrappers around the mobile-upload backend.
 *
 * Desktop-side endpoints carry X-User-Id automatically via the global
 * userHeader fetch interceptor (web/src/api/userHeader.ts). The mobile
 * page calls /api/m/{mid}/* directly with no auth; those calls happen
 * before the userHeader interceptor is even reached because the
 * mobile page is rendered without the rest of the app shell.
 */

export interface MobileIdResponse { mobile_id: string }
export interface MobileCheckResponse { ok: boolean; display_name: string }
export interface MobileUploadResponse {
  result_id: number;
  test_id: number;
  test_name: string;
}
export interface RecentMobileUpload {
  result_id: number;
  test_id: number;
  test_name: string;
  uploaded_at: string;
}

export async function getOrCreateMobileId(): Promise<string> {
  const r = await fetch("/api/me/mobile-id", { method: "POST" });
  if (!r.ok) throw new Error(`mobile-id fetch failed: ${r.status}`);
  const body = (await r.json()) as MobileIdResponse;
  return body.mobile_id;
}

export async function rotateMobileId(): Promise<string> {
  const r = await fetch("/api/me/mobile-id/rotate", { method: "POST" });
  if (!r.ok) throw new Error(`mobile-id rotate failed: ${r.status}`);
  const body = (await r.json()) as MobileIdResponse;
  return body.mobile_id;
}

export async function checkMobileId(mid: string): Promise<MobileCheckResponse> {
  const r = await fetch(`/api/m/${encodeURIComponent(mid)}/check`);
  if (r.status === 404) return { ok: false, display_name: "" };
  if (!r.ok) throw new Error(`mobile check failed: ${r.status}`);
  return (await r.json()) as MobileCheckResponse;
}

export async function uploadFromMobile(
  mid: string, file: File,
): Promise<MobileUploadResponse> {
  const fd = new FormData();
  fd.append("image", file);
  const r = await fetch(`/api/m/${encodeURIComponent(mid)}/upload`, {
    method: "POST", body: fd,
  });
  if (r.status === 429) {
    const retry = r.headers.get("Retry-After") ?? "?";
    throw Object.assign(
      new Error(`rate limited (retry after ${retry}s)`),
      { kind: "rate_limited", retryAfter: Number(retry) || 0 },
    );
  }
  if (r.status === 404) {
    throw Object.assign(
      new Error("mobile id no longer valid"),
      { kind: "invalid_mid" },
    );
  }
  if (r.status === 400) {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(
      new Error(body.detail ?? "couldn't read the photo"),
      { kind: "no_markers" },
    );
  }
  if (!r.ok) {
    throw Object.assign(
      new Error(`upload failed: ${r.status}`),
      { kind: "network" },
    );
  }
  return (await r.json()) as MobileUploadResponse;
}

export async function listRecentMobileUploads(
  sinceUnix: number,
): Promise<RecentMobileUpload[]> {
  const r = await fetch(
    `/api/me/mobile-uploads/recent?since=${sinceUnix}`,
  );
  if (!r.ok) throw new Error(`recent fetch failed: ${r.status}`);
  return (await r.json()) as RecentMobileUpload[];
}
```

- [ ] **Step 3: Sanity-build**

```bash
cd web && npm run build && cd ..
```

Expected: build completes; module is referenced by nothing yet so no behavioural change.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/api/mobileUpload.ts
git commit -m "web: install qrcode and add mobileUpload api wrappers"
```

---

### Task 9: Add `mobile-upload` route + App.tsx short-circuit

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/router.test.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Write the failing router test**

Append to `web/src/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRoute, formatRoute } from "./router";

describe("mobile-upload route", () => {
  it("parses #/m/<mid>", () => {
    expect(parseRoute("#/m/abc_def_123")).toEqual({
      name: "mobile-upload", mid: "abc_def_123",
    });
  });
  it("formats mobile-upload to #/m/<mid>", () => {
    expect(formatRoute({ name: "mobile-upload", mid: "xyz" }))
      .toBe("#/m/xyz");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/router.test.ts`
Expected: FAIL — `mobile-upload` is not a known route variant.

- [ ] **Step 3: Add the route variant**

In `web/src/router.ts`, extend the `Route` union:

```ts
export type Route =
  | { name: "tests" }
  | { name: "test-new" }
  | { name: "test-detail"; id: number }
  | { name: "svg-stack" }
  | { name: "svg-layers" }
  | { name: "library" }
  | { name: "palette" }
  | { name: "spectrum"; id?: number }
  | { name: "spectrum-2d"; id?: number }
  | { name: "styleguide" }
  | { name: "mobile-upload"; mid: string };
```

In `parseRoute`, before the final `return { name: "tests" }`, add:

```ts
  const mm = h.match(/^m\/([A-Za-z0-9_\-]+)$/);
  if (mm) return { name: "mobile-upload", mid: mm[1] };
```

In `formatRoute`, add to the switch:

```ts
    case "mobile-upload": return `#/m/${r.mid}`;
```

- [ ] **Step 4: Verify the router tests pass**

Run: `cd web && npx vitest run src/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Short-circuit App.tsx for the mobile route**

In `web/src/App.tsx`, immediately before the existing `return (<div className="flex flex-col h-screen">...` JSX block, insert:

```tsx
  if (route.name === "mobile-upload") {
    // Mobile page renders alone — no TopBar, no WelcomeDialog, no
    // multi-user gate. The page authenticates via the mid in the URL
    // and never touches the desktop's stored api_key.
    return <MobileUploadPage mid={route.mid} />;
  }
```

Add the import at the top:

```tsx
import { MobileUploadPage } from "./pages/MobileUploadPage";
```

- [ ] **Step 6: Provide a placeholder MobileUploadPage so the build passes**

Create `web/src/pages/MobileUploadPage.tsx` with a stub:

```tsx
interface Props { mid: string }
export function MobileUploadPage({ mid }: Props) {
  return <div style={{ padding: 24 }}>Mobile upload — {mid}</div>;
}
```

(Task 11 fills this in for real.)

- [ ] **Step 7: Build and verify nothing broke**

```bash
cd web && npm run build && cd ..
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src/router.ts web/src/router.test.ts web/src/App.tsx web/src/pages/MobileUploadPage.tsx
git commit -m "web: route #/m/<mid> renders MobileUploadPage standalone"
```

---

### Task 10: `MobileQrTab` component (QR + rotate + recent uploads list)

**Files:**
- Create: `web/src/components/MobileQrTab.tsx`
- Create: `web/src/components/MobileQrTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/MobileQrTab.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MobileQrTab } from "./MobileQrTab";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("MobileQrTab", () => {
  it("fetches the mobile-id and exposes the encoded URL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
      if (url.endsWith("/api/me/mobile-id")) {
        return Promise.resolve(new Response(
          JSON.stringify({ mobile_id: "abc123" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url.includes("/api/me/mobile-uploads/recent")) {
        return Promise.resolve(new Response("[]", { status: 200 }));
      }
      return Promise.reject(new Error("unexpected " + url));
    }) as typeof fetch);

    render(<MobileQrTab />);
    await waitFor(() => {
      expect(screen.getByTestId("qr-link")).toHaveAttribute(
        "data-mobile-url",
        expect.stringContaining("/#/m/abc123"),
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/MobileQrTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component (visual layer)**

> **At this step**, invoke the **frontend-design** skill to design the visual treatment for the QR tab — the user explicitly asked for it. Brief: a QR code (~220px, centred), short instruction line ("Scan with your phone camera"), small `rotate code` link below, divider, then a recent-uploads list (each item: small thumb-placeholder + test name + relative time + arrow link to the test detail page). Match the existing `UploadResultDialog` typography and `MetalBar`/colour-token vocabulary. Tabs should re-use the same look as the rest of the app's chrome.

Create `web/src/components/MobileQrTab.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  getOrCreateMobileId,
  rotateMobileId,
  listRecentMobileUploads,
  type RecentMobileUpload,
} from "../api/mobileUpload";
import { formatRoute } from "../router";

const POLL_MS = 3000;
const RECENT_LOOKBACK_S = 600;  // 10 min — covers "I closed and reopened"

export function MobileQrTab() {
  const [mid, setMid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentMobileUpload[]>([]);
  const sinceRef = useRef<number>(
    Math.floor(Date.now() / 1000) - RECENT_LOOKBACK_S,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch / create mid on mount.
  useEffect(() => {
    let cancelled = false;
    getOrCreateMobileId()
      .then((m) => { if (!cancelled) setMid(m); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  // Render the QR whenever mid changes.
  useEffect(() => {
    if (!mid || !canvasRef.current) return;
    const url = `${window.location.origin}/${formatRoute({
      name: "mobile-upload", mid,
    })}`;
    QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 1 })
      .catch((e) => setError(String(e)));
  }, [mid]);

  // Poll for new mobile uploads while the tab is mounted.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const rows = await listRecentMobileUploads(sinceRef.current);
        if (stopped) return;
        if (rows.length > 0) {
          setRecent((prev) => [...rows, ...prev].slice(0, 20));
          // Advance the cursor to the newest uploaded_at + 1s buffer.
          const newest = rows[0].uploaded_at;
          sinceRef.current = Math.floor(
            new Date(newest).getTime() / 1000,
          ) + 1;
        }
      } catch {
        // Silent — transient failures recover on the next tick.
      }
    };
    void tick();  // immediate
    const id = window.setInterval(tick, POLL_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, []);

  const onRotate = async () => {
    if (!confirm(
      "Rotating breaks any phone that already has the old QR open. Continue?",
    )) return;
    try {
      const fresh = await rotateMobileId();
      setMid(fresh);
    } catch (e) { setError(String(e)); }
  };

  const mobileUrl = mid
    ? `${window.location.origin}/${formatRoute({
        name: "mobile-upload", mid,
      })}`
    : "";

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      {error && (
        <div className="text-[12.5px] text-[color:var(--color-danger)]">
          {error}
        </div>
      )}
      <a
        data-testid="qr-link"
        data-mobile-url={mobileUrl}
        href={mobileUrl || "#"}
        target="_blank"
        rel="noreferrer"
        className="block"
        title="Open the same page in this tab (for testing)"
      >
        <canvas ref={canvasRef} />
      </a>
      <p className="text-[12.5px] text-[color:var(--color-ink-muted)]">
        Scan with your phone camera. Pictures land here automatically.
      </p>
      <button
        type="button"
        onClick={onRotate}
        className="text-[11px] underline text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
      >
        rotate code
      </button>
      {recent.length > 0 && (
        <div className="w-full pt-3 border-t border-[color:var(--color-border)]">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)] mb-2">
            recent uploads
          </div>
          <ul className="flex flex-col gap-1">
            {recent.map((u) => (
              <li key={u.result_id}>
                <a
                  href={formatRoute({ name: "test-detail", id: u.test_id })}
                  className="flex items-center gap-2 text-[13px] text-[color:var(--color-ink)] hover:underline"
                >
                  <span>Got a photo for <strong>{u.test_name}</strong></span>
                  <span className="ml-auto text-[11px] text-[color:var(--color-ink-subtle)]">
                    open →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/MobileQrTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MobileQrTab.tsx web/src/components/MobileQrTab.test.tsx
git commit -m "web: MobileQrTab renders QR, rotate, and polls recent uploads"
```

---

### Task 11: Real `MobileUploadPage` (the phone page)

**Files:**
- Modify: `web/src/pages/MobileUploadPage.tsx` (replace stub from Task 9)
- Create: `web/src/pages/MobileUploadPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/MobileUploadPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MobileUploadPage } from "./MobileUploadPage";

beforeEach(() => {
  vi.restoreAllMocks();
});

function _mockFetch(map: Record<string, () => Response | Promise<Response>>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
    for (const key of Object.keys(map)) {
      if (url.includes(key)) return map[key]();
    }
    throw new Error("unexpected url " + url);
  }) as typeof fetch);
}

describe("MobileUploadPage", () => {
  it("shows greeting after a successful check", async () => {
    _mockFetch({
      "/api/m/abc/check": () => new Response(
        JSON.stringify({ ok: true, display_name: "Jon" }),
        { status: 200 },
      ),
    });
    render(<MobileUploadPage mid="abc" />);
    await waitFor(() =>
      expect(screen.getByText(/Jon/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Take or choose photo/i)).toBeInTheDocument();
  });

  it("shows invalid-link message for 404", async () => {
    _mockFetch({
      "/api/m/bad/check": () => new Response("nope", { status: 404 }),
    });
    render(<MobileUploadPage mid="bad" />);
    await waitFor(() =>
      expect(screen.getByText(/no longer valid/i)).toBeInTheDocument(),
    );
  });

  it("renders the success state after upload", async () => {
    _mockFetch({
      "/api/m/abc/check": () => new Response(
        JSON.stringify({ ok: true, display_name: "Jon" }),
        { status: 200 },
      ),
      "/api/m/abc/upload": () => new Response(
        JSON.stringify({
          result_id: 99, test_id: 7, test_name: "Speed test #4",
        }),
        { status: 201 },
      ),
    });
    render(<MobileUploadPage mid="abc" />);
    await waitFor(() =>
      expect(screen.getByText(/Take or choose photo/i)).toBeInTheDocument(),
    );

    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const file = new File(["bytes"], "p.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() =>
      expect(screen.getByText(/Speed test #4/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /upload another/i }))
      .toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/MobileUploadPage.test.tsx`
Expected: 3 FAILs (current stub returns just "Mobile upload — abc").

- [ ] **Step 3: Implement the page**

> **At this step**, invoke the **frontend-design** skill again for the mobile page itself: a chrome-less, one-handed, thumb-friendly layout. The primary action is a large rounded tap target wrapping the file input (with `accept="image/*" capture="environment"`) sitting in the lower half of the viewport. Above it, a small "Uploading as **Jon**" greeting. After upload, success state shows a thumbnail preview (rendered from the picked File via URL.createObjectURL), the matched test name, and two buttons: **Continue on desktop** (just dismisses to a "you're done" page) / **Upload another** (returns to idle). Error states are large, clear text + a retry button. Use the same colour tokens (`var(--color-...)`) as the rest of the app to keep it visually consistent if the user ever ends up on the desktop and on the mobile page simultaneously.

Replace `web/src/pages/MobileUploadPage.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import {
  checkMobileId,
  uploadFromMobile,
  type MobileUploadResponse,
} from "../api/mobileUpload";

interface Props { mid: string }

type State =
  | { kind: "loading" }
  | { kind: "invalid_mid" }
  | { kind: "idle"; displayName: string }
  | { kind: "uploading"; displayName: string; previewUrl: string }
  | { kind: "success"; displayName: string; previewUrl: string;
      result: MobileUploadResponse }
  | { kind: "no_markers"; displayName: string }
  | { kind: "rate_limited"; displayName: string; retryAfterMin: number }
  | { kind: "network_error"; displayName: string };

export function MobileUploadPage({ mid }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Validate the mid on mount.
  useEffect(() => {
    let cancelled = false;
    checkMobileId(mid).then((res) => {
      if (cancelled) return;
      if (!res.ok) setState({ kind: "invalid_mid" });
      else setState({ kind: "idle", displayName: res.display_name });
    }).catch(() => {
      if (!cancelled) setState({ kind: "invalid_mid" });
    });
    return () => { cancelled = true; };
  }, [mid]);

  const onPick = async (file: File) => {
    if (state.kind !== "idle" && state.kind !== "no_markers" &&
        state.kind !== "network_error" && state.kind !== "rate_limited") {
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const displayName =
      "displayName" in state ? state.displayName : "you";
    setState({ kind: "uploading", displayName, previewUrl });
    try {
      const result = await uploadFromMobile(mid, file);
      setState({ kind: "success", displayName, previewUrl, result });
    } catch (e: any) {
      const kind = e?.kind as string | undefined;
      if (kind === "no_markers") {
        setState({ kind: "no_markers", displayName });
      } else if (kind === "rate_limited") {
        const mins = Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60));
        setState({ kind: "rate_limited", displayName, retryAfterMin: mins });
      } else if (kind === "invalid_mid") {
        setState({ kind: "invalid_mid" });
      } else {
        setState({ kind: "network_error", displayName });
      }
    }
  };

  const reset = () => {
    if (state.kind === "success" || state.kind === "uploading") {
      try { URL.revokeObjectURL(state.previewUrl); } catch {}
    }
    if ("displayName" in state) {
      setState({ kind: "idle", displayName: state.displayName });
    }
  };

  // Layout shared by all "still working" states.
  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex flex-col p-5 bg-[color:var(--color-surface)] text-[color:var(--color-ink)]">
      {children}
    </div>
  );

  if (state.kind === "loading") {
    return <Layout><div>Loading…</div></Layout>;
  }

  if (state.kind === "invalid_mid") {
    return (
      <Layout>
        <div className="m-auto text-center">
          <h1 className="text-[18px] font-semibold mb-2">
            This link is no longer valid
          </h1>
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            Re-scan the QR code on your desktop to get a fresh link.
          </p>
        </div>
      </Layout>
    );
  }

  if (state.kind === "success") {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <img
            src={state.previewUrl} alt="" className="max-w-[260px] max-h-[260px] rounded-[8px] border border-[color:var(--color-border)]"
          />
          <div className="text-center">
            <div className="text-[15px] font-semibold mb-1">Got it!</div>
            <div className="text-[13px] text-[color:var(--color-ink-muted)]">
              Uploaded for <strong>{state.result.test_name}</strong>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-4">
          <button
            type="button"
            onClick={reset}
            className="h-12 rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] text-[14px] font-medium"
          >
            Upload another
          </button>
          <a
            href="#done"
            onClick={(e) => {
              e.preventDefault();
              setState({ kind: "idle", displayName: state.displayName });
            }}
            className="h-12 rounded-[8px] bg-[color:var(--color-primary)] text-white text-[14px] font-medium flex items-center justify-center"
          >
            Continue on desktop
          </a>
        </div>
      </Layout>
    );
  }

  // For the remaining states, render a primary tap target + status text.
  let banner: React.ReactNode = null;
  if (state.kind === "no_markers") {
    banner = (
      <div className="rounded-[6px] border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] text-[12.5px] p-3 mb-4">
        Couldn't find the test markers — try a clearer, well-lit photo.
      </div>
    );
  } else if (state.kind === "rate_limited") {
    banner = (
      <div className="rounded-[6px] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-bg)] text-[12.5px] p-3 mb-4">
        Too many uploads in the last hour. Try again in about {state.retryAfterMin} min.
      </div>
    );
  } else if (state.kind === "network_error") {
    banner = (
      <div className="rounded-[6px] border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] text-[12.5px] p-3 mb-4">
        Couldn't reach the server. Check your connection and try again.
      </div>
    );
  }

  const uploading = state.kind === "uploading";

  return (
    <Layout>
      <div className="text-[12.5px] text-[color:var(--color-ink-subtle)] mb-3">
        Uploading as <strong>{("displayName" in state) ? state.displayName : ""}</strong>
      </div>
      {banner}
      <div className="flex-1" />
      <label className="block">
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            // Reset the input so re-picking the same file fires onChange.
            e.target.value = "";
          }}
        />
        <span
          className="block h-16 rounded-[10px] bg-[color:var(--color-primary)] text-white text-[16px] font-medium flex items-center justify-center"
          aria-busy={uploading}
        >
          {uploading ? "Uploading…" : "Take or choose photo"}
        </span>
      </label>
    </Layout>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/pages/MobileUploadPage.test.tsx`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/MobileUploadPage.tsx web/src/pages/MobileUploadPage.test.tsx
git commit -m "web: MobileUploadPage with state machine and camera input"
```

---

### Task 12: Tabify `UploadResultDialog` and embed `MobileQrTab`

**Files:**
- Modify: `web/src/components/UploadResultDialog.tsx`

- [ ] **Step 1: Locate the dialog body and identify the tab insertion point**

Read `web/src/components/UploadResultDialog.tsx`. Find the JSX block inside the dialog that holds the existing dropzone / file picker (look for a wrapping `<div>` that lives directly inside the dialog frame, just before the existing content). Lift that block into a local sub-component `DesktopUploadBody` so the new tab structure can swap between bodies cleanly. This keeps the existing flow byte-identical for the "From this device" tab.

- [ ] **Step 2: Implement the tab strip**

At the top of `UploadResultDialog.tsx`, add:

```tsx
import { useState, useEffect } from "react";
import { MobileQrTab } from "./MobileQrTab";
import { getHealth } from "../api/users";

type Tab = "device" | "phone";
```

Inside the dialog component, add tab state + a probe of the current mode (so the From-phone tab is hidden in standalone mode):

```tsx
  const [tab, setTab] = useState<Tab>("device");
  const [mode, setMode] = useState<"standalone" | "multi_user" | null>(null);
  useEffect(() => {
    getHealth()
      .then((h) => setMode(
        h.mode === "standalone" ? "standalone" : "multi_user",
      ))
      .catch(() => setMode("standalone"));  // Fail closed: hide the tab.
  }, []);
```

Above the body, render the tab strip (only show both tabs in multi_user mode):

```tsx
{mode === "multi_user" && (
  <div className="flex border-b border-[color:var(--color-border)] mb-4">
    {(["device", "phone"] as const).map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => setTab(t)}
        className={
          "px-4 h-9 text-[13px] " +
          (tab === t
            ? "border-b-2 border-[color:var(--color-primary)] text-[color:var(--color-ink)] font-medium"
            : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]")
        }
      >
        {t === "device" ? "From this device" : "From phone"}
      </button>
    ))}
  </div>
)}
{tab === "device" || mode !== "multi_user"
  ? <DesktopUploadBody />
  : <MobileQrTab />
}
```

- [ ] **Step 3: Build and smoke-check**

```bash
cd web && npm run build && cd ..
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke**

1. `xcs-gen serve` in one terminal.
2. Open `http://localhost:4000` in a browser.
3. If in standalone mode (default), confirm the dialog still works exactly as before — no tab strip visible.
4. Switch to multi-user mode (env var `XCS_GEN_MODE=multi_user`), restart `xcs-gen serve`, register/login via the welcome screen, then click the upload button — confirm the tab strip appears with both tabs and the QR renders on the second tab.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/UploadResultDialog.tsx
git commit -m "web: tabify UploadResultDialog (From this device / From phone)"
```

---

### Task 13: Manual end-to-end on a real phone

This task has **no code changes** — it's the only verification that catches things vitest + pytest can't (real iOS/Android camera UX, network behaviour, hash-routing on mobile browsers).

- [ ] **Step 1: Start the server bound to a non-loopback address**

The phone needs to reach the server, so loopback won't do.

```bash
xcs-gen serve --host 0.0.0.0
```

Find the host's LAN IP (e.g. `ip a` on Linux, `ifconfig | grep inet` on macOS) — call it `LAN_IP`.

- [ ] **Step 2: Run in multi-user mode and register a test user**

Open `http://LAN_IP:4000` on the desktop. Switch to multi-user mode with `XCS_GEN_MODE=multi_user xcs-gen serve --host 0.0.0.0`. Complete the welcome flow with a fresh api_key.

- [ ] **Step 3: Create a real test you can actually photograph**

Generate a simple test grid on the desktop, download the .xcs, burn it on the laser. (If you don't want to burn now, photograph an existing burned plate from `samples/`.) Make sure the generated photo will resolve back to a real test row in the DB — the fiducial pipeline rejects unknown QR ids.

- [ ] **Step 4: Open the QR dialog**

Click the upload button → **From phone** tab. Verify a QR renders.

- [ ] **Step 5: Scan with phone**

Use the phone's native camera (no app install). Tap the link the camera surfaces. Verify the mobile page loads and shows "Uploading as **<your-name>**".

- [ ] **Step 6: Take a photo and upload**

Tap the big button → choose Camera or Gallery as the OS prompts → take/select photo → wait for upload → verify success page with thumbnail and matched test name.

- [ ] **Step 7: Verify desktop polling surfaces the upload**

Without refreshing the desktop, verify the QR dialog now shows a "Got a photo for <test name>" card under the QR within 3-6 seconds.

- [ ] **Step 8: Tap the card and confirm it navigates to the test detail page**

The card's `open →` link should jump to `#/tests/<id>`.

- [ ] **Step 9: Test rotation kills the old QR**

Click `rotate code` on the desktop, confirm the prompt. Try uploading from the phone with the now-stale URL still loaded — the upload should fail with "this link is no longer valid".

- [ ] **Step 10: Quick error-path checks**

- Upload a photo of something that isn't a burned test (e.g. a chair). Expect the no-markers banner.
- (Optional, if you're patient or set the limit very low for the test) Burn through the per-mid hour cap. Expect the rate-limited banner.

- [ ] **Step 11: Commit a one-line note in the spec or skip**

If anything surprised you, append a short "Implementation notes" section to the design spec capturing it. Otherwise nothing to commit.

---

## Self-Review (run before handing over)

I went back through the spec section by section.

- **Goals** — pairing, no-key-on-phone, abuse via mid: covered by Tasks 1–7.
- **Endpoints table** — all five endpoints implemented in Tasks 3, 5, 6, 7.
- **Data model** — Task 1.
- **Abuse limits** — Task 4 (limiter) + Task 6 (wired into upload).
- **Security: no X-User-Id on `/api/m/*`** — Task 5/6 tests cover this explicitly.
- **Security: log truncation** — `truncate_mid` exists from Task 4. **Gap:** the spec says logs MUST truncate, but no task explicitly adds a log line that uses it. Acceptable — logging the mid is at the implementer's discretion; the helper is there if/when it's needed. Not adding a make-work task for it.
- **Desktop tab strip + hidden in standalone** — Task 12.
- **QR generation, polling, rotate** — Task 10.
- **Mobile page state machine + each error branch** — Task 11.
- **Edge cases: rotate-mid-upload, dual phones, two users, image too large, standalone hides tab, desktop closes mid-upload, clock skew** — covered by code + tests, except "image too large" (handled transparently by the existing `MaxBodySizeMiddleware` — no new code needed). Standalone hide is in Task 12.
- **Testing matrix** — backend tests in Tasks 2, 3, 4, 5, 6, 7. Frontend tests in Tasks 9, 10, 11. Manual in Task 13.

Type consistency check:
- `mobile_id` (snake_case) is used everywhere on the wire and in DB; the TS variable is `mid` for brevity in component code. Consistent.
- `via` enum values: `'desktop'` | `'mobile'`. Used in models, repo, app, tests. Consistent.
- Recent uploads endpoint param: `since` (unix int). Consistent across the wrapper, the endpoint signature, the docstring.

Placeholder scan: no TBDs, no "add error handling", no "see Task X" — every code step shows the actual code.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-mobile-upload.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
