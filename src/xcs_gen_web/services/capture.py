"""Capture service: photo bytes + Test spec → sampled swatches.

Phase C wires through the existing QR-based capture pipeline. Phase D
replaces the internals with the ArUco + id-only-QR scheme.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from xcs_gen.capture.layout import MARKER_MARGIN_MM, _QR_SIZE_INLINE_MM
from xcs_gen.capture.qr_payload import PayloadError, decode_payload

from ..capture_pipeline import DetectionError, decode_image_bytes, detect_qr, warp_to_burn_space
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
        qr_text, qr_corners = detect_qr(img)
    except DetectionError as e:
        raise CaptureError(f"QR detection failed: {e}") from e

    try:
        payload = decode_payload(qr_text)
    except PayloadError as e:
        raise CaptureError(f"QR payload invalid: {e}") from e

    if str(payload.get("id")) != str(test_id):
        raise CaptureError(
            f"QR is for test {payload.get('id')!r}; upload is for test {test_id}",
        )

    qr_size_mm = float(payload.get("qs", _QR_SIZE_INLINE_MM))
    default_offset = qr_size_mm + MARKER_MARGIN_MM
    grid_w = spec["width_mm"]
    grid_h = spec["height_mm"]
    ox = default_offset
    oy = default_offset
    actual_grid_h = grid_h

    min_x = min(0.0, ox)
    max_x = max(qr_size_mm, ox + grid_w)
    min_y = min(0.0, oy)
    max_y = max(qr_size_mm, oy + actual_grid_h)
    burn_size_mm = (max_x - min_x, max_y - min_y)
    qr_origin_mm = (-min_x, -min_y)
    grid_origin_mm = (ox - min_x, oy - min_y)

    warped = warp_to_burn_space(
        img,
        qr_corners_px=qr_corners,
        qr_size_mm=qr_size_mm,
        qr_origin_mm=qr_origin_mm,
        burn_size_mm=burn_size_mm,
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

    # sample_grid returns Swatch dataclass instances (capture_sampling.Swatch).
    # Swatch has: row, col, x_value, y_value, hex, sigma — no lab field.
    # Derive lab from hex so results_repo.averaged_swatches() can consume it.
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
