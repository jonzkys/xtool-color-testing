"""Convert a validated Project into a single XCSProject by merging generated tests."""

from __future__ import annotations

import json
import math
from xcs_gen.builder import build_xcs
from xcs_gen.capture.layout import registration_reservation_mm
from xcs_gen.generators import _PARAM_MAP, _set_param, generate_gradient
from xcs_gen.model import Device, ProcessingParams, XCSProject
from xcs_gen.text import text_height

from .schemas import BaseParams, ParamTest, Project

def beam_width_for_machine(machine_id: str, *, laser: str = "red") -> float:
    """Smallest spot dimension of the named laser on ``machine_id``.

    Used to warn when an element is narrower than what the laser can
    resolve — adjacent thin elements would merge in the burn. Defaults
    to the fiber laser ("red") because that's what color engraving uses
    and what the legacy single-machine code assumed.
    """
    from xcs_gen.machines import get, laser_for
    spec = laser_for(get(machine_id), laser)  # type: ignore[arg-type]
    return min(spec.spot_mm)


# Backwards-compat alias — F2 fiber spot is 0.03mm. Use beam_width_for_machine
# when the active machine is known; the frontend mirror in
# web/src/validation.ts is updated separately.
BEAM_WIDTH_MM: float = 0.03

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


_SUMMARY_MAX_LINES = 5  # worst-case for narrow workpieces (50 mm coins)


def _summary_space_above() -> float:
    """Vertical space reserved above a gradient for the summary text.

    The generator wraps the summary to fit within the test width, so
    the actual line count is dynamic (1-5 lines depending on workpiece
    width and label content). This reservation is the worst case so
    stacked tests on the same canvas never overlap when one of them
    wraps to many lines and the others don't. Slight wasted whitespace
    on wide tests is acceptable — overlap would be silent corruption.
    """
    line_h = text_height(_LABEL_FONT_SIZE) + 0.1
    return _SUMMARY_MAX_LINES * line_h + 0.05


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


def validate_beam_widths(project: Project, *, machine_id: str = "F2Ultra") -> None:
    """Raise ValueError if any test has element width below the beam spot size.

    Sub-beam-width elements will merge into each other when engraved, producing
    no visible gradient. This is a hard block: the generated file would be wrong.
    """
    beam_w = beam_width_for_machine(machine_id)
    for placement in project.tests:
        t = placement.test
        per_row = math.ceil(t.x_steps / t.rows)
        elem_w = (t.width_mm - max(0, per_row - 1) * t.gap_mm) / per_row
        if elem_w > 0 and elem_w < beam_w:
            raise ValueError(
                f"Test '{t.name}': element width {elem_w:.4f}mm is below beam "
                f"spot {beam_w}mm - adjacent elements will merge. "
                f"Reduce steps or increase width."
            )


# XCS distinguishes two angle behaviours via a single int:
#   1 = fixed scan angle for every pass
#   2 = increment the scan angle between passes (XCS picks the rotation)
# Crosshatch (alternating with the 90°-rotated companion stroke) is
# orthogonal — controlled by the boolean ``crossAngle`` field — and can
# layer on top of either fixed or incremental.
_ANGLE_TYPE_MAP: dict[str, int] = {
    "fixed":       1,
    "incremental": 2,
}


def _to_processing_params(
    bp: BaseParams,
    *,
    angle_mode: str = "fixed",
    crosshatch: bool = False,
) -> ProcessingParams:
    angle_type = _ANGLE_TYPE_MAP.get(angle_mode, _ANGLE_TYPE_MAP["fixed"])
    cross_angle = bool(crosshatch)
    # ``repeat`` is the user-input pass count, written through 1:1.
    # ``cross_angle`` is xTool's flag for "for every repeat, also burn
    # one stroke at scan_angle+90°" — so passes=N + crosshatch=true
    # produces 2N total strokes on the device. Halving used to happen
    # here on the (wrong) assumption that XCS doubled the count
    # automatically without `cross_angle`; the actual hardware
    # behaviour has cross_angle do the doubling, so passes maps
    # straight through.
    repeat = bp.passes
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


def _calibration_kwargs(
    by_material: dict[str, dict] | None,
    material_id: str | None,
) -> dict[str, object]:
    """Pull calibration data for a given material out of the per-material
    dict so we can splat it into ``generate_gradient`` without bloating
    its signature at every other call-site.
    """
    if not by_material or material_id is None:
        return {}
    cal = by_material.get(str(material_id))
    if not cal:
        return {}
    cp = cal.get("clean_pass_params")
    patches = cal.get("calibration_patches")
    if not cp or not patches:
        return {}
    return {
        "calibration_clean_pass_params": cp,
        "calibration_patches": patches,
    }


def project_to_xcs(
    project: Project,
    *,
    machine_id: str = "F2Ultra",
    annotation_params: ProcessingParams | None = None,
    calibration_by_material_id: dict[str, dict] | None = None,
) -> XCSProject:
    """Convert a Project into a single merged XCSProject.

    ``annotation_params`` overrides the defaults used for QR + ArUco
    fiducials, axis ticks, axis labels, and the summary text strip.
    Pass the value resolved from ``text_reg_defaults`` (per material →
    per machine fallback) so each burn carries the right calibration
    for the substrate. ``None`` means "use the built-in constants" —
    sensible for fresh installs and tests.

    Raises:
        ValueError: If any grid placements overlap or any element width
            is below the beam spot size.
    """
    validate_placements(project)
    validate_beam_widths(project, machine_id=machine_id)

    offsets = _compute_grid_offsets(project)

    # Generate each test with its computed offset, merging all under a single canvas_id.
    # The builder requires one canvas_id per XCSProject; extra_device_entries
    # reference display UUIDs (not canvas_id), so the merge is safe.
    merged = XCSProject(device=Device.from_machine(machine_id))
    merged.thickness_mm = project.focus_mm
    for i, placement in enumerate(project.tests):
        t = placement.test
        x_off, y_off = offsets[t.id]

        # Suffix sits on its own line below the fixed params. The pass
        # count itself is already emitted on the fixed-params line by
        # _build_summary_lines (as `x{repeat}`) — we only carry the
        # angle behaviour qualifiers here so the suffix line can stay
        # short on narrow workpieces.
        suffix_bits: list[str] = []
        if t.crosshatch:
            suffix_bits.append("crosshatch")
        if t.angle_mode != "fixed":
            suffix_bits.append(t.angle_mode)
        summary_suffix = " ".join(suffix_bits)

        # Validation tests render one cell per validation_cells entry,
        # each with its own frozen params overlay. Compute the per-cell
        # ProcessingParams list here so the renderer can iterate it
        # directly instead of computing values from a sweep.
        per_cell_params: list[ProcessingParams] | None = None
        x_steps = t.x_steps
        y_param = t.y_param
        if t.kind == "validation":
            cells = t.validation_cells or []
            if not cells:
                raise ValueError(
                    f"validation test '{t.name}' has no validation_cells",
                )
            per_cell_params = []
            for vc in cells:
                # Per-cell angle behaviour: a palette entry remembers
                # the angle_mode + crosshatch of the test that produced
                # it (since PR #38 / 0017 backfill), so a validation
                # cell can faithfully reproduce a colour even when
                # other cells in the same test came from differently-
                # configured palette entries. Test-level fields stay
                # as the fallback for cells that predate the backfill
                # or were entered manually without the flags.
                cell_params_dict = vc.get("params") or {}
                cell_angle_mode = cell_params_dict.get("angle_mode") or t.angle_mode
                cell_crosshatch_raw = cell_params_dict.get("crosshatch")
                cell_crosshatch = (
                    bool(cell_crosshatch_raw)
                    if cell_crosshatch_raw is not None
                    else t.crosshatch
                )
                p = _to_processing_params(
                    t.base_params,
                    angle_mode=cell_angle_mode,
                    crosshatch=cell_crosshatch,
                )
                # Filter to keys the renderer can apply per-cell. Palette
                # entries also carry top-level test attributes like ``laser``
                # and ``scan_angle`` (test-level) and legacy ``mode`` which
                # may round-trip as ``null`` — silently skip both unknown
                # keys and null values. ``angle_mode`` / ``crosshatch`` were
                # consumed above and are not numeric burn params, so they
                # don't appear in ``_PARAM_MAP`` and would be skipped here
                # anyway.
                for key, value in cell_params_dict.items():
                    if key not in _PARAM_MAP or value is None:
                        continue
                    _set_param(p, key, value)
                per_cell_params.append(p)
            # Override sweep-only fields so the wrapped-1D layout sizes
            # the gradient to exactly len(cells) elements. The dual-axis
            # path is intentionally bypassed (validation is 1D-only).
            x_steps = len(per_cell_params)
            y_param = None

        generated = generate_gradient(
            x_param=t.x_param,
            x_min=t.x_min,
            x_max=t.x_max,
            x_steps=x_steps,
            y_param=y_param,
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
            base_params=_to_processing_params(
                t.base_params, angle_mode=t.angle_mode, crosshatch=t.crosshatch,
            ),
            # Resolved per-material/machine annotation params override
            # the renderer's hardcoded fallback. ``None`` lets the
            # generator keep its built-in default for fresh installs.
            annotation_params=annotation_params,
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
            per_cell_params=per_cell_params,
            **_calibration_kwargs(
                calibration_by_material_id, t.material_id,
            ),
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


def project_to_xcs_bytes(
    project: Project,
    *,
    machine_id: str = "F2Ultra",
    annotation_params: ProcessingParams | None = None,
    calibration_by_material_id: dict[str, dict] | None = None,
) -> bytes:
    """Convert a Project to .xcs file bytes."""
    xcs = project_to_xcs(
        project, machine_id=machine_id, annotation_params=annotation_params,
        calibration_by_material_id=calibration_by_material_id,
    )
    data = build_xcs(xcs)
    return json.dumps(data, separators=(",", ":")).encode("utf-8")
