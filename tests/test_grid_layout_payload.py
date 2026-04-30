"""Tests for the public grid-layout payload exposed via
``GET /api/results/{rid}/grid-layout``.

The payload is a pure function of a result's ``TestSpec``. The frontend
uses these numbers to reverse-map a mouse position back to a (row, col)
swatch index, so the math here MUST agree with the sampler's
``_cell_bounds_px`` — otherwise hover would land on a different cell
than the one that was sampled.
"""

import pytest

from xcs_gen_web.services.capture import (
    _cell_bounds_px,
    _grid_layout_for_warped,
    grid_layout_payload,
)


def _2d_spec() -> dict:
    """6×4 2D test, each cell 10×10 mm, axis labels hidden."""
    return {
        "x_param": "power", "x_min": 0.0, "x_max": 100.0, "x_steps": 6,
        "y_param": "speed", "y_min": 100.0, "y_max": 1000.0, "y_steps": 4,
        "rows": 1,
        "width_mm": 60.0, "height_mm": 40.0,
        "hide_axis_labels": True,
    }


def _wrapped_1d_spec() -> dict:
    """10-step 1D test wrapped across 3 rows (4 + 4 + 2)."""
    return {
        "x_param": "power", "x_min": 0.0, "x_max": 100.0, "x_steps": 10,
        "y_param": None,
        "rows": 3,
        "width_mm": 40.0, "height_mm": 8.0,
        "hide_axis_labels": True,
    }


def _single_row_1d_spec() -> dict:
    return {
        "x_param": "power", "x_min": 0.0, "x_max": 100.0, "x_steps": 8,
        "y_param": None,
        "rows": 1,
        "width_mm": 80.0, "height_mm": 10.0,
        "hide_axis_labels": False,
    }


def test_2d_grid_payload_keys_present():
    p = grid_layout_payload(_2d_spec())
    for key in [
        "image_width_px", "image_height_px",
        "grid_origin_x_px", "grid_origin_y_px",
        "cell_width_px", "cell_height_px", "row_stride_px",
        "cells_per_physical_row", "physical_rows", "px_per_mm",
    ]:
        assert key in p, f"missing key {key}"


def test_2d_marked_as_2d():
    """The frontend keys off ``is_2d`` to switch swatch-index resolution."""
    p = grid_layout_payload(_2d_spec())
    assert p["is_2d"] is True
    assert p["cells_per_physical_row"] == 6  # x_steps
    assert p["physical_rows"] == 4


def test_wrapped_1d_cells_per_physical_row_set():
    p = grid_layout_payload(_wrapped_1d_spec())
    # 10 steps wrapped across 3 rows → ceil(10/3) = 4 per row
    assert p["cells_per_physical_row"] == 4
    assert p["physical_rows"] == 3
    assert p["is_2d"] is False


def test_single_row_1d_cells_per_physical_row_matches_x_steps():
    p = grid_layout_payload(_single_row_1d_spec())
    assert p["cells_per_physical_row"] == 8
    assert p["physical_rows"] == 1


def test_px_per_mm_is_10():
    """Pinned at 10 px/mm across the capture pipeline. If this
    changes someone is making an architectural decision and several
    places in the code break in concert."""
    assert grid_layout_payload(_2d_spec())["px_per_mm"] == pytest.approx(10.0)


def test_payload_forward_math_matches_internal_sampler_2d():
    """The public payload's forward formula MUST land on the same
    pixel rect that the sampler hit. Cross-check a few cells."""
    spec = _2d_spec()
    p = grid_layout_payload(spec)
    g = _grid_layout_for_warped(spec)
    for row, col in [(0, 0), (3, 5), (2, 3)]:
        x0_internal, y0_internal, x1_internal, y1_internal = _cell_bounds_px(g, row, col)
        cell_left = p["grid_origin_x_px"] + col * p["cell_width_px"]
        cell_top = p["grid_origin_y_px"] + row * p["row_stride_px"]
        cell_right = cell_left + p["cell_width_px"]
        cell_bottom = cell_top + p["cell_height_px"]
        # internal rounds, public is float — compare within 1 px
        assert abs(cell_left - x0_internal) <= 1, f"({row},{col}) left"
        assert abs(cell_top - y0_internal) <= 1, f"({row},{col}) top"
        assert abs(cell_right - x1_internal) <= 1, f"({row},{col}) right"
        assert abs(cell_bottom - y1_internal) <= 1, f"({row},{col}) bottom"


def test_payload_forward_math_matches_internal_sampler_wrapped_1d():
    """Wrapped 1D — physical row drives Y, displayed col drives X.
    Picking cells in each of the 3 physical rows."""
    spec = _wrapped_1d_spec()
    p = grid_layout_payload(spec)
    g = _grid_layout_for_warped(spec)
    # physical (row=0, col=2), (row=1, col=0), (row=2, col=1)
    for prow, pcol in [(0, 2), (1, 0), (2, 1)]:
        x0_internal, y0_internal, _, _ = _cell_bounds_px(g, prow, pcol)
        cell_left = p["grid_origin_x_px"] + pcol * p["cell_width_px"]
        cell_top = p["grid_origin_y_px"] + prow * p["row_stride_px"]
        assert abs(cell_left - x0_internal) <= 1
        assert abs(cell_top - y0_internal) <= 1


def test_image_dims_cover_grid_extent():
    """The reported image width/height must be at least as big as the
    bottom-right of the last cell, otherwise the frontend will
    erroneously reject in-bounds hovers."""
    spec = _2d_spec()
    p = grid_layout_payload(spec)
    last_cell_right = (
        p["grid_origin_x_px"] + spec["x_steps"] * p["cell_width_px"]
    )
    last_cell_bottom = (
        p["grid_origin_y_px"] + p["physical_rows"] * p["row_stride_px"]
    )
    assert p["image_width_px"] >= last_cell_right
    assert p["image_height_px"] >= last_cell_bottom


def test_image_dims_cover_grid_extent_wrapped_1d():
    p = grid_layout_payload(_wrapped_1d_spec())
    last_cell_right = (
        p["grid_origin_x_px"] + p["cells_per_physical_row"] * p["cell_width_px"]
    )
    # Wrapped 1D: last physical row's bottom = origin + (rows-1)*stride + cell_height
    last_cell_bottom = (
        p["grid_origin_y_px"]
        + (p["physical_rows"] - 1) * p["row_stride_px"]
        + p["cell_height_px"]
    )
    assert p["image_width_px"] >= last_cell_right
    assert p["image_height_px"] >= last_cell_bottom


def test_axis_labels_visible_increases_row_stride_for_wrapped_1d():
    """When axis labels are visible, the inter-row gap is bigger
    (room for tick + label glyph). row_stride_px reflects that;
    cell_height_px doesn't."""
    hidden = grid_layout_payload({**_wrapped_1d_spec(), "hide_axis_labels": True})
    visible = grid_layout_payload({**_wrapped_1d_spec(), "hide_axis_labels": False})
    assert visible["row_stride_px"] > hidden["row_stride_px"]
    assert visible["cell_height_px"] == hidden["cell_height_px"]


def test_2d_row_stride_equals_cell_height():
    """2D layouts have no inter-row gap — the grid is one tight block."""
    p = grid_layout_payload(_2d_spec())
    assert p["row_stride_px"] == pytest.approx(p["cell_height_px"])
