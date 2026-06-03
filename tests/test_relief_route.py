"""Tests for the /api/relief/smooth route."""
from __future__ import annotations

from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from xcs_gen_web.app import create_app


def _png_bytes(w=32, h=32, color=100) -> bytes:
    buf = BytesIO()
    Image.new("L", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_returns_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(), "image/png")},
        data={"strength": "8", "edge_threshold": "40"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.headers.get("cache-control") == "no-store"
    out = Image.open(BytesIO(resp.content))
    assert out.size == (32, 32)


def test_relief_smooth_rejects_non_image():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("x.bin", b"not an image", "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_relief_smooth_with_clahe_returns_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(64, 64, 120), "image/png")},
        data={"clahe": "true", "clahe_clip": "3.0", "clahe_tiles": "8"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    out = Image.open(BytesIO(resp.content))
    assert out.size == (64, 64)


def test_relief_smooth_clamps_out_of_range_clahe_params():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(64, 64, 120), "image/png")},
        # absurd values must be clamped, not 422'd (snap-don't-reject convention)
        data={"clahe": "true", "clahe_clip": "9999", "clahe_tiles": "9999"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.size == (64, 64)


def test_relief_smooth_can_disable_smoothing():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(32, 32, 120), "image/png")},
        data={"smooth": "false"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.size == (32, 32)


def test_relief_smooth_remove_bg_returns_alpha():
    client = TestClient(create_app())
    # Image with a black (0) border and a gray (120) interior.
    img = Image.new("L", (32, 32), 0)
    for y in range(8, 24):
        for x in range(8, 24):
            img.putpixel((x, y), 120)
    buf = BytesIO()
    img.save(buf, format="PNG")
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", buf.getvalue(), "image/png")},
        data={"smooth": "false", "remove_bg": "true", "bg_threshold": "8"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode in ("LA", "RGBA")  # has an alpha channel
    px = out.convert("LA")
    assert px.getpixel((0, 0))[1] == 0      # black border → transparent
    assert px.getpixel((16, 16))[1] == 255  # interior → opaque


def test_relief_smooth_clamps_bg_threshold():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(32, 32, 120), "image/png")},
        data={"remove_bg": "true", "bg_threshold": "9999"},
    )
    assert resp.status_code == 200
