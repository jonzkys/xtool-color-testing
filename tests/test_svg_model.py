"""Tests for the SVG-related data model additions."""

from xcs_gen.model import Circle, Path, ProcessingParams, XCSProject


def test_path_defaults():
    p = Path(d="M 0,0 L 10,10 Z", x=0, y=0, width=10, height=10, is_close_path=True)
    assert p.is_compound_path is False
    assert p.fill_rule == "evenodd"
    assert p.processing_type == "COLOR_FILL_ENGRAVE"
    assert p.is_fill is True
    assert p.layer_color == ""
    assert isinstance(p.params, ProcessingParams)
    assert p.id  # uuid populated


def test_circle_defaults():
    c = Circle(x=5, y=5, width=20, height=20)
    assert c.processing_type == "VECTOR_ENGRAVING"
    assert c.is_fill is True
    assert c.layer_color == ""
    assert isinstance(c.params, ProcessingParams)
    assert c.id


def test_xcsproject_has_paths_and_circles_lists():
    proj = XCSProject()
    assert proj.paths == []
    assert proj.circles == []
