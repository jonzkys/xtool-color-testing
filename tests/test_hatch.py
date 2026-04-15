"""Tests for the hatch module: polygon construction and segment generation."""

import pytest
from shapely.geometry import MultiPolygon, Polygon

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
