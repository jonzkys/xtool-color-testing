"""Regression: validation tests inherit ``rows=1`` from their source
sweep but actually burn ``ceil(cell_count / cells_per_row)`` physical
rows. The capture/inspect pipeline must see the derived rows so the
sampling grid lands on every burned row, not just the top one.

Bug source: Test #51 (production) was a kind=validation test with 18
cells / cells_per_row=6 / spec.rows=1. The DEBUG modal's
WARPED + SAMPLING GRID overlay only drew row 1's bounding box and
the per-row strip only rendered ROW 1.
"""

from __future__ import annotations

from xcs_gen_web.services import capture as capture_service
from xcs_gen_web.services.xcs import effective_spec_for_layout


_SWEEP_SPEC = {
    "x_param": "power", "x_min": 0, "x_max": 100, "x_steps": 6,
    "y_param": None, "y_min": None, "y_max": None, "y_steps": None,
    "rows": 1, "width_mm": 30, "height_mm": 5, "gap_mm": 0,
    "cell_shape": "rect", "angle_mode": "fixed",
    "unidirectional": False, "hide_axis_labels": False,
    "base_params": {
        "power": 50, "speed": 1000, "frequency": 60,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
    },
    "registration": {"mode": "on"},
    "cells_per_row": 6,
}


def _validation_test(*, cell_count: int, cells_per_row: int) -> dict:
    cells = [{"cell_index": i, "params": {"power": 10 + i}} for i in range(cell_count)]
    spec = {**_SWEEP_SPEC, "cells_per_row": cells_per_row}
    return {
        "id": 51, "name": "v", "kind": "validation",
        "spec": spec,
        "validation_cells": cells,
    }


def test_effective_spec_derives_rows_from_cells_per_row():
    """18 cells / cells_per_row=6 → rows=3. The stored spec.rows=1 must
    be overridden so the capture pipeline sees three physical rows."""
    eff = effective_spec_for_layout(
        spec=_SWEEP_SPEC,
        kind="validation",
        validation_cells=[{"cell_index": i, "params": {}} for i in range(18)],
    )
    assert eff["rows"] == 3, f"expected 3 rows, got {eff['rows']}"
    assert eff["x_steps"] == 18, "x_steps should equal cell_count"
    assert eff["y_param"] is None
    assert eff["hide_axis_labels"] is True


def test_effective_spec_handles_partial_last_row():
    """13 cells / cells_per_row=6 → ceil(13/6) = 3 physical rows."""
    eff = effective_spec_for_layout(
        spec=_SWEEP_SPEC,
        kind="validation",
        validation_cells=[{"cell_index": i, "params": {}} for i in range(13)],
    )
    assert eff["rows"] == 3
    assert eff["x_steps"] == 13


def test_effective_spec_passes_sweep_through_unchanged():
    """Sweep tests don't have validation_cells; the spec must be
    untouched so existing sweep behaviour is preserved."""
    eff = effective_spec_for_layout(spec=_SWEEP_SPEC, kind="sweep")
    assert eff is _SWEEP_SPEC, "sweep should return the same spec object"


def test_capture_effective_spec_rewires_rows_for_validation_test_row():
    """capture_service.effective_spec is the boundary helper used by
    every API handler. A test row with kind=validation + 18 cells +
    cells_per_row=6 must come back with rows=3."""
    t = _validation_test(cell_count=18, cells_per_row=6)
    eff = capture_service.effective_spec(t)
    assert eff["rows"] == 3
    assert eff["x_steps"] == 18


def test_capture_effective_spec_no_op_for_sweep():
    """Sweep tests pass through capture_service.effective_spec
    unchanged — no validation_cells, no kind override."""
    sweep_t = {"id": 1, "kind": "sweep", "spec": _SWEEP_SPEC, "validation_cells": []}
    eff = capture_service.effective_spec(sweep_t)
    assert eff is _SWEEP_SPEC


def test_grid_layout_payload_for_validation_reports_correct_row_count():
    """End-to-end check: the GridLayout payload (which the cell-inspector
    overlay reads) reports the validation test's true physical rows."""
    t = _validation_test(cell_count=18, cells_per_row=6)
    eff = capture_service.effective_spec(t)
    payload = capture_service.grid_layout_payload(eff)
    # Wrapped 1D layouts surface their row count in physical_rows;
    # stride_px must be > 0 (sampler advances to the next row).
    assert payload["physical_rows"] == 3
    assert payload["cells_per_physical_row"] == 6
    assert payload["row_stride_px"] > 0


def test_grid_row_count_for_validation_test():
    """The /debug/row-count endpoint feeds the result-debug modal's
    "how many rows do I need to fetch?" loop. With the bug, it always
    answered 1; now it answers ceil(cells / cells_per_row)."""
    t = _validation_test(cell_count=18, cells_per_row=6)
    eff = capture_service.effective_spec(t)
    rows = capture_service.grid_row_count(eff)
    assert rows == 3


def test_validation_layout_consistency_across_pipeline():
    """The .xcs builder and the capture pipeline must agree on rows
    so the sampling grid lands on the same cells the burn rendered.
    Regression for the production divergence that drove this fix."""
    t = _validation_test(cell_count=18, cells_per_row=6)
    capture_eff = capture_service.effective_spec(t)
    builder_eff = effective_spec_for_layout(
        spec=t["spec"], kind="validation",
        validation_cells=t["validation_cells"],
    )
    # Same row count, same x_steps — cell-width math, sampling grid,
    # and stride must all line up across the two consumers.
    assert capture_eff["rows"] == builder_eff["rows"] == 3
    assert capture_eff["x_steps"] == builder_eff["x_steps"] == 18


def test_no_cells_per_row_falls_back_to_stored_rows():
    """Older validation tests created before cells_per_row existed
    keep using their stored ``rows``. A test with stored rows=2 and
    no cells_per_row should still report 2 rows — the override only
    kicks in when cells_per_row is explicitly set."""
    spec = {**_SWEEP_SPEC, "rows": 2}
    spec.pop("cells_per_row", None)
    eff = effective_spec_for_layout(
        spec=spec,
        kind="validation",
        validation_cells=[{"cell_index": i, "params": {}} for i in range(4)],
    )
    assert eff["rows"] == 2


def test_one_row_validation_does_not_get_promoted():
    """A single-row validation test (cell_count <= cells_per_row)
    stays at rows=1 so the legacy single-row sampler path runs."""
    t = _validation_test(cell_count=4, cells_per_row=6)
    eff = capture_service.effective_spec(t)
    assert eff["rows"] == 1
    assert eff["x_steps"] == 4
