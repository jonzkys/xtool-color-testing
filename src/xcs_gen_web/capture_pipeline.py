"""Photo → canonical burn-space pipeline.

Given an uploaded image, locate the QR code (via pyzbar) and ArUco markers
(via opencv-contrib), compute a homography from the detected fiducial points
to known burn-space coordinates, and warp the image so every bed-mm maps to
a fixed pixel offset.

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
    """Raised when fiducials cannot be located in the image."""


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


_ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
_ARUCO_PARAMS = cv2.aruco.DetectorParameters()


def _qr_top_left_px(img: np.ndarray) -> tuple[int, tuple[float, float]]:
    """Return (qr_id, top_left_px). The QR's top-left module anchors the homography."""
    from xcs_gen.capture.qr_payload import PayloadError, decode_payload
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    for sym in _pyzbar_decode(gray, symbols=[ZBarSymbol.QRCODE]):
        try:
            payload = decode_payload(sym.data.decode("utf-8"))
        except (PayloadError, UnicodeDecodeError):
            continue
        pts = sym.polygon
        if len(pts) < 4:
            continue
        tl = min(pts, key=lambda p: p.x + p.y)
        return payload["id"], (float(tl.x), float(tl.y))
    raise DetectionError("no valid id-only QR detected")


def _aruco_centres_px(img: np.ndarray) -> dict[int, tuple[float, float]]:
    """Return {marker_id: centre_px} for every detected ArUco 1/2/3."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    detector = cv2.aruco.ArucoDetector(_ARUCO_DICT, _ARUCO_PARAMS)
    corners, ids, _ = detector.detectMarkers(gray)
    out: dict[int, tuple[float, float]] = {}
    if ids is None:
        return out
    for c_set, id_ in zip(corners, ids.flatten()):
        if int(id_) not in (1, 2, 3):
            continue
        pts = c_set.reshape(-1, 2)
        cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
        out[int(id_)] = (float(cx), float(cy))
    return out


def detect_fiducials(img: np.ndarray) -> tuple[int, dict[int, tuple[float, float]]]:
    """Return (qr_id, {0: QR-top-left, 1/2/3: ArUco centres}) in pixel coords."""
    qr_id, qr_tl = _qr_top_left_px(img)
    arucos = _aruco_centres_px(img)
    missing = [i for i in (1, 2, 3) if i not in arucos]
    if len(missing) > 1:
        raise DetectionError(f"insufficient ArUco markers; missing {missing}")
    corners: dict[int, tuple[float, float]] = {0: qr_tl}
    corners.update(arucos)
    return qr_id, corners


def warp_to_burn_space(
    image: np.ndarray,
    *,
    burn_anchors_mm: dict[int, tuple[float, float]],
    corners_px: dict[int, tuple[float, float]],
    burn_size_mm: tuple[float, float],
    px_per_mm: float = 10.0,
) -> np.ndarray:
    """Compute homography from the shared keys of burn_anchors_mm and corners_px."""
    keys = sorted(set(burn_anchors_mm.keys()) & set(corners_px.keys()))
    if len(keys) < 4:
        raise DetectionError(
            f"need >=4 matching fiducials for homography; have {len(keys)}",
        )
    src = np.array([corners_px[k] for k in keys], dtype=np.float32)
    dst = np.array([
        (burn_anchors_mm[k][0] * px_per_mm, burn_anchors_mm[k][1] * px_per_mm)
        for k in keys
    ], dtype=np.float32)
    H, _ = cv2.findHomography(src, dst, method=cv2.RANSAC)
    if H is None:
        raise DetectionError("homography solve failed")
    w_px = int(burn_size_mm[0] * px_per_mm)
    h_px = int(burn_size_mm[1] * px_per_mm)
    return cv2.warpPerspective(image, H, (w_px, h_px))
