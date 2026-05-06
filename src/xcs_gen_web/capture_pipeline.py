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
import pillow_heif
from PIL import Image, ImageCms, ImageOps


# iPhones save photos as HEIC by default. iOS Safari sometimes
# auto-converts on upload but not always (depends on iOS version and
# the page's accept attribute) — bytes do reach the server. Register
# the HEIF/HEIC decoder once at module load so PIL's ``Image.open``
# in ``decode_image_bytes`` accepts them transparently. The library
# ships self-contained manylinux wheels with libheif statically
# linked, so no system-level apt change.
pillow_heif.register_heif_opener()


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

    Also honours the EXIF Orientation tag — HEIC files from iPhones
    store pixels in raw sensor orientation and rely on the tag to tell
    viewers how to rotate. Without ``exif_transpose`` the image arrives
    sideways and ArUco/QR detection fails on photos that should be
    perfectly readable.
    """
    pil_img = Image.open(io.BytesIO(raw))
    pil_img = ImageOps.exif_transpose(pil_img)
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
    zbar/ArUco's built-in thresholding. Variants 2–4 are increasingly
    aggressive recovery techniques: Otsu rescues most mid-tone shots;
    CLAHE normalises uneven lighting (the most common failure mode on
    round-disc photos where one edge gets less flash); adaptive
    threshold catches photos where Otsu picks a bad global split
    because of a bright background highlight.
    """
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    # blockSize=51 is smaller than one ArUco cell at full phone-resolution
    # (~67 px/cell at 80 px/mm); we rely on OpenCV's internal pyramid
    # scaling in detectMarkers to make the local-mean meaningful.
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY,
        blockSize=51, C=10,
    )
    return [gray, otsu, clahe, adaptive]


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


def _unrotate_point(
    xr: float, yr: float, *, orig_w: int, orig_h: int, k: int,
) -> tuple[float, float]:
    """Map a point detected in ``np.rot90(orig, k)`` back to the
    original frame's ``(x, y)`` pixel coordinates. ``orig_w`` /
    ``orig_h`` are the original image's width and height."""
    if k == 0:
        return xr, yr
    if k == 1:  # 90° CCW
        return orig_w - 1 - yr, xr
    if k == 2:  # 180°
        return orig_w - 1 - xr, orig_h - 1 - yr
    if k == 3:  # 270° CCW (= 90° CW)
        return yr, orig_h - 1 - xr
    raise ValueError(f"unexpected rotation k={k}")


def _aruco_centres_px(img: np.ndarray) -> dict[int, tuple[float, float]]:
    """Return ``{marker_id: centre_px}`` for every detected ArUco 1/2/3.

    OpenCV's ArUco detector is *technically* rotation-invariant, but
    on real phone photos where one of the markers is near a frame
    edge, detection can succeed at one in-plane rotation and silently
    fail at others. After exhausting the four preprocessing variants
    in the natural orientation, fall back to detecting on 90°/180°/
    270° rotated copies and unrotate the centres back. Pure recovery
    path — fast when the natural orientation already finds all three.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    detector = cv2.aruco.ArucoDetector(_ARUCO_DICT, _ARUCO_PARAMS)
    out: dict[int, tuple[float, float]] = {}

    def _scan(rotated_gray: np.ndarray, k: int) -> None:
        for candidate in _preprocessing_variants(rotated_gray):
            corners, ids, _ = detector.detectMarkers(candidate)
            if ids is None:
                continue
            for c_set, id_ in zip(corners, ids.flatten()):
                key = int(id_)
                if key not in (1, 2, 3) or key in out:
                    continue
                pts = c_set.reshape(-1, 2)
                cx_r, cy_r = float(pts[:, 0].mean()), float(pts[:, 1].mean())
                cx, cy = _unrotate_point(
                    cx_r, cy_r, orig_w=w, orig_h=h, k=k,
                )
                out[key] = (cx, cy)
            if len(out) == 3:
                return

    # Try the natural orientation first — covers the common case
    # without paying the cost of three extra detection passes.
    _scan(gray, 0)
    if len(out) == 3:
        return out
    for k in (1, 2, 3):
        _scan(np.rot90(gray, k), k)
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


from .wb_correction import correct_warped_frame, CorrectionOutcome  # noqa: E402


def apply_wb_correction_to_warped(
    frame_bgr: np.ndarray,
    *,
    strip_anchors: list[tuple[
        tuple[float, float, float], tuple[float, float, float]
    ]] | None,
    unburned_rgb: tuple[float, float, float] | None,
    canonical_id: str | None,
    enabled: bool = True,
) -> CorrectionOutcome:
    """Pipeline-facing wrapper around ``wb_correction.correct_warped_frame``.

    When ``enabled`` is False, returns a CorrectionOutcome with
    ``mode="disabled"`` and the frame untouched. Otherwise delegates."""
    if not enabled:
        return CorrectionOutcome(
            frame=frame_bgr.copy(),
            mode="disabled",
            applied=False,
            measured_rgbs=None,
            fit=None,
            fit_kind=None,
            canonical_id=canonical_id,
        )
    return correct_warped_frame(
        frame_bgr,
        strip_anchors=strip_anchors,
        unburned_rgb=unburned_rgb,
        canonical_id=canonical_id,
    )


def reingest_with_wb(result_id: int) -> None:
    """Re-runs WB correction on an existing result.

    Reads ``warped_image_path``, applies correction with the latest
    settings, persists the new ``wb_*`` columns. Cell re-sampling
    happens via the existing repo update path (out of scope for v1
    of this helper — chromaticity-only fallback is exercised here).

    Raises:
        FileNotFoundError: when warped_image_path is not on disk.
    """
    from .repositories import results as r_repo

    result = r_repo.get(result_id)
    if result is None:
        raise KeyError(result_id)
    warped_path = result.get("warped_image_path")
    if warped_path is None:
        raise FileNotFoundError(
            f"result {result_id} has no warped_image_path; "
            "re-shoot the original photo to recompute"
        )
    img = cv2.imread(warped_path)
    if img is None:
        raise FileNotFoundError(f"can't read warped image at {warped_path}")
    outcome = apply_wb_correction_to_warped(
        img,
        strip_anchors=None,
        unburned_rgb=None,
        canonical_id=None,
    )
    r_repo.update_wb_state(
        result_id,
        mode=outcome.mode,
        anchor_rgb=outcome.measured_rgbs,
        correction=outcome.fit,
        canonical_id=outcome.canonical_id,
    )
