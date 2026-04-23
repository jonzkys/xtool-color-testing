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
from shapely.strtree import STRtree

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

    Implementation note — uses an STRtree spatial index to only consider
    shapes whose bbox actually overlaps the target. A naive
    ``unary_union(polys[i+1:])`` per iteration is O(N²) in polygon size;
    a suffix-union cache improves that but still accumulates one huge
    polygon that makes later ``difference()`` calls expensive. The tree
    query cuts each iteration to its true spatial neighbours — for
    sparse vtracer output that's typically dozens of shapes, not the
    full remainder of the z-stack.
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

    # Build an STRtree over the non-None polygons. ``tree_geoms[k]`` is
    # the k-th polygon inserted; ``tree_orig[k]`` maps it back to its
    # original shape index (z-order).
    tree_geoms: list[Polygon | MultiPolygon] = []
    tree_orig: list[int] = []
    for i, p in enumerate(polys):
        if p is None:
            continue
        tree_geoms.append(p)
        tree_orig.append(i)
    tree = STRtree(tree_geoms) if tree_geoms else None

    result: list[ParsedShape] = []
    for i in range(n):
        sh = shapes[i]
        my_poly = polys[i]
        if my_poly is None:
            # Stroke-only or unparseable - pass through
            result.append(sh)
            continue

        # Spatial candidates whose bbox intersects this shape's bbox.
        # Filter to only those stacked above (z > i). ``tree.query``
        # returns tree-local indices; ``tree_orig`` maps them back.
        higher: list[Polygon | MultiPolygon] = []
        if tree is not None:
            for k in tree.query(my_poly):
                orig_i = tree_orig[int(k)]
                if orig_i <= i:
                    continue
                cand = tree_geoms[int(k)]
                if not cand.is_empty:
                    higher.append(cand)
        if not higher:
            # Nothing spatially above this shape; keep it as-is.
            result.append(sh)
            continue

        above = higher[0] if len(higher) == 1 else unary_union(higher)
        if above.is_empty or my_poly.disjoint(above):
            # Bbox-overlap but no actual geometric overlap.
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
