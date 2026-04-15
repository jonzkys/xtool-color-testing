"""Convert an uploaded SVG into a stacked XCSProject.

Takes a raw SVG string, parses it with a single set of processing params,
and emits N stacked passes rotated by step_deg each. Used by the web UI's
"SVG Stack" tab.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import replace

from xcs_gen.builder import build_xcs
from xcs_gen.model import GRADIENT_LAYER_COLOR, Path, ProcessingParams, XCSProject, _uuid
from xcs_gen.svg_source import parse_svg

from .converter import _to_processing_params
from .schemas import SvgStackRequest


def _shape_layer_color(shape) -> str:
    """Pick a layer color for a shape: prefer fill, fall back to stroke, then default.

    Keeping each shape on its own fill-colored layer lets XCS Studio group and
    display the SVG the way a native import would, rather than flattening every
    shape onto one generic layer.
    """
    if shape.fill:
        return shape.fill
    if shape.stroke:
        return shape.stroke
    return GRADIENT_LAYER_COLOR


def svg_stack_to_xcs(request: SvgStackRequest) -> XCSProject:
    """Parse SVG, apply single-layer params, stack N passes with rotations.

    Raises:
        ValueError: if the SVG contains no supported shapes, or fails to parse.
    """
    # svgelements.SVG.parse() ultimately needs a path or file-like; simplest is
    # a short-lived temp file since svg_source.parse_svg takes a path string.
    fd, temp_path = tempfile.mkstemp(suffix=".svg")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(request.svg_content)

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

    # Base params with the user's chosen scan_angle applied.
    base = replace(
        _to_processing_params(request.base_params),
        scan_angle=request.scan_angle,
    )

    project = XCSProject()

    # Primary pass: one Path per SVG shape, colored by the shape's own fill/stroke
    # so XCS Studio groups them into the same visual layers an SVG import would.
    # All layers share the request's processing params regardless of color.
    primary_paths: list[Path] = []
    for shape in parse_result.shapes:
        p = Path(
            d=shape.d,
            x=shape.bbox_x_mm,
            y=shape.bbox_y_mm,
            width=shape.bbox_width_mm,
            height=shape.bbox_height_mm,
            is_close_path=shape.is_close_path,
            fill_rule=shape.fill_rule,
            params=base,
            processing_type=request.processing_type,
            is_fill=True,
            layer_color=_shape_layer_color(shape),
        )
        project.paths.append(p)
        primary_paths.append(p)

    # Additional stacked passes with rotated scan_angles.
    if request.stack_passes > 1:
        for pass_i in range(1, request.stack_passes):
            angle_offset = (pass_i * request.stack_step_deg) % 360
            for pp in primary_paths:
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

    return project


def svg_stack_to_xcs_bytes(request: SvgStackRequest) -> bytes:
    """Convert the request into .xcs file bytes."""
    xcs = svg_stack_to_xcs(request)
    data = build_xcs(xcs)
    return json.dumps(data, separators=(",", ":")).encode("utf-8")
