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


def test_background_alpha_masks_dark():
    from xcs_gen_web.relief import background_alpha

    gray = np.full((10, 10), 100, dtype=np.uint8)
    gray[0, 0] = 0
    gray[1, 1] = 5
    alpha = background_alpha(gray, threshold=8, high=False)
    assert alpha.dtype == np.uint8 and alpha.shape == gray.shape
    assert alpha[0, 0] == 0 and alpha[1, 1] == 0  # dark → transparent
    assert alpha[5, 5] == 255                     # relief → opaque


def test_background_alpha_high_masks_bright():
    from xcs_gen_web.relief import background_alpha

    gray = np.full((10, 10), 100, dtype=np.uint8)
    gray[0, 0] = 255
    alpha = background_alpha(gray, threshold=250, high=True)
    assert alpha[0, 0] == 0 and alpha[5, 5] == 255


def test_encode_png_la_round_trips_alpha():
    from io import BytesIO as _B

    from PIL import Image as _I

    from xcs_gen_web.relief import encode_png_la

    gray = np.full((4, 4), 120, dtype=np.uint8)
    alpha = np.full((4, 4), 255, dtype=np.uint8)
    alpha[0, 0] = 0
    img = _I.open(_B(encode_png_la(gray, alpha)))
    assert img.mode == "LA"
    px = np.array(img)
    assert px[0, 0, 1] == 0 and px[1, 1, 1] == 255


def test_parse_rgb_parses_and_clamps():
    from xcs_gen_web.relief import parse_rgb
    assert parse_rgb("10,20,30") == (10, 20, 30)
    assert parse_rgb("300,-5,40") == (255, 0, 40)  # clamped 0..255
    assert parse_rgb("") is None
    assert parse_rgb("1,2") is None
    assert parse_rgb("a,b,c") is None


def test_colour_background_alpha_keys_picked_colour():
    from xcs_gen_web.relief import colour_background_alpha
    # BGR image: left column a known colour, right column black.
    img = np.zeros((2, 2, 3), np.uint8)
    img[:, 0] = (30, 20, 10)  # BGR → RGB (10, 20, 30)
    alpha = colour_background_alpha(img, (10, 20, 30), 5)
    assert (alpha[:, 0] == 0).all()    # picked colour → background (transparent)
    assert (alpha[:, 1] == 255).all()  # black → foreground


def test_colour_background_alpha_respects_tolerance():
    from xcs_gen_web.relief import colour_background_alpha
    img = np.zeros((1, 2, 3), np.uint8)
    img[0, 0] = (0, 0, 0)    # RGB (0,0,0)
    img[0, 1] = (0, 0, 20)   # BGR → RGB (20,0,0), distance 20 from black
    tight = colour_background_alpha(img, (0, 0, 0), 10)   # 20 > 10 → fg
    assert tight[0, 0] == 0 and tight[0, 1] == 255
    loose = colour_background_alpha(img, (0, 0, 0), 30)   # 20 <= 30 → bg
    assert loose[0, 0] == 0 and loose[0, 1] == 0


def test_trim_alpha_erodes_object_inward():
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((40, 40), np.uint8)
    alpha[10:30, 10:30] = 255            # 20×20 square (short side 20)
    out = trim_alpha(alpha, 10)          # 10% of 20 → radius 2 → shave a 2px ring
    assert out[10, 10] == 0              # corner shaved off
    assert out[20, 20] == 255            # centre kept
    assert int((out > 0).sum()) < int((alpha > 0).sum())


def test_trim_alpha_noop_and_clamp():
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((40, 40), np.uint8)
    alpha[18:22, 18:22] = 255            # 4×4 square
    assert (trim_alpha(alpha, 0) == alpha).all()    # pct 0 → identity
    assert (trim_alpha(alpha, 90) == alpha).all()   # would empty → clamp to input


def test_trim_alpha_guards_negative_and_shape():
    import pytest
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((20, 20), np.uint8)
    alpha[5:15, 5:15] = 255
    assert (trim_alpha(alpha, -5) == alpha).all()   # negative pct → identity
    with pytest.raises(ValueError):
        trim_alpha(np.zeros((4, 4, 3), np.uint8), 10)  # non-2D → ValueError


def test_edge_falloff_down_bevels_to_floor():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((40, 40), 200, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[5:35, 5:35] = 255                       # 30×30 object (short side 30)
    out = edge_falloff(gray, alpha, 20, "down")   # band = 6 px
    assert out[5, 20] < 80                          # edge ramped toward the floor
    assert out[20, 20] == 200                       # centre (beyond band) unchanged
    row = out[20, 5:21].astype(int)                 # edge → centre along a row
    assert (np.diff(row) >= 0).all()                # monotonic non-decreasing


def test_edge_falloff_up_and_noop():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((40, 40), 100, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[5:35, 5:35] = 255
    up = edge_falloff(gray, alpha, 20, "up")
    assert up[5, 20] > 180                           # edge ramped toward the peak
    assert up[20, 20] == 100                         # centre (beyond band) unchanged
    assert (edge_falloff(gray, alpha, 0, "down") == gray).all()  # pct 0 → identity


def test_edge_falloff_guards_shape():
    import pytest
    from xcs_gen_web.relief import edge_falloff
    gray = np.zeros((10, 10), np.uint8)
    with pytest.raises(ValueError):
        edge_falloff(np.zeros((10, 10, 3), np.uint8), gray, 20)  # non-2D
    with pytest.raises(ValueError):
        edge_falloff(gray, np.zeros((10, 20), np.uint8), 20)     # shape mismatch
