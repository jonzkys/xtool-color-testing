"""Tests for the bbox-based detection retry + warp reprojection guard.

Two sibling features that protect ingest from broken homographies on
oblique-angle photos:

  - ``detect_fiducials_with_recropping``: when the first pass misses
    one or more fiducials but found enough to bound the plate, retry
    on a cropped image so markers come out larger and corner
    localisation gets a second chance.

  - ``warp_to_burn_space``'s reprojection-RMS guard: refuse to ingest
    when the homography fits its source/dest correspondences poorly.
    cv2.findHomography always reports "solved" for >=4 points, even
    when the result is geometrically nonsense.
"""

from __future__ import annotations

import numpy as np
import pytest

from xcs_gen_web import capture_pipeline as cp


def test_recropping_returns_first_pass_unchanged_when_full_house(monkeypatch):
    """Every fiducial detected on the first pass → no retry."""
    full_corners = {
        cp.QR_TL: (10.0, 10.0),
        cp.QR_TR: (50.0, 10.0),
        cp.QR_BR: (50.0, 50.0),
        cp.QR_BL: (10.0, 50.0),
        1: (90.0, 10.0),
        2: (10.0, 90.0),
        3: (90.0, 90.0),
    }
    calls = {"n": 0}

    def fake_detect(_img):
        calls["n"] += 1
        return 42, 0, full_corners

    monkeypatch.setattr(cp, "detect_fiducials", fake_detect)
    img = np.zeros((1000, 1000, 3), dtype=np.uint8)

    qr_id, retest, corners = cp.detect_fiducials_with_recropping(img)

    assert qr_id == 42
    assert retest == 0
    assert corners == full_corners
    assert calls["n"] == 1, "should not retry when first pass had everything"


def test_recropping_retries_and_picks_better_pass(monkeypatch):
    """First pass missing a key → retry on crop with all keys → win."""
    img_h, img_w = 2000, 2000
    img = np.zeros((img_h, img_w, 3), dtype=np.uint8)
    # First pass: two markers in the top-left quadrant only.
    first_corners = {
        cp.QR_TL: (200.0, 200.0),
        1: (300.0, 220.0),
    }
    # Second pass after crop: full house in the cropped frame's local
    # coordinates. The wrapper should add the crop offset back so the
    # result is in the original frame's pixel space.
    second_local = {
        cp.QR_TL: (50.0, 50.0),
        cp.QR_TR: (90.0, 50.0),
        cp.QR_BR: (90.0, 90.0),
        cp.QR_BL: (50.0, 90.0),
        1: (130.0, 60.0),
        2: (50.0, 130.0),
        3: (130.0, 130.0),
    }

    seen_shapes: list[tuple[int, int]] = []

    def fake_detect(img_arg):
        seen_shapes.append(img_arg.shape[:2])
        if len(seen_shapes) == 1:
            return 7, 0, first_corners
        return 7, 0, second_local

    monkeypatch.setattr(cp, "detect_fiducials", fake_detect)
    qr_id, retest, corners = cp.detect_fiducials_with_recropping(img)

    assert qr_id == 7
    assert retest == 0
    # Wrapper picked the second pass — strictly more keys than the first.
    assert set(corners.keys()) == cp._EXPECTED_FIDUCIAL_KEYS
    # First pass was original size; second pass was a crop (smaller).
    assert seen_shapes[0] == (img_h, img_w)
    assert seen_shapes[1][0] < img_h and seen_shapes[1][1] < img_w
    # Coordinates rebased to original frame (each value > the crop
    # offset they had in the local frame).
    assert all(p[0] > 50 and p[1] > 50 for p in corners.values())


def test_recropping_skips_when_crop_would_be_full_image(monkeypatch):
    """First pass markers spread across the whole frame → retry skipped."""
    img = np.zeros((1000, 1000, 3), dtype=np.uint8)
    spread_corners = {
        cp.QR_TL: (50.0, 50.0),
        1: (950.0, 50.0),
        2: (50.0, 950.0),
    }
    calls = {"n": 0}

    def fake_detect(_img):
        calls["n"] += 1
        return 1, 0, spread_corners

    monkeypatch.setattr(cp, "detect_fiducials", fake_detect)
    cp.detect_fiducials_with_recropping(img)
    assert calls["n"] == 1, "spread markers fill the frame; retry adds nothing"


def test_warp_rms_guard_rejects_garbage_correspondences():
    """Mismatched src/dest → high RMS → DetectionError, even though
    cv2 can solve a homography from 4+ points."""
    burn_anchors_mm = {
        cp.QR_TL: (1.0, 1.0),
        cp.QR_TR: (10.0, 1.0),
        cp.QR_BR: (10.0, 10.0),
        cp.QR_BL: (1.0, 10.0),
    }
    # src points form a perfect square in pixel space, but with one
    # vertex flagrantly misplaced — homography can't satisfy them all.
    corners_px = {
        cp.QR_TL: (100.0, 100.0),
        cp.QR_TR: (200.0, 100.0),
        cp.QR_BR: (200.0, 200.0),
        cp.QR_BL: (5.0, 5.0),  # misaligned
    }
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    with pytest.raises(cp.DetectionError, match="warp alignment poor"):
        cp.warp_to_burn_space(
            img,
            burn_anchors_mm=burn_anchors_mm,
            corners_px=corners_px,
            burn_size_mm=(11.0, 11.0),
            px_per_mm=10.0,
        )


def test_warp_rms_guard_passes_clean_correspondences():
    """Clean src/dest with a clean affine transform → low RMS → OK."""
    burn_anchors_mm = {
        cp.QR_TL: (1.0, 1.0),
        cp.QR_TR: (11.0, 1.0),
        cp.QR_BR: (11.0, 11.0),
        cp.QR_BL: (1.0, 11.0),
    }
    # Pixel-space square; consistent scale + offset → near-zero residuals.
    corners_px = {
        cp.QR_TL: (10.0, 10.0),
        cp.QR_TR: (110.0, 10.0),
        cp.QR_BR: (110.0, 110.0),
        cp.QR_BL: (10.0, 110.0),
    }
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    out = cp.warp_to_burn_space(
        img,
        burn_anchors_mm=burn_anchors_mm,
        corners_px=corners_px,
        burn_size_mm=(11.0, 11.0),
        px_per_mm=10.0,
    )
    assert out.shape[:2] == (110, 110)
