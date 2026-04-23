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
import time
from contextlib import nullcontext
from dataclasses import replace

from xcs_gen.builder import build_xcs
from xcs_gen.model import GRADIENT_LAYER_COLOR, Path, Rect, XCSProject
from xcs_gen.svg_source import ParsedShape, parse_svg

from .converter import _to_processing_params
from .schemas import (
    LayerSpec,
    SvgLayersRequest,
    SvgPreviewRequest,
    SvgPreviewResponse,
)
from .svg_guard import assert_shape_count
from .svg_subtract import subtract_overlapping_shapes
from .timing import TimingReport


def _write_svg_to_temp(svg_content: str) -> str:
    fd, temp_path = tempfile.mkstemp(suffix=".svg")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(svg_content)
    return temp_path


def _shape_primary_color(shape: ParsedShape) -> str | None:
    """Return a shape's fill color, or stroke if no fill."""
    if shape.fill and shape.fill != "none":
        return shape.fill
    if shape.stroke and shape.stroke != "none":
        return shape.stroke
    return None


def build_svg_layers_project(
    request: SvgLayersRequest,
    *,
    max_segments: int = 50000,
    report: TimingReport | None = None,
) -> XCSProject:
    """Parse SVG, group shapes by color, emit Paths or hatch Lines per layer.

    For HATCHED_LINES layers, emits Line segments via the hatch module into
    ``project.extra_displays`` / ``project.extra_device_entries`` instead of
    Path elements.  All other processing types emit Path elements exactly as
    before.

    Args:
        request: The SVG layers conversion request.
        max_segments: Hard cap on total hatched Line segments.  Raises
            ValueError if exceeded (with the worst-offending color in the
            message).
        report: Optional timing collector; phases are recorded if provided.

    Raises:
        ValueError: on parse failure, no shapes, no enabled layers, or
            hatched output exceeding *max_segments*.
    """
    _phase = report.phase if report else (lambda _name: nullcontext())

    temp_path = _write_svg_to_temp(request.svg_content)
    try:
        with _phase("parse"):
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

    # Subtraction runs against the FULL z-stack so disabled layers still
    # occlude shapes below them (hide-but-still-mask), matching how
    # design tools treat hidden layers. Then we filter to enabled colors.
    shapes = list(parse_result.shapes)
    if request.subtract_overlaps:
        with _phase("subtract"):
            shapes = subtract_overlapping_shapes(shapes)

    shapes = [
        shape for shape in shapes
        if _shape_primary_color(shape) in layer_by_color
    ]
    if not shapes:
        raise ValueError(
            "No SVG shapes matched any enabled layer color. Re-detect colors "
            "or enable the layer(s) you want to engrave."
        )

    project = XCSProject()

    # Segment counters for hatched layers (used for max_segments cap).
    segment_count = 0
    per_color_counts: dict[str, int] = {}

    # Manual phase timer here instead of ``with report.phase("emit"):``
    # because the loop body is long and re-indenting it just for the
    # context manager noise isn't worth it.
    _emit_start = time.perf_counter()
    # One Path per shape using its layer's params. HATCHED_LINES shapes are
    # handled separately below (no Path emitted for them).
    for shape in shapes:
        color = _shape_primary_color(shape)
        if color is None or color not in layer_by_color:
            continue
        layer = layer_by_color[color]

        if layer.processing_type == "HATCHED_LINES":
            from xcs_gen.hatch import svg_d_to_polygon, generate_hatch_segments
            from xcs_gen.builder import _build_rect_display, build_device_entry
            from xcs_gen.svg_source import HatchPass as LibHatchPass
            from xcs_gen.svg_source import HatchRamp as LibHatchRamp

            layer_params = _to_processing_params(layer.base_params)
            polygon = svg_d_to_polygon(shape.d, fill_rule=shape.fill_rule)
            # Thin filled RECT per hatch line (rotated to the hatch angle) instead
            # of LINE elements: XCS Studio handles RECT fills consistently when a
            # material preset is later applied, where LINE clusters get flattened
            # into a single fill region with the per-line params lost.
            for hp in layer.hatch_passes:
                lib_hp = LibHatchPass(
                    angle=hp.angle,
                    spacing=hp.spacing,
                    ramps=[
                        LibHatchRamp(param=r.param, axis=r.axis,
                                     min_value=r.min, max_value=r.max)
                        for r in hp.ramps
                    ],
                )
                segments = generate_hatch_segments(
                    polygon, lib_hp,
                    layer_color=color,
                    fallback_params=layer_params,
                )
                for seg in segments:
                    segment_count += 1
                    per_color_counts[color] = per_color_counts.get(color, 0) + 1
                    if segment_count > max_segments:
                        worst = max(per_color_counts, key=per_color_counts.get)
                        raise ValueError(
                            f"hatched output exceeded max_segments={max_segments} "
                            f"(color {worst!r} contributes {per_color_counts[worst]}). "
                            "Increase spacing, reduce passes, or raise max_segments."
                        )

                    # Each hatch segment becomes a thin filled RECT, rotated to
                    # the hatch angle so it lies along the line's direction.
                    # scan_angle=0 (relative to the rect) means the laser scans
                    # along the rect's long axis — i.e. along the hatch line.
                    seg_params = replace(
                        seg.params or layer_params, scan_angle=0,
                    )
                    rect = Rect(
                        x=seg.x, y=seg.y,
                        width=seg.length, height=hp.thickness,
                        params=seg_params,
                        processing_type="COLOR_FILL_ENGRAVE",
                        is_fill=True,
                        layer_color=color,
                    )
                    rect_display = _build_rect_display(rect)
                    rect_display["angle"] = hp.angle  # rotate around (x, y)

                    project.extra_displays.append(rect_display)
                    project.extra_device_entries.append(
                        build_device_entry(
                            rect.id, "RECT", "COLOR_FILL_ENGRAVE", seg_params,
                        )
                    )
            continue  # skip Path emission below for hatched layers

        params = replace(
            _to_processing_params(layer.base_params, angle_mode=layer.angle_mode),
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

    if report is not None:
        report.phases.append(("emit", time.perf_counter() - _emit_start))
        report.set("hatch_segments", segment_count)

    # Multi-pass behaviour is now handled by XCS natively via
    # ProcessingParams.repeat + angle_type + cross_angle on each layer's
    # params (piped through _to_processing_params via layer.angle_mode).
    # No per-pass path duplication here.

    if not project.paths and not project.extra_displays:
        raise ValueError("No paths emitted - check that the SVG has supported shapes.")

    return project


def svg_layers_to_xcs(request: SvgLayersRequest) -> XCSProject:
    """Parse SVG, group shapes by color, emit Paths per enabled layer.

    Delegates to :func:`build_svg_layers_project`.

    Raises:
        ValueError: on parse failure, no shapes, or no enabled layers with
            matching shapes.
    """
    return build_svg_layers_project(request)


def svg_preview(request: SvgPreviewRequest) -> SvgPreviewResponse:
    """Apply layer filtering + optional subtraction, return a preview SVG string.

    The response SVG is a minimal rendering with one <path> per remaining
    shape, using the shape's original fill color. viewBox matches the
    ParseResult's output dims so the UI can drop it into the preview pane.
    """
    assert_shape_count(request.svg_content)
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

    shapes = list(parsed.shapes)

    # Subtraction runs against the FULL z-stack so disabled layers still
    # occlude shapes below them. Then we filter down to enabled colors so
    # the preview matches what will actually be engraved.
    if request.subtract_overlaps and shapes:
        shapes = subtract_overlapping_shapes(shapes)

    if request.enabled_colors is not None:
        enabled = set(request.enabled_colors)
        shapes = [s for s in shapes if _shape_primary_color(s) in enabled]

    # Build viewBox from parsed output dims, falling back to shapes' bbox union
    if parsed.output_width_mm > 0 and parsed.output_height_mm > 0:
        view_w = parsed.output_width_mm
        view_h = parsed.output_height_mm
    elif shapes:
        min_x = min(s.bbox_x_mm for s in shapes)
        min_y = min(s.bbox_y_mm for s in shapes)
        max_x = max(s.bbox_x_mm + s.bbox_width_mm for s in shapes)
        max_y = max(s.bbox_y_mm + s.bbox_height_mm for s in shapes)
        view_w = max(max_x - min_x, 1.0)
        view_h = max(max_y - min_y, 1.0)
    else:
        view_w = view_h = 1.0

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {view_w:.4f} {view_h:.4f}" '
        f'width="100%" height="100%" preserveAspectRatio="xMidYMid meet">'
    ]
    for shape in shapes:
        fill = shape.fill or "none"
        stroke = shape.stroke or "none"
        parts.append(
            f'<path d="{shape.d}" fill="{fill}" stroke="{stroke}" '
            f'fill-rule="{shape.fill_rule}" />'
        )
    parts.append("</svg>")

    return SvgPreviewResponse(svg="".join(parts))


def svg_layers_to_xcs_bytes(request: SvgLayersRequest) -> bytes:
    """Convert to .xcs file bytes (JSON-encoded)."""
    assert_shape_count(request.svg_content)

    # Per-phase timing so a slow request log-line tells us which step
    # (parse vs subtract vs emit vs json.dumps) caused it. Especially
    # useful when the pipeline hits a gateway timeout — the report line
    # is written even on failure (emit() still runs in the finally
    # equivalent below, but we also want it on success).
    report = TimingReport("svg-layers")
    report.set("svg_bytes", len(request.svg_content))
    report.set("layers_enabled", sum(1 for l in request.layers if l.enabled))
    report.set("subtract", request.subtract_overlaps)

    try:
        xcs = build_svg_layers_project(request, report=report)
        report.set("paths", len(xcs.paths))
        report.set("extra_displays", len(xcs.extra_displays))
        with report.phase("build_xcs"):
            data = build_xcs(xcs)
        with report.phase("json.dumps"):
            body = json.dumps(data, separators=(",", ":")).encode("utf-8")
        report.set("output_bytes", len(body))
        return body
    finally:
        report.emit()
