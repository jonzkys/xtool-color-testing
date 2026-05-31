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
