"""Photo → canonical burn-space pipeline.

Given an uploaded image, locate the QR code (via pyzbar), compute a
homography from the QR's 4 image-space corners to known burn-space
coordinates, and warp the image so every bed-mm maps to a fixed pixel
offset.

pyzbar wraps the ZBar C library, which is substantially more robust on
real-world burned-substrate photos than cv2.QRCodeDetector. zbar is
installed as a system dep (``brew install zbar`` or ``apt install
libzbar0``); pyzbar is a Python dep of this package.

macOS quirk: Homebrew installs libzbar into /opt/homebrew/lib which is
not on ctypes.util.find_library's default search path. We shim the
lookup at import time so pyzbar can locate it without requiring the user
to set DYLD_LIBRARY_PATH.
"""

from __future__ import annotations

import ctypes.util
import io
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageCms


def _register_homebrew_zbar() -> None:
    """On macOS, ensure pyzbar can find libzbar installed via Homebrew."""
    if sys.platform != "darwin":
        return
    for candidate in ("/opt/homebrew/lib/libzbar.dylib", "/usr/local/lib/libzbar.dylib"):
        if os.path.exists(candidate):
            _orig = ctypes.util.find_library

            def _patched(name: str, _orig=_orig, _path=candidate):
                if name == "zbar":
                    return _path
                return _orig(name)

            ctypes.util.find_library = _patched
            return


_register_homebrew_zbar()

from pyzbar.pyzbar import ZBarSymbol, decode as _pyzbar_decode  # noqa: E402


class DetectionError(Exception):
    """Raised when the QR code cannot be located in the image."""


def decode_image_bytes(raw: bytes) -> np.ndarray:
    """Decode uploaded image bytes to a BGR uint8 array, applying any
    embedded ICC profile so the pixel values are in sRGB.

    iPhone JPEGs ship a Display P3 ICC profile. cv2.imdecode ignores ICC
    entirely and reads raw pixels as if they were already sRGB, which
    leaves colours ~10-15% less saturated than they actually are. Going
    through PIL lets us apply the profile and hand OpenCV true sRGB.
    """
    pil_img = Image.open(io.BytesIO(raw))
    icc = pil_img.info.get("icc_profile")
    if icc:
        src_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        dst_profile = ImageCms.createProfile("sRGB")
        transform = ImageCms.buildTransformFromOpenProfiles(
            src_profile, dst_profile, "RGB", "RGB"
        )
        pil_img = ImageCms.applyTransform(pil_img.convert("RGB"), transform)
    else:
        pil_img = pil_img.convert("RGB")
    rgb = np.array(pil_img)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def detect_qr(image: np.ndarray) -> tuple[str, np.ndarray]:
    """Find the QR code and return (decoded_text, corners).

    Corners are a (4, 2) array in TL, TR, BR, BL order (matching what
    warp_to_burn_space expects). If multiple QRs are present, returns
    the first decoded.

    Raises DetectionError if no QR is found or decoding fails.
    """
    results = _pyzbar_decode(image, symbols=[ZBarSymbol.QRCODE])
    if not results:
        raise DetectionError("no QR code detected")

    r = results[0]
    try:
        data = r.data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise DetectionError(f"QR payload is not valid UTF-8: {e}")

    pts = np.array([(p.x, p.y) for p in r.polygon], dtype=np.float32)
    if pts.shape != (4, 2):
        raise DetectionError(
            f"expected 4 polygon corners from pyzbar, got {pts.shape[0]}"
        )

    # Reorder arbitrary polygon corners to canonical TL, TR, BR, BL:
    #   TL = smallest x+y, BR = largest x+y
    #   TR = smallest (y-x), BL = largest (y-x)
    s = pts.sum(axis=1)
    d = pts[:, 1] - pts[:, 0]
    corners = np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )
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
