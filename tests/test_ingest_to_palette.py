from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


BASE = {"power": 50, "speed": 1000, "frequency": 60,
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


def test_ingest_404_on_missing_test(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    c = TestClient(create_app())
    r = c.post("/api/tests/9999/ingest-to-palette",
               json={"swatch_indices": [0], "mode": "averaged"})
    assert r.status_code == 404


def test_ingest_400_on_single_result_without_id(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [0], "mode": "single_result"})
    assert r.status_code == 400


def test_ingest_400_on_wrong_test_result(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    t1 = t_repo.create(name="A", material_id=mid, spec=SPEC)["id"]
    t2 = t_repo.create(name="B", material_id=mid, spec=SPEC)["id"]
    rid = c.post(f"/api/tests/{t1}/results",
                 files={"image": ("x.png", b"fake", "image/png")}).json()["id"]
    r = c.post(f"/api/tests/{t2}/ingest-to-palette", json={
        "swatch_indices": [0], "mode": "single_result", "result_id": rid,
    })
    assert r.status_code == 400


def test_ingest_422_on_empty_swatch_indices(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [], "mode": "averaged"})
    assert r.status_code == 422  # Pydantic validation error


def test_ingest_400_on_out_of_range_index(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.post(f"/api/tests/{tid}/ingest-to-palette",
               json={"swatch_indices": [999], "mode": "averaged"})
    assert r.status_code == 400


def test_ingest_is_idempotent_through_api(fresh_db, monkeypatch, tmp_path):
    """Re-calling POST /api/tests/{tid}/ingest-to-palette with the
    same body must not produce duplicate palette rows."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results",
           files={"image": ("x.png", b"fake", "image/png")})

    body = {"swatch_indices": [0, 1], "mode": "averaged"}
    c.post(f"/api/tests/{tid}/ingest-to-palette", json=body)
    c.post(f"/api/tests/{tid}/ingest-to-palette", json=body)

    entries = c.get(f"/api/palette?material_id={mid}").json()
    assert len(entries) == 2, (
        f"expected 2 entries after two identical ingest calls, got {len(entries)}"
    )


def test_ingest_validation_uses_per_cell_params_not_swept_index(
    fresh_db, monkeypatch, tmp_path,
):
    """Validation tests have no sweep — every cell carries its own
    frozen ``params`` dict in ``validation_cells``. The sampler uses
    ``x_min=0``, ``x_max=cell_count-1`` so ``swatch.x_value`` is the
    *cell index*, not a real param value. Re-ingest must read each
    cell's params from ``validation_cells`` instead of stamping the
    cell index onto the swept axis (``params["power"] = cell_index``)
    — the original bug produced palette rows with power=0..N-1, with
    the extremes ("power=99") obviously broken.

    This regression seeds two cells with hand-picked param dicts,
    fakes a capture that returns the corresponding swatches at
    (row, col) (0,0) + (0,1), and confirms the new palette entries
    carry the cells' frozen params verbatim — not the swept index."""
    from xcs_gen_web.repositories import validation_cells as vc_repo

    # Override the capture stub: row/col positions match the cell
    # layout (cells_per_row=2). x_value is the cell index because
    # bytes_for_test pins x_min=0/x_max=cell_count-1 — but we want the
    # ingest to ignore that and use validation_cells.params instead.
    def _validation_cap(*, image_bytes, test_id, spec):
        return cap.CaptureResult(
            swatches=[
                {"row": 0, "col": 0, "x_value": 0, "y_value": None,
                 "hex": "#aabbcc", "lab": [40, 5, -10], "sigma": 0.5},
                {"row": 0, "col": 1, "x_value": 1, "y_value": None,
                 "hex": "#ddeeff", "lab": [70, -5, 10], "sigma": 0.6},
            ],
            warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
        )

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _validation_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    val_spec = {
        **SPEC,
        "x_param": "power", "x_min": 0, "x_max": 1, "x_steps": 2,
        "cells_per_row": 2,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    # Two cells with very different params — including extreme values
    # the buggy path would have written from x_value (0 and 1).
    vc_repo.replace_for_test(test_id=tid, cells=[
        {"cell_index": 0, "expected_hex": "#aabbcc",
         "expected_lab": [40, 5, -10],
         "params": {
             "power": 14.6, "speed": 2400, "frequency": 125,
             "density": 5000, "passes": 2, "pulse_width": 200,
             "laser": "red", "scan_angle": 90,
         }},
        {"cell_index": 1, "expected_hex": "#ddeeff",
         "expected_lab": [70, -5, 10],
         "params": {
             "power": 8.9, "speed": 800, "frequency": 60,
             "density": 5000, "passes": 1, "pulse_width": 200,
             "laser": "red", "scan_angle": 90,
         }},
    ])
    c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("v.png", b"fake", "image/png")},
    )
    r = c.post(
        f"/api/tests/{tid}/ingest-to-palette",
        json={"swatch_indices": [0, 1], "mode": "averaged"},
    )
    assert r.status_code == 200, r.text

    entries = c.get(f"/api/palette?material_id={mid}").json()
    by_hex = {e["hex"]: e for e in entries}
    cell_a = by_hex["#aabbcc"]
    cell_b = by_hex["#ddeeff"]

    # Cell A came from cell_index=0; the buggy code would have written
    # power=0, speed=0. The fixed code uses validation_cells.params:
    assert cell_a["params"]["power"] == 14.6, (
        f"expected power=14.6 (from validation_cells), got {cell_a['params']['power']}"
    )
    assert cell_a["params"]["speed"] == 2400
    assert cell_a["params"]["frequency"] == 125

    # Cell B came from cell_index=1; the buggy code would have written
    # power=1.
    assert cell_b["params"]["power"] == 8.9, (
        f"expected power=8.9 (from validation_cells), got {cell_b['params']['power']}"
    )
    assert cell_b["params"]["speed"] == 800
    assert cell_b["params"]["frequency"] == 60


def test_ingest_sweep_unchanged_by_validation_branch(
    fresh_db, monkeypatch, tmp_path,
):
    """The validation-aware ingest branch must not alter sweep
    behaviour. A sweep test still gets ``params[x_param] = x_value``
    on every picked swatch."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    c.post(
        f"/api/tests/{tid}/ingest-to-palette",
        json={"swatch_indices": [0, 1], "mode": "averaged"},
    )
    entries = c.get(f"/api/palette?material_id={mid}").json()
    # Sweep speeds: 500, 1000 — pinned from x_value, base power stays.
    speeds = sorted(e["params"]["speed"] for e in entries)
    assert speeds == [500, 1000]
    powers = {e["params"]["power"] for e in entries}
    assert powers == {50}, f"sweep should keep base power; got {powers}"


def test_test_response_carries_ingested_flag(fresh_db, monkeypatch, tmp_path):
    """The list + detail endpoints expose a derived ``ingested`` flag
    so the FE can render an "ingested" pill on the test card alongside
    the status badge. Flag flips true once any palette entry references
    the test."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    # Pre-ingest: ingested is False.
    assert c.get(f"/api/tests/{tid}").json()["ingested"] is False
    assert c.get("/api/tests").json()[0]["ingested"] is False

    # Upload + ingest one swatch.
    c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    r = c.post(
        f"/api/tests/{tid}/ingest-to-palette",
        json={"swatch_indices": [0], "mode": "averaged"},
    )
    assert r.status_code == 200

    # Post-ingest: flag flips on both endpoints.
    assert c.get(f"/api/tests/{tid}").json()["ingested"] is True
    listed = c.get("/api/tests").json()
    assert next(t for t in listed if t["id"] == tid)["ingested"] is True
