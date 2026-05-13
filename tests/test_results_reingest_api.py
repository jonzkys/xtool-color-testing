"""Reingest endpoint tests."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from xcs_gen_web import images
from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import results as r_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60,
                    "density": 200, "passes": 1, "pulse_width": 200,
                    "laser": "red"},
    "registration": {"mode": "on"},
}


def _fake_capture(*, image_bytes, test_id, spec, **_kwargs):
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def test_reingest_route_returns_404_for_missing_result(fresh_db):
    client = TestClient(create_app())
    resp = client.post("/api/results/9999/reingest")
    assert resp.status_code == 404


def test_reingest_invalidates_warped_sidecar(fresh_db, monkeypatch, tmp_path):
    """Reingesting a result must delete the previously-stored warped
    PNG sidecar, not orphan it on disk. Also doubles as a regression
    test that ``results_reingest`` stays a plain ``def`` handler — a
    flip back to ``async def`` would block the event loop on every
    capture run, but this test at least confirms the happy-path
    executes through the threadpool successfully."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    # 1. Upload → result created.
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert upload.status_code == 201, upload.text
    rid = upload.json()["id"]

    # 2. Hit /warped-image so the sidecar lands on disk + DB pointer.
    warped = c.get(f"/api/results/{rid}/warped-image")
    assert warped.status_code == 200

    # 3. Capture the warped_image_path from the row.
    row = r_repo.get(rid, owner_id=0)
    old_warped_path = row["warped_image_path"]
    assert old_warped_path, "expected /warped-image to populate sidecar path"
    # Sanity check: the file actually exists on disk before reingest.
    assert images.read(old_warped_path)  # raises FileNotFoundError on miss

    # 4. Reingest.
    r = c.post(f"/api/results/{rid}/reingest")
    assert r.status_code == 200, r.text

    # 5. DB pointer is nulled.
    refreshed = r_repo.get(rid, owner_id=0)
    assert refreshed["warped_image_path"] is None

    # 6. Old sidecar bytes are gone — not orphaned on disk.
    with pytest.raises(FileNotFoundError):
        images.read(old_warped_path)
