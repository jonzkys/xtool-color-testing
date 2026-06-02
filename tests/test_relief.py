"""Tests for grayscale depth-map smoothing (relief)."""
from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from xcs_gen_web.relief import (
    ReliefSmoothParams,
    smooth_heightfield,
    to_grayscale_u8,
    encode_png,
)


def test_smooth_removes_single_pixel_spike():
    gray = np.full((20, 20), 100, dtype=np.uint8)
    gray[10, 10] = 255  # one bright spike
    out = smooth_heightfield(gray, ReliefSmoothParams())
    assert abs(int(out[10, 10]) - 100) < 20
    assert out.dtype == np.uint8
    assert out.shape == gray.shape


def test_smooth_preserves_a_real_step_edge():
    gray = np.empty((20, 20), dtype=np.uint8)
    gray[:, :10] = 50
    gray[:, 10:] = 200  # a 150-level jump, well above edge_threshold=40
    out = smooth_heightfield(gray, ReliefSmoothParams())
    assert out[:, 8].mean() < 90
    assert out[:, 11].mean() > 160


def test_smooth_keeps_a_monotonic_ramp_monotonic():
    row = np.linspace(0, 255, 256).astype(np.uint8)
    gray = np.tile(row, (32, 1))  # 32×256 horizontal ramp
    out = smooth_heightfield(gray, ReliefSmoothParams())
    diffs = np.diff(out[16].astype(np.int16))
    assert diffs.min() >= -2  # no significant new reversals introduced


def test_encode_png_round_trips_grayscale():
    gray = np.full((8, 12), 128, dtype=np.uint8)
    img = Image.open(BytesIO(encode_png(gray)))
    assert img.mode == "L"
    assert img.size == (12, 8)  # PIL size is (w, h)


def test_to_grayscale_u8_handles_channel_layouts():
    gray2d = np.full((4, 4), 120, dtype=np.uint8)
    assert to_grayscale_u8(gray2d).shape == (4, 4)

    bgr = cv2.cvtColor(gray2d, cv2.COLOR_GRAY2BGR)
    out_bgr = to_grayscale_u8(bgr)
    assert out_bgr.ndim == 2 and out_bgr.dtype == np.uint8

    bgra = cv2.cvtColor(gray2d, cv2.COLOR_GRAY2BGRA)
    out_bgra = to_grayscale_u8(bgra)
    assert out_bgra.ndim == 2 and out_bgra.dtype == np.uint8


def test_apply_clahe_increases_local_contrast():
    from xcs_gen_web.relief import apply_clahe

    # A low-contrast gradient bunched in a narrow band.
    row = np.linspace(90, 150, 256).astype(np.uint8)
    gray = np.tile(row, (64, 1))
    out = apply_clahe(gray, clip_limit=2.0, tiles=8)
    assert out.dtype == np.uint8
    assert out.shape == gray.shape
    # CLAHE should widen the value range vs the cramped input.
    assert int(out.max()) - int(out.min()) >= int(gray.max()) - int(gray.min())


def test_apply_clahe_handles_flat_field_without_error():
    from xcs_gen_web.relief import apply_clahe

    gray = np.full((32, 32), 128, dtype=np.uint8)
    out = apply_clahe(gray, clip_limit=2.0, tiles=8)
    assert out.shape == (32, 32)
    assert out.dtype == np.uint8
