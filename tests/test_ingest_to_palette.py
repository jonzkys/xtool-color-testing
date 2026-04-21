from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


BASE = {"power": 50, "speed": 1000, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}
SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _fake_cap(*, image_bytes, test_id, spec):
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": None,
             "hex": "#00ff00", "lab": [0, 0, 0], "sigma": 1.2},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def test_ingest_averaged(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [0, 1], "mode": "averaged"})
    assert r.status_code == 200
    assert r.json()["added"] == 2
    entries = c.get(f"/api/palette?material_id={mid}").json()
    assert len(entries) == 2
    assert {e["source"] for e in entries} == {"averaged"}


def test_ingest_single_result(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    rid = c.post(f"/api/tests/{tid}/results",
                 files={"image": ("x.png", b"fake", "image/png")}).json()["id"]
    r = c.post(f"/api/tests/{tid}/ingest-to-palette", json={
        "swatch_indices": [0],
        "mode": "single_result", "result_id": rid,
    })
    assert r.status_code == 200
    e = c.get(f"/api/palette?material_id={mid}").json()[0]
    assert e["source"] == "single_result"
    assert e["source_result_id"] == rid


def test_ingest_replace_existing(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    c.post(f"/api/tests/{tid}/ingest-to-palette",
           json={"swatch_indices": [0, 1], "mode": "averaged"})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [0], "mode": "averaged", "replace_existing": True})
    assert r.json()["added"] == 1
    assert len(c.get(f"/api/palette?material_id={mid}").json()) == 1
