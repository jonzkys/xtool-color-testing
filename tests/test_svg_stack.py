"""Tests for the SVG-stack converter and /api/svg-stack endpoint."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.schemas import BaseParams, SvgStackRequest
from xcs_gen_web.svg_converter import svg_stack_to_xcs, svg_stack_to_xcs_bytes


SAMPLES = Path(__file__).parent.parent / "samples"
PIKACHU_SVG = SAMPLES / "Pikachu.svg"


def _base() -> BaseParams:
    return BaseParams(
        power=14.6, speed=1000, frequency=125, density=5000,
        passes=1, pulse_width=200, laser="red",
    )


def _request(**overrides) -> SvgStackRequest:
    defaults = dict(
        name="test",
        svg_content=PIKACHU_SVG.read_text(),
        width_mm=50.0,
        height_mm=None,  # preserve aspect
        start_x=10.0, start_y=10.0,
        base_params=_base(),
        processing_type="COLOR_FILL_ENGRAVE",
        scan_angle=90.0,
        stack_passes=1,
        stack_step_deg=90.0,
    )
    defaults.update(overrides)
    return SvgStackRequest(**defaults)


def test_svg_stack_single_pass_produces_paths():
    project = svg_stack_to_xcs(_request())
    assert len(project.paths) > 0
    # All paths share the single scan angle
    angles = {p.params.scan_angle for p in project.paths}
    assert angles == {90.0}


def test_svg_stack_multiple_passes_duplicates_with_rotation():
    project = svg_stack_to_xcs(_request(stack_passes=3, stack_step_deg=60.0))
    # 3 passes = 3× the primary path count
    # Get count after 1 pass for comparison
    single = svg_stack_to_xcs(_request(stack_passes=1))
    assert len(project.paths) == 3 * len(single.paths)
    # Three distinct scan angles: 90, 150, 210
    angles = sorted({p.params.scan_angle for p in project.paths})
    assert angles == [90.0, 150.0, 210.0]


def test_svg_stack_rejects_empty_svg():
    with pytest.raises(ValueError, match="No supported shapes"):
        svg_stack_to_xcs(_request(svg_content='<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))


def test_svg_stack_returns_valid_xcs_bytes():
    body = svg_stack_to_xcs_bytes(_request())
    data = json.loads(body)
    assert "canvas" in data
    assert "device" in data
    assert len(data["canvas"][0]["displays"]) > 0


def test_api_svg_stack_endpoint():
    client = TestClient(create_app())
    payload = {
        "name": "pika_stack",
        "svg_content": PIKACHU_SVG.read_text(),
        "width_mm": 50.0,
        "height_mm": None,
        "start_x": 10, "start_y": 10,
        "base_params": {
            "power": 14.6, "speed": 1000, "frequency": 125,
            "density": 5000, "passes": 1, "pulse_width": 200, "laser": "red",
        },
        "processing_type": "COLOR_FILL_ENGRAVE",
        "scan_angle": 90.0,
        "stack_passes": 2,
        "stack_step_deg": 90.0,
    }
    resp = client.post("/api/svg-stack", json=payload)
    assert resp.status_code == 200
    assert "pika_stack.xcs" in resp.headers["content-disposition"]
    data = json.loads(resp.content)
    assert "canvas" in data


def test_api_svg_stack_rejects_bad_name():
    client = TestClient(create_app())
    payload = {
        "name": "bad/name",  # path separator rejected by pattern
        "svg_content": "<svg/>",
        "width_mm": 50,
        "base_params": {
            "power": 14.6, "speed": 1000, "frequency": 125,
            "density": 5000, "passes": 1, "pulse_width": 200, "laser": "red",
        },
    }
    resp = client.post("/api/svg-stack", json=payload)
    assert resp.status_code == 422
