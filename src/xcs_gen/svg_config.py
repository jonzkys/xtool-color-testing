"""YAML config loader for the svg generate CLI.

Compiles a YAML file into LayerConfig / HatchPass / HatchRamp / AutoRamp
dataclasses — the exact same shape the Python API accepts.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import yaml

from .model import ProcessingParams
from .svg_source import (
    AutoRamp,
    HatchPass,
    HatchRamp,
    LayerConfig,
    RampAxis,
    RenderMode,
)


_PARAM_FIELDS = {
    "speed", "power", "frequency", "density", "passes",
    "pulse_width", "laser", "dpi",
}
_VALID_RENDER_MODES = {"fill_engrave", "vector_engrave", "vector_cut", "hatched"}
_VALID_AXES = {"perp", "parallel", "x", "y"}
_VALID_SORT_BY = {"luminance", "hue", "order_of_appearance"}


@dataclass
class LoadedConfig:
    """Result of parsing a YAML svg config file."""

    defaults: ProcessingParams = field(default_factory=ProcessingParams)
    layer_config: dict[str, LayerConfig] = field(default_factory=dict)
    auto_ramp: AutoRamp | None = None


def load_svg_config(path: str) -> LoadedConfig:
    """Load and validate a YAML config file."""
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"config {path!r}: top-level must be a mapping")

    defaults = _params_from_flat(raw.get("defaults") or {}, base=ProcessingParams())

    layer_config: dict[str, LayerConfig] = {}
    for color, entry in (raw.get("layers") or {}).items():
        key = color.lower() if isinstance(color, str) else color
        layer_config[key] = _build_layer_config(key, entry, defaults)

    auto_ramp = None
    ar = raw.get("auto_ramp")
    if ar is not None:
        auto_ramp = _build_auto_ramp(ar)

    return LoadedConfig(defaults=defaults, layer_config=layer_config, auto_ramp=auto_ramp)


def _params_from_flat(data: dict, *, base: ProcessingParams) -> ProcessingParams:
    """Merge a flat ProcessingParams-like dict onto a base."""
    params = replace(base)
    for key, value in data.items():
        if key == "laser":
            params.processing_light_source = str(value)
            continue
        if key == "frequency":
            params.mopa_frequency = int(value)
            continue
        if key == "passes":
            params.repeat = int(value)
            continue
        if key not in _PARAM_FIELDS and key not in ("render_mode", "hatch_passes"):
            continue
        if not hasattr(params, key):
            continue
        current = getattr(params, key)
        setattr(params, key, type(current)(value))
    return params


def _build_layer_config(color: str, entry: dict, defaults: ProcessingParams) -> LayerConfig:
    if not isinstance(entry, dict):
        raise ValueError(f"layer {color!r}: must be a mapping")
    render_mode = entry.get("render_mode", "fill_engrave")
    if render_mode not in _VALID_RENDER_MODES:
        raise ValueError(
            f"layer {color!r}: invalid render_mode {render_mode!r}. "
            f"Valid: {sorted(_VALID_RENDER_MODES)}"
        )
    params = _params_from_flat(entry, base=defaults)
    hatch_passes: list[HatchPass] = []
    for i, hp in enumerate(entry.get("hatch_passes") or []):
        hatch_passes.append(_build_hatch_pass(color, i, hp, defaults))
    return LayerConfig(
        params=params,
        render_mode=render_mode,  # type: ignore[arg-type]
        hatch_passes=hatch_passes,
    )


def _build_hatch_pass(color: str, index: int, entry: dict, defaults: ProcessingParams) -> HatchPass:
    if not isinstance(entry, dict):
        raise ValueError(f"layer {color!r} pass {index}: must be a mapping")
    angle = float(entry.get("angle", 0.0))
    spacing = float(entry.get("spacing", 0.5))

    per_pass_overrides = {k: v for k, v in entry.items() if k in _PARAM_FIELDS}
    base_params = None
    if per_pass_overrides:
        base_params = _params_from_flat(per_pass_overrides, base=defaults)

    ramps: list[HatchRamp] = []
    for j, rentry in enumerate(entry.get("ramps") or []):
        ramps.append(_build_hatch_ramp(color, index, j, rentry))

    return HatchPass(angle=angle, spacing=spacing, base_params=base_params, ramps=ramps)


def _build_hatch_ramp(color: str, pass_idx: int, ramp_idx: int, entry: dict) -> HatchRamp:
    if not isinstance(entry, dict):
        raise ValueError(
            f"layer {color!r} pass {pass_idx} ramp {ramp_idx}: must be a mapping"
        )
    param = entry.get("param")
    axis = entry.get("axis")
    if axis not in _VALID_AXES:
        raise ValueError(
            f"layer {color!r} pass {pass_idx} ramp {ramp_idx}: "
            f"invalid axis {axis!r}. Valid: {sorted(_VALID_AXES)}"
        )
    min_value = float(entry.get("min", 0.0))
    max_value = float(entry.get("max", 0.0))
    return HatchRamp(
        param=str(param),
        axis=axis,  # type: ignore[arg-type]
        min_value=min_value,
        max_value=max_value,
    )


def _build_auto_ramp(entry: dict) -> AutoRamp:
    sort_by = entry.get("sort_by", "luminance")
    if sort_by not in _VALID_SORT_BY:
        raise ValueError(
            f"auto_ramp.sort_by {sort_by!r} invalid. Valid: {sorted(_VALID_SORT_BY)}"
        )
    default_render_mode = entry.get("default_render_mode", "fill_engrave")
    if default_render_mode not in _VALID_RENDER_MODES:
        raise ValueError(
            f"auto_ramp.default_render_mode {default_render_mode!r} invalid."
        )
    return AutoRamp(
        param=str(entry.get("param")),
        min_value=float(entry.get("min", 0.0)),
        max_value=float(entry.get("max", 0.0)),
        sort_by=sort_by,  # type: ignore[arg-type]
        default_render_mode=default_render_mode,  # type: ignore[arg-type]
    )
