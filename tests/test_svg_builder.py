"""Tests for the SVG-related builder additions."""

from xcs_gen.builder import _build_path_display, _build_circle_display, build_xcs
from xcs_gen.model import Circle, Path, ProcessingParams, XCSProject


def test_build_path_display_core_fields():
    p = Path(
        d="M 0,0 L 10,10 Z",
        x=5.0, y=7.5, width=10.0, height=10.0,
        is_close_path=True,
        is_compound_path=False,
        fill_rule="evenodd",
        layer_color="#ff0000",
    )
    disp = _build_path_display(p)
    assert disp["type"] == "PATH"
    assert disp["dPath"] == "M 0,0 L 10,10 Z"
    assert disp["x"] == 5.0
    assert disp["y"] == 7.5
    assert disp["width"] == 10.0
    assert disp["height"] == 10.0
    assert disp["isClosePath"] is True
    assert disp["isCompoundPath"] is False
    assert disp["fillRule"] == "evenodd"
    assert disp["layerColor"] == "#ff0000"
    assert disp["layerTag"] == "#ff0000"
    assert disp["offsetX"] == 5.0
    assert disp["offsetY"] == 7.5
    assert disp["points"] == []
    # graphicX/Y exist — exact semantics filled in via Task 2's empirical finding.
    assert "graphicX" in disp
    assert "graphicY" in disp


def test_build_circle_display_core_fields():
    c = Circle(x=5.0, y=5.0, width=20.0, height=20.0, layer_color="#00ff00")
    disp = _build_circle_display(c)
    assert disp["type"] == "CIRCLE"
    assert disp["x"] == 5.0
    assert disp["y"] == 5.0
    assert disp["width"] == 20.0
    assert disp["height"] == 20.0
    assert disp["layerColor"] == "#00ff00"


def test_build_xcs_includes_paths_and_circles():
    proj = XCSProject()
    proj.paths.append(Path(
        d="M 0,0 L 10,10 Z", x=0, y=0, width=10, height=10,
        is_close_path=True, layer_color="#ff0000",
    ))
    proj.circles.append(Circle(
        x=20, y=20, width=15, height=15, layer_color="#00ff00",
    ))

    out = build_xcs(proj)
    displays = out["canvas"][0]["displays"]
    types = [d["type"] for d in displays]
    assert "PATH" in types
    assert "CIRCLE" in types

    # Both layers registered
    layer_data = out["canvas"][0]["layerData"]
    assert "#ff0000" in layer_data
    assert "#00ff00" in layer_data

    # Processing entries for both shapes
    dev_entries = out["device"]["data"]["value"][0][1]["displays"]["value"]
    entry_types = [entry[1]["type"] for entry in dev_entries]
    assert "PATH" in entry_types
    assert "CIRCLE" in entry_types


def test_build_xcs_paths_with_separate_params():
    """Two paths with same layer color but different params both survive."""
    proj = XCSProject()
    proj.paths.append(Path(
        d="M 0,0 L 10,0 L 10,10 L 0,10 Z", x=0, y=0, width=10, height=10,
        is_close_path=True, layer_color="#000000",
        params=ProcessingParams(power=20),
    ))
    proj.paths.append(Path(
        d="M 0,0 L 5,5 Z", x=0, y=0, width=5, height=5,
        is_close_path=True, layer_color="#000000",
        params=ProcessingParams(power=80),
    ))

    out = build_xcs(proj)
    dev_entries = out["device"]["data"]["value"][0][1]["displays"]["value"]
    powers = [
        entry[1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["power"]
        for entry in dev_entries if entry[1]["type"] == "PATH"
    ]
    assert 20 in powers
    assert 80 in powers
