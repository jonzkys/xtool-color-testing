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

# Fiducial keys used in corners_px / burn_anchors_mm. ArUco IDs 1/2/3
# occupy the TR/BL/BR burn-space corners; the QR contributes four
# polygon corners (TL is key 0 so older call sites keep working).
QR_TL, QR_BL, QR_BR, QR_TR = 0, 4, 5, 6


def _preprocessing_variants(gray: np.ndarray) -> list[np.ndarray]:
    """Return candidate images for fiducial detection.

    Phone photos of laser burns on stainless usually aren't pure B&W —
    burns are mid-tone gray on a bright substrate. Raw gray confuses
    zbar/ArUco's built-in thresholding. Running the detectors on a
    blurred-and-Otsu'd version rescues most shots; we keep the raw
    image too so crisp burns don't get hurt by the blur.
    """
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return [gray, otsu]


def _qr_corners_px(
    img: np.ndarray,
) -> tuple[int, int, dict[int, tuple[float, float]]]:
    """Return ``(qr_id, retest_index, {QR_TL/BL/BR/TR: (x, y) in pixels})``.

    Each QR contributes four anchor points rather than just one, so a
    homography can be solved even when some ArUco corners are missed.
    pyzbar's polygon order is inconsistent across photos (it depends on
    which finder-pattern side the decoder landed on), so we canonicalise
    the four polygon vertices by image-space position — TL=min(x+y),
    BR=max(x+y), TR=max(x-y), BL=min(x-y). This assumes the QR is
    roughly upright in the image, which is the normal case for hand-held
    phone shots of a flat burn.

    ``retest_index`` is 0 for pre-retest-era QRs (``decode_payload``
    supplies the default).
    """
    from xcs_gen.capture.qr_payload import PayloadError, decode_payload
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    for candidate in _preprocessing_variants(gray):
        for sym in _pyzbar_decode(candidate, symbols=[ZBarSymbol.QRCODE]):
            try:
                payload = decode_payload(sym.data.decode("utf-8"))
            except (PayloadError, UnicodeDecodeError):
                continue
            if len(sym.polygon) < 4:
                continue
            arr = np.array([[p.x, p.y] for p in sym.polygon[:4]], dtype=np.float32)
            s = arr[:, 0] + arr[:, 1]
            d = arr[:, 0] - arr[:, 1]
            tl = tuple(float(x) for x in arr[int(np.argmin(s))])
            br = tuple(float(x) for x in arr[int(np.argmax(s))])
            tr = tuple(float(x) for x in arr[int(np.argmax(d))])
            bl = tuple(float(x) for x in arr[int(np.argmin(d))])
            return (
                payload["id"],
                int(payload.get("r", 0) or 0),
                {QR_TL: tl, QR_BL: bl, QR_BR: br, QR_TR: tr},
            )
    raise DetectionError("no valid id-only QR detected")


def _aruco_centres_px(img: np.ndarray) -> dict[int, tuple[float, float]]:
    """Return {marker_id: centre_px} for every detected ArUco 1/2/3."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    detector = cv2.aruco.ArucoDetector(_ARUCO_DICT, _ARUCO_PARAMS)
    out: dict[int, tuple[float, float]] = {}
    for candidate in _preprocessing_variants(gray):
        corners, ids, _ = detector.detectMarkers(candidate)
        if ids is None:
            continue
        for c_set, id_ in zip(corners, ids.flatten()):
            key = int(id_)
            if key not in (1, 2, 3) or key in out:
                continue
            pts = c_set.reshape(-1, 2)
            cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
            out[key] = (float(cx), float(cy))
        if len(out) == 3:
            break
    return out


def detect_fiducials(
    img: np.ndarray,
) -> tuple[int, int, dict[int, tuple[float, float]]]:
    """Return ``(qr_id, retest_index, fiducials)`` where ``fiducials``
    maps marker keys to pixel centres.

    Keys: 0/4/5/6 → QR TL/BL/BR/TR, 1/2/3 → ArUco TR/BL/BR centres. The
    four QR corners alone give a well-determined homography, so a
    partial ArUco detection (at least one of three) is still usable.
    ``retest_index`` is 0 for burns predating the retest feature.
    """
    qr_id, retest_index, qr_corners = _qr_corners_px(img)
    arucos = _aruco_centres_px(img)
    # Accept any non-empty ArUco detection. Together with the 4 QR corners
    # that gives us at least 5 matches for the homography.
    corners: dict[int, tuple[float, float]] = dict(qr_corners)
    corners.update(arucos)
    return qr_id, retest_index, corners


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
