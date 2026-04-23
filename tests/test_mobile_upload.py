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

    # The result row should be tagged via='mobile'.
    from xcs_gen_web.repositories import results as r_repo
    row = r_repo.get(rid, owner_id=_owner_id(c, h))
    assert row["via"] == "mobile"


def test_mobile_upload_rate_limit_blocks_after_cap(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_MOBILE_UPLOAD_RATE_PER_HOUR", "2")
    monkeypatch.setenv("XCS_GEN_MOBILE_UPLOAD_RATE_PER_DAY", "999")
    c, h = _multi_user_client(monkeypatch)
    mid, tid = _seed_user_with_test(c, h, monkeypatch, tmp_path)

    # Wrap detect_test_id so we can assert the blocked request never
    # reaches the fiducial pipeline (proves the limiter short-circuits
    # BEFORE expensive work, not just somewhere upstream of the response).
    detect_calls: list[bytes] = []
    def _counting_detect(data):
        detect_calls.append(data)
        return tid
    monkeypatch.setattr(cap, "detect_test_id", _counting_detect)

    for _ in range(2):
        r = c.post(
            f"/api/m/{mid}/upload",
            files={"image": ("p.jpg", b"fake", "image/jpeg")},
        )
        assert r.status_code == 201
    assert len(detect_calls) == 2

    r = c.post(
        f"/api/m/{mid}/upload",
        files={"image": ("p.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    # Critical assertion: the blocked request did NOT reach detect_test_id.
    assert len(detect_calls) == 2


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
