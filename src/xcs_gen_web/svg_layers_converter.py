"""Per-color-layer converter for the SVG Layers tab.

Takes an SVG and a per-color LayerSpec list. Emits Paths grouped by SVG fill
color, each layer with its own processing params / type / scan angle and
optional crosshatch stack. Supports the same overlap-subtraction flag as
SvgStackRequest.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections import Counter
from dataclasses import replace

from xcs_gen.builder import build_xcs
from xcs_gen.model import GRADIENT_LAYER_COLOR, Path, XCSProject, _uuid
from xcs_gen.svg_source import ParsedShape, parse_svg

from .converter import _to_processing_params
from .schemas import (
    DetectedLayer,
    LayerSpec,
    SvgDetectRequest,
    SvgLayersRequest,
)
from .svg_subtract import subtract_overlapping_shapes


def _write_svg_to_temp(svg_content: str) -> str:
    fd, temp_path = tempfile.mkstemp(suffix=".svg")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(svg_content)
    return temp_path


def detect_svg_layers(request: SvgDetectRequest) -> list[DetectedLayer]:
    """Parse an SVG and return the unique colors (for UI layer list population).

    Returned in SVG document order so the UI can reflect z-stacking as it
    appears in the source file. Each color is reported once with the count
    of shapes using it and whether it shows up as a fill or only a stroke.
    """
    temp_path = _write_svg_to_temp(request.svg_content)
    try:
        parsed = parse_svg(
            temp_path,
            total_width=request.width_mm,
            total_height=None,
        )
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass

    # Track first-seen index for stable ordering
    order: dict[str, int] = {}
    is_fill: dict[str, bool] = {}
    counts: Counter[str] = Counter()

    for shape in parsed.shapes:
        # Fill is the primary bucket
        if shape.fill and shape.fill != "none":
            color = shape.fill
            if color not in order:
                order[color] = len(order)
                is_fill[color] = True
            counts[color] += 1
            continue
        # Otherwise stroke-only
        if shape.stroke and shape.stroke != "none":
            color = shape.stroke
            if color not in order:
                order[color] = len(order)
                is_fill[color] = False
            counts[color] += 1

    result = [
        DetectedLayer(color=c, shape_count=counts[c], is_fill=is_fill[c])
        for c in sorted(order, key=order.get)
    ]
    return result


def _shape_primary_color(shape: ParsedShape) -> str | None:
    """Return a shape's fill color, or stroke if no fill."""
    if shape.fill and shape.fill != "none":
        return shape.fill
    if shape.stroke and shape.stroke != "none":
        return shape.stroke
    return None


def svg_layers_to_xcs(request: SvgLayersRequest) -> XCSProject:
    """Parse SVG, group shapes by color, emit Paths per enabled layer.

    Raises:
        ValueError: on parse failure, no shapes, or no enabled layers with
            matching shapes.
    """
    temp_path = _write_svg_to_temp(request.svg_content)
    try:
        parse_result = parse_svg(
            temp_path,
            total_width=request.width_mm,
            total_height=request.height_mm,
            start_x=request.start_x,
            start_y=request.start_y,
        )
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass

    if not parse_result.shapes:
        raise ValueError("No supported shapes found in SVG.")

    # Map color -> LayerSpec for lookup. Disabled layers are filtered out.
    layer_by_color: dict[str, LayerSpec] = {
        layer.color: layer for layer in request.layers if layer.enabled
    }
    if not layer_by_color:
        raise ValueError("No enabled layers - enable at least one.")

    # Keep only shapes whose color maps to an enabled layer.
    shapes = [
        shape for shape in parse_result.shapes
        if _shape_primary_color(shape) in layer_by_color
    ]
    if not shapes:
        raise ValueError(
            "No SVG shapes matched any enabled layer color. Re-detect colors "
            "or enable the layer(s) you want to engrave."
        )

    if request.subtract_overlaps:
        shapes = subtract_overlapping_shapes(shapes)
        if not shapes:
            raise ValueError(
                "All shapes were fully subtracted by higher layers - nothing to engrave."
            )

    project = XCSProject()

    # Primary pass: one Path per shape using its layer's params.
    # Track (shape_color, original_Path) pairs so we can restack per-layer crosshatch.
    primary: list[tuple[str, Path]] = []
    for shape in shapes:
        color = _shape_primary_color(shape)
        if color is None or color not in layer_by_color:
            continue
        layer = layer_by_color[color]

        params = replace(
            _to_processing_params(layer.base_params),
            scan_angle=layer.scan_angle,
        )

        p = Path(
            d=shape.d,
            x=shape.bbox_x_mm,
            y=shape.bbox_y_mm,
            width=shape.bbox_width_mm,
            height=shape.bbox_height_mm,
            is_close_path=shape.is_close_path,
            fill_rule=shape.fill_rule,
            params=params,
            processing_type=layer.processing_type,
            is_fill=(shape.fill is not None and shape.fill != "none"),
            layer_color=color,
        )
        project.paths.append(p)
        primary.append((color, p))

    # Crosshatch: for each layer, if enabled, stack additional rotated passes
    # over just that layer's primary paths.
    for color, layer in layer_by_color.items():
        if not layer.crosshatch_enabled or layer.crosshatch_passes <= 1:
            continue
        layer_primary = [p for c, p in primary if c == color]
        for pass_i in range(1, layer.crosshatch_passes):
            angle_offset = (pass_i * layer.crosshatch_step_deg) % 360
            for pp in layer_primary:
                new_params = replace(
                    pp.params,
                    scan_angle=(pp.params.scan_angle + angle_offset) % 360,
                )
                project.paths.append(
                    Path(
                        d=pp.d,
                        x=pp.x,
                        y=pp.y,
                        width=pp.width,
                        height=pp.height,
                        is_close_path=pp.is_close_path,
                        fill_rule=pp.fill_rule,
                        params=new_params,
                        processing_type=pp.processing_type,
                        is_fill=pp.is_fill,
                        id=_uuid(),
                        layer_color=pp.layer_color,
                    )
                )

    if not project.paths:
        raise ValueError("No paths emitted - check that the SVG has supported shapes.")

    return project


def svg_layers_to_xcs_bytes(request: SvgLayersRequest) -> bytes:
    """Convert to .xcs file bytes."""
    xcs = svg_layers_to_xcs(request)
    data = build_xcs(xcs)
    return json.dumps(data, separators=(",", ":")).encode("utf-8")
