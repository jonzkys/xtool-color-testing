"""Tests for the SVG Layers converter and /api/svg-layers endpoint."""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.schemas import (
    BaseParams,
    LayerSpec,
    SvgLayersRequest,
)
from xcs_gen_web.svg_layers_converter import (
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


def test_layer_crosshatch_sets_cross_angle_flag_and_preserves_passes():
    """``crosshatch=True`` maps to XCS-native ``cross_angle``; ``repeat``
    equals the user's passes count (1:1, NOT halved). xTool Studio runs
    ``repeat`` literally and ``cross_angle`` adds a 90°-rotated companion
    stroke per pass — so passes=4 + crosshatch fires 8 strokes (4 at
    scan_angle, 4 at scan_angle+90°)."""
    yellow_base = _base().model_copy(update={"passes": 4})
    layers = [
        _layer("#ffd73e", crosshatch=True, base_params=yellow_base),
        _layer("#000000"),  # default angle_mode="fixed", crosshatch=False
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
    # 4 passes → 4 strokes, alternating 0° and 90° via cross_angle.
    assert all(p.params.repeat == 4 for p in yellow_paths)
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
    # Default output is now the .xs ZIP bundle.
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 200
    assert "pika.xs" in resp.headers["content-disposition"]
    assert resp.headers["content-type"].startswith("application/zip")
    assert resp.content.startswith(b"PK")

    # .xcs flat JSON is still selectable via the format field.
    resp_xcs = client.post("/api/svg-layers", json={**payload, "format": "xcs"})
    assert resp_xcs.status_code == 200
    assert "pika.xcs" in resp_xcs.headers["content-disposition"]
    data = json.loads(resp_xcs.content)
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
    # Default .xs bundle for a hatched layer.
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/zip")
    assert resp.content.startswith(b"PK")
    assert len(resp.content) > 1000  # non-trivial bundle

    # .xcs flat JSON still selectable.
    resp_xcs = client.post("/api/svg-layers", json={**payload, "format": "xcs"})
    assert resp_xcs.status_code == 200
    assert resp_xcs.headers["content-type"].startswith("application/json")
    assert len(resp_xcs.content) > 1000  # non-trivial XCS body


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


# DetectedLayer / detect_svg_layers tests moved with the code to the
# client — web/src/svg/detectLayers.ts is now the source of truth and
# its pure-JS near-white logic is covered by the browser-side detection.
# ``is_near_white`` (pure function in xcs_gen/svg_source.py) still has
# its own unit tests in tests/test_svg_source.py.


def test_api_preview_width_is_a_uniform_scale():
    """``width_mm`` scales the preview and (almost exactly) nothing else.

    The SVG-layers page deliberately omits ``width_mm`` from its preview
    effect's dependency array: changing the project width must not cost a
    multi-second round trip, because the response differs from the previous
    one only by a constant factor on every coordinate AND on the viewBox —
    and the pane renders it at ``width/height 100%`` with
    ``preserveAspectRatio``, so the on-screen pixels are identical.

    Measured on Pikachu at 50 mm vs 100 mm: 120 of 122 paths are *bit*-exactly
    2x (max deviation 0.000000000 mm). The other two are multi-ring shapes
    that survived subtraction, where shapely's ``difference`` picks up or
    drops a sub-micron sliver ring depending on the coordinate magnitude it
    is handed. Same fill, same z-position, visually identical — so the
    frontend assumption holds — but it is a tolerance, not an identity, and
    this test says so out loud.

    If this ever stops being true (a width-dependent tolerance, a minimum
    feature size, a non-uniform fit), the frontend must put the dep back.
    """
    client = TestClient(create_app())

    def preview(width_mm: float) -> str:
        resp = client.post("/api/svg-preview", json={
            "svg_content": PIKACHU_SVG.read_text(),
            "width_mm": width_mm,
            "subtract_overlaps": True,
        })
        assert resp.status_code == 200
        return resp.json()["svg"]

    small = preview(50)
    large = preview(100)

    paths_small = re.findall(r'<path d="([^"]+)" fill="([^"]+)"', small)
    paths_large = re.findall(r'<path d="([^"]+)" fill="([^"]+)"', large)

    # Same shapes, same colours, same z-order.
    assert len(paths_small) == len(paths_large) > 0
    assert [f for _, f in paths_small] == [f for _, f in paths_large]

    # Must handle scientific notation — svgelements emits e.g. "7.779E-06"
    # for near-zero relative deltas, and a naive r"-?\d+\.\d+" splits the
    # mantissa from the exponent and reports nonsense.
    num_re = re.compile(r"-?\d+\.?\d*(?:[eE][-+]?\d+)?")

    exact = 0
    for (d_small, _), (d_large, _) in zip(paths_small, paths_large):
        nums_small = [float(n) for n in num_re.findall(d_small)]
        nums_large = [float(n) for n in num_re.findall(d_large)]
        if len(nums_small) != len(nums_large):
            # Sliver-ring divergence; tolerated, but bounded by the ratio
            # assertion below.
            continue
        for a, b in zip(nums_small, nums_large):
            assert b == pytest.approx(a * 2, abs=1e-6)
        exact += 1

    # The overwhelming majority must be exactly proportional. If this ratio
    # slips, subtraction has become materially scale-sensitive and the
    # frontend optimisation is no longer safe.
    assert exact >= 0.95 * len(paths_small), (
        f"only {exact}/{len(paths_small)} paths scaled exactly"
    )

    # And the viewBox itself scales exactly.
    vb_small = re.search(r'viewBox="([^"]+)"', small).group(1).split()
    vb_large = re.search(r'viewBox="([^"]+)"', large).group(1).split()
    for a, b in zip(vb_small, vb_large):
        assert float(b) == pytest.approx(float(a) * 2, abs=1e-3)
