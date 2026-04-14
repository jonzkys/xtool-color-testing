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
