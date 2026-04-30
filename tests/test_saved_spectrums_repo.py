"""Repository unit tests for saved spectrums.

Covers:
* create() persists across all three tables and derives bbox/centroid
* get() reassembles the parent + children into the response shape
* delete() cascades to swatches + coefficients
* delete_test() preserves the saved spectrum but nulls source_test_id
"""

from __future__ import annotations

from xcs_gen_web.repositories import saved_spectrums as ss_repo
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

# Five mid-grey-to-blue swatches inside a fictional crop on speed.
_SWATCHES = [
    {"swatch_row": 0, "swatch_col": 1, "x_value": 1000.0,
     "hex": "#404060", "lab": (28.0, 5.0, -22.0)},
    {"swatch_row": 0, "swatch_col": 2, "x_value": 1500.0,
     "hex": "#506080", "lab": (38.0, 4.0, -25.0)},
    {"swatch_row": 0, "swatch_col": 3, "x_value": 2000.0,
     "hex": "#7080a0", "lab": (50.0, 3.0, -22.0)},
    {"swatch_row": 0, "swatch_col": 4, "x_value": 2500.0,
     "hex": "#90a0c0", "lab": (62.0, 2.0, -18.0)},
    {"swatch_row": 0, "swatch_col": 5, "x_value": 3000.0,
     "hex": "#b0c0e0", "lab": (75.0, 1.0, -10.0)},
]
_FIT_COEFFS = {
    "l": [10.0, 0.022, 0.0],            # degree 2: c0 + c1*x + c2*x^2
    "a": [6.0, -0.0017, 0.0],
    "b": [-25.0, 0.005, 0.0],
}
_FIT_R2 = {"l": 0.999, "a": 0.95, "b": 0.92}


def _setup_test(fresh_db) -> int:
    mid = m_repo.create(name="SS Tag")["id"]
    return t_repo.create(name="Speed sweep", material_id=mid, spec=_TEST_SPEC)["id"]


def test_create_persists_across_three_tables_and_derives_bbox(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "SS Blue 1000-3000",
        "source_test_id": tid,
        "axis_param": "speed",
        "axis_min": 1000.0,
        "axis_max": 3000.0,
        "fit_form": "polynomial",
        "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS,
        "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })

    # Top-level columns
    assert rec["id"] >= 1
    assert rec["name"] == "SS Blue 1000-3000"
    assert rec["source_test_id"] == tid
    assert rec["axis_param"] == "speed"
    assert rec["fit_degree"] == 2
    assert rec["fit_r2"]["l"] == 0.999
    assert rec["fit_r2_min"] == 0.92  # min across L/a/b

    # Bbox derived server-side from the swatches.
    assert rec["lab_l_min"] == 28.0
    assert rec["lab_l_max"] == 75.0
    assert rec["lab_a_min"] == 1.0
    assert rec["lab_a_max"] == 5.0
    assert rec["lab_b_min"] == -25.0
    assert rec["lab_b_max"] == -10.0

    # Centroids = mean of each channel.
    assert abs(rec["lab_l_centroid"] - (28+38+50+62+75)/5) < 1e-9
    assert abs(rec["lab_a_centroid"] - (5+4+3+2+1)/5) < 1e-9

    # Children round-trip.
    assert len(rec["swatches"]) == 5
    assert {s["x_value"] for s in rec["swatches"]} == {1000.0, 1500.0, 2000.0, 2500.0, 3000.0}
    assert rec["fit_coefficients"]["l"] == [10.0, 0.022, 0.0]


def test_get_returns_full_record(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "thing", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })
    got = ss_repo.get(rec["id"])
    assert got is not None
    assert got["id"] == rec["id"]
    assert len(got["swatches"]) == 5
    assert set(got["fit_coefficients"].keys()) == {"l", "a", "b"}


def test_delete_cascades_to_children(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "thing", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })
    ss_repo.delete(rec["id"])
    assert ss_repo.get(rec["id"]) is None
    # Direct count check on children.
    from xcs_gen_web.db import session_scope
    from xcs_gen_web.models import (
        saved_spectrum_swatches, saved_spectrum_fit_coefficients,
    )
    from sqlalchemy import select, func
    with session_scope() as s:
        n_sw = s.execute(
            select(func.count()).select_from(saved_spectrum_swatches)
            .where(saved_spectrum_swatches.c.saved_spectrum_id == rec["id"])
        ).scalar()
        n_co = s.execute(
            select(func.count()).select_from(saved_spectrum_fit_coefficients)
            .where(saved_spectrum_fit_coefficients.c.saved_spectrum_id == rec["id"])
        ).scalar()
        assert n_sw == 0
        assert n_co == 0


def test_source_test_delete_nulls_reference(fresh_db):
    tid = _setup_test(fresh_db)
    rec = ss_repo.create({
        "name": "thing", "source_test_id": tid,
        "axis_param": "speed", "axis_min": 1000.0, "axis_max": 3000.0,
        "fit_form": "polynomial", "fit_degree": 2,
        "fit_coefficients": _FIT_COEFFS, "fit_r2": _FIT_R2,
        "displayed_projection": "lightness",
        "swatches": _SWATCHES,
    })
    t_repo.delete(tid)
    got = ss_repo.get(rec["id"])
    assert got is not None
    assert got["source_test_id"] is None
    assert len(got["swatches"]) == 5  # data preserved
