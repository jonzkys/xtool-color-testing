"""kind=validation tests render one cell per validation_cells row, each
with its own frozen params. Sweep math is bypassed entirely."""

from __future__ import annotations

import json

from xcs_gen_web.converter import project_to_xcs, project_to_xcs_bytes
from xcs_gen_web.schemas import Project
from xcs_gen_web.services.xcs import bytes_for_test


_BASE = {
    "power": 50, "speed": 1000, "frequency": 60,
    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
}


def _validation_project() -> Project:
    """Hand-build a single-test Project whose only test is kind=validation
    with three explicit cells. Each cell pins ``power`` to a different
    value; the renderer should emit three rects, one per cell, with the
    matching power."""
    cells = [
        {"cell_index": 0, "params": {"power": 8}},
        {"cell_index": 1, "params": {"power": 11}},
        {"cell_index": 2, "params": {"power": 14}},
    ]
    return Project.model_validate({
        "name": "v",
        "grid_gap_mm": 0,
        "focus_mm": 1.5,
        "tests": [{
            "row": 0, "col": 0, "col_span": 1,
            "test": {
                "id": "1", "name": "v", "material_id": "1",
                "x_param": "power", "x_min": 0, "x_max": 100,
                "x_steps": 3,
                "rows": 1,
                "width_mm": 30, "height_mm": 10, "gap_mm": 0,
                "cell_shape": "rect", "angle_mode": "fixed",
                "unidirectional": False,
                "hide_axis_labels": True,
                "base_params": _BASE,
                "kind": "validation",
                "validation_cells": cells,
            },
        }],
    })


def test_validation_kind_emits_one_cell_per_validation_row():
    project = _validation_project()
    xcs = project_to_xcs(project)

    # 3 rects, one per validation_cells row.
    assert len(xcs.elements) == 3, (
        f"expected 3 cells, got {len(xcs.elements)}"
    )

    # Each rect's params reflect the per-cell overlay (power) on top of
    # the base params (speed/frequency/etc. unchanged).
    powers = [r.params.power for r in xcs.elements]
    assert powers == [8, 11, 14], f"got {powers}"
    # Sanity: non-overridden fields stay on the base.
    for r in xcs.elements:
        assert r.params.speed == 1000
        assert r.params.mopa_frequency == 60
        assert r.params.density == 200
        assert r.params.pulse_width == 200


def test_validation_kind_skips_axis_labels():
    """Axis-label tick + label elements are suppressed because the swept
    x-axis carries no meaning when each cell has its own params."""
    project = _validation_project()
    xcs = project_to_xcs(project)

    # Summary text is still emitted — width-aware wrapping may turn it
    # into 1-3 stacked TEXT displays — but axis labels would add 5
    # ticks (LINE) + 5 labels (TEXT). The invariant we care about:
    # zero LINE displays and only a small number of TEXT displays
    # (just the wrapped summary, no per-cell axis ticks).
    types = [d.get("type") for d in xcs.extra_displays]
    assert types.count("LINE") == 0, (
        f"expected no axis-tick LINEs, got {types.count('LINE')} "
        f"(types={types})"
    )
    assert 1 <= types.count("TEXT") <= 3, (
        f"expected 1-3 summary TEXT displays, got {types.count('TEXT')} "
        f"(types={types})"
    )


def test_validation_kind_round_trips_through_bytes_for_test():
    """End-to-end: bytes_for_test → project_to_xcs_bytes → JSON.
    The three cells survive into the final XCS bytes."""
    spec = {
        "x_param": "power", "x_min": 0, "x_max": 100, "x_steps": 3,
        "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0,
        "cell_shape": "rect", "angle_mode": "fixed",
        "unidirectional": False, "base_params": _BASE,
        "registration": {"mode": "off"},
    }
    cells = [
        {"cell_index": 0, "params": {"power": 8}},
        {"cell_index": 1, "params": {"power": 11}},
        {"cell_index": 2, "params": {"power": 14}},
    ]
    raw = bytes_for_test(
        test_id=1, name="v", material_id=1, spec=spec,
        kind="validation", validation_cells=cells,
    )
    payload = json.loads(raw.decode("utf-8"))
    # Three RECT displays from the gradient layer (plus one TEXT for the
    # summary line). Filter to RECT to count cells.
    displays = payload["canvas"][0]["displays"]
    rects = [d for d in displays if d.get("type") == "RECT"]
    assert len(rects) == 3, f"expected 3 RECTs, got {len(rects)}"


def test_sweep_kind_unchanged_by_per_cell_branch():
    """A kind=sweep test (the legacy default) must still produce a sweep:
    cell power is interpolated across the x-axis."""
    project = Project.model_validate({
        "name": "s",
        "grid_gap_mm": 0,
        "focus_mm": 1.5,
        "tests": [{
            "row": 0, "col": 0, "col_span": 1,
            "test": {
                "id": "1", "name": "s", "material_id": "1",
                "x_param": "power", "x_min": 10, "x_max": 30,
                "x_steps": 3,
                "rows": 1,
                "width_mm": 30, "height_mm": 10, "gap_mm": 0,
                "cell_shape": "rect", "angle_mode": "fixed",
                "unidirectional": False,
                "hide_axis_labels": True,
                "base_params": _BASE,
                # kind defaults to "sweep"; validation_cells absent.
            },
        }],
    })
    xcs = project_to_xcs(project)
    powers = [r.params.power for r in xcs.elements]
    # Linear interp 10..30 over 3 steps: 10, 20, 30.
    assert powers == [10, 20, 30]


def test_validation_kind_supports_multi_param_overlay():
    """A cell's params dict can overlay multiple fields at once."""
    cells = [
        {"cell_index": 0, "params": {"power": 5, "speed": 800}},
        {"cell_index": 1, "params": {"power": 25, "speed": 1500}},
    ]
    project = Project.model_validate({
        "name": "v",
        "grid_gap_mm": 0,
        "focus_mm": 1.5,
        "tests": [{
            "row": 0, "col": 0, "col_span": 1,
            "test": {
                "id": "1", "name": "v", "material_id": "1",
                "x_param": "power", "x_min": 0, "x_max": 100, "x_steps": 2,
                "rows": 1,
                "width_mm": 20, "height_mm": 10, "gap_mm": 0,
                "cell_shape": "rect", "angle_mode": "fixed",
                "unidirectional": False, "hide_axis_labels": True,
                "base_params": _BASE,
                "kind": "validation", "validation_cells": cells,
            },
        }],
    })
    xcs = project_to_xcs(project)
    powers = [r.params.power for r in xcs.elements]
    speeds = [r.params.speed for r in xcs.elements]
    assert powers == [5, 25]
    assert speeds == [800, 1500]
    # Untouched fields fall through from base.
    for r in xcs.elements:
        assert r.params.mopa_frequency == 60
        assert r.params.density == 200


def test_project_to_xcs_bytes_validation_kind_serialises():
    """Full round-trip through JSON serialisation works."""
    project = _validation_project()
    raw = project_to_xcs_bytes(project)
    payload = json.loads(raw.decode("utf-8"))
    rects = [d for d in payload["canvas"][0]["displays"] if d.get("type") == "RECT"]
    assert len(rects) == 3
