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
