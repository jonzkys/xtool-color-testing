"""Photo → canonical burn-space pipeline.

Given an uploaded image, locate the QR code, compute a homography from the
QR's 4 image-space corners to known burn-space coordinates, and warp the
image so every bed-mm maps to a fixed pixel offset.
"""

from __future__ import annotations

import cv2
import numpy as np


class DetectionError(Exception):
    """Raised when the QR code cannot be located in the image."""


def detect_qr(image: np.ndarray) -> tuple[str, np.ndarray]:
    """Find the QR code and return (decoded_text, corners).

    `corners` is a (4, 2) array of pixel coordinates in the order OpenCV
    returns: top-left, top-right, bottom-right, bottom-left.

    Raises DetectionError if no QR is found or decoding fails.
    """
    detector = cv2.QRCodeDetector()
    data, points, _ = detector.detectAndDecode(image)
    if not data or points is None:
        raise DetectionError("no QR code detected")
    # points shape: (1, 4, 2). Normalize to (4, 2).
    corners = points.reshape(4, 2).astype(np.float32)
    return data, corners


def warp_to_burn_space(
    image: np.ndarray,
    *,
    qr_corners_px: np.ndarray,
    qr_size_mm: float,
    qr_origin_mm: tuple[float, float],
    burn_size_mm: tuple[float, float],
    px_per_mm: float = 10.0,
) -> np.ndarray:
    """Warp `image` so the burn area maps to a fixed pixel canvas.

    Args:
        image: source BGR or RGB uint8 image.
        qr_corners_px: 4x2 array of QR corners in source pixel space
            (top-left, top-right, bottom-right, bottom-left).
        qr_size_mm: physical QR edge length in mm.
        qr_origin_mm: (x, y) in burn-space mm of the QR's top-left corner.
        burn_size_mm: (width, height) of the whole burn area in mm.
        px_per_mm: target resolution of the warped image.

    Returns:
        Warped image with shape (burn_h_mm * px_per_mm, burn_w_mm * px_per_mm, 3).
    """
    ox, oy = qr_origin_mm
    src = qr_corners_px
    dst = np.array([
        [(ox) * px_per_mm, (oy) * px_per_mm],
        [(ox + qr_size_mm) * px_per_mm, (oy) * px_per_mm],
        [(ox + qr_size_mm) * px_per_mm, (oy + qr_size_mm) * px_per_mm],
        [(ox) * px_per_mm, (oy + qr_size_mm) * px_per_mm],
    ], dtype=np.float32)

    H, _ = cv2.findHomography(src, dst)
    if H is None:
        raise DetectionError("could not compute homography from QR corners")

    w_mm, h_mm = burn_size_mm
    out_w = int(round(w_mm * px_per_mm))
    out_h = int(round(h_mm * px_per_mm))
    warped = cv2.warpPerspective(image, H, (out_w, out_h))
    return warped
