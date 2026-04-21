"""Tests for the capture pipeline (fiducial detect + homography warp).

Uses synthetic images rendered from segno + PIL so the tests are
deterministic and don't require real photographs.

detect_qr and the old warp_to_burn_space signature were removed in Task 17
(ArUco redesign). The new API is detect_fiducials / warp_to_burn_space with
burn_anchors_mm / corners_px kwargs.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest
import segno

from xcs_gen.capture.marker_render import render_aruco_bits
from xcs_gen.capture.qr_payload import encode_id
from xcs_gen_web.capture_pipeline import (
    DetectionError,
    detect_fiducials,
    warp_to_burn_space,
)


def _render_strip(px_per_mm: int = 20) -> np.ndarray:
    """Render a synthetic test strip with a QR at TL and ArUcos at TR/BL/BR."""
    W_mm, H_mm = 50, 30
    img = np.full((H_mm * px_per_mm, W_mm * px_per_mm, 3), 255, dtype=np.uint8)

    def paste_bits(bits, x_mm, y_mm, size_mm):
        side = int(size_mm * px_per_mm)
        arr = np.where(bits, 0, 255).astype(np.uint8)
        arr = cv2.resize(arr, (side, side), interpolation=cv2.INTER_NEAREST)
        x_px, y_px = int(x_mm * px_per_mm), int(y_mm * px_per_mm)
        region = img[y_px:y_px + side, x_px:x_px + side]
        for c in range(3):
            region[..., c] = arr

    qr = segno.make(encode_id(7), error="m")
    qr_bits = np.array(qr.matrix, dtype=bool)
    paste_bits(qr_bits, 1, 1, 5)
    paste_bits(render_aruco_bits(1), W_mm - 1 - 2, 1,           2)
    paste_bits(render_aruco_bits(2), 1,             H_mm - 1 - 2, 2)
    paste_bits(render_aruco_bits(3), W_mm - 1 - 2, H_mm - 1 - 2, 2)
    return img


def test_detect_fiducials_returns_id_and_four_corners():
    img = _render_strip()
    qr_id, corners = detect_fiducials(img)
    assert qr_id == 7
    assert set(corners.keys()) == {0, 1, 2, 3}
    for k in corners:
        assert len(corners[k]) == 2


def test_detect_fiducials_raises_when_no_qr():
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    with pytest.raises(DetectionError):
        detect_fiducials(img)


def test_warp_produces_expected_canvas_size():
    img = _render_strip()
    _, corners = detect_fiducials(img)
    # Fabricate anchor positions in mm; result canvas = 40x20 mm @ 10 px/mm
    burn_anchors = {
        0: (0.0, 0.0),
        1: (40.0, 0.0),
        2: (0.0, 20.0),
        3: (40.0, 20.0),
    }
    warped = warp_to_burn_space(
        img,
        burn_anchors_mm=burn_anchors,
        corners_px=corners,
        burn_size_mm=(40.0, 20.0),
        px_per_mm=10.0,
    )
    assert warped.shape[0] == 200
    assert warped.shape[1] == 400


def test_warp_raises_with_fewer_than_four_anchors():
    img = _render_strip()
    _, corners = detect_fiducials(img)
    # Only supply 3 anchors - should raise DetectionError
    burn_anchors = {
        0: (0.0, 0.0),
        1: (40.0, 0.0),
        2: (0.0, 20.0),
    }
    with pytest.raises(DetectionError, match="need >=4"):
        warp_to_burn_space(
            img,
            burn_anchors_mm=burn_anchors,
            corners_px=corners,
            burn_size_mm=(40.0, 20.0),
            px_per_mm=10.0,
        )
