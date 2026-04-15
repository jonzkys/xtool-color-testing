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


def test_line_defaults_unchanged():
    from xcs_gen.model import Line
    line = Line(x=0, y=0, length=10)
    # Existing defaults still work — no params, no processing_type fuss.
    assert line.params is None
    assert line.processing_type == "VECTOR_ENGRAVING"
    assert line.angle == 0.0


def test_line_accepts_params_and_processing_type():
    from xcs_gen.model import Line, ProcessingParams
    p = ProcessingParams(power=42, speed=500)
    line = Line(x=0, y=0, length=10, params=p, processing_type="VECTOR_CUTTING")
    assert line.params.power == 42
    assert line.processing_type == "VECTOR_CUTTING"
