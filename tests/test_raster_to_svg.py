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


def test_max_colors_caps_palette():
    """PIL pre-quantization drastically reduces vtracer's output palette.

    vtracer's color_precision can still introduce ±1-channel splits on
    pre-quantized pixels, so max_colors is a strong guideline rather than
    a hard cap. With a very tight target (3 colors), the actual output
    should stay well under what the unquantized trace produces.
    """
    import re
    baseline = png_to_svg(PIKA_PNG.read_bytes(), image_format="png")
    baseline_n = len(set(re.findall(r'fill="([^"]+)"', baseline)))

    opts = RasterTraceOptions(max_colors=3)
    svg = png_to_svg(PIKA_PNG.read_bytes(), image_format="png", options=opts)
    capped_n = len(set(re.findall(r'fill="([^"]+)"', svg)))

    # Hard cap of 2x target catches pathological splits without being brittle.
    assert capped_n <= 6
    # And it has to be fewer than the unquantized baseline.
    assert capped_n < baseline_n


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


def test_raster_to_svg_rejects_over_cap_values():
    """Backend caps on trace options are a DoS guard — vtracer's work
    scales per-layer, so a malicious client asking for 256 colours
    (pre-cap) could burn a lot of CPU. Pydantic rejects the request
    at the schema layer before any work is done."""
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    client = TestClient(create_app())

    # Any over-cap value should be a 422 (Pydantic validation error)
    for field, bad in [
        ("max_colors", 64),          # cap = 32
        ("layer_difference", 200),   # cap = 128
        ("filter_speckle", 100),     # cap = 64
        ("color_precision", 16),     # cap = 8 (unchanged)
    ]:
        body = {"image_data": "data:image/png;base64,iVBORw0KGgo="}
        body[field] = bad
        resp = client.post("/api/raster-to-svg", json=body)
        assert resp.status_code == 422, (
            f"expected 422 for {field}={bad}, got {resp.status_code}: {resp.text}"
        )
