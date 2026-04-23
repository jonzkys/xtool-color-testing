from __future__ import annotations

import cv2
import numpy as np
import segno

from xcs_gen.capture.marker_render import render_aruco_bits
from xcs_gen.capture.qr_payload import encode_id
from xcs_gen_web.capture_pipeline import detect_fiducials


def _render_strip(px_per_mm: int = 20) -> tuple[np.ndarray, dict]:
    # 50x30 mm strip; QR (5mm) at (1,1); ArUcos (2mm) at TR/BL/BR
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

    # QR (segno)
    qr = segno.make(encode_id(42), error="m")
    qr_bits = np.array(qr.matrix, dtype=bool)
    paste_bits(qr_bits, 1, 1, 5)

    # ArUcos
    paste_bits(render_aruco_bits(1), W_mm - 1 - 2, 1,         2)
    paste_bits(render_aruco_bits(2), 1,           H_mm - 1 - 2, 2)
    paste_bits(render_aruco_bits(3), W_mm - 1 - 2, H_mm - 1 - 2, 2)

    expected = {
        "qr_id": 42,
        "qr_mm": (1, 1, 5),
        "aruco_mm": {
            1: (W_mm - 1 - 2, 1,         2),
            2: (1,           H_mm - 1 - 2, 2),
            3: (W_mm - 1 - 2, H_mm - 1 - 2, 2),
        },
    }
    return img, expected


def test_detect_finds_qr_and_three_arucos():
    img, _ = _render_strip()
    qr_id, retest_index, corners = detect_fiducials(img)
    assert qr_id == 42
    assert retest_index == 0
    # 4 QR polygon corners (keys 0/4/5/6) + 3 ArUco centres (1/2/3).
    assert set(corners.keys()) == {0, 1, 2, 3, 4, 5, 6}
    for k in corners:
        assert len(corners[k]) == 2


def test_detect_succeeds_with_zero_arucos(monkeypatch):
    """QR alone gives 4 anchors — homography is still well-determined.

    Uses a real strip image but monkey-patches the ArUco detector to simulate
    a scenario where the markers were unreadable (e.g., out of frame, occluded).
    """
    from xcs_gen_web import capture_pipeline
    img, _ = _render_strip()
    monkeypatch.setattr(capture_pipeline, "_aruco_centres_px", lambda _: {})
    qr_id, _retest_idx, corners = capture_pipeline.detect_fiducials(img)
    assert qr_id == 42
    assert set(corners.keys()) == {0, 4, 5, 6}
