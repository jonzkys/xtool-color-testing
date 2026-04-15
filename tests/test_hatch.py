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
