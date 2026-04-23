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


def _qr_polygon_raw(
    img: np.ndarray,
) -> tuple[int, int, np.ndarray]:
    """Return ``(qr_id, retest_index, polygon_px)`` where ``polygon_px``
    is the raw 4-point polygon returned by pyzbar, unlabelled.

    Labelling each polygon vertex as QR_TL / QR_TR / QR_BR / QR_BL
    happens at the caller (``detect_fiducials``) using ArUco-derived
    burn-space orientation — pyzbar's polygon order isn't consistent
    enough to rely on across rotated / skewed phone shots.
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
            return (
                payload["id"],
                int(payload.get("r", 0) or 0),
                arr,
            )
    raise DetectionError("no valid id-only QR detected")


def _label_qr_corners(
    polygon_px: np.ndarray,
    arucos_px: dict[int, tuple[float, float]],
) -> dict[int, tuple[float, float]]:
    """Classify each of the 4 QR polygon vertices into a burn-space
    corner key (``QR_TL`` / ``QR_TR`` / ``QR_BR`` / ``QR_BL``).

    Uses the 3 ArUco centres (IDs 1/2/3 at burn-space TR/BL/BR
    respectively) to derive the burn-space x and y axes in image
    coordinates, then classifies each QR polygon vertex by its
    sign-of-dot-product relative to the polygon's centroid. This is
    robust to arbitrary rotation + skew of the photo.

    When fewer than 3 ArUcos are detected the orientation can't be
    determined reliably; we fall back to the old image-space
    canonicalisation (``min(x+y)`` = TL, etc.), which is only
    correct for roughly-upright photos but is the best we can do
    without the ArUco anchors.
    """
    pts = polygon_px.astype(np.float64)
    if not all(k in arucos_px for k in (1, 2, 3)):
        # Fallback: assume the tag is upright in the image. Wrong for
        # rotated photos, but those can't be rescued without ArUcos.
        s = pts[:, 0] + pts[:, 1]
        d = pts[:, 0] - pts[:, 1]
        return {
            QR_TL: tuple(float(v) for v in pts[int(np.argmin(s))]),
            QR_BR: tuple(float(v) for v in pts[int(np.argmax(s))]),
            QR_TR: tuple(float(v) for v in pts[int(np.argmax(d))]),
            QR_BL: tuple(float(v) for v in pts[int(np.argmin(d))]),
        }

    ar_tr = np.asarray(arucos_px[1], dtype=np.float64)
    ar_bl = np.asarray(arucos_px[2], dtype=np.float64)
    ar_br = np.asarray(arucos_px[3], dtype=np.float64)

    # Burn-space basis vectors projected into image space. In burn
    # coordinates: +x goes from BL → BR, +y goes from TR → BR
    # (top-to-bottom). We keep direction only — magnitude cancels in
    # the sign test.
    bx = ar_br - ar_bl
    by = ar_br - ar_tr
    bx = bx / (np.linalg.norm(bx) + 1e-9)
    by = by / (np.linalg.norm(by) + 1e-9)

    centroid = pts.mean(axis=0)
    quadrant_to_key = {
        (-1, -1): QR_TL,
        (+1, -1): QR_TR,
        (+1, +1): QR_BR,
        (-1, +1): QR_BL,
    }
    result: dict[int, tuple[float, float]] = {}
    for pt in pts:
        rel = pt - centroid
        sign_x = 1 if float(rel @ bx) > 0 else -1
        sign_y = 1 if float(rel @ by) > 0 else -1
        key = quadrant_to_key[(sign_x, sign_y)]
        result[key] = (float(pt[0]), float(pt[1]))

    # Defensive: if two polygon points land in the same quadrant
    # (degenerate case — QR decoded with collinear polygon), we'd be
    # missing a key. Fill any gap with the image-space fallback so
    # callers don't KeyError downstream.
    if len(result) < 4:
        fb = {
            QR_TL: tuple(float(v) for v in pts[int(np.argmin(pts[:, 0] + pts[:, 1]))]),
            QR_BR: tuple(float(v) for v in pts[int(np.argmax(pts[:, 0] + pts[:, 1]))]),
            QR_TR: tuple(float(v) for v in pts[int(np.argmax(pts[:, 0] - pts[:, 1]))]),
            QR_BL: tuple(float(v) for v in pts[int(np.argmin(pts[:, 0] - pts[:, 1]))]),
        }
        for k, v in fb.items():
            result.setdefault(k, v)
    return result


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

    QR corner labelling uses the ArUco markers' known burn-space
    positions (IDs 1/2/3 = TR/BL/BR) to determine image-space
    orientation first, then classifies each QR polygon vertex into the
    right burn-space quadrant. This makes the pipeline robust to
    rotated photos (e.g. phone pictures taken with the tag landscape
    vs portrait). When fewer than 3 ArUcos are detected we fall back
    to assuming the tag is upright in the image — less accurate but
    the old behaviour is preserved as a graceful degradation.
    """
    qr_id, retest_index, qr_polygon = _qr_polygon_raw(img)
    arucos = _aruco_centres_px(img)
    qr_corners = _label_qr_corners(qr_polygon, arucos)
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
