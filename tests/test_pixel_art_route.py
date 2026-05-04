"""Tests for the /api/pixel-art and /api/pixel-art/svg routes."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _payload(**overrides):
    base = {
        "name": "test-pixel",
        "material_id": "mat-1",
        "width_mm": 10.0,
        "height_mm": 10.0,
        "start_x": 10.0,
        "start_y": 20.0,
        "cell_mm": 1.0,
        "rects": [
            {"x": 0, "y": 0, "width": 2, "height": 2, "color": "#000000"},
        ],
        "layers": [
            {
                "color": "#000000",
                "enabled": True,
                "base_params": {
                    "power": 50, "speed": 1000, "frequency": 65,
                    "density": 100, "passes": 1, "pulse_width": 200,
                    "laser": "red",
                },
            },
        ],
    }
    base.update(overrides)
    return base


def test_pixel_art_returns_xcs_bytes_with_filename():
    client = TestClient(create_app())
    resp = client.post("/api/pixel-art", json=_payload())
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment;")
    assert "test-pixel.xcs" in resp.headers["content-disposition"]
    payload = json.loads(resp.content.decode("utf-8"))
    assert isinstance(payload, dict) and payload


def test_pixel_art_400_when_all_layers_disabled():
    client = TestClient(create_app())
    body = _payload()
    body["layers"][0]["enabled"] = False
    resp = client.post("/api/pixel-art", json=body)
    assert resp.status_code == 400
    assert "No enabled rects" in resp.json()["detail"]


def test_pixel_art_svg_returns_parseable_svg():
    from xml.etree import ElementTree as ET

    client = TestClient(create_app())
    resp = client.post("/api/pixel-art/svg", json=_payload())
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/svg+xml")
    root = ET.fromstring(resp.text)
    assert root.tag.endswith("svg")
    assert root.attrib["viewBox"] == "0 0 10.0 10.0"
    paths = root.findall(".//{http://www.w3.org/2000/svg}path")
    assert len(paths) == 1
