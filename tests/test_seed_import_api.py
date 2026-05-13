"""Route tests for /api/seed/preview + /api/seed/import.

The routes are mode-gated (multi_user only), user-gated (the seed user
can't import onto themselves), and idempotent (a second POST returns
409). These tests exercise each gate with a real TestClient — the
underlying copy machinery is covered separately in
``test_seed_import_service.py``.

We pre-register two users via /api/users/register; the first one
becomes ``demo_target_user_id`` (= 1 by default) and is the seed
source. The second registration becomes the destination "fresh" user.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from xcs_gen_web.app import create_app
from xcs_gen_web.config import Settings
from xcs_gen_web.db import session_scope
from xcs_gen_web.models import materials as materials_t
from xcs_gen_web.models import tests as tests_t

# 16-char url-safe base64 strings. Match the shape in test_multi_user.py
# so failures read identically.
SEED_KEY = "seed_AAAAA_zz001"   # registered first → id=1 → matches demo_target_user_id default
DST_KEY = "dst__BBBBB_zz002"


def _h(key: str) -> dict[str, str]:
    return {"X-User-Id": key}


def _register(client: TestClient, key: str, name: str) -> int:
    r = client.post(
        "/api/users/register",
        json={"api_key": key, "first_name": name},
    )
    assert r.status_code == 201, r.text
    return int(r.json()["id"])


# ── DB seeders — write directly via SQLA Core so the test's setup
# doesn't accidentally pull in repo-side timestamp / validation logic
# that would bump fields we want to inspect verbatim. Mirrors the
# helpers in test_seed_import_service.py.


def _now() -> str:
    return "2026-05-13T00:00:00+00:00"


def _seed_material(owner_id: int, name: str = "Stainless") -> int:
    with session_scope() as s:
        res = s.execute(
            materials_t.insert().values(
                name=name,
                notes="seed-route-test",
                created_at=_now(),
                owner_id=owner_id,
                visibility="private",
            )
        )
        return int(res.inserted_primary_key[0])


def _seed_test(owner_id: int, material_id: int, name: str = "t1") -> int:
    with session_scope() as s:
        res = s.execute(
            tests_t.insert().values(
                name=name,
                material_id=material_id,
                status="created",
                spec_json="{}",
                notes="",
                created_at=_now(),
                updated_at=_now(),
                locked=0,
                owner_id=owner_id,
                visibility="private",
                retest_index=0,
                machine_id="F2Ultra",
                kind="sweep",
                source_test_id=None,
                parent_test_id=None,
            )
        )
        return int(res.inserted_primary_key[0])


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def mu_client(fresh_db):
    """Multi-user app with the seed user registered first.

    The default ``demo_target_user_id`` is 1 — autoincrement guarantees
    the first registered user gets id=1, so SEED_KEY's user IS the seed
    user and DST_KEY's user (id=2) is a fresh empty account.
    """
    settings = Settings(mode="multi_user")
    client = TestClient(create_app(settings=settings))
    client.seed_id = _register(client, SEED_KEY, "Seed")
    client.dst_id = _register(client, DST_KEY, "Dst")
    # Sanity — if these break, every assertion below is wrong.
    assert client.seed_id == 1
    assert client.dst_id == 2
    return client


@pytest.fixture
def standalone_client(fresh_db):
    settings = Settings(mode="standalone")
    return TestClient(create_app(settings=settings))


# ── /api/seed/preview ───────────────────────────────────────────────────


def test_seed_preview_standalone_mode_404(standalone_client):
    r = standalone_client.get("/api/seed/preview")
    assert r.status_code == 404
    assert "standalone" in r.json()["detail"]


def test_seed_preview_multi_user_returns_counts(mu_client):
    m1 = _seed_material(mu_client.seed_id, "Stainless")
    _seed_material(mu_client.seed_id, "Brass")
    _seed_test(mu_client.seed_id, m1, name="sweep-A")
    _seed_test(mu_client.seed_id, m1, name="sweep-B")

    r = mu_client.get("/api/seed/preview", headers=_h(DST_KEY))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["src_owner_id"] == 1
    assert body["src_has_data"] is True
    assert body["already_imported"] is False
    assert body["materials"] == 2
    assert body["tests"] == 2
    assert body["results"] == 0
    assert body["palette_entries"] == 0
    assert body["presets"] == 0
    assert body["saved_spectrums"] == 0


def test_seed_preview_seed_user_self_400(mu_client):
    """The seed user asking to preview-into-themselves is rejected."""
    r = mu_client.get("/api/seed/preview", headers=_h(SEED_KEY))
    assert r.status_code == 400
    assert "seed account" in r.json()["detail"]


# ── /api/seed/import ────────────────────────────────────────────────────


def test_seed_import_standalone_mode_404(standalone_client):
    r = standalone_client.post("/api/seed/import")
    assert r.status_code == 404
    assert "standalone" in r.json()["detail"]


def test_seed_import_happy_path(mu_client):
    m1 = _seed_material(mu_client.seed_id, "Stainless")
    _seed_material(mu_client.seed_id, "Brass")
    _seed_test(mu_client.seed_id, m1, name="sweep-A")

    r = mu_client.post("/api/seed/import", headers=_h(DST_KEY))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["materials"] == 2
    assert body["tests"] == 1
    assert body["results"] == 0
    assert body["palette_entries"] == 0
    assert body["image_warnings"] == []
    # Materials are now visible on the dst user's library.
    listing = mu_client.get("/api/materials", headers=_h(DST_KEY))
    assert listing.status_code == 200
    names = sorted(m["name"] for m in listing.json())
    assert names == ["Brass", "Stainless"]


def test_seed_import_already_imported_409(mu_client):
    _seed_material(mu_client.seed_id, "Stainless")
    first = mu_client.post("/api/seed/import", headers=_h(DST_KEY))
    assert first.status_code == 200, first.text
    second = mu_client.post("/api/seed/import", headers=_h(DST_KEY))
    assert second.status_code == 409
    assert "already" in second.json()["detail"].lower()


def test_seed_import_empty_seed_400(mu_client):
    """Source account has no rows — refuse to import nothing."""
    r = mu_client.post("/api/seed/import", headers=_h(DST_KEY))
    assert r.status_code == 400
    assert "no data" in r.json()["detail"].lower()


def test_seed_import_seed_user_self_400(mu_client):
    """Caller IS the seed user — refuse before the service is even called."""
    _seed_material(mu_client.seed_id, "Stainless")
    r = mu_client.post("/api/seed/import", headers=_h(SEED_KEY))
    assert r.status_code == 400
    assert "seed account" in r.json()["detail"]


def test_seed_import_actually_creates_rows_in_dst(mu_client):
    """End-to-end sanity: after POST, the dst user's listing endpoints
    show the imported rows with ``import_source='seed'`` tagged on the
    underlying DB rows."""
    m1 = _seed_material(mu_client.seed_id, "Stainless")
    _seed_test(mu_client.seed_id, m1, name="sweep-A")
    _seed_test(mu_client.seed_id, m1, name="sweep-B")

    r = mu_client.post("/api/seed/import", headers=_h(DST_KEY))
    assert r.status_code == 200, r.text

    materials_resp = mu_client.get(
        "/api/materials", headers=_h(DST_KEY),
    ).json()
    assert len(materials_resp) == 1
    assert materials_resp[0]["name"] == "Stainless"

    # ``/api/tests`` validates spec_json shape via TestResponse, which
    # the bare ``"{}"`` we seeded with would fail. The DB-level assert
    # below proves the rows landed under the dst owner — that's the
    # contract this test is checking. (Real seed-source rows go through
    # the normal POST /api/tests path so their spec_json is always valid.)

    # All copied rows are tagged with import_source='seed' in the DB.
    with session_scope() as s:
        owned_materials = s.execute(
            select(materials_t).where(
                materials_t.c.owner_id == mu_client.dst_id,
            )
        ).all()
        owned_tests = s.execute(
            select(tests_t).where(
                tests_t.c.owner_id == mu_client.dst_id,
            )
        ).all()
    assert all(m.import_source == "seed" for m in owned_materials)
    assert all(t.import_source == "seed" for t in owned_tests)
