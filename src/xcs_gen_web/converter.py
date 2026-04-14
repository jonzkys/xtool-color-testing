"""Convert a validated Project into a single XCSProject by merging generated tests."""

from __future__ import annotations

import json

from xcs_gen.builder import build_xcs
from xcs_gen.generators import generate_gradient
from xcs_gen.model import ProcessingParams, XCSProject

from .schemas import BaseParams, Project

# Offset from canvas (0,0) where the composition starts. Leaves margin from
# the edge of the XCS canvas so tests aren't flush against the origin.
CANVAS_ORIGIN_X = 10.0
CANVAS_ORIGIN_Y = 10.0


def validate_placements(project: Project) -> None:
    """Raise ValueError if any grid placements overlap."""
    # Build a set of occupied (row, col) cells accounting for col_span
    occupied: dict[tuple[int, int], str] = {}
    for placement in project.tests:
        for c in range(placement.col, placement.col + placement.col_span):
            cell = (placement.row, c)
            if cell in occupied:
                raise ValueError(
                    f"Test placements overlap at row={placement.row} col={c} "
                    f"(test '{placement.test.name}' and '{occupied[cell]}')"
                )
            occupied[cell] = placement.test.name


def _to_processing_params(bp: BaseParams) -> ProcessingParams:
    return ProcessingParams(
        power=bp.power,
        speed=bp.speed,
        mopa_frequency=bp.frequency,
        density=bp.density,
        repeat=bp.passes,
        pulse_width=bp.pulse_width,
        processing_light_source=bp.laser,
    )


def _compute_grid_offsets(project: Project) -> dict[str, tuple[float, float]]:
    """Return a dict mapping test.id -> (x_offset, y_offset) in the composition."""
    # Determine each column's width as the max width of tests in that column
    # (accounting for col_span by dividing width across spans).
    col_widths: dict[int, float] = {}
    row_heights: dict[int, float] = {}

    for placement in project.tests:
        t = placement.test
        # Width this placement contributes per column
        per_col_width = t.width_mm / placement.col_span
        for c in range(placement.col, placement.col + placement.col_span):
            col_widths[c] = max(col_widths.get(c, 0.0), per_col_width)
        row_heights[placement.row] = max(row_heights.get(placement.row, 0.0), t.height_mm)

    # Compute cumulative offsets
    cols = sorted(col_widths)
    rows = sorted(row_heights)
    gap = project.grid_gap_mm

    col_x: dict[int, float] = {}
    x = 0.0
    for c in cols:
        col_x[c] = x
        x += col_widths[c] + gap

    row_y: dict[int, float] = {}
    y = 0.0
    for r in rows:
        row_y[r] = y
        y += row_heights[r] + gap

    offsets: dict[str, tuple[float, float]] = {}
    for placement in project.tests:
        offsets[placement.test.id] = (
            col_x[placement.col],
            row_y[placement.row],
        )
    return offsets


def project_to_xcs(project: Project) -> XCSProject:
    """Convert a Project into a single merged XCSProject.

    Raises:
        ValueError: If any grid placements overlap.
    """
    validate_placements(project)

    offsets = _compute_grid_offsets(project)

    # Generate each test with its computed offset, merging all under a single canvas_id.
    # The builder requires one canvas_id per XCSProject; extra_device_entries
    # reference display UUIDs (not canvas_id), so the merge is safe.
    merged = XCSProject()
    for i, placement in enumerate(project.tests):
        t = placement.test
        x_off, y_off = offsets[t.id]

        generated = generate_gradient(
            x_param=t.x_param,
            x_min=t.x_min,
            x_max=t.x_max,
            x_steps=t.x_steps,
            y_param=t.y_param,
            # y_* sentinels are ignored when y_param is None (see generate_gradient).
            y_min=t.y_min if t.y_min is not None else 0,
            y_max=t.y_max if t.y_max is not None else 0,
            y_steps=t.y_steps if t.y_steps is not None else 1,
            rows=t.rows,
            total_width=t.width_mm,
            total_height=t.height_mm,
            gap=t.gap_mm,
            start_x=CANVAS_ORIGIN_X + x_off,
            start_y=CANVAS_ORIGIN_Y + y_off,
            base_params=_to_processing_params(t.base_params),
        )

        if i == 0:
            merged.canvas_id = generated.canvas_id
        merged.elements.extend(generated.elements)
        merged.extra_displays.extend(generated.extra_displays)
        merged.extra_device_entries.extend(generated.extra_device_entries)

    return merged


def project_to_xcs_bytes(project: Project) -> bytes:
    """Convert a Project to .xcs file bytes."""
    xcs = project_to_xcs(project)
    data = build_xcs(xcs)
    return json.dumps(data, separators=(",", ":")).encode("utf-8")
