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

# Default annotation processing: light vector engrave
_DEFAULT_ANNOTATION_PARAMS = ProcessingParams(
    speed=1000,
    power=10,
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
        x_steps: Number of elements along X axis.
        y_param: Parameter to vary along Y axis (None = single axis).
        y_min: Minimum Y parameter value.
        y_max: Maximum Y parameter value.
        y_steps: Number of rows along Y axis (ignored if y_param is None).
        total_width: Total gradient area width in mm.
        total_height: Total gradient area height in mm.
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

    # Compute element dimensions from total area
    elem_w = (total_width - max(0, x_steps - 1) * gap) / x_steps
    if is_dual:
        elem_h = (total_height - max(0, y_steps - 1) * gap) / y_steps
    else:
        elem_h = total_height

    x_values = _linspace(x_min, x_max, x_steps)
    y_values = _linspace(y_min, y_max, y_steps) if is_dual else [0.0]

    project = XCSProject()

    # --- Generate gradient elements ---
    for yi, y_val in enumerate(y_values):
        for xi, x_val in enumerate(x_values):
            params = _copy_params(base_params)
            _set_param(params, x_param, x_val)
            if is_dual:
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

    # --- Generate axis annotations ---
    ann_layer = ANNOTATION_LAYER_COLOR

    # X axis: bottom
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

    # Y axis: left (dual axis only)
    if is_dual:
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

    return project


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
    label_y = bottom_y + tick_length + 0.5  # small gap between tick and label

    for i in indices:
        # Tick mark center-x for this element
        cx = start_x + i * (elem_w + gap) + elem_w / 2

        # Vertical tick mark
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

        # Label
        label = _format_value(x_param, x_values[i])
        lw = text_width(label, font_size)
        text_disp = make_text_display(
            label,
            x=cx - lw / 2,  # center below tick
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
        # Center-y for this row
        cy = start_y + i * (elem_h + gap) + elem_h / 2

        # Horizontal tick mark extending left
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

        # Label (right-aligned to the left of the tick)
        label = _format_value(y_param, y_values[i])
        lw = text_width(label, font_size)
        text_disp = make_text_display(
            label,
            x=left_x - tick_length - 0.5 - lw,  # right-aligned
            y=cy - th / 2,  # vertically centered
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

    # Choose interval to get ~8 labels
    interval = max(1, math.ceil(n / 8))
    indices = list(range(0, n, interval))

    # Always include the last element
    if indices[-1] != n - 1:
        indices.append(n - 1)

    return indices


def _format_value(param: str, value: float) -> str:
    """Format a parameter value for display as an axis label."""
    field = _PARAM_MAP.get(param, param)
    if field in _INT_FIELDS:
        return str(int(round(value)))
    # Power: 1 decimal, strip trailing zero
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
