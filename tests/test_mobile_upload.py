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


import pytest


def test_get_or_create_mobile_id_raises_for_unknown_user(fresh_db):
    with pytest.raises(ValueError, match="no such user"):
        u_repo.get_or_create_mobile_id(99999)


def test_rotate_mobile_id_makes_new_resolve_and_old_dead(fresh_db):
    user = u_repo.register(api_key="dddddddddddddddd", first_name="D")
    old = u_repo.get_or_create_mobile_id(user["id"])
    new = u_repo.rotate_mobile_id(user["id"])
    assert u_repo.get_by_mobile_id(new) is not None
    assert u_repo.get_by_mobile_id(old) is None


def test_rotate_mobile_id_raises_for_unknown_user(fresh_db):
    with pytest.raises(ValueError, match="no such user"):
        u_repo.rotate_mobile_id(99999)


def test_get_by_mobile_id_returns_none_for_empty_string(fresh_db):
    assert u_repo.get_by_mobile_id("") is None


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
