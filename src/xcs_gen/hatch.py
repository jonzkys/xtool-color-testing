"""Polygon construction and hatch-segment generation for the hatched render mode.

Depends on shapely for polygon ops. Consumes the same SVG path d-strings (in
bed-mm) that the v1 parser emits.
"""

from __future__ import annotations

from typing import Literal

from shapely import make_valid
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon
from shapely.ops import unary_union
from svgelements import Path as SVGPath


FillRule = Literal["evenodd", "nonzero"]

MIN_SPACING_DEFAULT = 0.01  # mm; minimum hatch line spacing (overridable by CLI in Task 11)


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

    Walks svgelements' segment structure so absolute/relative commands resolve
    correctly. Each Move segment starts a new ring. Curved segments (CubicBezier,
    QuadraticBezier, Arc) are sampled at a fixed tolerance.
    """
    from svgelements import Arc, Close, CubicBezier, Line, Move, QuadraticBezier

    rings: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []

    def _flush() -> None:
        if len(current) >= 3:
            if current[0] != current[-1]:
                current.append(current[0])
            rings.append(list(current))

    for seg in path.segments():
        if isinstance(seg, Move):
            _flush()
            current.clear()
            if seg.end is not None:
                current.append((float(seg.end.x), float(seg.end.y)))
        elif isinstance(seg, Close):
            # Implicit close: pop a copy of the start point on flush.
            continue
        elif isinstance(seg, Line):
            if seg.end is not None:
                current.append((float(seg.end.x), float(seg.end.y)))
        elif isinstance(seg, (CubicBezier, QuadraticBezier, Arc)):
            # Sample the curve at multiple points for fidelity.
            for t in (0.25, 0.5, 0.75, 1.0):
                pt = seg.point(t)
                current.append((float(pt.x), float(pt.y)))
        else:
            # Unknown segment type: at least record its endpoint if available.
            end = getattr(seg, "end", None)
            if end is not None:
                current.append((float(end.x), float(end.y)))

    _flush()
    return rings


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


# ---------------------------------------------------------------------------
# Hatch segment generation
# ---------------------------------------------------------------------------

import math
from dataclasses import replace

from .model import Line, ProcessingParams


def generate_hatch_segments(
    polygon: Polygon | MultiPolygon,
    hatch_pass,  # HatchPass
    *,
    layer_color: str,
    fallback_params: ProcessingParams,
    min_spacing: float | None = None,
) -> list[Line]:
    """Produce clipped Line segments for one pass through one polygon.

    Each segment is one Line instance, carrying the per-segment params and
    processing_type='VECTOR_ENGRAVING'. The caller appends these to
    XCSProject.extra_displays and extra_device_entries.
    """
    if polygon.is_empty:
        return []

    base = hatch_pass.base_params or fallback_params
    angle = hatch_pass.angle
    spacing = hatch_pass.spacing
    if spacing <= 0:
        return []

    # Rotate polygon so the hatch lines become horizontal.
    rotated = _rotate_polygon(polygon, -angle)
    if rotated.is_empty:
        return []
    minx, miny, maxx, maxy = rotated.bounds
    if maxx - minx < spacing or maxy - miny < spacing:
        # Shape smaller than one hatch spacing in either direction → no lines.
        return []

    # Precompute world-space bbox for ramps that use x/y axes.
    world_minx, world_miny, world_maxx, world_maxy = polygon.bounds
    # For perp/parallel, we work in the rotated frame (perp = y in rotated coords).

    spacing_ramp = next(
        (r for r in hatch_pass.ramps if r.param == "spacing"), None
    )

    y = miny
    lines: list[Line] = []
    if min_spacing is None:
        min_spacing = MIN_SPACING_DEFAULT
    while y < maxy:
        step = spacing
        if spacing_ramp is not None:
            # Compute spacing at the current y in the rotated frame.
            pos = _ramp_position(
                ramp=spacing_ramp,
                mid_rot=(minx + (maxx - minx) / 2, y),
                mid_world=(0, 0),  # unused for perp/parallel axes
                rot_bounds=(minx, miny, maxx, maxy),
                world_bounds=(world_minx, world_miny, world_maxx, world_maxy),
            )
            step = _ramp_value_at(spacing_ramp, pos)
            if step < min_spacing:
                step = min_spacing
        # Center the line within its step band so placement is symmetric.
        y_center = y + step / 2
        if y_center >= maxy:
            break

        scan = LineString([(minx - 1.0, y_center), (maxx + 1.0, y_center)])
        clipped = rotated.intersection(scan)
        for seg in _iter_linestrings(clipped):
            mid_rot = seg.interpolate(0.5, normalized=True)
            mid_rot_xy = (mid_rot.x, mid_rot.y)
            rad = math.radians(angle)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            mid_world = (
                cos_a * mid_rot_xy[0] - sin_a * mid_rot_xy[1],
                sin_a * mid_rot_xy[0] + cos_a * mid_rot_xy[1],
            )

            params = _copy_params(base)
            for ramp in hatch_pass.ramps:
                if ramp.param == "spacing":
                    continue
                pos = _ramp_position(
                    ramp=ramp,
                    mid_rot=mid_rot_xy, mid_world=mid_world,
                    rot_bounds=(minx, miny, maxx, maxy),
                    world_bounds=(world_minx, world_miny, world_maxx, world_maxy),
                )
                value = _ramp_value_at(ramp, pos)
                _set_param_on(params, ramp.param, value)

            line = _segment_to_line(
                seg, angle=angle, layer_color=layer_color, params=params,
            )
            if line is not None:
                lines.append(line)
        y += step

    return lines


def _rotate_polygon(polygon: Polygon | MultiPolygon, angle_deg: float):
    from shapely.affinity import rotate
    return rotate(polygon, angle_deg, origin=(0, 0), use_radians=False)


def _iter_linestrings(geom):
    """Yield LineString parts from whatever shapely.intersection returned."""
    if geom.is_empty:
        return
    if isinstance(geom, LineString):
        yield geom
        return
    if isinstance(geom, MultiLineString):
        yield from geom.geoms
        return
    # GeometryCollection: extract LineString parts only.
    for sub in getattr(geom, "geoms", []):
        if isinstance(sub, LineString):
            yield sub


def _segment_to_line(
    seg: LineString,
    *,
    angle: float,
    layer_color: str,
    params: ProcessingParams,
) -> Line | None:
    coords = list(seg.coords)
    if len(coords) < 2:
        return None
    # Segment is in the rotated frame (horizontal). Length is the x-extent.
    x0_rot, y_rot = coords[0]
    x1_rot, _ = coords[-1]
    length = abs(x1_rot - x0_rot)
    if length <= 0:
        return None

    # Rotate the start point back to original bed-mm frame.
    rad = math.radians(angle)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    start_x = cos_a * x0_rot - sin_a * y_rot
    start_y = sin_a * x0_rot + cos_a * y_rot

    return Line(
        x=start_x, y=start_y, length=length, angle=angle,
        layer_color=layer_color,
        params=params,
        processing_type="VECTOR_ENGRAVING",
    )


def _copy_params(p: ProcessingParams) -> ProcessingParams:
    return replace(p)


def _ramp_position(
    *,
    ramp,  # HatchRamp
    mid_rot: tuple[float, float],
    mid_world: tuple[float, float],
    rot_bounds: tuple[float, float, float, float],
    world_bounds: tuple[float, float, float, float],
) -> float:
    """Return a 0..1 position for the midpoint along the ramp's axis."""
    if ramp.axis == "perp":
        # Perpendicular to hatch direction == y in rotated frame.
        lo, hi = rot_bounds[1], rot_bounds[3]
        v = mid_rot[1]
    elif ramp.axis == "parallel":
        lo, hi = rot_bounds[0], rot_bounds[2]
        v = mid_rot[0]
    elif ramp.axis == "x":
        lo, hi = world_bounds[0], world_bounds[2]
        v = mid_world[0]
    elif ramp.axis == "y":
        lo, hi = world_bounds[1], world_bounds[3]
        v = mid_world[1]
    else:
        return 0.0
    span = hi - lo
    if span <= 0:
        return 0.0
    t = (v - lo) / span
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return t


def _ramp_value_at(ramp, pos: float) -> float:
    """Evaluate a ramp at normalised position ``pos`` ∈ [0, 1].

    Prefers ``ramp.stops`` when non-empty (piecewise-linear between
    adjacent stops; clamps at the ends), otherwise falls back to the
    two-point ``min_value`` / ``max_value`` linear form.
    """
    stops = getattr(ramp, "stops", None) or []
    if len(stops) >= 2:
        # Stops are sorted by position on construction; if not, sort
        # here defensively — cheap vs. the hatch inner loop.
        if any(stops[i].position > stops[i + 1].position for i in range(len(stops) - 1)):
            stops = sorted(stops, key=lambda s: s.position)
        if pos <= stops[0].position:
            return stops[0].value
        if pos >= stops[-1].position:
            return stops[-1].value
        # Find the bracketing pair.
        for i in range(len(stops) - 1):
            a, b = stops[i], stops[i + 1]
            if a.position <= pos <= b.position:
                span = b.position - a.position
                if span <= 0:
                    return a.value
                t = (pos - a.position) / span
                return a.value + t * (b.value - a.value)
        return stops[-1].value
    # Legacy two-point linear form.
    return ramp.min_value + pos * (ramp.max_value - ramp.min_value)


_INT_PARAM_FIELDS = {"speed", "density", "passes", "pulse_width"}


def _set_param_on(params: ProcessingParams, name: str, value: float) -> None:
    """Write a ramped value into a ProcessingParams field. 'passes' maps to 'repeat'."""
    attr = "repeat" if name == "passes" else name
    if name == "frequency":
        attr = "mopa_frequency"
    is_int = name in _INT_PARAM_FIELDS
    setattr(params, attr, int(round(value)) if is_int else value)
