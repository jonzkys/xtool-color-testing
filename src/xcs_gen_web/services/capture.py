"""Capture service: photo bytes + Test spec → sampled swatches."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from xcs_gen.capture.layout import (
    ARUCO_ID_BOTTOM_LEFT,
    ARUCO_ID_BOTTOM_RIGHT,
    ARUCO_ID_TOP_RIGHT,
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

# IDs of the three ArUco fiducials the layout places around the burn area.
# Kept as a frozenset so missing-marker computation can be a pure set op.
_EXPECTED_ARUCOS = frozenset(
    {ARUCO_ID_TOP_RIGHT, ARUCO_ID_BOTTOM_LEFT, ARUCO_ID_BOTTOM_RIGHT}
)

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


def detect_test_id(image_bytes: bytes) -> tuple[int, int]:
    """Peek at an uploaded photo and return ``(test_id, retest_index)``
    encoded in its QR, without warping or sampling. Used by the
    auto-match upload route so we can route a photo to the right test
    + retest purely from its registration QR."""
    try:
        img = decode_image_bytes(image_bytes)
    except Exception as e:
        raise CaptureError(f"could not decode image: {e}") from e
    try:
        qr_id, retest_index, _ = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e
    return qr_id, retest_index


@dataclass
class CaptureResult:
    swatches: list[dict[str, Any]]
    warped_image_bgr: np.ndarray
    # Retest index decoded from the QR. Pre-retest-era burns → 0.
    retest_index: int = 0
    # ArUco IDs (subset of {1, 2, 3}) that detect_fiducials did not find
    # in the photo. The homography is still solvable with ≥4 anchors,
    # but a missing ArUco means that quadrant of the burn-space is
    # extrapolated rather than constrained — sample colours near the
    # corresponding corner are unreliable.
    missing_markers: list[int] = field(default_factory=list)


def run_capture(*, image_bytes: bytes, test_id: int,
                spec: dict[str, Any]) -> CaptureResult:
    try:
        img = decode_image_bytes(image_bytes)
    except Exception as e:
        raise CaptureError(f"could not decode image: {e}") from e

    try:
        qr_id, retest_index, corners_px = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e

    missing_markers = sorted(_EXPECTED_ARUCOS - set(corners_px.keys()))

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
        cell_shape=spec.get("cell_shape", "rect"),
        aggregator=spec.get("sample_aggregator") or "saturation_median",
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
    return CaptureResult(
        swatches=swatches,
        warped_image_bgr=warped,
        retest_index=retest_index,
        missing_markers=missing_markers,
    )


def aggregate_warped(
    warped: np.ndarray,
    spec: dict[str, Any],
    aggregator: str,
) -> list[dict[str, Any]]:
    """Re-run only the aggregation step over an already-warped image.

    Used by the preview endpoint to swap aggregators without re-running
    fiducial detection or the homography. The returned swatches have
    the same shape as ``CaptureResult.swatches`` so the API can return
    them unchanged.
    """
    from xcs_gen_web.capture_sampling import sample_grid
    from xcs_gen.sampling_aggregators import LEGAL_AGGREGATORS

    if aggregator not in LEGAL_AGGREGATORS:
        raise CaptureError(
            f"unknown aggregator: {aggregator!r}; "
            f"legal values: {LEGAL_AGGREGATORS}"
        )

    # Recompute the burn-space layout from the spec — same math as
    # run_capture. Lifted into a small helper so we don't duplicate it.
    from xcs_gen.capture.layout import (
        ARUCO_SIZE_DEFAULT_MM, MARKER_MARGIN_MM, QR_SIZE_DEFAULT_MM,
    )
    from ..palette import hex_to_lab

    reg = spec.get("registration", {}) if isinstance(spec.get("registration"), dict) else {}
    qr_size = reg.get("qr_size_mm") or QR_SIZE_DEFAULT_MM
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    grid_w = spec["width_mm"]
    row_height_mm = spec["height_mm"]
    rows = spec.get("rows", 1) or 1
    is_wrapped_1d = rows > 1 and spec.get("y_param") is None
    if is_wrapped_1d:
        gap = _effective_row_gap_mm(bool(spec.get("hide_axis_labels", False)))
        row_stride_mm = row_height_mm + gap
        grid_h = rows * row_height_mm + (rows - 1) * gap
    else:
        row_stride_mm = None
        grid_h = row_height_mm
    margin = MARKER_MARGIN_MM
    qr_tl = (margin, margin)
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )
    sample_grid_h = rows * row_height_mm if is_wrapped_1d else grid_h

    swatches_raw = sample_grid(
        warped, grid_origin_mm=grid_origin_mm,
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
        cell_shape=spec.get("cell_shape", "rect"),
        aggregator=aggregator,
    )
    return [
        {
            "row": s.row, "col": s.col,
            "x_value": s.x_value, "y_value": s.y_value,
            "hex": s.hex,
            "lab": list(hex_to_lab(s.hex)),
            "sigma": s.sigma,
        }
        for s in swatches_raw
    ]


def inspect_cell(
    warped: np.ndarray,
    spec: dict[str, Any],
    row: int,
    col: int,
) -> dict[str, Any]:
    """Extract a single cell crop from a warped image and run all five
    aggregators on the masked sample region. Returns:

    - ``cell_image_b64``: PNG-encoded base64 string of the cell's
      bounding-rect crop (~ 60% of cell pitch each side, larger so the
      modal can show a comfortable view).
    - ``sampling_region``: dict describing the mask (``shape``,
      ``radius_px`` for circle / ``half_w_px``/``half_h_px`` for rect,
      ``center_px`` relative to the cell crop).
    - ``aggregator_results``: dict mapping each aggregator name to the
      hex it produces on this cell.
    """
    import base64
    import math
    import cv2
    from xcs_gen.sampling_aggregators import LEGAL_AGGREGATORS, aggregate

    px_per_mm = 10.0
    cell_shape = spec.get("cell_shape", "rect")
    grid_w = spec["width_mm"]
    row_height_mm = spec["height_mm"]
    rows_total = spec.get("rows", 1) or 1
    is_wrapped_1d = rows_total > 1 and spec.get("y_param") is None
    if is_wrapped_1d:
        gap = _effective_row_gap_mm(bool(spec.get("hide_axis_labels", False)))
        row_stride_mm = row_height_mm + gap
        grid_h = rows_total * row_height_mm + (rows_total - 1) * gap
    else:
        row_stride_mm = row_height_mm
        grid_h = row_height_mm

    # Burn-space layout (mirrors run_capture).
    from xcs_gen.capture.layout import (
        ARUCO_SIZE_DEFAULT_MM, MARKER_MARGIN_MM, QR_SIZE_DEFAULT_MM,
    )
    reg = spec.get("registration", {}) if isinstance(spec.get("registration"), dict) else {}
    qr_size = reg.get("qr_size_mm") or QR_SIZE_DEFAULT_MM
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    margin = MARKER_MARGIN_MM
    qr_tl = (margin, margin)
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )

    x_steps = spec["x_steps"]
    y_steps = spec.get("y_steps") if spec.get("y_param") is not None else 1
    if not (0 <= row < (y_steps or 1)) or not (0 <= col < x_steps):
        raise CaptureError(
            f"cell ({row}, {col}) out of bounds for grid "
            f"y_steps={y_steps} x_steps={x_steps}",
        )

    # Cell centre in burn-space mm.
    cell_w_mm = grid_w / x_steps
    if spec.get("y_param") is None and rows_total > 1:
        # Wrapped 1D path
        per_row = math.ceil(x_steps / rows_total)
        cx_mm = grid_origin_mm[0] + (col + 0.5) * (grid_w / per_row)
        cy_mm = grid_origin_mm[1] + row * row_stride_mm + row_height_mm / 2
        cell_h_mm = row_height_mm
    else:
        cell_h_mm = grid_h / (y_steps or 1)
        cx_mm = grid_origin_mm[0] + (col + 0.5) * cell_w_mm
        cy_mm = grid_origin_mm[1] + (row + 0.5) * cell_h_mm

    cell_w_px = cell_w_mm * px_per_mm
    cell_h_px = cell_h_mm * px_per_mm
    cx_px, cy_px = int(round(cx_mm * px_per_mm)), int(round(cy_mm * px_per_mm))

    # Bounding rect for the cell crop (use 100% of cell pitch so the
    # crop shows the cell with a small substrate border for context).
    half_w = int(round(cell_w_px / 2))
    half_h = int(round(cell_h_px / 2))
    rx0 = max(0, cx_px - half_w)
    ry0 = max(0, cy_px - half_h)
    rx1 = min(warped.shape[1], cx_px + half_w)
    ry1 = min(warped.shape[0], cy_px + half_h)
    crop = warped[ry0:ry1, rx0:rx1]
    if crop.size == 0:
        raise CaptureError(f"cell ({row}, {col}) is empty after cropping")

    # Sample-region pixels (the same mask used by _sample_cell).
    half_sample_w = cell_w_px * 0.6 / 2
    half_sample_h = cell_h_px * 0.6 / 2
    sx0 = max(0, int(round(cx_px - half_sample_w)))
    sy0 = max(0, int(round(cy_px - half_sample_h)))
    sx1 = min(warped.shape[1], int(round(cx_px + half_sample_w)))
    sy1 = min(warped.shape[0], int(round(cy_px + half_sample_h)))
    sample_box = warped[sy0:sy1, sx0:sx1]
    if cell_shape == "circle":
        radius_px = min(cell_w_px, cell_h_px) * 0.5 / 2
        h_, w_ = sample_box.shape[:2]
        yy, xx = np.ogrid[:h_, :w_]
        cy_local = (cy_px - sy0)
        cx_local = (cx_px - sx0)
        inside = (xx - cx_local) ** 2 + (yy - cy_local) ** 2 <= radius_px ** 2
        masked = sample_box[inside]
        sampling_region = {
            "shape": "circle",
            "radius_px": float(radius_px),
            "center_px": [int(cx_px - rx0), int(cy_px - ry0)],
        }
    else:
        masked = sample_box.reshape(-1, 3)
        sampling_region = {
            "shape": "rect",
            "half_w_px": float(half_sample_w),
            "half_h_px": float(half_sample_h),
            "center_px": [int(cx_px - rx0), int(cy_px - ry0)],
        }

    # Run all aggregators.
    results: dict[str, str] = {}
    for name in LEGAL_AGGREGATORS:
        b, g, r = aggregate(name, masked) if masked.size > 0 else (0, 0, 0)
        results[name] = f"#{r:02x}{g:02x}{b:02x}"

    # Encode the crop as PNG base64.
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        raise CaptureError("failed to encode cell crop")
    cell_image_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    # Sigma over the full 60% bounding rect — matches _sample_cell's
    # semantics so InspectCellResponse.sigma equals ResultSwatch.sigma
    # for the same cell.
    bbox_pixels = sample_box.reshape(-1, 3)
    if bbox_pixels.size == 0:
        sigma = 0.0
    else:
        from xcs_gen_web.capture_sampling import _bgr_to_lab
        lab = _bgr_to_lab(bbox_pixels)
        sigma = float(np.sqrt(np.sum(np.var(lab, axis=0))))

    # Compute x_value / y_value for the inspector header.
    from xcs_gen_web.capture_sampling import _linspace, _round_param
    x_val = _round_param(spec["x_param"], _linspace(spec["x_min"], spec["x_max"], x_steps)[col])
    y_val: float | None
    if spec.get("y_param") is not None and y_steps:
        y_val = _round_param(spec["y_param"], _linspace(spec.get("y_min", 0.0), spec.get("y_max", 0.0), y_steps)[row])
    else:
        y_val = None

    return {
        "row": row, "col": col,
        "x_value": x_val, "y_value": y_val,
        "sigma": sigma,
        "cell_image_b64": cell_image_b64,
        "sampling_region": sampling_region,
        "aggregator_results": results,
    }
