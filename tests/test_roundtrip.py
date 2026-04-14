"""Validate generated XCS files have the same structure as the reference sample."""

import json
from pathlib import Path

from xcs_gen.builder import build_xcs
from xcs_gen.generators import generate_gradient
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


def test_reference_file_parses():
    """Sanity check that the reference file loads as valid JSON."""
    ref = _load_reference()
    assert ref["extName"] == "F2 Ultra"
    assert ref["canvas"][0]["displays"][0]["type"] == "RECT"


def test_single_axis_gradient():
    """Single axis gradient generates correct element count and params."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=1000,
        x_steps=10,
        total_width=100.0,
        total_height=50.0,
    )

    assert len(project.elements) == 10

    # First element should have speed=100, last speed=1000
    result = build_xcs(project)
    dev_entries = result["device"]["data"]["value"][0][1]["displays"]["value"]

    first_speed = dev_entries[0][1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["speed"]
    last_speed = dev_entries[9][1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["speed"]
    assert first_speed == 100
    assert last_speed == 1000

    # Element width should be 10mm (100mm / 10 steps, zero gap)
    display = result["canvas"][0]["displays"][0]
    assert abs(display["width"] - 10.0) < 0.01
    assert abs(display["height"] - 50.0) < 0.01


def test_dual_axis_gradient():
    """Dual axis gradient generates correct grid."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=500,
        x_steps=5,
        y_param="power",
        y_min=10,
        y_max=50,
        y_steps=4,
        total_width=50.0,
        total_height=40.0,
    )

    assert len(project.elements) == 20  # 5 * 4

    result = build_xcs(project)
    dev_entries = result["device"]["data"]["value"][0][1]["displays"]["value"]

    # First row, first element: speed=100, power=10
    e0 = dev_entries[0][1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]
    assert e0["speed"] == 100
    assert abs(e0["power"] - 10.0) < 0.01

    # Second row, last element: speed=500, power~23.3
    e9 = dev_entries[9][1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]
    assert e9["speed"] == 500
    assert abs(e9["power"] - 23.33) < 0.1


def test_shared_layer():
    """All gradient elements share one layer."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=1000,
        x_steps=50,
    )

    result = build_xcs(project)
    canvas = result["canvas"][0]

    # All gradient displays share a single layer color
    gradient_colors = {d["layerColor"] for d in canvas["displays"] if d["type"] == "RECT"}
    assert len(gradient_colors) == 1

    # Layer data should have 2 entries: gradient + annotation
    assert len(canvas["layerData"]) == 2


def test_annotations_present():
    """Gradient has tick marks and text labels."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=1000,
        x_steps=10,
    )

    result = build_xcs(project)
    canvas = result["canvas"][0]

    # Should have LINE (ticks) and TEXT (labels) displays beyond the 10 RECTs
    types = [d["type"] for d in canvas["displays"]]
    assert "LINE" in types
    assert "TEXT" in types

    line_count = types.count("LINE")
    text_count = types.count("TEXT")
    # 5 labels per row (start + 3 middle + end), 1 row = 5 ticks + 5 labels + 1 summary
    assert line_count == 5
    assert text_count == 6


def test_1000_elements():
    """Scaling test: 1000 elements in 100mm."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=5000,
        x_steps=1000,
        total_width=100.0,
        total_height=50.0,
        gap=0.0,
    )

    assert len(project.elements) == 1000

    result = build_xcs(project)

    # Element width should be 0.1mm
    display = result["canvas"][0]["displays"][0]
    assert abs(display["width"] - 0.1) < 0.001

    # Should have ~10 labels, not 1000
    types = [d["type"] for d in result["canvas"][0]["displays"]]
    text_count = types.count("TEXT")
    assert 5 <= text_count <= 12

    # Verify JSON is valid and serializable
    json_str = json.dumps(result, separators=(",", ":"))
    assert len(json_str) > 0


def test_speed_values_are_ints():
    """Speed values must be integers in the output."""
    project = generate_gradient(
        x_param="speed",
        x_min=100,
        x_max=3000,
        x_steps=7,
    )
    result = build_xcs(project)
    dev_entries = result["device"]["data"]["value"][0][1]["displays"]["value"]

    for entry_id, entry in dev_entries:
        if entry["type"] == "RECT":
            speed = entry["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["speed"]
            assert isinstance(speed, int), f"Speed {speed} is not int"
