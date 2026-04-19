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
