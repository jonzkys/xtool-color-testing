"""High-level generators for common test patterns."""

from __future__ import annotations

from .model import ProcessingParams, Rect, XCSProject


def gradient_grid(
    *,
    x_param: str = "speed",
    x_min: float = 100,
    x_max: float = 5000,
    x_steps: int = 10,
    y_param: str = "power",
    y_min: float = 10,
    y_max: float = 100,
    y_steps: int = 10,
    element_width: float = 2.0,
    element_height: float = 5.0,
    gap: float = 1.0,
    start_x: float = 10.0,
    start_y: float = 10.0,
    base_params: ProcessingParams | None = None,
    processing_type: str = "COLOR_FILL_ENGRAVE",
) -> XCSProject:
    """Generate a 2D grid varying one parameter on each axis.

    Args:
        x_param: Parameter name to vary along X axis (e.g. "speed", "power").
        x_min: Minimum value for X parameter.
        x_max: Maximum value for X parameter.
        x_steps: Number of steps along X axis.
        y_param: Parameter name to vary along Y axis.
        y_min: Minimum value for Y parameter.
        y_max: Maximum value for Y parameter.
        y_steps: Number of steps along Y axis.
        element_width: Width of each test element in mm.
        element_height: Height of each test element in mm.
        gap: Gap between elements in mm.
        start_x: X origin of the grid in mm.
        start_y: Y origin of the grid in mm.
        base_params: Base processing parameters (non-varied params).
        processing_type: Which processing type to use.

    Returns:
        XCSProject ready to be written.
    """
    if base_params is None:
        base_params = ProcessingParams()

    project = XCSProject()

    x_values = _linspace(x_min, x_max, x_steps)
    y_values = _linspace(y_min, y_max, y_steps)

    for yi, y_val in enumerate(y_values):
        for xi, x_val in enumerate(x_values):
            params = ProcessingParams(
                speed=base_params.speed,
                power=base_params.power,
                repeat=base_params.repeat,
                density=base_params.density,
                pulse_width=base_params.pulse_width,
                mopa_frequency=base_params.mopa_frequency,
                dpi=base_params.dpi,
                dot_duration=base_params.dot_duration,
                processing_light_source=base_params.processing_light_source,
                scan_angle=base_params.scan_angle,
                angle_type=base_params.angle_type,
                cross_angle=base_params.cross_angle,
            )
            _set_param(params, x_param, x_val)
            _set_param(params, y_param, y_val)

            elem = Rect(
                x=start_x + xi * (element_width + gap),
                y=start_y + yi * (element_height + gap),
                width=element_width,
                height=element_height,
                params=params,
                processing_type=processing_type,
            )
            project.elements.append(elem)

    return project


def single_axis_sweep(
    *,
    param: str = "speed",
    values: list[float] | None = None,
    min_val: float = 100,
    max_val: float = 5000,
    steps: int = 50,
    element_width: float = 1.0,
    element_height: float = 10.0,
    gap: float = 0.5,
    start_x: float = 10.0,
    start_y: float = 50.0,
    base_params: ProcessingParams | None = None,
    processing_type: str = "COLOR_FILL_ENGRAVE",
) -> XCSProject:
    """Generate a single row of elements sweeping one parameter.

    Args:
        param: Parameter name to vary.
        values: Explicit list of values. If None, uses linspace(min_val, max_val, steps).
        min_val: Minimum value (used if values is None).
        max_val: Maximum value (used if values is None).
        steps: Number of steps (used if values is None).
        element_width: Width of each element in mm.
        element_height: Height of each element in mm.
        gap: Gap between elements in mm.
        start_x: X origin in mm.
        start_y: Y origin in mm.
        base_params: Base processing parameters.
        processing_type: Which processing type to use.

    Returns:
        XCSProject ready to be written.
    """
    if base_params is None:
        base_params = ProcessingParams()
    if values is None:
        values = _linspace(min_val, max_val, steps)

    project = XCSProject()

    for i, val in enumerate(values):
        params = ProcessingParams(
            speed=base_params.speed,
            power=base_params.power,
            repeat=base_params.repeat,
            density=base_params.density,
            pulse_width=base_params.pulse_width,
            mopa_frequency=base_params.mopa_frequency,
            dpi=base_params.dpi,
            dot_duration=base_params.dot_duration,
            processing_light_source=base_params.processing_light_source,
            scan_angle=base_params.scan_angle,
            angle_type=base_params.angle_type,
            cross_angle=base_params.cross_angle,
        )
        _set_param(params, param, val)

        elem = Rect(
            x=start_x + i * (element_width + gap),
            y=start_y,
            width=element_width,
            height=element_height,
            params=params,
            processing_type=processing_type,
        )
        project.elements.append(elem)

    return project


# --- Helpers ---

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


def _set_param(params: ProcessingParams, name: str, value: float) -> None:
    field = _PARAM_MAP.get(name)
    if field is None:
        raise ValueError(
            f"Unknown parameter '{name}'. Valid: {sorted(_PARAM_MAP.keys())}"
        )
    # Integer fields
    if field in ("repeat", "density", "pulse_width", "mopa_frequency", "dpi"):
        setattr(params, field, int(round(value)))
    else:
        setattr(params, field, value)


def _linspace(start: float, stop: float, n: int) -> list[float]:
    if n <= 1:
        return [start]
    step = (stop - start) / (n - 1)
    return [start + i * step for i in range(n)]
