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
    decode_image_bytes,
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


def test_detect_fiducials_returns_id_retest_and_four_corners():
    img = _render_strip()
    qr_id, retest_index, corners = detect_fiducials(img)
    assert qr_id == 7
    assert retest_index == 0  # strip was rendered with no retest index
    # 4 QR polygon corners (0/4/5/6) + 3 ArUco centres (1/2/3).
    assert set(corners.keys()) == {0, 1, 2, 3, 4, 5, 6}
    for k in corners:
        assert len(corners[k]) == 2


def test_detect_fiducials_raises_when_no_qr():
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    with pytest.raises(DetectionError):
        detect_fiducials(img)


def test_warp_produces_expected_canvas_size():
    img = _render_strip()
    _, _, corners = detect_fiducials(img)
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
    _, _, corners = detect_fiducials(img)
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


def test_preprocessing_variants_returns_five_variants():
    """We need five detection variants — raw gray, Otsu(blurred), CLAHE,
    adaptive-threshold mean-C, and a contrast-stretched-inverted pass
    for low-contrast stainless engravings — so the QR/ArUco loops have
    multiple chances to recover phone photos with uneven lighting,
    glare, or near-substrate contrast. A regression to fewer variants
    degrades detection."""
    import numpy as np
    from xcs_gen_web.capture_pipeline import _preprocessing_variants

    gray = np.full((200, 200), 128, dtype=np.uint8)
    variants = _preprocessing_variants(gray)
    assert len(variants) == 5, f"expected 5 variants, got {len(variants)}"
    for v in variants:
        assert v.shape == gray.shape
        assert v.dtype == np.uint8


def test_decode_image_bytes_accepts_heic():
    """iPhones default to HEIC. ``pillow_heif.register_heif_opener`` is
    called at module load, so PIL's ``Image.open`` accepts HEIC bytes
    without a separate code path. Round-trip a small RGB → HEIC →
    decode and assert the colour comes back. Encoded as HEIF (no
    encoder licence needed for the test) — the format is the same
    family Pillow's opener handles."""
    import io
    from PIL import Image
    import pillow_heif

    src = Image.new("RGB", (16, 16), (200, 100, 50))
    buf = io.BytesIO()
    pillow_heif.from_pillow(src).save(buf, format="HEIF")

    arr = decode_image_bytes(buf.getvalue())
    assert arr.shape == (16, 16, 3)
    assert arr.dtype == np.uint8
    # decode_image_bytes returns BGR; the source is RGB(200, 100, 50).
    bgr = arr[8, 8]
    assert tuple(int(x) for x in bgr) == (50, 100, 200)


def test_unrotate_point_round_trips_through_all_rotations():
    """``_unrotate_point`` must invert ``np.rot90(arr, k)``: a marker
    detected in the rotated image at ``(xr, yr)`` should map back to
    the same pixel in the original. Verify by picking a unique pixel
    in a small image, rotating, locating the marker post-rotation,
    and checking the inverse equals the source coordinates."""
    from xcs_gen_web.capture_pipeline import _unrotate_point

    # Build an 8×5 image (w=8, h=5) with a unique non-zero at (3, 2).
    h, w = 5, 8
    arr = np.zeros((h, w), dtype=np.uint8)
    src_x, src_y = 3, 2
    arr[src_y, src_x] = 255

    for k in (0, 1, 2, 3):
        rotated = np.rot90(arr, k)
        # Locate the marker in the rotated frame.
        ys, xs = np.where(rotated == 255)
        assert len(xs) == 1, f"k={k}: marker missing after rotation"
        xr, yr = float(xs[0]), float(ys[0])
        x_back, y_back = _unrotate_point(xr, yr, orig_w=w, orig_h=h, k=k)
        assert (round(x_back), round(y_back)) == (src_x, src_y), (
            f"k={k}: rotated marker at ({xr},{yr}) → unmapped "
            f"({x_back},{y_back}), expected ({src_x},{src_y})"
        )


def test_decode_image_bytes_honours_exif_orientation():
    """iPhone HEIC/JPEGs store pixels in raw sensor orientation and
    rely on the EXIF Orientation tag to tell viewers how to rotate.
    Without ``ImageOps.exif_transpose`` an upright phone photo
    arrives sideways and ArUco detection finds nothing. Construct
    a 4×8 image where the top-left pixel is unique, then encode it
    with Orientation=6 (rotate 90° CW). Decode and verify the
    image came out 8×4 with the unique pixel in the top-right
    (where rotation places it)."""
    import io
    import struct
    from PIL import Image

    # 32×64 raster with a wide top stripe of red so JPEG compression
    # can't smear the marker away. Paint the top 4 rows red; everything
    # else neutral. After Orientation=6 (rotate 90° CW for display)
    # the red stripe ends up on the *right* of an 64×32 image.
    src = Image.new("RGB", (32, 64), (220, 220, 220))
    for y in range(4):
        for x in range(32):
            src.putpixel((x, y), (255, 0, 0))

    exif = src.getexif()
    exif[0x0112] = 6  # Orientation = 6 (rotate 90° CW on display)
    buf = io.BytesIO()
    src.save(buf, format="JPEG", exif=exif.tobytes(), quality=92)

    arr = decode_image_bytes(buf.getvalue())
    # Storage 32×64 rotates to display 64×32; numpy shape is (h, w, c).
    assert arr.shape == (32, 64, 3), f"expected (32, 64, 3), got {arr.shape}"
    # Sample the centre of the right stripe — should be clearly red
    # even with JPEG compression. decode_image_bytes returns BGR.
    bgr = arr[16, 62]
    assert int(bgr[2]) > 200, f"expected dominant red, got BGR {tuple(int(x) for x in bgr)}"
    assert int(bgr[0]) < 80 and int(bgr[1]) < 80, (
        f"expected non-red channels low, got BGR {tuple(int(x) for x in bgr)}"
    )
