from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
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
            {"row": 0, "col": 1, "x_value": 1000, "y_value": None,
             "hex": "#00ff00", "lab": [0, 0, 0], "sigma": 1.2},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def test_upload_happy_path(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    r = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert len(body["swatches"]) == 2

    # status + lock promoted
    t = c.get(f"/api/tests/{tid}").json()
    assert t["status"] == "tested"
    assert t["locked"] is True


def test_averaged_swatches_endpoint(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.get(f"/api/tests/{tid}/swatches")
    assert r.status_code == 200
    rows = r.json()
    assert {rr["hex"] for rr in rows} == {"#ff0000", "#00ff00"}


def test_auto_upload_routes_photo_to_test_via_qr(fresh_db, monkeypatch, tmp_path):
    """POST /api/results/upload reads the QR to find the test id, then
    persists the result against that test — no tid in the URL."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    monkeypatch.setattr(cap, "detect_test_id", lambda _: tid)

    r = c.post(
        "/api/results/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert len(body["swatches"]) == 2
    # test should get promoted to tested just like the scoped endpoint
    t = c.get(f"/api/tests/{tid}").json()
    assert t["status"] == "tested"


def test_auto_upload_404_when_qr_matches_unknown_test(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "detect_test_id", lambda _: 9999)
    c = TestClient(create_app())
    r = c.post(
        "/api/results/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 404
    assert "9999" in r.json()["detail"]


def test_preflight_returns_test_info_and_existing_count(fresh_db, monkeypatch, tmp_path):
    """Preflight decodes the QR only (no persistence) so the modal can
    warn before re-processing a test that already has uploads."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="Speed sweep", material_id=mid, spec=SPEC)["id"]
    monkeypatch.setattr(cap, "detect_test_id", lambda _: tid)

    # No uploads yet.
    r = c.post(
        "/api/results/preflight",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "test_id": tid, "test_name": "Speed sweep",
        "existing_result_count": 0,
    }

    # After one upload, preflight reports the prior result count.
    c.post("/api/results/upload",
           files={"image": ("phone.jpg", b"fake", "image/jpeg")})
    r2 = c.post(
        "/api/results/preflight",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r2.json()["existing_result_count"] == 1

    # Preflight does not persist (still only 1 result after 2 preflights).
    assert len(c.get(f"/api/tests/{tid}/results").json()) == 1


def test_auto_upload_400_when_qr_missing(fresh_db, monkeypatch, tmp_path):
    def _no_qr(_):
        raise cap.CaptureError("no valid id-only QR detected")
    monkeypatch.setattr(cap, "detect_test_id", _no_qr)
    c = TestClient(create_app())
    r = c.post(
        "/api/results/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 400
    assert "QR" in r.json()["detail"]


def test_patch_excluded_flips_average(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    rid = r.json()["id"]
    c.patch(f"/api/results/{rid}", json={"excluded": True})
    assert c.get(f"/api/tests/{tid}/swatches").json() == []
