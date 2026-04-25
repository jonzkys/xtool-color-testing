"""Multi-user scoping: every user sees only their own data.

Runs against a TestClient configured in ``multi_user`` mode. Each test
registers one or two users (which produces real rows in the users
table), then exercises the scoped endpoints with the real api_keys.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.config import Settings


# 16-char url-safe base64 strings (hand-picked so they're readable in
# failure messages). The backend doesn't care about the source of the
# key, only its shape.
ALICE_KEY = "alice_AAAA_zzzz1"
BOB_KEY = "bob_BBBBB_zzzz22"


@pytest.fixture
def mu_client(fresh_db):
    settings = Settings(mode="multi_user")
    client = TestClient(create_app(settings=settings))
    # Pre-register the two fixture users so each test starts with them
    # already present. Tests that care about the register path test it
    # directly. We attach the integer user-ids assigned by the backend
    # so tests can assert against owner_id directly.
    client.user_ids = {}
    for key, name in [(ALICE_KEY, "Alice"), (BOB_KEY, "Bob")]:
        r = client.post(
            "/api/users/register",
            json={"api_key": key, "first_name": name},
        )
        assert r.status_code == 201, r.text
        client.user_ids[key] = r.json()["id"]
    return client


def _h(key: str) -> dict[str, str]:
    return {"X-User-Id": key}


def test_health_reports_multi_user_mode(mu_client):
    r = mu_client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["mode"] == "multi_user"
    assert "available_machines" in body


def test_missing_user_header_is_401(mu_client):
    r = mu_client.get("/api/materials")
    assert r.status_code == 401
    assert "X-User-Id" in r.json()["detail"]


def test_unregistered_key_is_401(fresh_db):
    """A syntactically valid key that was never registered is rejected."""
    client = TestClient(create_app(settings=Settings(mode="multi_user")))
    r = client.get("/api/materials", headers=_h("GHOST_Zzzz_11112"))
    assert r.status_code == 401
    assert "not registered" in r.json()["detail"]


def test_malformed_key_is_401(mu_client):
    r = mu_client.get("/api/materials", headers=_h("short"))
    assert r.status_code == 401
    assert "16 url-safe" in r.json()["detail"]


def test_register_duplicate_key_is_409(mu_client):
    r = mu_client.post(
        "/api/users/register",
        json={"api_key": ALICE_KEY, "first_name": "Impostor"},
    )
    assert r.status_code == 409


def test_me_returns_the_caller(mu_client):
    r = mu_client.get("/api/me", headers=_h(ALICE_KEY))
    assert r.status_code == 200
    body = r.json()
    assert body["api_key"] == ALICE_KEY
    assert body["first_name"] == "Alice"


def test_me_patch_updates_first_name(mu_client):
    r = mu_client.patch(
        "/api/me", json={"first_name": "Alicia"}, headers=_h(ALICE_KEY),
    )
    assert r.status_code == 200
    assert r.json()["first_name"] == "Alicia"


def test_materials_are_isolated_per_user(mu_client):
    alice_id = mu_client.user_ids[ALICE_KEY]
    bob_id = mu_client.user_ids[BOB_KEY]

    a = mu_client.post(
        "/api/materials", json={"name": "Alpha alu"}, headers=_h(ALICE_KEY),
    )
    assert a.status_code == 201
    assert a.json()["owner_id"] == alice_id

    b = mu_client.post(
        "/api/materials", json={"name": "Brass strip"}, headers=_h(BOB_KEY),
    )
    assert b.status_code == 201
    assert b.json()["owner_id"] == bob_id

    alice_only = mu_client.get("/api/materials", headers=_h(ALICE_KEY)).json()
    bob_only = mu_client.get("/api/materials", headers=_h(BOB_KEY)).json()
    assert [m["name"] for m in alice_only] == ["Alpha alu"]
    assert [m["name"] for m in bob_only] == ["Brass strip"]

    # Direct fetch across owners returns 404.
    bob_mid = b.json()["id"]
    r = mu_client.get(f"/api/materials/{bob_mid}", headers=_h(ALICE_KEY))
    assert r.status_code == 404


def test_tests_are_isolated_per_user(mu_client):
    # Seed a material per user.
    a_mid = mu_client.post(
        "/api/materials", json={"name": "A"}, headers=_h(ALICE_KEY),
    ).json()["id"]
    b_mid = mu_client.post(
        "/api/materials", json={"name": "B"}, headers=_h(BOB_KEY),
    ).json()["id"]

    spec = {
        "x_param": "speed", "x_min": 100, "x_max": 1000, "x_steps": 3,
        "y_param": None,
        "rows": 1, "width_mm": 20, "height_mm": 4, "gap_mm": 0,
        "cell_shape": "rect", "square_cells": True,
        "angle_mode": "fixed", "unidirectional": False,
        "hide_axis_labels": False,
        "base_params": {
            "power": 50, "speed": 1000, "frequency": 60000,
            "density": 200, "passes": 1, "pulse_width": 200,
            "laser": "red",
        },
        "registration": {"mode": "on"},
    }

    alice_test = mu_client.post(
        "/api/tests",
        json={"name": "Alice speed", "material_id": a_mid, "spec": spec},
        headers=_h(ALICE_KEY),
    ).json()
    bob_test = mu_client.post(
        "/api/tests",
        json={"name": "Bob speed", "material_id": b_mid, "spec": spec},
        headers=_h(BOB_KEY),
    ).json()

    # Each user only sees their own list.
    alice_list = mu_client.get("/api/tests", headers=_h(ALICE_KEY)).json()
    assert [t["id"] for t in alice_list] == [alice_test["id"]]

    # Cross-owner GET returns 404.
    r = mu_client.get(f"/api/tests/{bob_test['id']}", headers=_h(ALICE_KEY))
    assert r.status_code == 404

    # Cross-owner delete also returns 404 (no leak of existence).
    r = mu_client.delete(f"/api/tests/{bob_test['id']}", headers=_h(ALICE_KEY))
    assert r.status_code == 404

    # Bob's test is still present for Bob.
    r = mu_client.get(f"/api/tests/{bob_test['id']}", headers=_h(BOB_KEY))
    assert r.status_code == 200
    assert r.json()["owner_id"] == mu_client.user_ids[BOB_KEY]


def test_material_creation_for_cross_owner_material_rejects(mu_client):
    """Creating a test referencing another user's material id fails
    with 'unknown material_id' — because the lookup is scoped."""
    # Alice's material.
    a_mid = mu_client.post(
        "/api/materials", json={"name": "A"}, headers=_h(ALICE_KEY),
    ).json()["id"]
    spec = {
        "x_param": "speed", "x_min": 100, "x_max": 1000, "x_steps": 3,
        "y_param": None,
        "rows": 1, "width_mm": 20, "height_mm": 4, "gap_mm": 0,
        "cell_shape": "rect", "square_cells": True,
        "angle_mode": "fixed", "unidirectional": False,
        "hide_axis_labels": False,
        "base_params": {
            "power": 50, "speed": 1000, "frequency": 60000,
            "density": 200, "passes": 1, "pulse_width": 200,
            "laser": "red",
        },
        "registration": {"mode": "on"},
    }
    r = mu_client.post(
        "/api/tests",
        json={"name": "mine", "material_id": a_mid, "spec": spec},
        headers=_h(BOB_KEY),
    )
    assert r.status_code == 400
    assert "unknown material_id" in r.json()["detail"]


def test_standalone_mode_has_no_header_requirement(fresh_db):
    """Sanity: the default (standalone) mode never demands the header."""
    client = TestClient(create_app())
    r = client.get("/api/materials")
    assert r.status_code == 200


def test_standalone_mode_rejects_registration(fresh_db):
    """Register is a multi-user concept; it's a 400 in standalone."""
    client = TestClient(create_app())
    r = client.post(
        "/api/users/register",
        json={"api_key": "whatever_16chars", "first_name": "x"},  # exactly 16
    )
    assert r.status_code == 400


def test_register_rate_limit_triggers_429(fresh_db):
    """Trips when a single IP burns through the bucket in under an hour."""
    settings = Settings(mode="multi_user", register_rate_per_hour=3)
    client = TestClient(create_app(settings=settings))
    # Three should succeed.
    for i, ch in enumerate("abc"):
        r = client.post(
            "/api/users/register",
            json={"api_key": f"rateLimit_{ch}__zz1", "first_name": f"u{i}"},
        )
        assert r.status_code == 201, r.text
    # Fourth trips the limiter.
    r = client.post(
        "/api/users/register",
        json={"api_key": "rateLimit_d__zz1", "first_name": "u3"},
    )
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_upload_body_size_cap(fresh_db):
    """Requests with Content-Length above the cap get 413 before reaching
    any handler — protects the capture pipeline from OOM attempts."""
    settings = Settings(mode="standalone", max_upload_bytes=1024)
    client = TestClient(create_app(settings=settings))
    r = client.post(
        "/api/results/upload",
        content=b"x" * 2048,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 413
    assert "1024" in r.json()["detail"]


def test_users_id_is_integer_not_api_key(fresh_db):
    """Sanity: /api/me exposes a numeric id that's different from the key."""
    settings = Settings(mode="multi_user")
    client = TestClient(create_app(settings=settings))
    r = client.post(
        "/api/users/register",
        json={"api_key": "integerUserId_ok", "first_name": "t"},
    )
    assert r.status_code == 201
    body = r.json()
    assert isinstance(body["id"], int)
    assert body["id"] >= 1
    assert body["api_key"] == "integerUserId_ok"

    # Data rows should record that integer — not the api_key.
    mat = client.post(
        "/api/materials", json={"name": "x"},
        headers={"X-User-Id": "integerUserId_ok"},
    ).json()
    assert mat["owner_id"] == body["id"]
