"""Tests for sampling cells from a warped burn-space image."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.capture_sampling import (
    Swatch,
    sample_grid,
    sample_gradient,
)


def _make_warped_grid(cell_colors: list[list[tuple[int, int, int]]]) -> np.ndarray:
    """Build a synthetic warped image with uniform-color cells.

    Each cell is 50x50 px. `cell_colors[r][c]` is the (B,G,R) color of
    the cell at row r, col c.
    """
    rows = len(cell_colors)
    cols = len(cell_colors[0])
    img = np.zeros((rows * 50, cols * 50, 3), dtype=np.uint8)
    for r in range(rows):
        for c in range(cols):
            img[r * 50:(r + 1) * 50, c * 50:(c + 1) * 50] = cell_colors[r][c]
    return img


def test_sample_grid_recovers_uniform_cells():
    cells = [
        [(255, 0, 0), (0, 255, 0), (0, 0, 255)],      # BGR
        [(128, 128, 128), (200, 200, 200), (50, 50, 50)],
    ]
    img = _make_warped_grid(cells)

    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(30.0, 20.0),
        px_per_mm=5.0,
        x_param="speed", x_min=100, x_max=300, x_steps=3,
        y_param="power", y_min=10, y_max=50, y_steps=2,
    )
    assert len(swatches) == 6
    top_left = next(s for s in swatches if s.row == 0 and s.col == 0)
    assert top_left.hex == "#0000ff"  # BGR(255,0,0) → RGB(0,0,255)
    assert top_left.x_value == 100
    assert top_left.y_value == 10


def test_sample_grid_sigma_is_zero_for_uniform_cell():
    img = _make_warped_grid([[(100, 100, 100)]])
    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(10.0, 10.0),
        px_per_mm=5.0,
        x_param="speed", x_min=100, x_max=100, x_steps=1,
        y_param=None,
    )
    assert swatches[0].sigma < 0.5


def test_sample_gradient_returns_n_swatches_along_axis():
    cells = [[(i * 25, 0, 0) for i in range(10)]]
    img = _make_warped_grid(cells)

    swatches = sample_gradient(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(100.0, 5.0),
        px_per_mm=5.0,
        x_param="speed", x_min=100, x_max=1000, n_samples=10,
    )
    assert len(swatches) == 10
    assert swatches[0].x_value == 100
    assert swatches[-1].x_value == 1000


def test_swatch_is_dataclass_with_expected_fields():
    s = Swatch(row=1, col=2, x_value=300.0, y_value=50.0, hex="#abcdef", sigma=2.5)
    assert s.row == 1
    assert s.col == 2
    assert s.hex == "#abcdef"


def test_sample_cell_circle_excludes_corner_pixels():
    """For a 'circle' cell, corner pixels of the bounding rect should NOT
    be sampled. Setup: a 60x60 image with bright corners and a dark
    centre. The captured median should be near the centre value."""
    import numpy as np
    from xcs_gen_web.capture_sampling import _sample_cell

    img = np.full((60, 60, 3), 200, dtype=np.uint8)  # bright everywhere
    # Carve a 30px-diameter dark disc in the centre.
    yy, xx = np.ogrid[:60, :60]
    inside = (xx - 30) ** 2 + (yy - 30) ** 2 < 15 ** 2
    img[inside] = 50
    hex_, sigma = _sample_cell(
        img, cx_px=30, cy_px=30, w_px=60, h_px=60,
        cell_shape="circle", aggregator="median",
    )
    # Inscribed-circle 50% diameter = 30 px, fully inside the dark disc.
    # Median should be ~50, not ~200.
    r = int(hex_[1:3], 16)
    assert r < 100, f"expected near-50 median, got {hex_}"


def test_sample_cell_rect_uses_central_region():
    """Regression: cell_shape='rect' samples a centred window of size
    w_px * _CENTRAL_REGION_FRACTION, ignoring pixels outside it."""
    import numpy as np
    from xcs_gen_web.capture_sampling import _sample_cell, _CENTRAL_REGION_FRACTION

    img = np.full((100, 100, 3), 200, dtype=np.uint8)
    # Carve a centred dark patch wide enough to fully cover the sampling
    # window regardless of the chosen fraction.
    half = int(round(100 * _CENTRAL_REGION_FRACTION / 2))
    img[50 - half : 50 + half, 50 - half : 50 + half] = 50
    hex_, _ = _sample_cell(
        img, cx_px=50, cy_px=50, w_px=100, h_px=100,
        cell_shape="rect", aggregator="median",
    )
    # All pixels inside the central window are 50, so median should be 0x32.
    assert hex_ == "#323232"


def test_sample_cell_dispatches_aggregator():
    """The aggregator name routes to the correct pure function."""
    import numpy as np
    from xcs_gen_web.capture_sampling import _sample_cell

    img = np.full((40, 40, 3), 100, dtype=np.uint8)
    img[10:30, 10:30] = 200
    hex_median, _ = _sample_cell(
        img, cx_px=20, cy_px=20, w_px=40, h_px=40,
        cell_shape="rect", aggregator="median",
    )
    hex_mean, _ = _sample_cell(
        img, cx_px=20, cy_px=20, w_px=40, h_px=40,
        cell_shape="rect", aggregator="mean",
    )
    # In a region with mixed values, median != mean (in general).
    assert hex_median == "#c8c8c8"  # 200 dominates the inner 60%
    # Mean might equal it here too if region is uniform; the key thing
    # is both calls succeed and return valid hex strings.
    assert hex_mean.startswith("#") and len(hex_mean) == 7


# ── Pulse-width axes follow the machine's preset list ────────────────
#
# Regression: a frequency × pulse_width sweep (pulse_width 2–500 over 16
# rows) burns the 16 F2 Ultra presets — 2, 4, 6, 9, 13, … 350, 500 —
# but the sampler labelled the rows with a linear ramp (2, 35.2, 68.4,
# …). Row 8 burned at 60 ns was stored as 268 ns, and ingest copied
# that into the palette recipe. The sampler must agree with the burn.

_PW_PRESETS = [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500]


def _swatch_axis_values(swatches):
    return {(s.row, s.col): (s.x_value, s.y_value) for s in swatches}


def test_sample_grid_pulse_width_y_axis_uses_presets():
    img = _make_warped_grid([[(0, 0, 0)] * 3 for _ in range(16)])
    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(30.0, 160.0),
        px_per_mm=5.0,
        x_param="frequency", x_min=80, x_max=900, x_steps=3,
        y_param="pulse_width", y_min=2, y_max=500, y_steps=16,
    )
    ys = [s.y_value for s in swatches if s.col == 0]
    assert ys == _PW_PRESETS
    # The non-quantised axis keeps its linear ramp.
    assert [s.x_value for s in swatches if s.row == 0] == [80, 490, 900]


def test_sample_grid_pulse_width_x_axis_wrapped_1d_uses_presets():
    """Wrapped 1D: the value is indexed by the flat cell position."""
    img = _make_warped_grid([[(0, 0, 0)] * 3 for _ in range(3)])
    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(30.0, 30.0),
        px_per_mm=5.0,
        x_param="pulse_width", x_min=13, x_max=500, x_steps=9,
        y_param=None, rows=3, row_stride_mm=10.0,
    )
    assert [s.x_value for s in sorted(swatches, key=lambda s: (s.row, s.col))] == [
        13, 20, 30, 45, 60, 80, 100, 150, 200,
    ]


def test_sample_grid_axis_values_match_the_burned_cells():
    """The invariant the bug broke: (row, col) → params must be the
    same pair the .xcs builder burned into that cell."""
    from xcs_gen_web.services.xcs import _cell_list_for_test

    spec = {
        "x_param": "frequency", "x_min": 50, "x_max": 400, "x_steps": 4,
        "y_param": "pulse_width", "y_min": 13, "y_max": 500, "y_steps": 12,
        "base_params": {},
    }
    burned = _cell_list_for_test(test={"kind": "sweep", "spec": spec})

    img = _make_warped_grid([[(0, 0, 0)] * 4 for _ in range(12)])
    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(40.0, 120.0),
        px_per_mm=5.0,
        x_param=spec["x_param"], x_min=spec["x_min"], x_max=spec["x_max"],
        x_steps=spec["x_steps"],
        y_param=spec["y_param"], y_min=spec["y_min"], y_max=spec["y_max"],
        y_steps=spec["y_steps"],
    )
    sampled = [
        (s.x_value, s.y_value)
        for s in sorted(swatches, key=lambda s: (s.row, s.col))
    ]
    assert sampled == [(round(c["x_value"]), c["y_value"]) for c in burned]

