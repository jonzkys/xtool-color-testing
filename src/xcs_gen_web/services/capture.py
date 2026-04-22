"""Capture service: photo bytes + Test spec → sampled swatches."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from xcs_gen.capture.layout import (
    ARUCO_SIZE_DEFAULT_MM,
    MARKER_MARGIN_MM,
    QR_SIZE_DEFAULT_MM,
    compute_layout,
)
from xcs_gen.text import text_height

from ..capture_pipeline import (
    QR_BL, QR_BR, QR_TL, QR_TR,
    DetectionError,
    decode_image_bytes,
    detect_fiducials,
    warp_to_burn_space,
)
from ..capture_sampling import sample_grid
from ..palette import hex_to_lab

# Generator defaults that govern wrapped-grid row placement. Kept in sync
# with generate_gradient's defaults (row_gap=1.0, tick_length=0.5,
# label_font_size=1.2) so the capture math matches what was actually burned.
_ROW_GAP_DEFAULT_MM = 1.0
_LABEL_FONT_SIZE = 1.2
_TICK_LENGTH_MM = 0.5


def _effective_row_gap_mm(hide_axis_labels: bool) -> float:
    """Vertical gap between wrapped rows, matching the generator's math."""
    ann_space = 0.0 if hide_axis_labels else (
        _TICK_LENGTH_MM + 0.05 + text_height(_LABEL_FONT_SIZE) + 0.05
    )
    return max(_ROW_GAP_DEFAULT_MM, ann_space)


class CaptureError(Exception):
    """Raised by run_capture when the image can't be processed."""


def detect_test_id(image_bytes: bytes) -> int:
    """Peek at an uploaded photo and return the test id encoded in its QR,
    without warping or sampling. Used by the auto-match upload route so we
    can route a photo to the right test purely from its registration QR."""
    try:
        img = decode_image_bytes(image_bytes)
    except Exception as e:
        raise CaptureError(f"could not decode image: {e}") from e
    try:
        qr_id, _ = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e
    return qr_id


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
    # spec["height_mm"] is the per-row cell height. For wrapped 1D tests
    # (rows > 1, y_param=None) the generator stacks rows with an
    # inter-row gap, and places bottom registration markers at the true
    # bottom of the stack. Match that geometry so the homography maps
    # detected ArUcos to the correct burn-space coordinates; otherwise
    # the warp compresses the whole physical grid into the top row.
    row_height_mm = spec["height_mm"]
    rows = spec.get("rows", 1) or 1
    is_wrapped_1d = rows > 1 and spec.get("y_param") is None
    row_stride_mm: float | None = None
    if is_wrapped_1d:
        gap = _effective_row_gap_mm(bool(spec.get("hide_axis_labels", False)))
        row_stride_mm = row_height_mm + gap
        grid_h = rows * row_height_mm + (rows - 1) * gap
    else:
        grid_h = row_height_mm
    margin = MARKER_MARGIN_MM

    # Burn-space anchors (mm) for each marker's reference point.
    # QR: top-left corner. ArUcos: centre (top-left + half-size).
    qr_tl = (margin, margin)
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )
    burn_w = grid_origin_mm[0] + grid_w + aruco_size + margin
    burn_h = grid_origin_mm[1] + grid_h + aruco_size + margin

    layout = compute_layout(
        grid_x=grid_origin_mm[0], grid_y=grid_origin_mm[1],
        grid_w=grid_w, grid_h=grid_h,
        mode="on", qr_size_mm=qr_size, aruco_size_mm=aruco_size,
    )
    # QR anchors (4 corners of the QR square, burn-space mm) plus ArUco
    # centres (converted from layout's top-left + half-size offsets).
    burn_anchors = {
        QR_TL: qr_tl,
        QR_BL: (qr_tl[0], qr_tl[1] + qr_size),
        QR_BR: (qr_tl[0] + qr_size, qr_tl[1] + qr_size),
        QR_TR: (qr_tl[0] + qr_size, qr_tl[1]),
    }
    for ar in layout.arucos:
        burn_anchors[ar.marker_id] = (ar.x + ar.size / 2, ar.y + ar.size / 2)

    try:
        warped = warp_to_burn_space(
            img,
            burn_anchors_mm=burn_anchors,
            corners_px=corners_px,
            burn_size_mm=(burn_w, burn_h),
            px_per_mm=10.0,
        )
    except DetectionError as e:
        raise CaptureError(str(e)) from e

    # sample_grid's wrapped branch derives cell height from grid_size_mm[1] /
    # rows, which assumes no inter-row gap. Pass the cells-only height and
    # the explicit stride so the sampler hits each row's cells, not the gaps.
    sample_grid_h = rows * row_height_mm if is_wrapped_1d else grid_h
    swatches_raw = sample_grid(
        warped,
        grid_origin_mm=grid_origin_mm,
        grid_size_mm=(grid_w, sample_grid_h),
        px_per_mm=10.0,
        x_param=spec["x_param"],
        x_min=spec["x_min"], x_max=spec["x_max"], x_steps=spec["x_steps"],
        y_param=spec.get("y_param"),
        y_min=spec.get("y_min") or 0.0,
        y_max=spec.get("y_max") or 0.0,
        y_steps=spec.get("y_steps") or 1,
        rows=rows,
        row_stride_mm=row_stride_mm,
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
