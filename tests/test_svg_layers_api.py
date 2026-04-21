"""Tests for the SVG Layers converter and /api/svg-layers endpoint."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.schemas import (
    BaseParams,
    LayerSpec,
    SvgDetectRequest,
    SvgLayersRequest,
)
from xcs_gen_web.svg_layers_converter import (
    detect_svg_layers,
    svg_layers_to_xcs,
)


SAMPLES = Path(__file__).parent.parent / "samples"
PIKACHU_SVG = SAMPLES / "Pikachu.svg"


def _base() -> BaseParams:
    return BaseParams(
        power=14.6, speed=1000, frequency=125, density=5000,
        passes=1, pulse_width=200, laser="red",
    )


def _layer(color: str, **overrides) -> LayerSpec:
    defaults = dict(
        color=color, name=color, enabled=True,
        processing_type="COLOR_FILL_ENGRAVE",
        scan_angle=90.0, base_params=_base(),
        angle_mode="fixed",
    )
    defaults.update(overrides)
    return LayerSpec(**defaults)


def test_detect_layers_returns_all_svg_colors():
    req = SvgDetectRequest(svg_content=PIKACHU_SVG.read_text(), width_mm=50.0)
    layers = detect_svg_layers(req)
    colors = {l.color for l in layers}
    # Pikachu has these five fills
    assert "#000000" in colors
    assert "#ffd73e" in colors
    assert "#ee4e36" in colors
    # All layers have a positive shape_count and is_fill marked
    assert all(l.shape_count > 0 for l in layers)


def test_layers_request_emits_paths_per_layer():
    layers = [
        _layer("#ffd73e", scan_angle=0),
        _layer("#000000", scan_angle=45),
    ]
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers, material_id="mat-test",
    )
    project = svg_layers_to_xcs(req)
    yellow_paths = [p for p in project.paths if p.layer_color == "#ffd73e"]
    black_paths = [p for p in project.paths if p.layer_color == "#000000"]
    assert len(yellow_paths) > 0
    assert len(black_paths) > 0
    # Each layer's scan angle should be its own
    assert all(p.params.scan_angle == 0 for p in yellow_paths)
    assert all(p.params.scan_angle == 45 for p in black_paths)


def test_disabled_layer_is_skipped():
    layers = [
        _layer("#ffd73e", enabled=True),
        _layer("#000000", enabled=False),
    ]
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers, material_id="mat-test",
    )
    project = svg_layers_to_xcs(req)
    colors = {p.layer_color for p in project.paths}
    assert "#ffd73e" in colors
    assert "#000000" not in colors


def test_layer_crosshatch_sets_cross_angle_flag_and_halves_repeat():
    """angle_mode='crosshatch' maps to XCS-native cross_angle; passes is halved because XCS doubles each repeat."""
    yellow_base = _base().model_copy(update={"passes": 4})
    layers = [
        _layer("#ffd73e", angle_mode="crosshatch", base_params=yellow_base),
        _layer("#000000"),  # default angle_mode="fixed"
    ]
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers, material_id="mat-test",
    )
    project = svg_layers_to_xcs(req)

    yellow_paths = [p for p in project.paths if p.layer_color == "#ffd73e"]
    black_paths = [p for p in project.paths if p.layer_color == "#000000"]

    # No per-pass path duplication: yellow layer emits once per SVG shape,
    # and XCS stacks the passes natively.
    assert all(p.params.cross_angle for p in yellow_paths)
    # Crosshatch: user asked for 4 total burns → XCS repeat=2 (× 2 angles each).
    assert all(p.params.repeat == 2 for p in yellow_paths)
    # Fixed black layer: angle_type=1, no cross.
    assert all(p.params.angle_type == 1 for p in black_paths)
    assert all(not p.params.cross_angle for p in black_paths)


def test_no_enabled_layers_raises():
    layers = [_layer("#ffd73e", enabled=False)]
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers, material_id="mat-test",
    )
    with pytest.raises(ValueError, match="No enabled"):
        svg_layers_to_xcs(req)


def test_unmatched_colors_produce_error():
    """If the layers list doesn't cover any of the SVG's colors, raise."""
    layers = [_layer("#ff00ff")]  # not in Pikachu
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers, material_id="mat-test",
    )
    with pytest.raises(ValueError, match="No SVG shapes matched"):
        svg_layers_to_xcs(req)


def test_api_detect_endpoint():
    client = TestClient(create_app())
    resp = client.post("/api/svg-detect-layers", json={
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
    })
    assert resp.status_code == 200
    layers = resp.json()
    assert len(layers) >= 3
    assert all("color" in l and "shape_count" in l and "is_fill" in l for l in layers)


def test_api_preview_returns_svg_string():
    """Preview endpoint returns an SVG string; filters + subtraction applied."""
    client = TestClient(create_app())

    # No filtering, no subtraction - should return all shapes
    resp = client.post("/api/svg-preview", json={
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
        "enabled_colors": None,
        "subtract_overlaps": False,
    })
    assert resp.status_code == 200
    svg_all = resp.json()["svg"]
    assert svg_all.startswith("<svg")
    assert "<path" in svg_all
    path_count_full = svg_all.count("<path")

    # Filter to one color - should have fewer paths
    resp2 = client.post("/api/svg-preview", json={
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
        "enabled_colors": ["#ffd73e"],
        "subtract_overlaps": False,
    })
    assert resp2.status_code == 200
    svg_filtered = resp2.json()["svg"]
    assert svg_filtered.count("<path") < path_count_full
    # Only the yellow fill should be present
    assert "#ffd73e" in svg_filtered
    assert "#000000" not in svg_filtered


def test_api_preview_subtract_changes_paths():
    """With subtract_overlaps, bottom layers get holes - the yellow body path changes."""
    client = TestClient(create_app())
    original = client.post("/api/svg-preview", json={
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
        "subtract_overlaps": False,
    }).json()["svg"]
    subtracted = client.post("/api/svg-preview", json={
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
        "subtract_overlaps": True,
    }).json()["svg"]
    # Subtracted path data should differ from the original
    assert original != subtracted


def test_api_layers_endpoint():
    client = TestClient(create_app())
    payload = {
        "name": "pika",
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50,
        "material_id": "mat-test",
        "layers": [
            {
                "color": "#ffd73e", "name": "Yellow body", "enabled": True,
                "processing_type": "COLOR_FILL_ENGRAVE", "scan_angle": 0,
                "base_params": _base().model_dump(),
                "angle_mode": "fixed",
            },
            {
                "color": "#000000", "name": "Outlines", "enabled": True,
                "processing_type": "VECTOR_ENGRAVING", "scan_angle": 0,
                "base_params": _base().model_dump(),
                "angle_mode": "fixed",
            },
        ],
        "subtract_overlaps": False,
    }
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 200
    assert "pika.xcs" in resp.headers["content-disposition"]
    data = json.loads(resp.content)
    assert "canvas" in data


def test_layerspec_accepts_hatched_lines_with_passes():
    from xcs_gen_web.schemas import HatchPass, HatchRamp, LayerSpec
    from xcs_gen_web.schemas import BaseParams
    spec = LayerSpec(
        color="#ffd73e",
        name="yellow",
        processing_type="HATCHED_LINES",
        base_params=BaseParams(power=50, speed=1000, frequency=65,
                               density=100, passes=1, pulse_width=200, laser="red"),
        hatch_passes=[
            HatchPass(angle=0, spacing=0.5,
                      ramps=[HatchRamp(param="power", axis="perp", min=30, max=70)]),
        ],
    )
    assert spec.processing_type == "HATCHED_LINES"
    assert len(spec.hatch_passes) == 1
    assert spec.hatch_passes[0].ramps[0].param == "power"


def test_layerspec_rejects_hatched_with_empty_passes():
    import pytest
    from pydantic import ValidationError
    from xcs_gen_web.schemas import BaseParams, LayerSpec
    with pytest.raises(ValidationError) as exc:
        LayerSpec(
            color="#ffd73e",
            name="yellow",
            processing_type="HATCHED_LINES",
            base_params=BaseParams(power=50, speed=1000, frequency=65,
                                   density=100, passes=1, pulse_width=200, laser="red"),
            hatch_passes=[],
        )
    assert "HATCHED_LINES" in str(exc.value)


def test_layerspec_non_hatched_with_passes_is_allowed():
    """Non-hatched layers with hatch_passes don't fail (the converter ignores them)."""
    from xcs_gen_web.schemas import BaseParams, HatchPass, LayerSpec
    spec = LayerSpec(
        color="#000000",
        name="black",
        processing_type="VECTOR_CUTTING",
        base_params=BaseParams(power=80, speed=500, frequency=65,
                               density=100, passes=1, pulse_width=200, laser="red"),
        hatch_passes=[HatchPass(angle=0, spacing=0.5)],
    )
    assert spec.processing_type == "VECTOR_CUTTING"
    # hatch_passes survive on the model but won't be used by the converter.
    assert len(spec.hatch_passes) == 1


TWO_COLOR_SVG = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect x="0" y="0" width="50" height="50" fill="#000000"/>
  <rect x="50" y="50" width="50" height="50" fill="#ffd73e"/>
</svg>
"""


def test_layers_request_emits_rects_for_hatched_layer():
    from xcs_gen_web.schemas import (
        BaseParams, HatchPass, HatchRamp, LayerSpec, SvgLayersRequest,
    )
    from xcs_gen_web.svg_layers_converter import build_svg_layers_project
    bp = BaseParams(power=50, speed=1000, frequency=65, density=100,
                    passes=1, pulse_width=200, laser="red")
    req = SvgLayersRequest(
        name="t",
        svg_content=TWO_COLOR_SVG,
        width_mm=50,
        material_id="mat-test",
        layers=[
            LayerSpec(color="#000000", name="black", processing_type="VECTOR_ENGRAVING",
                      base_params=bp),
            LayerSpec(
                color="#ffd73e", name="yellow", processing_type="HATCHED_LINES",
                base_params=bp,
                hatch_passes=[HatchPass(
                    angle=0, spacing=1.0,
                    ramps=[HatchRamp(param="power", axis="perp", min=30, max=70)],
                )],
            ),
        ],
    )
    project = build_svg_layers_project(req)
    # Black layer → one Path. Yellow layer → many rotated RECT displays.
    assert len(project.paths) >= 1
    rect_displays = [d for d in project.extra_displays if d.get("type") == "RECT"]
    assert len(rect_displays) > 0
    # Each RECT has a matching device entry by id.
    rect_ids = {d["id"] for d in rect_displays}
    entry_ids = {eid for eid, _ in project.extra_device_entries}
    assert rect_ids.issubset(entry_ids)


def test_layers_hatched_max_segments_cap():
    """Hatched output exceeding max_segments raises with a clear message."""
    import pytest
    from xcs_gen_web.schemas import BaseParams, HatchPass, LayerSpec, SvgLayersRequest
    from xcs_gen_web.svg_layers_converter import build_svg_layers_project
    bp = BaseParams(power=50, speed=1000, frequency=65, density=100,
                    passes=1, pulse_width=200, laser="red")
    req = SvgLayersRequest(
        name="t", svg_content=TWO_COLOR_SVG, width_mm=50,
        material_id="mat-test",
        layers=[
            LayerSpec(
                color="#ffd73e", name="yellow", processing_type="HATCHED_LINES",
                base_params=bp,
                hatch_passes=[HatchPass(angle=0, spacing=0.05)],  # very dense
            ),
            LayerSpec(color="#000000", name="black",
                      processing_type="VECTOR_ENGRAVING", base_params=bp),
        ],
    )
    with pytest.raises(ValueError, match="max_segments"):
        build_svg_layers_project(req, max_segments=20)


def test_api_layers_endpoint_with_hatched_layer():
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    client = TestClient(create_app())
    payload = {
        "name": "hatched-test",
        "svg_content": TWO_COLOR_SVG,
        "width_mm": 50,
        "material_id": "mat-test",
        "layers": [
            {"color": "#000000", "name": "black",
             "processing_type": "VECTOR_ENGRAVING",
             "base_params": {"power": 80, "speed": 500, "frequency": 65,
                              "density": 100, "passes": 1, "pulse_width": 200,
                              "laser": "red"}},
            {"color": "#ffd73e", "name": "yellow",
             "processing_type": "HATCHED_LINES",
             "base_params": {"power": 50, "speed": 1000, "frequency": 65,
                              "density": 100, "passes": 1, "pulse_width": 200,
                              "laser": "red"},
             "hatch_passes": [
                 {"angle": 0, "spacing": 1.0,
                  "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}]},
             ]},
        ],
    }
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert len(resp.content) > 1000  # non-trivial XCS body


def test_api_layers_endpoint_rejects_hatched_with_empty_passes():
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    client = TestClient(create_app())
    payload = {
        "name": "bad", "svg_content": TWO_COLOR_SVG, "width_mm": 50,
        "material_id": "mat-test",
        "layers": [
            {"color": "#ffd73e", "name": "yellow",
             "processing_type": "HATCHED_LINES",
             "base_params": {"power": 50, "speed": 1000, "frequency": 65,
                              "density": 100, "passes": 1, "pulse_width": 200,
                              "laser": "red"},
             "hatch_passes": []},
        ],
    }
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 422  # Pydantic validation error
    assert "HATCHED_LINES" in resp.text


def test_detected_layer_is_near_white_defaults_false():
    from xcs_gen_web.schemas import DetectedLayer
    layer = DetectedLayer(color="#ff0000", shape_count=3, is_fill=True)
    assert layer.is_near_white is False


def test_detected_layer_is_near_white_round_trips_true():
    from xcs_gen_web.schemas import DetectedLayer
    layer = DetectedLayer.model_validate({
        "color": "#ffffff",
        "shape_count": 1,
        "is_fill": True,
        "is_near_white": True,
    })
    assert layer.is_near_white is True
