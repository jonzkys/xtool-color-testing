"""Capture service: photo bytes + Test spec → sampled swatches."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from xcs_gen.capture.layout import (
    ARUCO_ID_BOTTOM_LEFT,
    ARUCO_ID_BOTTOM_RIGHT,
    ARUCO_ID_TOP_RIGHT,
    ARUCO_SIZE_DEFAULT_MM,
    MARKER_MARGIN_MM,
    QR_SIZE_DEFAULT_MM,
)

from ..capture_pipeline import (
    DetectionError,
    decode_image_bytes,
    detect_fiducials,
    warp_to_burn_space,
)
from ..capture_sampling import sample_grid
from ..palette import hex_to_lab


class CaptureError(Exception):
    """Raised by run_capture when the image can't be processed."""


@dataclass
class CaptureResult:
    swatches: list[dict[str, Any]]
    warped_image_bgr: np.ndarray


def run_capture(*, image_bytes: bytes, test_id: int,
                spec: dict[str, Any]) -> CaptureResult:
    try:
        img = decode_image_bytes(image_bytes)
    except Exception as e:
        raise CaptureError(f"could not decode image: {e}") from e

    try:
        qr_id, corners_px = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e

    if qr_id != test_id:
        raise CaptureError(
            f"QR on photo is test #{qr_id}; upload is for test #{test_id}",
        )

    reg = spec.get("registration", {}) if isinstance(spec.get("registration"), dict) else {}
    qr_size = reg.get("qr_size_mm") or QR_SIZE_DEFAULT_MM
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    grid_w = spec["width_mm"]
    grid_h = spec["height_mm"]
    margin = MARKER_MARGIN_MM

    # Burn-space anchors (mm) for each marker's reference point.
    # QR: top-left corner. ArUcos: centre.
    qr_tl = (margin, margin)
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )
    burn_w = grid_origin_mm[0] + grid_w + aruco_size + margin
    burn_h = grid_origin_mm[1] + grid_h + aruco_size + margin
    tr_c = (grid_origin_mm[0] + grid_w + margin + aruco_size / 2,
            margin + aruco_size / 2)
    bl_c = (qr_tl[0] + qr_size / 2,
            grid_origin_mm[1] + grid_h + margin + aruco_size / 2)
    br_c = (grid_origin_mm[0] + grid_w + margin + aruco_size / 2,
            grid_origin_mm[1] + grid_h + margin + aruco_size / 2)

    burn_anchors = {
        0: qr_tl,
        ARUCO_ID_TOP_RIGHT: tr_c,
        ARUCO_ID_BOTTOM_LEFT: bl_c,
        ARUCO_ID_BOTTOM_RIGHT: br_c,
    }

    warped = warp_to_burn_space(
        img,
        burn_anchors_mm=burn_anchors,
        corners_px=corners_px,
        burn_size_mm=(burn_w, burn_h),
        px_per_mm=10.0,
    )

    swatches_raw = sample_grid(
        warped,
        grid_origin_mm=grid_origin_mm,
        grid_size_mm=(grid_w, grid_h),
        px_per_mm=10.0,
        x_param=spec["x_param"],
        x_min=spec["x_min"], x_max=spec["x_max"], x_steps=spec["x_steps"],
        y_param=spec.get("y_param"),
        y_min=spec.get("y_min") or 0.0,
        y_max=spec.get("y_max") or 0.0,
        y_steps=spec.get("y_steps") or 1,
        rows=spec.get("rows", 1),
        row_stride_mm=None,
    )
    swatches = [
        {
            "row": s.row,
            "col": s.col,
            "x_value": s.x_value,
            "y_value": s.y_value,
            "hex": s.hex,
            "lab": list(hex_to_lab(s.hex)),
            "sigma": s.sigma,
        }
        for s in swatches_raw
    ]
    return CaptureResult(swatches=swatches, warped_image_bgr=warped)
