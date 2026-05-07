"""``cells_per_row`` controls the wrapped-1D column count.

Validation tests pin a column count that often doesn't divide evenly
into ``x_steps``. Without an explicit ``cells_per_row`` plumbed into
the generator, ``_generate_wrapped`` derives the column count from
``ceil(x_steps / rows)``, which is wrong when the last row is partial
(e.g. 8 cells across 2 rows of cells_per_row=6 collapses to 4-per-row,
producing rectangular cells where square ones were intended).
"""

from __future__ import annotations

import math

from xcs_gen.generators import generate_gradient
from xcs_gen.model import Rect


def _gradient_rects(project) -> list[Rect]:
    """Return only the gradient cells (skip registration/strip/markers)."""
    from xcs_gen.model import GRADIENT_LAYER_COLOR
    return [
        el for el in project.elements
        if isinstance(el, Rect) and el.layer_color == GRADIENT_LAYER_COLOR
    ]


def test_cells_per_row_overrides_per_row_math_on_partial_last_row():
    # 8 cells, cells_per_row=6, rows=2 → first row 6, second row 2.
    # Without the kwarg, per_row collapses to ceil(8/2)=4.
    project = generate_gradient(
        x_param="power", x_min=10, x_max=80, x_steps=8,
        rows=2,
        total_width=23.94, total_height=3.574, gap=0.5,
        cells_per_row=6,
    )
    cells = _gradient_rects(project)
    assert len(cells) == 8
    expected_w = (23.94 - 5 * 0.5) / 6
    for c in cells:
        assert math.isclose(c.width, expected_w, abs_tol=1e-6), (
            f"cell width {c.width} != {expected_w}"
        )
        assert math.isclose(c.height, 3.574, abs_tol=1e-6)


def test_cells_per_row_omitted_keeps_legacy_behaviour():
    # Sweep test: no cells_per_row → per_row = ceil(x_steps/rows).
    project = generate_gradient(
        x_param="power", x_min=10, x_max=80, x_steps=12,
        rows=2,
        total_width=60.0, total_height=10.0, gap=0.5,
    )
    cells = _gradient_rects(project)
    assert len(cells) == 12
    # 12 cells in 2 rows = 6 per row → cell width (60 - 5*0.5)/6 = 9.583…
    expected_w = (60.0 - 5 * 0.5) / 6
    for c in cells:
        assert math.isclose(c.width, expected_w, abs_tol=1e-6)
