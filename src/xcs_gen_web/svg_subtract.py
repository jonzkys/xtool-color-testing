"""Boolean subtraction between SVG layers.

Given a list of shapes in Z-order (first = bottom, last = top), each filled
shape has the union of all shapes above it subtracted from its geometry. The
result is a list of shapes where no two filled regions overlap - the laser
engraves each bed pixel at most once per layer pass.

Open / stroked paths (no fill) are passed through unchanged; boolean ops
on strokes aren't meaningful.
"""

from __future__ import annotations

from dataclasses import replace

from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

from xcs_gen.hatch import svg_d_to_polygon
from xcs_gen.svg_source import ParsedShape


def _geom_to_svg_d(geom) -> str:
    """Turn a shapely Polygon / MultiPolygon / GeometryCollection into an SVG d string.

    Each ring becomes a "M x0 y0 L x1 y1 L ... Z" subpath. Holes are emitted as
    additional closed subpaths; XCS Studio's fill-rule handling treats them
    correctly as odd-depth (hole) rings under evenodd.
    """
    if geom.is_empty:
        return ""

    parts: list[str] = []

    def emit_ring(coords: list[tuple[float, float]]) -> None:
        if len(coords) < 3:
            return
        x0, y0 = coords[0]
        parts.append(f"M {x0:.4f} {y0:.4f}")
        for x, y in coords[1:]:
            parts.append(f"L {x:.4f} {y:.4f}")
        parts.append("Z")

    polys: list[Polygon]
    if isinstance(geom, Polygon):
        polys = [geom]
    elif isinstance(geom, MultiPolygon):
        polys = list(geom.geoms)
    else:
        # GeometryCollection: keep polygons, drop anything else (points/lines
        # from degenerate boolean results).
        polys = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]

    for poly in polys:
        if poly.is_empty:
            continue
        emit_ring(list(poly.exterior.coords))
        for interior in poly.interiors:
            emit_ring(list(interior.coords))

    return " ".join(parts)


def subtract_overlapping_shapes(shapes: list[ParsedShape]) -> list[ParsedShape]:
    """Return a new shape list where each filled shape has higher shapes subtracted.

    Shapes are processed in reverse document order. For shape i the polygon of
    every filled shape j > i is unioned and subtracted from shape i's geometry.
    A shape that ends up empty after subtraction is dropped. A shape whose
    geometry changes gets a new d-string and bounding box; all other metadata
    (fill, stroke, fill_rule, kind) is preserved.

    Stroked-only (fill is None) shapes pass through unchanged - strokes are
    1D and not subject to area subtraction.

    Implementation note — walks bottom→top but builds the "above" mask
    incrementally via a suffix-union table computed once, top→bottom.
    The old implementation rebuilt ``unary_union(polys[i+1:])`` for every
    ``i``, which is O(N²) unions; at ~1000 shapes that's where the
    500-layer timeout was coming from. The ``disjoint`` short-circuit
    skips the (expensive) ``difference`` call whenever a shape's bbox
    doesn't touch anything stacked above it — the common case on sparse
    vtracer output.
    """
    n = len(shapes)

    # Pre-compute polygons for filled shapes; keep strokes-only aside.
    polys: list[Polygon | MultiPolygon | None] = []
    for sh in shapes:
        if sh.fill is None:
            polys.append(None)
            continue
        try:
            p = svg_d_to_polygon(sh.d, fill_rule=sh.fill_rule)
        except Exception:
            p = None
        if p is None or p.is_empty:
            polys.append(None)
            continue
        polys.append(p)

    # suffix_unions[i] = unary_union(polys[i+1:]) — the "mask" that sits
    # above shape i. Built once, top→bottom, so each shape contributes to
    # at most one union call (O(N) unions total instead of the old O(N²)).
    suffix_unions: list[Polygon | MultiPolygon | None] = [None] * n
    for i in range(n - 2, -1, -1):
        above_p = polys[i + 1]
        prev_suffix = suffix_unions[i + 1]
        if above_p is None:
            suffix_unions[i] = prev_suffix
        elif prev_suffix is None or prev_suffix.is_empty:
            suffix_unions[i] = above_p
        else:
            suffix_unions[i] = unary_union([prev_suffix, above_p])

    result: list[ParsedShape] = []
    for i in range(n):
        sh = shapes[i]
        my_poly = polys[i]
        if my_poly is None:
            # Stroke-only or unparseable - pass through
            result.append(sh)
            continue

        above = suffix_unions[i]
        if above is None or above.is_empty or my_poly.disjoint(above):
            # Nothing above, or bboxes don't even touch — no work to do.
            result.append(sh)
            continue

        diff = my_poly.difference(above)
        if diff.is_empty:
            # Fully covered by higher shapes - drop
            continue

        # Rebuild the shape with the new geometry. Only d, bbox, and kind change.
        minx, miny, maxx, maxy = diff.bounds
        new_d = _geom_to_svg_d(diff)
        if not new_d:
            continue
        result.append(
            replace(
                sh,
                d=new_d,
                kind="path",
                bbox_x_mm=minx,
                bbox_y_mm=miny,
                bbox_width_mm=max(maxx - minx, 0.001),
                bbox_height_mm=max(maxy - miny, 0.001),
                is_close_path=True,
                # fill_rule stays evenodd so exteriors-then-holes layout is respected
            )
        )

    return result
