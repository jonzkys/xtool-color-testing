"""Convert a validated Project into a single XCSProject by merging generated tests."""

from __future__ import annotations

import json
import math
from xcs_gen.builder import build_xcs
from xcs_gen.capture.layout import registration_reservation_mm
from xcs_gen.generators import generate_gradient
from xcs_gen.model import Device, ProcessingParams, XCSProject
from xcs_gen.text import text_height

from .schemas import BaseParams, ParamTest, Project

# F2 Ultra MOPA beam spot size. Mirrors web/src/validation.ts BEAM_WIDTH_MM.
BEAM_WIDTH_MM = 0.03

# Offset from canvas (0,0) where the composition starts. Leaves margin from
# the edge of the XCS canvas so tests aren't flush against the origin.
CANVAS_ORIGIN_X = 10.0
CANVAS_ORIGIN_Y = 10.0

# Must match generate_gradient defaults. Kept in sync manually — the
# drift guard in tests/test_converter.py::test_converter_constants_match_generator_defaults
# will fail if these stop matching generate_gradient's signature.
_LABEL_FONT_SIZE = 1.2
_TICK_LENGTH = 0.5


def _annotation_space_below(hide_axis_labels: bool = False) -> float:
    """Vertical space below a gradient for the X axis tick marks + labels.

    Returns 0 when labels are hidden so stacked tests pack tighter.
    Mirrors _add_tick_and_label: tick + 0.05 gap + text + 0.05 padding.
    """
    if hide_axis_labels:
        return 0.0
    return _TICK_LENGTH + 0.05 + text_height(_LABEL_FONT_SIZE) + 0.05


def _summary_space_above() -> float:
    """Vertical space above a gradient for the summary text line."""
    return text_height(_LABEL_FONT_SIZE) + 0.05


def _test_vertical_footprint(t: ParamTest) -> float:
    """Total vertical space a test occupies, including summary and axis labels.

    For multi-row tests (rows > 1), the generator auto-expands row_gap to fit
    inter-row annotations (unless hide_axis_labels is set, in which case the
    user's row_gap is used verbatim).

    When registration markers are enabled, the generator shifts the entire
    test content down by the registration reservation so markers don't end up
    at negative coordinates; add that shift to the footprint so stacked tests
    don't overlap.
    """
    summary = _summary_space_above()
    ann_below = _annotation_space_below(t.hide_axis_labels)

    if t.rows > 1:
        effective_row_gap = max(t.gap_mm, ann_below)
        gradient_h = t.rows * t.height_mm + (t.rows - 1) * effective_row_gap
    else:
        gradient_h = t.height_mm

    _, reg_shift_y = registration_reservation_mm(
        t.registration.mode,
        qr_size_mm=t.registration.qr_size_mm,
        aruco_size_mm=t.registration.aruco_size_mm,
    )

    return reg_shift_y + summary + gradient_h + ann_below


def _test_horizontal_footprint(t: ParamTest) -> float:
    """Total horizontal space a test occupies.

    Matches _test_vertical_footprint: when registration is enabled the grid
    shifts right by the reservation, so the column must allocate that extra
    width.
    """
    reg_shift_x, _ = registration_reservation_mm(
        t.registration.mode,
        qr_size_mm=t.registration.qr_size_mm,
        aruco_size_mm=t.registration.aruco_size_mm,
    )
    return reg_shift_x + t.width_mm


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


_ANGLE_MODE_MAP: dict[str, tuple[int, bool]] = {
    "fixed":       (1, False),
    "crosshatch":  (1, True),
    "incremental": (2, False),
}


def _to_processing_params(bp: BaseParams, *, angle_mode: str = "fixed") -> ProcessingParams:
    angle_type, cross_angle = _ANGLE_MODE_MAP.get(angle_mode, _ANGLE_MODE_MAP["fixed"])
    # XCS applies crossAngle as "burn one pass at scanAngle and another at
    # scanAngle+90° for every `repeat` cycle" — so each repeat = 2 actual
    # burns. We expose "passes" to the user as total burns, so divide by 2
    # (clamping to >=1) when crosshatch is active. Users should pick even
    # passes in crosshatch mode to avoid rounding; the UI enforces this.
    repeat = bp.passes
    if angle_mode == "crosshatch":
        repeat = max(1, bp.passes // 2)
    return ProcessingParams(
        power=bp.power,
        speed=bp.speed,
        mopa_frequency=bp.frequency,
        density=bp.density,
        repeat=repeat,
        pulse_width=bp.pulse_width,
        processing_light_source=bp.laser,
        scan_angle=bp.scan_angle,
        angle_type=angle_type,
        cross_angle=cross_angle,
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


def project_to_xcs(project: Project, *, machine_id: str = "F2Ultra") -> XCSProject:
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
    merged = XCSProject(device=Device.from_machine(machine_id))
    merged.thickness_mm = project.focus_mm
    for i, placement in enumerate(project.tests):
        t = placement.test
        x_off, y_off = offsets[t.id]

        # Suffix shown in the per-test summary line (e.g. "x3 crosshatch")
        # when >1 passes are configured.
        summary_suffix = ""
        if t.base_params.passes > 1 and t.angle_mode != "fixed":
            summary_suffix = f"x{t.base_params.passes} {t.angle_mode}"
        elif t.base_params.passes > 1:
            summary_suffix = f"x{t.base_params.passes}"

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
            base_params=_to_processing_params(t.base_params, angle_mode=t.angle_mode),
            summary_suffix=summary_suffix,
            registration_mode=t.registration.mode,
            registration_qr_size_mm=t.registration.qr_size_mm,
            registration_aruco_size_mm=t.registration.aruco_size_mm,
            unidirectional=t.unidirectional,
            cell_shape=t.cell_shape,
            test_id=int(t.id) if t.id.isdigit() else None,
            retest_index=t.retest_index,
            material_id=t.material_id,
            hide_axis_labels=t.hide_axis_labels,
        )

        if i == 0:
            merged.canvas_id = generated.canvas_id
        merged.elements.extend(generated.elements)
        merged.circles.extend(generated.circles)
        merged.paths.extend(generated.paths)
        merged.extra_displays.extend(generated.extra_displays)
        merged.extra_device_entries.extend(generated.extra_device_entries)
        merged.bitmaps.extend(generated.bitmaps)

    return merged


def project_to_xcs_bytes(project: Project, *, machine_id: str = "F2Ultra") -> bytes:
    """Convert a Project to .xcs file bytes."""
    xcs = project_to_xcs(project, machine_id=machine_id)
    data = build_xcs(xcs)
    return json.dumps(data, separators=(",", ":")).encode("utf-8")
