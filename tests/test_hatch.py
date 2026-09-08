"""Tests for the hatch module: polygon construction and segment generation."""

import pytest
from shapely.geometry import MultiPolygon, Point, Polygon

from xcs_gen.hatch import svg_d_to_polygon


def test_svg_d_to_polygon_simple_square():
    poly = svg_d_to_polygon("M 0,0 L 10,0 L 10,10 L 0,10 Z", fill_rule="evenodd")
    assert isinstance(poly, Polygon)
    assert abs(poly.area - 100) < 1e-6


def test_svg_d_to_polygon_compound_with_hole_evenodd():
    # Outer 20x20 square, inner 5x5 hole centered at (10,10).
    d = (
        "M 0,0 L 20,0 L 20,20 L 0,20 Z "
        "M 7.5,7.5 L 12.5,7.5 L 12.5,12.5 L 7.5,12.5 Z"
    )
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert isinstance(poly, Polygon)
    # Area = 400 (outer) - 25 (inner) = 375.
    assert abs(poly.area - 375) < 1e-6
    assert len(poly.interiors) == 1


def test_svg_d_to_polygon_two_disjoint_shapes_is_multipolygon():
    # Two separate 10x10 squares.
    d = (
        "M 0,0 L 10,0 L 10,10 L 0,10 Z "
        "M 20,0 L 30,0 L 30,10 L 20,10 Z"
    )
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert isinstance(poly, MultiPolygon)
    assert abs(poly.area - 200) < 1e-6


def test_svg_d_to_polygon_self_intersecting_is_repaired():
    # A bowtie — self-intersecting quad.
    d = "M 0,0 L 10,10 L 10,0 L 0,10 Z"
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert poly.is_valid


from xcs_gen.model import Line, ProcessingParams
from xcs_gen.svg_source import HatchPass
from xcs_gen.hatch import generate_hatch_segments


def _square_polygon():
    return svg_d_to_polygon("M 0,0 L 10,0 L 10,10 L 0,10 Z", fill_rule="evenodd")


def test_hatch_segments_horizontal_square_count():
    poly = _square_polygon()
    hp = HatchPass(angle=0.0, spacing=1.0)
    base = ProcessingParams(power=50)
    segs = generate_hatch_segments(poly, hp, layer_color="#ff0000", fallback_params=base)
    # 10mm tall, spacing 1mm → lines at y=0.5, 1.5, ..., 9.5 → 10 segments.
    assert len(segs) == 10
    for s in segs:
        assert isinstance(s, Line)
        assert s.layer_color == "#ff0000"
        assert s.params is not None
        assert s.params.power == 50
        assert s.processing_type == "VECTOR_ENGRAVING"
        assert abs(s.length - 10.0) < 1e-6
        assert abs(s.angle - 0.0) < 1e-6


def test_hatch_segments_vertical_square():
    poly = _square_polygon()
    hp = HatchPass(angle=90.0, spacing=1.0)
    base = ProcessingParams()
    segs = generate_hatch_segments(poly, hp, layer_color="#00ff00", fallback_params=base)
    assert len(segs) == 10
    for s in segs:
        assert abs(s.length - 10.0) < 1e-6
        assert abs(s.angle - 90.0) < 1e-6


def test_hatch_segments_donut_produces_two_per_line():
    d = "M 0,0 L 20,0 L 20,20 L 0,20 Z M 7.5,7.5 L 12.5,7.5 L 12.5,12.5 L 7.5,12.5 Z"
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    hp = HatchPass(angle=0.0, spacing=1.0)
    segs = generate_hatch_segments(poly, hp, layer_color="#0000ff", fallback_params=ProcessingParams())
    # Lines crossing the hole (y in 7.5..12.5) split into 2 segments; lines
    # outside are single segments. Expect more segments than 20 (the line count).
    assert len(segs) > 20


def test_hatch_segments_empty_when_shape_too_small():
    poly = svg_d_to_polygon("M 0,0 L 0.1,0 L 0.1,0.1 L 0,0.1 Z", fill_rule="evenodd")
    hp = HatchPass(angle=0.0, spacing=1.0)
    segs = generate_hatch_segments(poly, hp, layer_color="#aaaaaa", fallback_params=ProcessingParams())
    assert segs == []


def test_hatch_segments_uses_pass_base_params_when_set():
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        base_params=ProcessingParams(power=99),
    )
    fallback = ProcessingParams(power=10)
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=fallback)
    assert all(s.params.power == 99 for s in segs)


from xcs_gen.svg_source import HatchRamp


def test_hatch_ramp_power_perp_axis():
    """Power ramps from 30 at bottom to 70 at top (axis=perp for angle=0)."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        ramps=[HatchRamp(param="power", axis="perp", min_value=30, max_value=70)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=ProcessingParams())
    assert len(segs) == 10
    powers = [s.params.power for s in segs]
    # Monotonically increasing from near-30 to near-70.
    assert abs(powers[0] - 32.0) < 0.5   # first midpoint at y=0.5 in a 10-tall bbox → ~32
    assert abs(powers[-1] - 68.0) < 0.5  # last midpoint at y=9.5 → ~68
    for i in range(1, len(powers)):
        assert powers[i] > powers[i - 1]


def test_hatch_ramp_power_y_axis_ignores_angle():
    """axis='y' projects the midpoint onto the bbox y, regardless of hatch angle."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=45.0, spacing=1.0,
        ramps=[HatchRamp(param="power", axis="y", min_value=10, max_value=90)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=ProcessingParams())
    assert len(segs) > 0
    # Segment midpoints with smaller world-space y get smaller power.
    sorted_segs = sorted(segs, key=lambda s: s.y + (math.sin(math.radians(s.angle)) * s.length / 2))
    powers_low_to_high = [s.params.power for s in sorted_segs]
    assert powers_low_to_high[0] < powers_low_to_high[-1]


def test_hatch_ramp_int_field_rounded():
    """Ramp on an int field (e.g. speed) produces rounded int values."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        ramps=[HatchRamp(param="speed", axis="perp", min_value=500, max_value=1500)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ff0000", fallback_params=ProcessingParams())
    for s in segs:
        assert isinstance(s.params.speed, int)


import math  # noqa: E402 — used in test_hatch_ramp_power_y_axis_ignores_angle


def test_hatch_spacing_ramp_produces_variable_spacing():
    """With spacing ramping 1.0 -> 0.2 along perp, more lines pack near the 'max' end."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,  # spacing field is a fallback when no spacing-ramp
        ramps=[HatchRamp(param="spacing", axis="perp", min_value=1.0, max_value=0.2)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=ProcessingParams())
    # Without a spacing ramp: 10 segments. With ramp: should be strictly more.
    assert len(segs) > 10
    # Verify line density is higher near y=10 (the 'max_value' end).
    ys = sorted(s.y for s in segs)
    mid = len(ys) // 2
    upper_half_count = sum(1 for y in ys if y > ys[mid])
    lower_half_count = sum(1 for y in ys if y <= ys[mid])
    # Lines closer together near the top → half-by-count both sides, but the
    # upper half (small spacing) spans less y distance.
    upper_y_span = ys[-1] - ys[mid]
    lower_y_span = ys[mid] - ys[0]
    assert upper_y_span < lower_y_span


def test_hatch_spacing_ramp_clamped_to_min():
    """A spacing ramp that would go to zero is clamped at min_spacing."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        ramps=[HatchRamp(param="spacing", axis="perp", min_value=1.0, max_value=0.001)],
    )
    segs = generate_hatch_segments(
        poly, hp, layer_color="#ffd73e",
        fallback_params=ProcessingParams(),
    )
    # With min_spacing default 0.01, the ramp clamps and we get finite segments.
    # Without clamping, this would hang in an infinite loop.
    assert len(segs) > 0
    assert len(segs) < 10000  # sanity upper bound


# ── inline curve evaluation (B2) ─────────────────────────────────────────────

def test_path_to_rings_matches_svgelements_point_exactly():
    """The inlined Bezier arithmetic must be bit-identical to ``seg.point(t)``.

    ``_path_to_rings`` evaluates cubics and quadratics inline rather than
    calling ``seg.point(t)``, which routes through ``npoint([t])`` and
    allocates a numpy array per sample. The expression order deliberately
    mirrors svgelements' own ``_compute_point`` so float association matches;
    if someone "simplifies" the algebra, this test catches the drift.
    """
    from svgelements import (
        Arc, Close, CubicBezier, Line, Move, Path as SVGPath, QuadraticBezier,
    )
    from xcs_gen.hatch import _CURVE_TS, _path_to_rings

    d = "M 0 0 C 10 20 30 -5 40 10 Q 50 30 60 0 L 70 5 Z"
    path = SVGPath(d)

    # Reference: the pre-optimisation implementation, verbatim.
    rings: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []

    def flush() -> None:
        if len(current) >= 3:
            if current[0] != current[-1]:
                current.append(current[0])
            rings.append(list(current))

    for seg in path.segments():
        if isinstance(seg, Move):
            flush()
            current.clear()
            if seg.end is not None:
                current.append((float(seg.end.x), float(seg.end.y)))
        elif isinstance(seg, Close):
            continue
        elif isinstance(seg, Line):
            if seg.end is not None:
                current.append((float(seg.end.x), float(seg.end.y)))
        elif isinstance(seg, (CubicBezier, QuadraticBezier, Arc)):
            for t in _CURVE_TS:
                pt = seg.point(t)
                current.append((float(pt.x), float(pt.y)))
    flush()

    assert _path_to_rings(path) == rings


def test_path_to_rings_handles_arcs_via_the_library_fallback():
    """Arcs are not inlined — they must still round-trip through seg.point."""
    from svgelements import Path as SVGPath
    from xcs_gen.hatch import _path_to_rings

    # A circle decomposes to Arc segments, which take the fallback branch.
    rings = _path_to_rings(SVGPath("M 10 5 A 5 5 0 1 0 10 4.99 Z"))
    assert rings, "arc path produced no rings"
    xs = [p[0] for p in rings[0]]
    ys = [p[1] for p in rings[0]]
    # Sampled points should trace out something round, not collapse to a line.
    assert max(xs) - min(xs) > 5
    assert max(ys) - min(ys) > 5


# ── even-odd nesting (B3) ────────────────────────────────────────────────────

def test_evenodd_nesting_three_levels_deep():
    """Ring-in-ring-in-ring: depth 2 is solid again, not a hole.

    The STRtree rewrite has to reduce by container RANK, and shapely evaluates
    ``input.predicate(tree_geom)`` — so finding a ring's containers means
    asking ``within``, not ``contains``. Getting that backwards inverts the
    nesting and this test is what notices.
    """
    from xcs_gen.hatch import svg_d_to_polygon

    d = (
        "M 0 0 L 100 0 L 100 100 L 0 100 Z "      # outer, depth 0
        "M 20 20 L 80 20 L 80 80 L 20 80 Z "      # hole, depth 1
        "M 40 40 L 60 40 L 60 60 L 40 60 Z"       # island inside hole, depth 2
    )
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert poly is not None and not poly.is_empty
    # 100x100 minus a 60x60 hole plus a 20x20 island back in.
    assert poly.area == pytest.approx(100 * 100 - 60 * 60 + 20 * 20, abs=1e-6)
    assert poly.contains(Point(50, 50))     # the island is solid
    assert not poly.contains(Point(30, 30))  # the hole is not
    assert poly.contains(Point(10, 10))     # the outer band is


def test_evenodd_two_disjoint_shapes_each_with_a_hole():
    """Two independent rings-with-holes must not adopt each other's holes."""
    from xcs_gen.hatch import svg_d_to_polygon

    d = (
        "M 0 0 L 40 0 L 40 40 L 0 40 Z "
        "M 10 10 L 30 10 L 30 30 L 10 30 Z "
        "M 100 0 L 140 0 L 140 40 L 100 40 Z "
        "M 110 10 L 130 10 L 130 30 L 110 30 Z"
    )
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert poly is not None
    assert poly.area == pytest.approx(2 * (40 * 40 - 20 * 20), abs=1e-6)
