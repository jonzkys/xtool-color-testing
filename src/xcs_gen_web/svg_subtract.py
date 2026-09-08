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


# Post-subtract d-strings are emitted at %.4f mm while the bbox they carry
# came from unrounded shapely bounds, so a flattened ring can land ~5e-5 mm
# outside its own bbox. Demand containment by more than an order of magnitude
# beyond that before trusting the bbox as a proxy for the geometry.
_BBOX_MARGIN_MM = 1e-3


def _bbox_inside(
    sh: ParsedShape, x: float, y: float, width: float, height: float
) -> bool:
    """True when ``sh``'s recorded bbox sits strictly inside the rect."""
    m = _BBOX_MARGIN_MM
    return (
        sh.bbox_x_mm >= x + m
        and sh.bbox_y_mm >= y + m
        and sh.bbox_x_mm + sh.bbox_width_mm <= x + width - m
        and sh.bbox_y_mm + sh.bbox_height_mm <= y + height - m
    )


def subtract_and_clip(
    shapes: list[ParsedShape],
    *, x: float, y: float, width: float, height: float,
) -> list[ParsedShape]:
    """``subtract_overlapping_shapes`` then ``clip_shapes_to_rect``, fused.

    Running them separately means every shape's geometry is built twice: the
    subtract pass computes a shapely polygon, serialises it to a d-string via
    ``_geom_to_svg_d``, and the clip pass immediately parses that string back
    into a polygon just to ask whether it is inside the canvas. On a 2789-path
    vtracer trace that second parse was 5.9 s of a 10.3 s request — the single
    largest phase in the whole pipeline, spent rebuilding something we had
    just thrown away.

    Keeping the geometry in hand across both steps also means a shape that is
    untouched by subtraction AND inside the canvas keeps its original
    ``d`` — curves included — instead of being flattened to polylines for no
    reason.
    """
    canvas = Polygon([
        (x, y), (x + width, y),
        (x + width, y + height), (x, y + height),
    ])
    clip_enabled = not canvas.is_empty

    polys = _shape_polygons(shapes)
    tree, tree_geoms, tree_orig = _build_tree(polys)

    out: list[ParsedShape] = []
    for i, sh in enumerate(shapes):
        mine = polys[i]
        if mine is None:
            # Stroke-only or unparseable — passes through both steps untouched.
            out.append(sh)
            continue

        geom = mine
        higher = _higher_neighbours(tree, tree_geoms, tree_orig, mine, i)
        if higher:
            above = higher[0] if len(higher) == 1 else unary_union(higher)
            if not above.is_empty and not geom.disjoint(above):
                geom = geom.difference(above)
                if geom.is_empty:
                    continue  # fully covered by shapes above it

        if clip_enabled and not _bbox_inside(sh, x, y, width, height):
            # Only shapes near the canvas edge pay for a real intersection,
            # and we already hold the geometry so there is nothing to re-parse.
            bounds = geom.bounds
            if not (
                bounds[0] >= x and bounds[1] >= y
                and bounds[2] <= x + width and bounds[3] <= y + height
            ):
                geom = geom.intersection(canvas)
                if geom.is_empty:
                    continue

        if geom is mine:
            out.append(sh)  # untouched by both steps — keep the original d
            continue

        new_d = _geom_to_svg_d(geom)
        if not new_d:
            continue
        minx, miny, maxx, maxy = geom.bounds
        out.append(
            replace(
                sh,
                d=new_d,
                kind="path",
                bbox_x_mm=minx,
                bbox_y_mm=miny,
                bbox_width_mm=max(maxx - minx, 0.001),
                bbox_height_mm=max(maxy - miny, 0.001),
                is_close_path=True,
            )
        )
    return out


def _shape_polygons(shapes: list[ParsedShape]):
    """Polygon per filled shape, ``None`` for strokes and unparseable input."""
    polys: list[Polygon | MultiPolygon | None] = []
    for sh in shapes:
        if sh.fill is None:
            polys.append(None)
            continue
        try:
            p = svg_d_to_polygon(sh.d, fill_rule=sh.fill_rule)
        except Exception:
            p = None
        polys.append(None if (p is None or p.is_empty) else p)
    return polys


def _build_tree(polys):
    tree_geoms: list[Polygon | MultiPolygon] = []
    tree_orig: list[int] = []
    for i, p in enumerate(polys):
        if p is None:
            continue
        tree_geoms.append(p)
        tree_orig.append(i)
    tree = STRtree(tree_geoms) if tree_geoms else None
    return tree, tree_geoms, tree_orig


def _higher_neighbours(tree, tree_geoms, tree_orig, mine, i):
    """Geometries stacked above index ``i`` that genuinely intersect ``mine``.

    ``predicate="intersects"`` rather than a bare bbox query: the bare query
    hands ``unary_union`` candidates that only share a bounding box, and on a
    dense trace the bottom shape's bbox overlaps nearly everything.
    """
    if tree is None:
        return []
    higher: list[Polygon | MultiPolygon] = []
    for k in tree.query(mine, predicate="intersects"):
        orig_i = tree_orig[int(k)]
        if orig_i <= i:
            continue
        cand = tree_geoms[int(k)]
        if not cand.is_empty:
            higher.append(cand)
    return higher


def clip_shapes_to_rect(
    shapes: list[ParsedShape],
    *, x: float, y: float, width: float, height: float,
) -> list[ParsedShape]:
    """Intersect each filled shape with the canvas rect ``(x, y, width, height)``.

    vtracer occasionally emits polygons whose vertices sit a fraction of a
    pixel outside the source-image rect — a leftover from anti-alias edge
    smoothing. Without clipping those slivers leak into the .xcs output as
    burns past the design canvas. This applies a single rectangular clip
    so the engraved area never exceeds the input image's footprint.

    Stroke-only shapes pass through unchanged. Shapes whose intersection
    with the rect is empty are dropped.
    """
    if not shapes:
        return shapes
    canvas = Polygon([
        (x, y), (x + width, y),
        (x + width, y + height), (x, y + height),
    ])
    if canvas.is_empty:
        return shapes
    out: list[ParsedShape] = []
    for sh in shapes:
        if sh.fill is None:
            out.append(sh)
            continue
        # Bbox fast path: if the stored bbox is inside the rect then so is the
        # geometry, and we can skip rebuilding the polygon entirely. On a real
        # trace only 15 of 2785 shapes actually cross the canvas edge, so this
        # is the overwhelmingly common case and the polygon rebuild was ~97%
        # wasted work.
        #
        # The margin is a tolerance, not slop: post-subtract d-strings are
        # written at %.4f while the bbox came from unrounded ``diff.bounds``,
        # so the flattened polygon can sit up to ~5e-5 mm outside its own
        # recorded bbox. Require containment by more than that.
        if _bbox_inside(sh, x, y, width, height):
            out.append(sh)
            continue
        try:
            poly = svg_d_to_polygon(sh.d, fill_rule=sh.fill_rule)
        except Exception:
            poly = None
        if poly is None or poly.is_empty:
            out.append(sh)
            continue
        if canvas.contains(poly):
            # Fully inside — common case, no need to rebuild geometry.
            out.append(sh)
            continue
        clipped = poly.intersection(canvas)
        if clipped.is_empty:
            continue
        new_d = _geom_to_svg_d(clipped)
        if not new_d:
            continue
        minx, miny, maxx, maxy = clipped.bounds
        out.append(
            replace(
                sh,
                d=new_d,
                kind="path",
                bbox_x_mm=minx,
                bbox_y_mm=miny,
                bbox_width_mm=max(maxx - minx, 0.001),
                bbox_height_mm=max(maxy - miny, 0.001),
                is_close_path=True,
            )
        )
    return out
