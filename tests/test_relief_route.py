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


def _png_rgb(w=48, h=48):
    from PIL import Image as _I
    buf = BytesIO()
    img = _I.new("RGB", (w, h), (0, 0, 0))      # black background
    for y in range(12, 36):                       # a mid-grey square object
        for x in range(12, 36):
            img.putpixel((x, y), (150, 150, 150))
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_colour_trim_falloff_returns_la_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "bg_mode": "colour",
            "bg_color": "0,0,0",      # key out the black background
            "bg_tolerance": "20",
            "trim_pct": "5",
            "falloff_pct": "10",
            "falloff_target": "0",
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "LA"            # grayscale + alpha
    assert out.size == (48, 48)
    # the keyed background is transparent
    assert out.getpixel((2, 2))[1] == 0


def test_relief_smooth_perimeter_returns_la_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "bg_mode": "dark",
            "bg_threshold": "8",
            "perimeter_pct": "5",     # round the silhouette boundary
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "LA"            # grayscale + alpha
    assert out.size == (48, 48)


def test_relief_smooth_clahe_with_bg_removal_returns_la_png():
    # CLAHE now runs AFTER background removal (mask-aware) — exercise the
    # reordered path end-to-end.
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={
            "smooth": "false",
            "clahe": "true",
            "clahe_clip": "3",
            "clahe_tiles": "8",
            "remove_bg": "true",
            "bg_mode": "dark",
            "bg_threshold": "8",
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "LA"            # grayscale + alpha (background removed)
    assert out.getpixel((2, 2))[1] == 0  # background still transparent


def test_relief_smooth_colour_mode_without_colour_is_opaque():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={"smooth": "false", "remove_bg": "true", "bg_mode": "colour", "bg_color": ""},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "L"             # nothing picked → no alpha, plain L PNG
