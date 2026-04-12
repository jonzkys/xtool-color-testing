"""Validate generated XCS files have the same structure as the reference sample."""

import json
from pathlib import Path

from xcs_gen.builder import build_xcs
from xcs_gen.model import ProcessingParams, Rect, XCSProject

SAMPLES_DIR = Path(__file__).parent.parent / "samples"
REFERENCE = SAMPLES_DIR / "Square1-28power-3636speed-22pass-1234lines-69power-200.xcs"


def _load_reference() -> dict:
    with open(REFERENCE) as f:
        return json.load(f)


def test_single_element_structure():
    """Generated single-element XCS has all required top-level keys."""
    project = XCSProject()
    project.elements.append(
        Rect(
            x=103.08,
            y=103.44,
            width=13.84,
            height=13.11,
            params=ProcessingParams(
                speed=3636,
                power=28.8,
                repeat=22,
                density=1234,
                mopa_frequency=69,
                pulse_width=200,
            ),
        )
    )
    result = build_xcs(project)
    ref = _load_reference()

    # Check all top-level keys present
    for key in ref:
        assert key in result, f"Missing top-level key: {key}"

    # Canvas structure
    assert len(result["canvas"]) == 1
    canvas = result["canvas"][0]
    assert "layerData" in canvas
    assert "displays" in canvas
    assert len(canvas["displays"]) == 1

    # Display has correct geometry
    display = canvas["displays"][0]
    assert display["type"] == "RECT"
    assert abs(display["x"] - 103.08) < 0.01
    assert abs(display["width"] - 13.84) < 0.01

    # Device data is a Map with processing entries
    device_data = result["device"]["data"]
    assert device_data["dataType"] == "Map"
    canvas_entry = device_data["value"][0][1]
    displays_map = canvas_entry["displays"]
    assert displays_map["dataType"] == "Map"
    display_entry = displays_map["value"][0][1]

    # Processing params match
    color_fill = display_entry["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]
    assert color_fill["speed"] == 3636
    assert color_fill["power"] == 28.8
    assert color_fill["repeat"] == 22
    assert color_fill["density"] == 1234
    assert color_fill["mopaFrequency"] == 69
    assert color_fill["pulseWidth"] == 200


def test_multi_element_unique_layers():
    """Each element gets a unique layer color."""
    project = XCSProject()
    for i in range(5):
        project.elements.append(
            Rect(x=10 + i * 5, y=10, width=3, height=3)
        )
    result = build_xcs(project)
    canvas = result["canvas"][0]

    colors = [d["layerColor"] for d in canvas["displays"]]
    assert len(set(colors)) == 5, "Each element should have a unique layer color"
    assert len(canvas["layerData"]) == 5


def test_reference_file_parses():
    """Sanity check that the reference file loads as valid JSON."""
    ref = _load_reference()
    assert ref["extName"] == "F2 Ultra"
    assert ref["canvas"][0]["displays"][0]["type"] == "RECT"
