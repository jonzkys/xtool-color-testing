"""Polygon construction and hatch-segment generation for the hatched render mode.

Depends on shapely for polygon ops. Consumes the same SVG path d-strings (in
bed-mm) that the v1 parser emits.
"""

from __future__ import annotations

import re
from typing import Literal

from shapely import make_valid
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon
from shapely.ops import unary_union
from svgelements import Path as SVGPath


FillRule = Literal["evenodd", "nonzero"]


def svg_d_to_polygon(d: str, *, fill_rule: FillRule = "evenodd") -> Polygon | MultiPolygon:
    """Convert an SVG path d-string to a shapely Polygon (or MultiPolygon).

    Subpaths split on 'M'/'m' commands. Curve commands (C, Q, A) are flattened
    by svgelements' built-in sampling before each ring is handed to shapely.

    Fill rule:
      - evenodd: nested subpaths alternate between exterior/hole based on nesting.
      - nonzero: winding direction decides. We approximate by treating every ring
        as an exterior, then unioning — adequate for typical laser artwork.
    """
    path = SVGPath(d)
    rings = _path_to_rings(path)
    if not rings:
        return Polygon()

    if fill_rule == "nonzero":
        # Union every subpath as its own polygon; holes produced by winding are
        # conservatively ignored. Good enough for laser artwork.
        polys = [Polygon(ring) for ring in rings if len(ring) >= 3]
        return _repair(unary_union(polys))

    # evenodd: walk rings, every one that's strictly inside an odd number of
    # others becomes a hole.
    simple_polys = [Polygon(ring) for ring in rings if len(ring) >= 3]
    if not simple_polys:
        return Polygon()

    # Sort by area descending so containment checks are stable.
    indexed = sorted(enumerate(simple_polys), key=lambda pair: pair[1].area, reverse=True)
    depth: dict[int, int] = {idx: 0 for idx, _ in indexed}
    for i, (a_idx, a) in enumerate(indexed):
        for b_idx, b in indexed[:i]:
            if depth[b_idx] is None:
                continue
            if b.contains(a):
                depth[a_idx] = depth[b_idx] + 1

    # Group rings by their containing exterior (nearest even-depth ancestor).
    exteriors: list[tuple[list[tuple[float, float]], list[list[tuple[float, float]]]]] = []
    exterior_indices: list[int] = []
    for idx, poly in indexed:
        if depth[idx] % 2 == 0:
            exteriors.append((list(poly.exterior.coords), []))
            exterior_indices.append(idx)

    for idx, poly in indexed:
        if depth[idx] % 2 == 1:
            # Assign to the innermost even-depth parent.
            best = None
            best_depth = -1
            for ex_idx, (shell_coords, _holes) in zip(exterior_indices, exteriors):
                if depth[ex_idx] > best_depth and Polygon(shell_coords).contains(poly):
                    best = ex_idx
                    best_depth = depth[ex_idx]
            if best is not None:
                exteriors[exterior_indices.index(best)][1].append(list(poly.exterior.coords))

    built = [Polygon(shell, holes=holes) for shell, holes in exteriors]
    if len(built) == 1:
        result = built[0]
    else:
        result = MultiPolygon(built)

    return _repair(result)


def _path_to_rings(path: SVGPath) -> list[list[tuple[float, float]]]:
    """Flatten an SVGPath into a list of rings (closed coordinate loops).

    Each 'M' command starts a new ring. svgelements' .as_points() samples any
    curved segments at an internal default error tolerance.
    """
    d = path.d() or ""
    segments = _split_on_moveto(d)
    rings: list[list[tuple[float, float]]] = []
    for seg_d in segments:
        try:
            seg_path = SVGPath(seg_d)
        except Exception:
            continue
        pts = [(float(p[0]), float(p[1])) for p in seg_path.as_points()]
        if len(pts) >= 3:
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            rings.append(pts)
    return rings


_MOVE_RE = re.compile(r"([Mm])")


def _split_on_moveto(d: str) -> list[str]:
    """Split a path d-string into subpaths, each starting with an M/m command."""
    if not d.strip():
        return []
    tokens = _MOVE_RE.split(d)
    # _MOVE_RE.split returns ['', 'M', 'body', 'M', 'body', ...]
    segments: list[str] = []
    i = 1
    while i < len(tokens):
        segments.append(tokens[i] + tokens[i + 1])
        i += 2
    return segments


def _repair(geom):
    """Run make_valid on the result. If it returns a GeometryCollection, extract polygons."""
    g = make_valid(geom)
    if g.geom_type == "Polygon" or g.geom_type == "MultiPolygon":
        return g
    # Filter to polygon parts only.
    polys = [sub for sub in getattr(g, "geoms", []) if sub.geom_type in ("Polygon", "MultiPolygon")]
    if not polys:
        return Polygon()
    if len(polys) == 1:
        return polys[0]
    return unary_union(polys)
