"""Tests for raster (PNG) → SVG conversion via vtracer."""

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.raster_to_svg import (
    RasterTraceOptions,
    decode_base64_image,
    png_to_svg,
)

SAMPLES = Path(__file__).parent.parent / "samples"
PIKA_PNG = SAMPLES / "pika.png"


def test_png_to_svg_returns_svg_string():
    svg = png_to_svg(PIKA_PNG.read_bytes(), image_format="png")
    assert svg.startswith("<?xml") or svg.startswith("<svg")
    assert "<path" in svg


def test_aggressive_quantization_reduces_colors():
    """Very low color_precision collapses the palette to a tiny number of colors."""
    import re
    aggressive = RasterTraceOptions(color_precision=2, layer_difference=48, filter_speckle=10)
    svg = png_to_svg(PIKA_PNG.read_bytes(), image_format="png", options=aggressive)
    fills = set(re.findall(r'fill="([^"]+)"', svg))
    # Pika PNG collapses to ~2 distinct colors under these settings
    assert 1 <= len(fills) <= 6


def test_decode_base64_data_url():
    raw = PIKA_PNG.read_bytes()
    data_url = f"data:image/png;base64,{base64.b64encode(raw).decode()}"
    decoded, fmt = decode_base64_image(data_url)
    assert decoded == raw
    assert fmt == "png"


def test_decode_plain_base64_defaults_to_png():
    raw = PIKA_PNG.read_bytes()
    decoded, fmt = decode_base64_image(base64.b64encode(raw).decode())
    assert decoded == raw
    assert fmt == "png"


def test_api_raster_to_svg_endpoint():
    client = TestClient(create_app())
    raw = PIKA_PNG.read_bytes()
    data_url = f"data:image/png;base64,{base64.b64encode(raw).decode()}"
    resp = client.post("/api/raster-to-svg", json={
        "image_data": data_url,
        "color_precision": 2,
        "layer_difference": 48,
        "filter_speckle": 10,
    })
    assert resp.status_code == 200
    svg = resp.json()["svg"]
    assert "<path" in svg


def test_api_raster_to_svg_rejects_garbage():
    client = TestClient(create_app())
    resp = client.post("/api/raster-to-svg", json={
        "image_data": "not base64!@#",
    })
    assert resp.status_code == 400


def test_roundtrip_png_through_svg_layers_detect():
    """Convert PNG -> SVG -> run SVG layers detection. Should find colors."""
    client = TestClient(create_app())
    raw = PIKA_PNG.read_bytes()
    data_url = f"data:image/png;base64,{base64.b64encode(raw).decode()}"

    # Step 1: vectorize
    resp = client.post("/api/raster-to-svg", json={
        "image_data": data_url,
        "color_precision": 3,
        "layer_difference": 48,
        "filter_speckle": 10,
    })
    assert resp.status_code == 200
    svg = resp.json()["svg"]

    # Step 2: feed into existing detect endpoint
    resp2 = client.post("/api/svg-detect-layers", json={
        "svg_content": svg,
        "width_mm": 50,
    })
    assert resp2.status_code == 200
    layers = resp2.json()
    assert len(layers) >= 1
    assert all("color" in l for l in layers)
