"""Endpoint tests for /api/spectrums (saved spectrums)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


_BASE_PARAMS = {
    "power": 50, "speed": 1000, "frequency": 60,
    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
}
_TEST_SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 6,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": _BASE_PARAMS,
    "registration": {"mode": "on"},
}


def _payload(tid: int, name: str = "spec", min_r2: float = 0.95) -> dict:
    return {
        "name": name,
        "source_test_id": tid,
        "axis_param": "speed",
        "axis_min": 1000.0,
        "axis_max": 3000.0,
        "fit_form": "polynomial",
        "fit_degree": 2,
        "fit_coefficients": {
            "l": [10.0, 0.022, 0.0],
            "a": [6.0, -0.0017, 0.0],
            "b": [-25.0, 0.005, 0.0],
        },
        "fit_r2": {"l": 0.999, "a": min_r2, "b": 0.92},
        "displayed_projection": "lightness",
        "swatches": [
            {"swatch_row": 0, "swatch_col": 1, "x_value": 1000.0,
             "hex": "#404060", "lab": [28.0, 5.0, -22.0]},
            {"swatch_row": 0, "swatch_col": 2, "x_value": 1500.0,
             "hex": "#506080", "lab": [38.0, 4.0, -25.0]},
            {"swatch_row": 0, "swatch_col": 3, "x_value": 2000.0,
             "hex": "#7080a0", "lab": [50.0, 3.0, -22.0]},
            {"swatch_row": 0, "swatch_col": 4, "x_value": 2500.0,
             "hex": "#90a0c0", "lab": [62.0, 2.0, -18.0]},
            {"swatch_row": 0, "swatch_col": 5, "x_value": 3000.0,
             "hex": "#b0c0e0", "lab": [75.0, 1.0, -10.0]},
        ],
    }


def _setup(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="Speed sweep", material_id=mid, spec=_TEST_SPEC)["id"]
    return c, tid


def test_post_creates_record_201(fresh_db):
    c, tid = _setup(fresh_db)
    r = c.post("/api/spectrums", json=_payload(tid))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] >= 1
    assert body["source_test_id"] == tid
    assert len(body["swatches"]) == 5
    # Bbox derived server-side.
    assert body["lab_l_min"] == 28.0
    assert body["lab_l_max"] == 75.0


def test_post_rejects_mismatched_coefficient_count_422(fresh_db):
    c, tid = _setup(fresh_db)
    payload = _payload(tid)
    payload["fit_coefficients"]["l"] = [10.0, 0.022]  # only 2 for degree 2
    r = c.post("/api/spectrums", json=payload)
    assert r.status_code == 422
    assert "coefficient" in r.text.lower() or "fit_coefficients" in r.text.lower()


def test_post_rejects_too_few_swatches_422(fresh_db):
    c, tid = _setup(fresh_db)
    payload = _payload(tid)
    payload["swatches"] = payload["swatches"][:1]  # one swatch
    r = c.post("/api/spectrums", json=payload)
    # Pydantic min_length=2 on swatches catches this.
    assert r.status_code == 422


def test_post_404_for_unknown_source_test(fresh_db):
    c, _ = _setup(fresh_db)
    payload = _payload(9999)
    r = c.post("/api/spectrums", json=payload)
    assert r.status_code == 404


def test_get_list_returns_records_for_machine(fresh_db):
    c, tid = _setup(fresh_db)
    c.post("/api/spectrums", json=_payload(tid, name="alpha"))
    c.post("/api/spectrums", json=_payload(tid, name="beta"))
    r = c.get("/api/spectrums")
    assert r.status_code == 200
    rows = r.json()
    assert {row["name"] for row in rows} == {"alpha", "beta"}


def test_get_list_filters_by_min_r2(fresh_db):
    c, tid = _setup(fresh_db)
    c.post("/api/spectrums", json=_payload(tid, name="weak", min_r2=0.5))
    c.post("/api/spectrums", json=_payload(tid, name="strong", min_r2=0.99))
    r = c.get("/api/spectrums?min_r2=0.9")
    rows = r.json()
    assert {row["name"] for row in rows} == {"strong"}


def test_get_detail_404_for_unknown_id(fresh_db):
    c, _ = _setup(fresh_db)
    r = c.get("/api/spectrums/9999")
    assert r.status_code == 404
