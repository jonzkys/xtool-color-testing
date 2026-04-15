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
        crosshatch_enabled=False, crosshatch_passes=2, crosshatch_step_deg=90.0,
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
        width_mm=50, layers=layers,
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
        width_mm=50, layers=layers,
    )
    project = svg_layers_to_xcs(req)
    colors = {p.layer_color for p in project.paths}
    assert "#ffd73e" in colors
    assert "#000000" not in colors


def test_layer_crosshatch_stacks_per_layer():
    layers = [
        _layer("#ffd73e", crosshatch_enabled=True, crosshatch_passes=3, crosshatch_step_deg=60),
        _layer("#000000"),  # no crosshatch
    ]
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers,
    )
    project = svg_layers_to_xcs(req)

    yellow_paths = [p for p in project.paths if p.layer_color == "#ffd73e"]
    black_paths = [p for p in project.paths if p.layer_color == "#000000"]

    # Yellow has 3 passes -> 3 distinct scan angles (90, 150, 210)
    yellow_angles = sorted({p.params.scan_angle for p in yellow_paths})
    assert yellow_angles == [90, 150, 210]

    # Black has no crosshatch -> single scan angle
    assert len({p.params.scan_angle for p in black_paths}) == 1


def test_no_enabled_layers_raises():
    layers = [_layer("#ffd73e", enabled=False)]
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers,
    )
    with pytest.raises(ValueError, match="No enabled"):
        svg_layers_to_xcs(req)


def test_unmatched_colors_produce_error():
    """If the layers list doesn't cover any of the SVG's colors, raise."""
    layers = [_layer("#ff00ff")]  # not in Pikachu
    req = SvgLayersRequest(
        name="t", svg_content=PIKACHU_SVG.read_text(),
        width_mm=50, layers=layers,
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
        "layers": [
            {
                "color": "#ffd73e", "name": "Yellow body", "enabled": True,
                "processing_type": "COLOR_FILL_ENGRAVE", "scan_angle": 0,
                "base_params": _base().model_dump(),
                "crosshatch_enabled": False, "crosshatch_passes": 2, "crosshatch_step_deg": 90,
            },
            {
                "color": "#000000", "name": "Outlines", "enabled": True,
                "processing_type": "VECTOR_ENGRAVING", "scan_angle": 0,
                "base_params": _base().model_dump(),
                "crosshatch_enabled": False, "crosshatch_passes": 2, "crosshatch_step_deg": 90,
            },
        ],
        "subtract_overlaps": False,
    }
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 200
    assert "pika.xcs" in resp.headers["content-disposition"]
    data = json.loads(resp.content)
    assert "canvas" in data
