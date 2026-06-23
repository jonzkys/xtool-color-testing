"""Tests for the /api/relief/smooth route."""
from __future__ import annotations

import io
import json
from io import BytesIO

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from xcs_gen_web.app import create_app


def _png(arr, mode):
    buf = io.BytesIO()
    Image.fromarray(arr, mode=mode).save(buf, format="PNG")
    return buf.getvalue()


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
        data={"smooth": "false", "remove_bg": "true",
              "subtractions": json.dumps([{"method": "dark", "threshold": 8}])},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode in ("LA", "RGBA")  # has an alpha channel
    px = out.convert("LA")
    assert px.getpixel((0, 0))[1] == 0      # black border → transparent
    assert px.getpixel((16, 16))[1] == 255  # interior → opaque


def test_relief_smooth_clamps_subtraction_threshold():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(32, 32, 120), "image/png")},
        data={"remove_bg": "true",
              "subtractions": json.dumps([{"method": "dark", "threshold": 9999}])},
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
            "subtractions": json.dumps([{"method": "colour", "color": [0, 0, 0],
                                         "tolerance": 20}]),
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
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
            "perimeter_pct": "5",
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
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "LA"            # grayscale + alpha (background removed)
    assert out.getpixel((2, 2))[1] == 0  # background still transparent


def test_relief_smooth_no_usable_subtraction_is_opaque():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={"smooth": "false", "remove_bg": "true",
              "subtractions": json.dumps([{"method": "colour"}])},  # no colour → skipped
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "L"             # nothing usable → no alpha, plain L PNG


def _png_two_red_blobs():
    """40×20 RGB: black background, two disconnected red blobs (left & right)."""
    from PIL import Image as _I
    buf = BytesIO()
    img = _I.new("RGB", (40, 20), (0, 0, 0))
    for y in range(5, 15):
        for x in range(3, 11):
            img.putpixel((x, y), (200, 0, 0))    # blob A (left)
        for x in range(29, 37):
            img.putpixel((x, y), (200, 0, 0))    # blob B (right)
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_stacks_dark_plus_area():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_two_red_blobs(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([
                {"method": "dark", "threshold": 8},                     # outer black bg
                {"method": "area", "color": [200, 0, 0], "tolerance": 40,
                 "seedX": 7 / 40, "seedY": 0.5},                        # blob A only
            ]),
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content)).convert("LA")
    assert out.getpixel((0, 0))[1] == 0       # black background removed (dark)
    assert out.getpixel((7, 10))[1] == 0      # blob A removed (area, seeded)
    assert out.getpixel((33, 10))[1] == 255   # blob B kept (same colour, disconnected)


def test_relief_smooth_empty_subtractions_is_plain_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={"smooth": "false", "remove_bg": "true", "subtractions": "[]"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "L"


def _png_donut():
    """48×48 RGB: grey square on black with an enclosed black hole at the centre."""
    from PIL import Image as _I
    buf = BytesIO()
    img = _I.new("RGB", (48, 48), (0, 0, 0))
    for y in range(12, 36):
        for x in range(12, 36):
            img.putpixel((x, y), (150, 150, 150))
    for y in range(22, 26):
        for x in range(22, 26):
            img.putpixel((x, y), (0, 0, 0))       # internal hole (dark)
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_shape_internal_default_keeps_hole_hard():
    # Default shape_internal=false: the internal hole is re-punched hard-edged
    # even with edge falloff on.
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_donut(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
            "falloff_pct": "10",
            "falloff_target": "0",
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content)).convert("LA")
    assert out.getpixel((23, 23))[1] == 0     # internal hole stays transparent


def test_relief_smooth_shape_internal_changes_the_result():
    # shape_internal=true must actually shape the internal-hole boundary, so the
    # output differs from the default (outer-only) path for the same donut +
    # falloff. (The difference shows in the height field near the hole edge —
    # the hole's alpha stays 0 either way, so compare the full encoded result.)
    client = TestClient(create_app())

    def smooth(shape_internal: str) -> bytes:
        resp = client.post(
            "/api/relief/smooth",
            files={"file": ("depth.png", _png_donut(), "image/png")},
            data={
                "smooth": "false",
                "remove_bg": "true",
                "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
                "falloff_pct": "10",
                "falloff_target": "0",
                "shape_internal": shape_internal,
            },
        )
        assert resp.status_code == 200
        return resp.content

    default = smooth("false")
    shaped = smooth("true")
    shaped_mode = Image.open(BytesIO(shaped)).mode
    assert shaped_mode == "LA"
    assert shaped != default  # the flag demonstrably alters the output


# ---------------------------------------------------------------------------
# /api/relief/export — 8/16-bit full-precision render
# ---------------------------------------------------------------------------

def test_export_16bit_returns_true_16bit():
    client = TestClient(create_app())
    ramp = np.linspace(0, 255, 64 * 64).reshape(64, 64).astype(np.uint8)
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(ramp, "L"), "image/png")},
                    data={"bit_depth": "16", "smooth": "true", "tone_mode": "gamma", "gamma": "0.5"})
    assert r.status_code == 200
    im = Image.open(io.BytesIO(r.content))
    assert im.mode in ("I;16", "I")
    assert len(np.unique(np.asarray(im))) > 256


def test_export_8bit_returns_mode_L():
    client = TestClient(create_app())
    ramp = np.linspace(0, 255, 64 * 64).reshape(64, 64).astype(np.uint8)
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(ramp, "L"), "image/png")},
                    data={"bit_depth": "8", "smooth": "true", "tone_mode": "none"})
    assert r.status_code == 200
    assert Image.open(io.BytesIO(r.content)).mode == "L"


def test_export_preserves_16bit_input():
    client = TestClient(create_app())
    src = np.linspace(0, 65535, 64 * 64).reshape(64, 64).astype(np.uint16)
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(src, "I;16"), "image/png")},
                    data={"bit_depth": "16", "smooth": "false", "tone_mode": "none"})
    assert r.status_code == 200
    assert len(np.unique(np.asarray(Image.open(io.BytesIO(r.content))))) > 256


def test_export_16bit_with_bg_is_grayscale():
    client = TestClient(create_app())
    img = np.full((64, 64), 200, dtype=np.uint8)
    img[:8, :] = 0
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(img, "L"), "image/png")},
                    data={"bit_depth": "16", "smooth": "false", "tone_mode": "none",
                          "remove_bg": "true", "subtractions": '[{"method":"dark","threshold":8}]'})
    assert r.status_code == 200
    im = Image.open(io.BytesIO(r.content))
    assert im.mode in ("I;16", "I")
    assert int(np.asarray(im)[0, 0]) == 0
