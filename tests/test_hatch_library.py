"""Sanity checks on shapely APIs we'll use in hatch.py, pinned before building on them."""

from shapely.geometry import LineString, Polygon, MultiLineString
from shapely import make_valid


def test_polygon_line_intersection_simple():
    """A single horizontal line crossing a square returns one LineString segment."""
    square = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    line = LineString([(-1, 5), (11, 5)])
    result = square.intersection(line)
    assert isinstance(result, LineString)
    coords = list(result.coords)
    assert coords[0] == (0.0, 5.0)
    assert coords[-1] == (10.0, 5.0)


def test_polygon_line_intersection_with_hole():
    """A line crossing a donut (polygon with a hole) returns a MultiLineString of 2 segments."""
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    inner = [(3, 3), (3, 7), (7, 7), (7, 3)]
    donut = Polygon(outer, holes=[inner])
    line = LineString([(-1, 5), (11, 5)])
    result = donut.intersection(line)
    assert isinstance(result, MultiLineString)
    segments = list(result.geoms)
    assert len(segments) == 2
    lengths = sorted(s.length for s in segments)
    assert abs(lengths[0] - 3.0) < 1e-6
    assert abs(lengths[1] - 3.0) < 1e-6


def test_make_valid_repairs_self_intersecting():
    """shapely.make_valid repairs a self-intersecting polygon into a valid geometry."""
    bowtie = Polygon([(0, 0), (10, 10), (10, 0), (0, 10)])  # self-intersecting
    fixed = make_valid(bowtie)
    assert fixed.is_valid


def test_yaml_roundtrip():
    """pyyaml loads a nested dict round-trip."""
    import yaml
    data = {"layers": {"#ff0000": {"render_mode": "hatched", "hatch_passes": [{"angle": 0, "spacing": 0.4}]}}}
    s = yaml.safe_dump(data)
    loaded = yaml.safe_load(s)
    assert loaded == data
