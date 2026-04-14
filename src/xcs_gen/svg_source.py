"""SVG parsing for the svg-to-laser pipeline.

Reads an SVG via svgelements (which bakes transforms and resolves styles),
converts shapes to normalized ParsedShape records carrying absolute-coord
SVG path strings in bed-mm coordinates.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Literal

from svgelements import (
    SVG,
    Circle as SVGCircle,
    Ellipse as SVGEllipse,
    Line as SVGLine,
    Path as SVGPath,
    Polygon as SVGPolygon,
    Polyline as SVGPolyline,
    Rect as SVGRect,
    Shape as SVGShape,
)


ShapeKind = Literal["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"]


@dataclass
class ParsedShape:
    """A single SVG shape normalized into bed-mm coordinates."""

    kind: ShapeKind
    d: str                        # SVG path d string in bed-mm coords
    bbox_x_mm: float
    bbox_y_mm: float
    bbox_width_mm: float
    bbox_height_mm: float
    fill: str | None              # lowercase "#rrggbb" or None
    stroke: str | None
    fill_rule: Literal["evenodd", "nonzero"] = "evenodd"
    is_close_path: bool = True
    # For native CIRCLE emission we also keep the circle's derived props:
    circle_cx_mm: float | None = None
    circle_cy_mm: float | None = None
    circle_r_mm: float | None = None


@dataclass
class ParseResult:
    """Result of parsing an SVG file."""

    shapes: list[ParsedShape] = field(default_factory=list)
    output_width_mm: float = 0.0
    output_height_mm: float = 0.0
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (kind, id)


def parse_svg(
    svg_path: str,
    *,
    total_width: float,
    total_height: float | None,
    start_x: float = 0.0,
    start_y: float = 0.0,
) -> ParseResult:
    """Parse an SVG into a list of ParsedShape records.

    Args:
        svg_path: filesystem path to the .svg file.
        total_width: output width in bed-mm. The SVG is uniformly scaled.
        total_height: output height in bed-mm. If None, aspect ratio is preserved.
        start_x: bed-mm x offset applied to every shape.
        start_y: bed-mm y offset applied to every shape.

    Returns:
        ParseResult with normalized shapes and skipped-element log.
    """
    svg = SVG.parse(source=svg_path)
    src_w = float(svg.width) if svg.width else None
    src_h = float(svg.height) if svg.height else None
    if not src_w or not src_h:
        # Fall back to viewBox bounds if width/height missing.
        vb = getattr(svg, "viewbox", None)
        if vb is not None:
            src_w = float(vb.width)
            src_h = float(vb.height)
    if not src_w or not src_h:
        raise ValueError(
            f"SVG {svg_path}: cannot determine source dimensions "
            "(no width/height or viewBox)."
        )

    scale_x = total_width / src_w
    if total_height is None:
        scale_y = scale_x
        out_h = src_h * scale_y
    else:
        scale_y = total_height / src_h
        out_h = total_height

    result = ParseResult(output_width_mm=total_width, output_height_mm=out_h)

    for element in svg.elements():
        if not isinstance(element, SVGShape):
            continue
        shape = _normalize_shape(
            element,
            scale_x=scale_x, scale_y=scale_y,
            start_x=start_x, start_y=start_y,
            result=result,
        )
        if shape is not None:
            result.shapes.append(shape)

    return result


_UNSUPPORTED_LOGGED: set[str] = set()


def _normalize_shape(
    element: SVGShape,
    *,
    scale_x: float,
    scale_y: float,
    start_x: float,
    start_y: float,
    result: ParseResult,
) -> ParsedShape | None:
    """Convert one svgelements Shape to a ParsedShape, or return None if skipped."""
    kind = _shape_kind(element)
    if kind is None:
        tag = type(element).__name__
        el_id = getattr(element, "id", "") or ""
        if tag not in _UNSUPPORTED_LOGGED:
            print(f"[svg_source] skipping unsupported element <{tag}> (id={el_id!r})",
                  file=sys.stderr)
            _UNSUPPORTED_LOGGED.add(tag)
        result.skipped.append((tag, el_id))
        return None

    # svgelements composes transforms into the shape; convert to absolute SVGPath.
    try:
        path = SVGPath(element)  # accepts any Shape subclass
    except Exception as exc:
        el_id = getattr(element, "id", "") or ""
        print(f"[svg_source] failed to normalize element id={el_id!r}: {exc}",
              file=sys.stderr)
        result.skipped.append((type(element).__name__, el_id))
        return None

    # Apply mm-scale and bed-origin offset to every segment endpoint.
    path = _scale_and_offset(path, scale_x, scale_y, start_x, start_y)

    bbox = path.bbox()
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    bbox_w = x1 - x0
    bbox_h = y1 - y0
    if bbox_w <= 0 or bbox_h <= 0:
        return None

    d_str = path.d()
    if not d_str:
        return None

    fill = _normalize_color(getattr(element, "fill", None))
    stroke = _normalize_color(getattr(element, "stroke", None))
    fill_rule = _fill_rule(element)
    is_close = _is_close_path(path)

    ps = ParsedShape(
        kind=kind,
        d=d_str,
        bbox_x_mm=x0,
        bbox_y_mm=y0,
        bbox_width_mm=bbox_w,
        bbox_height_mm=bbox_h,
        fill=fill,
        stroke=stroke,
        fill_rule=fill_rule,
        is_close_path=is_close,
    )
    if kind == "circle" and isinstance(element, SVGCircle):
        ps.circle_cx_mm = (x0 + x1) / 2
        ps.circle_cy_mm = (y0 + y1) / 2
        ps.circle_r_mm = bbox_w / 2
    return ps


def _shape_kind(element: SVGShape) -> ShapeKind | None:
    if isinstance(element, SVGPath):
        return "path"
    if isinstance(element, SVGRect):
        return "rect"
    if isinstance(element, SVGCircle):
        return "circle"
    if isinstance(element, SVGEllipse):
        return "ellipse"
    if isinstance(element, SVGLine):
        return "line"
    if isinstance(element, SVGPolygon):
        return "polygon"
    if isinstance(element, SVGPolyline):
        return "polyline"
    return None


def _scale_and_offset(
    path: SVGPath, scale_x: float, scale_y: float, offset_x: float, offset_y: float
) -> SVGPath:
    """Apply uniform scale + offset to every point in a path. Returns new SVGPath."""
    # svgelements transforms API: .transform works via affine matrix; simplest is
    # to apply a transform string and re-parse.
    transform = f"matrix({scale_x} 0 0 {scale_y} {offset_x} {offset_y})"
    new_path = SVGPath(path)
    new_path *= transform  # svgelements supports matrix post-multiply via *= transform
    return new_path


def _normalize_color(color) -> str | None:
    """Normalize a svgelements Color to lowercase '#rrggbb', or None.

    Handles:
    - None/Color('none')  → None
    - Color('transparent') → None  (alpha=0 means fully transparent)
    - Named colors like 'red' → '#ff0000'
    - Uppercase hex '#FFD73E' → '#ffd73e'
    - Short hex '#f00' → '#ff0000'
    """
    if color is None:
        return None
    # svgelements Color('none') == None evaluates True
    if color == None:  # noqa: E711  — intentional: Color.__eq__(None) is True for 'none'
        return None
    s = str(color).strip().lower()
    if s in ("", "none"):
        return None
    # transparent becomes '#00000000' (8-char hex with alpha=00)
    if s.startswith("#") and len(s) == 9 and s[7:9] == "00":
        return None
    # Expand short hex
    if s.startswith("#") and len(s) == 4:
        s = "#" + "".join(c * 2 for c in s[1:])
    if s.startswith("#") and len(s) == 7:
        return s
    # Any other form svgelements couldn't resolve → discard
    return None


def _fill_rule(element: SVGShape) -> Literal["evenodd", "nonzero"]:
    rule = getattr(element, "fill_rule", None)
    if rule is None:
        return "evenodd"
    r = str(rule).lower()
    return "nonzero" if r == "nonzero" else "evenodd"


def _is_close_path(path: SVGPath) -> bool:
    # Check for a 'Z' / 'z' close-path command in the d-string.
    d = path.d() or ""
    return d.strip().endswith(("z", "Z"))


@dataclass
class DetectedColor:
    """A colour detected in the SVG, with the role it plays."""

    hex: str                                       # lowercase "#rrggbb"
    source: Literal["fill", "stroke", "both"]
    shape_count: int


def detect_svg_colors(svg_path: str) -> list[DetectedColor]:
    """Return every unique fill/stroke colour used by shapes in the SVG."""
    # Minimal parse (scale/offset don't matter for colour detection).
    result = parse_svg(svg_path, total_width=100.0, total_height=None)

    fill_counts: dict[str, int] = {}
    stroke_counts: dict[str, int] = {}
    for shape in result.shapes:
        if shape.fill:
            fill_counts[shape.fill] = fill_counts.get(shape.fill, 0) + 1
        if shape.stroke:
            stroke_counts[shape.stroke] = stroke_counts.get(shape.stroke, 0) + 1

    out: list[DetectedColor] = []
    for hex_color in sorted(set(fill_counts) | set(stroke_counts)):
        in_fill = hex_color in fill_counts
        in_stroke = hex_color in stroke_counts
        if in_fill and in_stroke:
            source: Literal["fill", "stroke", "both"] = "both"
            count = max(fill_counts[hex_color], stroke_counts[hex_color])
        elif in_fill:
            source = "fill"
            count = fill_counts[hex_color]
        else:
            source = "stroke"
            count = stroke_counts[hex_color]
        out.append(DetectedColor(hex=hex_color, source=source, shape_count=count))
    return out


# ---------------------------------------------------------------------------
# Layer resolution: LayerConfig / AutoRamp / LayerAssignment
# ---------------------------------------------------------------------------

from .model import ProcessingParams  # noqa: E402 — appended after top-level imports

RenderMode = Literal["fill_engrave", "vector_engrave", "vector_cut"]

_RENDER_MODE_TO_PROCESSING: dict[str, str] = {
    "fill_engrave": "COLOR_FILL_ENGRAVE",
    "vector_engrave": "VECTOR_ENGRAVING",
    "vector_cut": "VECTOR_CUTTING",
}


@dataclass
class LayerConfig:
    """Explicit params for a single colour layer."""

    params: ProcessingParams
    render_mode: RenderMode = "fill_engrave"


@dataclass
class AutoRamp:
    """Automatic parameter ramp across detected colours."""

    param: str                                         # e.g. "power", "speed"
    min_value: float                                   # assigned to first in sort
    max_value: float                                   # assigned to last in sort
    sort_by: Literal["luminance", "hue", "order_of_appearance"] = "luminance"
    default_render_mode: RenderMode = "fill_engrave"


@dataclass
class LayerAssignment:
    """Resolved per-colour params + render mode, ready to emit."""

    params: ProcessingParams
    render_mode: RenderMode
    processing_type: str


def resolve_layer_params(
    *,
    detected_colors: list[str],
    layer_config: dict[str, LayerConfig] | None,
    auto_ramp: AutoRamp | None,
    base_params: ProcessingParams,
) -> dict[str, LayerAssignment]:
    """Produce one LayerAssignment per detected colour.

    Resolution order:
      1. explicit layer_config entry
      2. auto_ramp (applied only to colours not in layer_config)
      3. ValueError if neither covers a colour.
    """
    layer_config = layer_config or {}
    out: dict[str, LayerAssignment] = {}

    # 1. Apply explicit entries.
    for color, cfg in layer_config.items():
        out[color] = LayerAssignment(
            params=cfg.params,
            render_mode=cfg.render_mode,
            processing_type=_RENDER_MODE_TO_PROCESSING[cfg.render_mode],
        )

    # 2. Apply auto-ramp to remaining colours in the order they were detected.
    remaining = [c for c in detected_colors if c not in out]
    if remaining:
        if auto_ramp is None:
            raise ValueError(
                f"No layer_config or auto_ramp covers colours: {remaining}. "
                "Provide layer_config entries or pass an AutoRamp."
            )
        ordered = _sort_for_ramp(remaining, auto_ramp.sort_by)
        values = _linspace(auto_ramp.min_value, auto_ramp.max_value, len(ordered))
        for color, value in zip(ordered, values):
            params = _copy_params(base_params)
            _set_ramp_param(params, auto_ramp.param, value)
            out[color] = LayerAssignment(
                params=params,
                render_mode=auto_ramp.default_render_mode,
                processing_type=_RENDER_MODE_TO_PROCESSING[auto_ramp.default_render_mode],
            )
        if len(ordered) == 1:
            print(
                "[svg_source] auto-ramp applied to only one colour; "
                f"assigning min_value ({auto_ramp.min_value}).",
                file=sys.stderr,
            )

    return out


def _sort_for_ramp(
    colors: list[str],
    mode: Literal["luminance", "hue", "order_of_appearance"],
) -> list[str]:
    if mode == "order_of_appearance":
        return list(colors)
    if mode == "luminance":
        # Sort descending by luminance so that darkest ends up last (→ max_value).
        return sorted(colors, key=_luminance, reverse=True)
    if mode == "hue":
        return sorted(colors, key=_hue)
    return list(colors)


def _luminance(hex_color: str) -> float:
    r, g, b = _hex_to_rgb(hex_color)
    return 0.299 * r + 0.587 * g + 0.114 * b


def _hue(hex_color: str) -> float:
    r, g, b = (c / 255 for c in _hex_to_rgb(hex_color))
    mx = max(r, g, b)
    mn = min(r, g, b)
    d = mx - mn
    if d == 0:
        return 0.0
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = ((b - r) / d) + 2
    else:
        h = ((r - g) / d) + 4
    return h * 60


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    return (
        int(hex_color[1:3], 16),
        int(hex_color[3:5], 16),
        int(hex_color[5:7], 16),
    )


def _linspace(a: float, b: float, n: int) -> list[float]:
    if n <= 1:
        return [a]
    step = (b - a) / (n - 1)
    return [a + step * i for i in range(n)]


def _copy_params(p: ProcessingParams) -> ProcessingParams:
    return ProcessingParams(
        speed=p.speed, power=p.power, repeat=p.repeat, density=p.density,
        pulse_width=p.pulse_width, mopa_frequency=p.mopa_frequency, dpi=p.dpi,
        dot_duration=p.dot_duration,
        processing_light_source=p.processing_light_source,
        scan_angle=p.scan_angle, angle_type=p.angle_type, cross_angle=p.cross_angle,
    )


_RAMP_FIELD_MAP = {
    "speed": ("speed", True),
    "power": ("power", False),
    "frequency": ("mopa_frequency", True),
    "mopa_frequency": ("mopa_frequency", True),
    "density": ("density", True),
    "passes": ("repeat", True),
    "repeat": ("repeat", True),
    "pulse_width": ("pulse_width", True),
    "dpi": ("dpi", True),
}


def _set_ramp_param(params: ProcessingParams, name: str, value: float) -> None:
    if name not in _RAMP_FIELD_MAP:
        raise ValueError(f"Unknown ramp param {name!r}. "
                         f"Valid: {sorted(_RAMP_FIELD_MAP)}")
    field_name, is_int = _RAMP_FIELD_MAP[name]
    setattr(params, field_name, int(round(value)) if is_int else value)
