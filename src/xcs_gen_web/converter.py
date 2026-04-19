"""Convert a validated Project into a single XCSProject by merging generated tests."""

from __future__ import annotations

import json
import math
from dataclasses import replace

from xcs_gen.builder import build_xcs
from xcs_gen.capture.layout import registration_reservation_mm
from xcs_gen.generators import generate_gradient
from xcs_gen.model import ProcessingParams, Rect, XCSProject, _uuid
from xcs_gen.text import text_height

from .schemas import BaseParams, ParamTest, Project

# F2 Ultra MOPA beam spot size. Mirrors web/src/validation.ts BEAM_WIDTH_MM.
BEAM_WIDTH_MM = 0.03

# Offset from canvas (0,0) where the composition starts. Leaves margin from
# the edge of the XCS canvas so tests aren't flush against the origin.
CANVAS_ORIGIN_X = 10.0
CANVAS_ORIGIN_Y = 10.0

# Must match generate_gradient defaults.
# Kept in sync manually; changing those generator defaults requires updating these.
_LABEL_FONT_SIZE = 3.0
_TICK_LENGTH = 0.5


def _annotation_space_below() -> float:
    """Vertical space below a gradient for the X axis tick marks + labels.

    Mirrors the layout in _add_tick_and_label: tick + 0.05 gap + text + 0.05 padding.
    """
    return _TICK_LENGTH + 0.05 + text_height(_LABEL_FONT_SIZE) + 0.05


def _summary_space_above() -> float:
    """Vertical space above a gradient for the summary text line."""
    return text_height(_LABEL_FONT_SIZE) + 0.05


def _test_vertical_footprint(t: ParamTest) -> float:
    """Total vertical space a test occupies, including summary and axis labels.

    For multi-row tests (rows > 1), the generator auto-expands row_gap to fit
    inter-row annotations, so the full stack is larger than rows * height_mm.

    When registration markers are enabled, the generator shifts the entire
    test content down by the registration reservation so markers don't end up
    at negative coordinates; add that shift to the footprint so stacked tests
    don't overlap.
    """
    summary = _summary_space_above()
    ann_below = _annotation_space_below()

    if t.rows > 1:
        # generate_gradient uses effective_row_gap = max(row_gap, ann_space)
        effective_row_gap = max(1.0, ann_below)
        gradient_h = t.rows * t.height_mm + (t.rows - 1) * effective_row_gap
    else:
        gradient_h = t.height_mm

    reg_shift = registration_reservation_mm(
        t.registration.mode, t.registration.qr_mode
    )

    return reg_shift + summary + gradient_h + ann_below


def _test_horizontal_footprint(t: ParamTest) -> float:
    """Total horizontal space a test occupies.

    Matches _test_vertical_footprint: when registration is enabled the grid
    shifts right by the reservation, so the column must allocate that extra
    width.
    """
    reg_shift = registration_reservation_mm(
        t.registration.mode, t.registration.qr_mode
    )
    return reg_shift + t.width_mm


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


def validate_beam_widths(project: Project) -> None:
    """Raise ValueError if any test has element width below the beam spot size.

    Sub-beam-width elements will merge into each other when engraved, producing
    no visible gradient. This is a hard block: the generated file would be wrong.
    """
    for placement in project.tests:
        t = placement.test
        per_row = math.ceil(t.x_steps / t.rows)
        elem_w = (t.width_mm - max(0, per_row - 1) * t.gap_mm) / per_row
        if elem_w > 0 and elem_w < BEAM_WIDTH_MM:
            raise ValueError(
                f"Test '{t.name}': element width {elem_w:.4f}mm is below beam "
                f"spot {BEAM_WIDTH_MM}mm - adjacent elements will merge. "
                f"Reduce steps or increase width."
            )


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
        # Width this placement contributes per column, including any space
        # reserved for registration markers.
        per_col_width = _test_horizontal_footprint(t) / placement.col_span
        for c in range(placement.col, placement.col + placement.col_span):
            col_widths[c] = max(col_widths.get(c, 0.0), per_col_width)
        row_heights[placement.row] = max(row_heights.get(placement.row, 0.0), _test_vertical_footprint(t))

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
        ValueError: If any grid placements overlap or any element width
            is below the beam spot size.
    """
    validate_placements(project)
    validate_beam_widths(project)

    offsets = _compute_grid_offsets(project)

    # Generate each test with its computed offset, merging all under a single canvas_id.
    # The builder requires one canvas_id per XCSProject; extra_device_entries
    # reference display UUIDs (not canvas_id), so the merge is safe.
    merged = XCSProject()
    for i, placement in enumerate(project.tests):
        t = placement.test
        x_off, y_off = offsets[t.id]

        # Crosshatch suffix shown in the per-test summary line (e.g. "x3@60°").
        summary_suffix = ""
        if t.crosshatch_enabled and t.crosshatch_passes > 1:
            step = t.crosshatch_step_deg
            step_str = str(int(step)) if step == int(step) else f"{step:g}"
            summary_suffix = f"x{t.crosshatch_passes} at {step_str}deg"

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
            summary_suffix=summary_suffix,
            registration_mode=t.registration.mode,
            registration_qr_mode=t.registration.qr_mode,
            test_id=t.id,
            material_id=t.material_id,
        )

        if i == 0:
            merged.canvas_id = generated.canvas_id
        merged.elements.extend(generated.elements)
        merged.extra_displays.extend(generated.extra_displays)
        merged.extra_device_entries.extend(generated.extra_device_entries)
        merged.bitmaps.extend(generated.bitmaps)

        # Crosshatch: stack additional passes with rotated scanAngles over the
        # same gradient rects. Annotations are only emitted for the first pass.
        if t.crosshatch_enabled and t.crosshatch_passes > 1:
            for pass_i in range(1, t.crosshatch_passes):
                angle_offset = (pass_i * t.crosshatch_step_deg) % 360
                for elem in generated.elements:
                    new_params = replace(
                        elem.params,
                        scan_angle=(elem.params.scan_angle + angle_offset) % 360,
                    )
                    merged.elements.append(
                        Rect(
                            x=elem.x,
                            y=elem.y,
                            width=elem.width,
                            height=elem.height,
                            params=new_params,
                            processing_type=elem.processing_type,
                            is_fill=elem.is_fill,
                            id=_uuid(),
                            layer_color=elem.layer_color,
                        )
                    )

    return merged


def project_to_xcs_bytes(project: Project) -> bytes:
    """Convert a Project to .xcs file bytes."""
    xcs = project_to_xcs(project)
    data = build_xcs(xcs)
    return json.dumps(data, separators=(",", ":")).encode("utf-8")
