"""Tests for the capture pipeline (QR detect + homography warp).

Uses synthetic images rendered from segno + PIL so the tests are
deterministic and don't require real photographs.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
import segno
from PIL import Image

from xcs_gen_web.capture_pipeline import (
    DetectionError,
    detect_qr,
    warp_to_burn_space,
)


def _render_synthetic_sheet(
    *,
    qr_text: str,
    canvas_w_px: int = 800,
    canvas_h_px: int = 600,
    qr_top_left: tuple[int, int] = (50, 50),
    qr_size_px: int = 180,
) -> np.ndarray:
    """Render a white image with a black QR pasted at a known pixel position."""
    qr = segno.make(qr_text, error="m")
    # segno.to_pil() is not a method; use the save API to bytes then reload.
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=10, border=2)
    buf.seek(0)
    qr_img = Image.open(buf).convert("L").resize((qr_size_px, qr_size_px))

    canvas = Image.new("L", (canvas_w_px, canvas_h_px), 255)
    canvas.paste(qr_img, qr_top_left)
    return np.array(canvas.convert("RGB"))


def test_detect_qr_returns_payload_and_corners():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    img = _render_synthetic_sheet(qr_text=qr_text)
    payload, corners = detect_qr(img)
    assert payload == qr_text
    assert corners.shape == (4, 2)
    # Corners should bracket the pasted position (50,50) + size (180)
    xs = corners[:, 0]
    ys = corners[:, 1]
    assert xs.min() > 40 and xs.max() < 240
    assert ys.min() > 40 and ys.max() < 240


def test_detect_qr_raises_when_no_code_present():
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    with pytest.raises(DetectionError):
        detect_qr(img)


def test_warp_produces_expected_canvas_size():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    img = _render_synthetic_sheet(qr_text=qr_text)
    _, corners = detect_qr(img)
    # Pretend QR is 12mm in burn-space, at top-left (0,0) of a 40x20mm grid.
    # Target resolution: 10 px/mm → expect warped 400x200 canvas.
    warped = warp_to_burn_space(
        img,
        qr_corners_px=corners,
        qr_size_mm=12.0,
        qr_origin_mm=(0.0, 0.0),
        burn_size_mm=(40.0, 20.0),
        px_per_mm=10.0,
    )
    assert warped.shape[0] == 200
    assert warped.shape[1] == 400


def test_warp_qr_region_is_dark():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    img = _render_synthetic_sheet(qr_text=qr_text)
    _, corners = detect_qr(img)
    warped = warp_to_burn_space(
        img,
        qr_corners_px=corners,
        qr_size_mm=12.0,
        qr_origin_mm=(0.0, 0.0),
        burn_size_mm=(40.0, 20.0),
        px_per_mm=10.0,
    )
    # QR region in warped image is at (0,0) to (120,120) px.
    qr_region = warped[:120, :120]
    # Must contain some very dark pixels (QR modules)
    assert qr_region.min() < 80
