"""High-level generators for gradient test patterns."""

from __future__ import annotations

import math
from dataclasses import replace

from .builder import build_device_entry, build_line_display
from .model import (
    ANNOTATION_LAYER_COLOR,
    GRADIENT_LAYER_COLOR,
    Line,
    ProcessingParams,
    Rect,
    XCSProject,
)
from .text import make_text_display, text_height, text_width

# Default annotation processing: blue diode, moderate settings for readable text
_DEFAULT_ANNOTATION_PARAMS = ProcessingParams(
    speed=230,
    power=80,
    density=200,
    repeat=1,
    processing_light_source="blue",
)

_PARAM_MAP = {
    "speed": "speed",
    "power": "power",
    "repeat": "repeat",
    "passes": "repeat",
    "density": "density",
    "lines": "density",
    "pulse_width": "pulse_width",
    "mopa_frequency": "mopa_frequency",
    "frequency": "mopa_frequency",
    "dpi": "dpi",
}

_INT_FIELDS = {"speed", "repeat", "density", "pulse_width", "mopa_frequency", "dpi"}


def generate_gradient(
    *,
    x_param: str,
    x_min: float,
    x_max: float,
    x_steps: int = 100,
    y_param: str | None = None,
    y_min: float = 0,
    y_max: float = 0,
    y_steps: int = 1,
    rows: int = 1,
    row_gap: float = 1.0,
    total_width: float = 100.0,
    total_height: float = 50.0,
    gap: float = 0.0,
    start_x: float = 10.0,
    start_y: float = 10.0,
    base_params: ProcessingParams | None = None,
    processing_type: str = "COLOR_FILL_ENGRAVE",
    label_font_size: float = 3.0,
    tick_length: float = 2.0,
    annotation_params: ProcessingParams | None = None,
) -> XCSProject:
    """Generate a gradient test pattern with axis annotations.

    Args:
        x_param: Parameter to vary along X axis.
        x_min: Minimum X parameter value.
        x_max: Maximum X parameter value.
        x_steps: Total number of elements in the gradient.
        y_param: Parameter to vary along Y axis (None = single axis).
        y_min: Minimum Y parameter value.
        y_max: Maximum Y parameter value.
        y_steps: Number of rows along Y axis (ignored if y_param is None).
        rows: Number of rows to wrap the gradient across (single axis only).
        row_gap: Gap between wrapped rows in mm.
        total_width: Total gradient area width in mm.
        total_height: Row height in mm (total height = rows * total_height + gaps).
        gap: Gap between elements in mm.
        start_x: X origin of gradient area in mm.
        start_y: Y origin of gradient area in mm.
        base_params: Base processing parameters for non-varied fields.
        processing_type: Active processing type for gradient elements.
        label_font_size: Font size in points for axis labels.
        tick_length: Length of tick marks in mm.
        annotation_params: Processing params for annotations (ticks + labels).

    Returns:
        XCSProject ready to be written.
    """
    if base_params is None:
        base_params = ProcessingParams()
    if annotation_params is None:
        annotation_params = _DEFAULT_ANNOTATION_PARAMS

    is_dual = y_param is not None and y_steps > 1

    project = XCSProject()

    # Reserve space above gradient for summary text
    summary_font_size = label_font_size
    summary_h = text_height(summary_font_size) + 0.3  # text + minimal padding
    gradient_start_y = start_y + summary_h

    # Build summary line
    summary = _build_summary(
        x_param=x_param, x_min=x_min, x_max=x_max, x_steps=x_steps,
        y_param=y_param, y_min=y_min, y_max=y_max, y_steps=y_steps,
        base_params=base_params,
    )
    _add_summary_text(
        project, summary,
        x=start_x, y=start_y,
        font_size=summary_font_size,
        annotation_params=annotation_params,
    )

    if is_dual:
        _generate_dual_axis(
            project,
            x_param=x_param, x_values=_linspace(x_min, x_max, x_steps),
            y_param=y_param, y_values=_linspace(y_min, y_max, y_steps),
            x_steps=x_steps, y_steps=y_steps,
            total_width=total_width, total_height=total_height,
            gap=gap, start_x=start_x, start_y=gradient_start_y,
            base_params=base_params, processing_type=processing_type,
            label_font_size=label_font_size, tick_length=tick_length,
            annotation_params=annotation_params,
        )
    else:
        _generate_wrapped(
            project,
            x_param=x_param, x_values=_linspace(x_min, x_max, x_steps),
            x_steps=x_steps, rows=rows, row_gap=row_gap,
            total_width=total_width, row_height=total_height,
            gap=gap, start_x=start_x, start_y=gradient_start_y,
            base_params=base_params, processing_type=processing_type,
            label_font_size=label_font_size, tick_length=tick_length,
            annotation_params=annotation_params,
        )

    return project


def _build_summary(
    *,
    x_param: str,
    x_min: float,
    x_max: float,
    x_steps: int,
    y_param: str | None,
    y_min: float,
    y_max: float,
    y_steps: int,
    base_params: ProcessingParams,
) -> str:
    """Build a 1-2 line summary string of the gradient parameters."""
    parts = [
        f"{x_param} {_format_value(x_param, x_min)}-{_format_value(x_param, x_max)}",
    ]
    if y_param:
        parts.append(f"{y_param} {_format_value(y_param, y_min)}-{_format_value(y_param, y_max)}")

    # Add fixed params (skip the one being varied)
    x_field = _PARAM_MAP.get(x_param, x_param)
    y_field = _PARAM_MAP.get(y_param, y_param) if y_param else None

    fixed = []
    if x_field != "power" and y_field != "power":
        fixed.append(f"P{base_params.power}%")
    if x_field != "speed" and y_field != "speed":
        fixed.append(f"S{base_params.speed}")
    if x_field != "mopa_frequency" and y_field != "mopa_frequency":
        fixed.append(f"F{base_params.mopa_frequency}Hz")
    if x_field != "density" and y_field != "density":
        fixed.append(f"L{base_params.density}")
    if x_field != "pulse_width" and y_field != "pulse_width":
        fixed.append(f"PW{base_params.pulse_width}")
    if x_field != "repeat" and y_field != "repeat" and base_params.repeat > 1:
        fixed.append(f"x{base_params.repeat}")

    parts.append(" ".join(fixed))
    return " / ".join(parts)


def _add_summary_text(
    project: XCSProject,
    summary: str,
    *,
    x: float,
    y: float,
    font_size: float,
    annotation_params: ProcessingParams,
) -> None:
    """Add a summary text element above the gradient."""
    ann_layer = ANNOTATION_LAYER_COLOR
    text_disp = make_text_display(
        summary, x=x, y=y,
        font_size=font_size, layer_color=ann_layer,
    )
    project.extra_displays.append(text_disp)
    project.extra_device_entries.append(
        build_device_entry(
            text_disp["id"], "TEXT", "FILL_VECTOR_ENGRAVING", annotation_params
        )
    )


def _generate_wrapped(
    project: XCSProject,
    *,
    x_param: str,
    x_values: list[float],
    x_steps: int,
    rows: int,
    row_gap: float,
    total_width: float,
    row_height: float,
    gap: float,
    start_x: float,
    start_y: float,
    base_params: ProcessingParams,
    processing_type: str,
    label_font_size: float,
    tick_length: float,
    annotation_params: ProcessingParams,
) -> None:
    """Generate a single-axis gradient, optionally wrapped across rows."""
    per_row = math.ceil(x_steps / rows)
    elem_w = (total_width - max(0, per_row - 1) * gap) / per_row

    ann_layer = ANNOTATION_LAYER_COLOR

    # For multi-row: compute the space needed for labels below each row
    # and ensure row_gap is large enough (only matters for non-last rows)
    ann_space = tick_length + 0.2 + text_height(label_font_size) + 0.2
    effective_row_gap = max(row_gap, ann_space) if rows > 1 else 0

    for row in range(rows):
        row_start = row * per_row
        row_end = min(row_start + per_row, x_steps)
        row_count = row_end - row_start
        if row_count <= 0:
            break

        row_y = start_y + row * (row_height + effective_row_gap)

        # Generate elements for this row
        for i in range(row_start, row_end):
            col = i - row_start
            params = _copy_params(base_params)
            _set_param(params, x_param, x_values[i])

            elem = Rect(
                x=start_x + col * (elem_w + gap),
                y=row_y,
                width=elem_w,
                height=row_height,
                params=params,
                processing_type=processing_type,
                layer_color=GRADIENT_LAYER_COLOR,
            )
            project.elements.append(elem)

        # Labels below each row
        bottom_y = row_y + row_height
        label_y = bottom_y + tick_length + 0.2

        # Start tick + label
        _add_tick_and_label(
            project,
            param=x_param,
            value=x_values[row_start],
            cx=start_x + elem_w / 2,
            bottom_y=bottom_y,
            label_y=label_y,
            tick_length=tick_length,
            font_size=label_font_size,
            layer_color=ann_layer,
            annotation_params=annotation_params,
        )

        # End tick + label
        end_col = row_count - 1
        _add_tick_and_label(
            project,
            param=x_param,
            value=x_values[row_end - 1],
            cx=start_x + end_col * (elem_w + gap) + elem_w / 2,
            bottom_y=bottom_y,
            label_y=label_y,
            tick_length=tick_length,
            font_size=label_font_size,
            layer_color=ann_layer,
            annotation_params=annotation_params,
        )

        # Middle labels at intervals
        if row_count > 2:
            indices = _label_indices(row_count)
            indices = [idx for idx in indices if idx != 0 and idx != row_count - 1]
            for idx in indices:
                _add_tick_and_label(
                    project,
                    param=x_param,
                    value=x_values[row_start + idx],
                    cx=start_x + idx * (elem_w + gap) + elem_w / 2,
                    bottom_y=bottom_y,
                    label_y=label_y,
                    tick_length=tick_length,
                    font_size=label_font_size,
                    layer_color=ann_layer,
                    annotation_params=annotation_params,
                )


def _generate_dual_axis(
    project: XCSProject,
    *,
    x_param: str,
    x_values: list[float],
    y_param: str,
    y_values: list[float],
    x_steps: int,
    y_steps: int,
    total_width: float,
    total_height: float,
    gap: float,
    start_x: float,
    start_y: float,
    base_params: ProcessingParams,
    processing_type: str,
    label_font_size: float,
    tick_length: float,
    annotation_params: ProcessingParams,
) -> None:
    """Generate a dual-axis gradient grid."""
    elem_w = (total_width - max(0, x_steps - 1) * gap) / x_steps
    elem_h = (total_height - max(0, y_steps - 1) * gap) / y_steps

    for yi, y_val in enumerate(y_values):
        for xi, x_val in enumerate(x_values):
            params = _copy_params(base_params)
            _set_param(params, x_param, x_val)
            _set_param(params, y_param, y_val)

            elem = Rect(
                x=start_x + xi * (elem_w + gap),
                y=start_y + yi * (elem_h + gap),
                width=elem_w,
                height=elem_h,
                params=params,
                processing_type=processing_type,
                layer_color=GRADIENT_LAYER_COLOR,
            )
            project.elements.append(elem)

    ann_layer = ANNOTATION_LAYER_COLOR

    _add_x_axis(
        project,
        x_param=x_param,
        x_values=x_values,
        x_steps=x_steps,
        elem_w=elem_w,
        gap=gap,
        start_x=start_x,
        bottom_y=start_y + total_height,
        tick_length=tick_length,
        font_size=label_font_size,
        layer_color=ann_layer,
        annotation_params=annotation_params,
    )

    _add_y_axis(
        project,
        y_param=y_param,
        y_values=y_values,
        y_steps=y_steps,
        elem_h=elem_h,
        gap=gap,
        start_y=start_y,
        left_x=start_x,
        tick_length=tick_length,
        font_size=label_font_size,
        layer_color=ann_layer,
        annotation_params=annotation_params,
    )


def _add_tick_and_label(
    project: XCSProject,
    *,
    param: str,
    value: float,
    cx: float,
    bottom_y: float,
    label_y: float,
    tick_length: float,
    font_size: float,
    layer_color: str,
    annotation_params: ProcessingParams,
) -> None:
    """Add a single tick mark + label at a given X position."""
    tick = Line(
        x=cx,
        y=bottom_y,
        length=tick_length,
        angle=90.0,
        layer_color=layer_color,
    )
    tick_display = build_line_display(tick)
    project.extra_displays.append(tick_display)
    project.extra_device_entries.append(
        build_device_entry(tick.id, "LINE", "VECTOR_ENGRAVING", annotation_params)
    )

    label = _format_value(param, value)
    lw = text_width(label, font_size)
    text_disp = make_text_display(
        label,
        x=cx - lw / 2,
        y=label_y,
        font_size=font_size,
        layer_color=layer_color,
    )
    project.extra_displays.append(text_disp)
    project.extra_device_entries.append(
        build_device_entry(
            text_disp["id"], "TEXT", "FILL_VECTOR_ENGRAVING", annotation_params
        )
    )


def _add_x_axis(
    project: XCSProject,
    *,
    x_param: str,
    x_values: list[float],
    x_steps: int,
    elem_w: float,
    gap: float,
    start_x: float,
    bottom_y: float,
    tick_length: float,
    font_size: float,
    layer_color: str,
    annotation_params: ProcessingParams,
) -> None:
    """Add X-axis tick marks and labels below the gradient."""
    indices = _label_indices(x_steps)
    label_y = bottom_y + tick_length + 0.2

    for i in indices:
        cx = start_x + i * (elem_w + gap) + elem_w / 2
        _add_tick_and_label(
            project,
            param=x_param,
            value=x_values[i],
            cx=cx,
            bottom_y=bottom_y,
            label_y=label_y,
            tick_length=tick_length,
            font_size=font_size,
            layer_color=layer_color,
            annotation_params=annotation_params,
        )


def _add_y_axis(
    project: XCSProject,
    *,
    y_param: str,
    y_values: list[float],
    y_steps: int,
    elem_h: float,
    gap: float,
    start_y: float,
    left_x: float,
    tick_length: float,
    font_size: float,
    layer_color: str,
    annotation_params: ProcessingParams,
) -> None:
    """Add Y-axis tick marks and labels to the left of the gradient."""
    indices = _label_indices(y_steps)
    th = text_height(font_size)

    for i in indices:
        cy = start_y + i * (elem_h + gap) + elem_h / 2

        tick = Line(
            x=left_x - tick_length,
            y=cy,
            length=tick_length,
            angle=0.0,
            layer_color=layer_color,
        )
        tick_display = build_line_display(tick)
        project.extra_displays.append(tick_display)
        project.extra_device_entries.append(
            build_device_entry(tick.id, "LINE", "VECTOR_ENGRAVING", annotation_params)
        )

        label = _format_value(y_param, y_values[i])
        lw = text_width(label, font_size)
        text_disp = make_text_display(
            label,
            x=left_x - tick_length - 0.5 - lw,
            y=cy - th / 2,
            font_size=font_size,
            layer_color=layer_color,
        )
        project.extra_displays.append(text_disp)
        project.extra_device_entries.append(
            build_device_entry(
                text_disp["id"], "TEXT", "FILL_VECTOR_ENGRAVING", annotation_params
            )
        )


def _label_indices(n: int) -> list[int]:
    """Compute which element indices get labels. Aims for 5-10 labels."""
    if n <= 10:
        return list(range(n))

    interval = max(1, math.ceil(n / 8))
    indices = list(range(0, n, interval))

    if indices[-1] != n - 1:
        indices.append(n - 1)

    return indices


def _format_value(param: str, value: float) -> str:
    """Format a parameter value for display as an axis label."""
    field = _PARAM_MAP.get(param, param)
    if field in _INT_FIELDS:
        return str(int(round(value)))
    if value == int(value):
        return str(int(value))
    return f"{value:.1f}"


def _copy_params(p: ProcessingParams) -> ProcessingParams:
    return ProcessingParams(
        speed=p.speed,
        power=p.power,
        repeat=p.repeat,
        density=p.density,
        pulse_width=p.pulse_width,
        mopa_frequency=p.mopa_frequency,
        dpi=p.dpi,
        dot_duration=p.dot_duration,
        processing_light_source=p.processing_light_source,
        scan_angle=p.scan_angle,
        angle_type=p.angle_type,
        cross_angle=p.cross_angle,
    )


def _set_param(params: ProcessingParams, name: str, value: float) -> None:
    field = _PARAM_MAP.get(name)
    if field is None:
        raise ValueError(
            f"Unknown parameter '{name}'. Valid: {sorted(_PARAM_MAP.keys())}"
        )
    if field in _INT_FIELDS:
        setattr(params, field, int(round(value)))
    else:
        setattr(params, field, value)


def _linspace(start: float, stop: float, n: int) -> list[float]:
    if n <= 1:
        return [start]
    step = (stop - start) / (n - 1)
    return [start + i * step for i in range(n)]
