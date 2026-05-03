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

    # Determine the actual grid layout the swatches use, then bounds-check
    # the requested (row, col) against IT — not against the raw x/y_steps.
    # Wrapped 1D layouts (rows>1, y_param=None) split x_steps across
    # `per_row` cells per physical row; the swatch grid's row index goes
    # 0..rows_total-1 and col index 0..per_row-1. Sticking with the raw
    # y_steps=1 here was the bug — it rejected any non-row-0 click.
    #
    # ``flat_idx`` is the position of this cell within ``x_values`` —
    # for wrapped 1D it's row*per_row + col (matching the storage in
    # capture_sampling.py); for sweep / 2D it's just col since each row
    # spans the full x range.
    if spec.get("y_param") is None and rows_total > 1:
        per_row = math.ceil(x_steps / rows_total)
        max_row, max_col = rows_total, per_row
        cell_w_mm = grid_w / per_row
        cell_h_mm = row_height_mm
        cx_mm = grid_origin_mm[0] + (col + 0.5) * cell_w_mm
        cy_mm = grid_origin_mm[1] + row * row_stride_mm + row_height_mm / 2
        flat_idx = row * per_row + col
    else:
        max_row, max_col = (y_steps or 1), x_steps
        cell_w_mm = grid_w / x_steps
        cell_h_mm = grid_h / (y_steps or 1)
        cx_mm = grid_origin_mm[0] + (col + 0.5) * cell_w_mm
        cy_mm = grid_origin_mm[1] + (row + 0.5) * cell_h_mm
        flat_idx = col

    if not (0 <= row < max_row) or not (0 <= col < max_col):
        raise CaptureError(
            f"cell ({row}, {col}) out of bounds for grid "
            f"max_row={max_row} max_col={max_col}",
        )

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

    # Sample-region pixels (the same mask used by _sample_cell — import
    # the constant so this stays in sync if the fraction is retuned).
    from xcs_gen_web.capture_sampling import _CENTRAL_REGION_FRACTION
    half_sample_w = cell_w_px * _CENTRAL_REGION_FRACTION / 2
    half_sample_h = cell_h_px * _CENTRAL_REGION_FRACTION / 2
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
            # 50% inscribed circle is the only circle mask we ship today;
            # the label travels with the data so the UI doesn't have to
            # know the convention.
            "fraction_label": "50% Ø",
        }
    else:
        masked = sample_box.reshape(-1, 3)
        sampling_region = {
            "shape": "rect",
            "half_w_px": float(half_sample_w),
            "half_h_px": float(half_sample_h),
            "center_px": [int(cx_px - rx0), int(cy_px - ry0)],
            # Reflects the actual constant — if _CENTRAL_REGION_FRACTION
            # is retuned, the inspector's overlay annotation auto-updates.
            "fraction_label": f"{int(round(_CENTRAL_REGION_FRACTION * 100))}%",
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

    # Compute x_value / y_value for the inspector header. Use the flat
    # index (which already accounts for wrapped 1D row offsets); a bare
    # ``col`` lookup would round-trip the row-0 value for every row,
    # which was the bug this fix addresses.
    from xcs_gen_web.capture_sampling import _linspace, _round_param
    x_val = _round_param(spec["x_param"], _linspace(spec["x_min"], spec["x_max"], x_steps)[flat_idx])
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


def _grid_layout_for_warped(spec: dict[str, Any]) -> dict[str, Any]:
    """Cell-grid math shared by the debug renderers — derives per-row /
    per-cell mm coordinates from the spec. Mirrors the maths in
    ``inspect_cell``; extracted so the renderers don't have to duplicate
    every line of arithmetic. ``px_per_mm`` is a constant 10.0 across
    the capture pipeline.
    """
    import math

    px_per_mm = 10.0
    grid_w = spec["width_mm"]
    row_height_mm = spec["height_mm"]
    rows_total = spec.get("rows", 1) or 1
    is_wrapped_1d = rows_total > 1 and spec.get("y_param") is None

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

    if is_wrapped_1d:
        per_row = math.ceil(x_steps / rows_total)
        cell_w_mm = grid_w / per_row
        cell_h_mm = row_height_mm
        max_row, max_col = rows_total, per_row
        gap = _effective_row_gap_mm(bool(spec.get("hide_axis_labels", False)))
        row_stride_mm = row_height_mm + gap
    else:
        cell_w_mm = grid_w / x_steps
        cell_h_mm = row_height_mm / (y_steps or 1)
        max_row, max_col = (y_steps or 1), x_steps
        # 2D / single-row 1D: cells stack with no inter-row gap.
        row_stride_mm = cell_h_mm

    return {
        "px_per_mm": px_per_mm,
        "grid_origin_mm": grid_origin_mm,
        "row_stride_mm": row_stride_mm,
        "cell_w_mm": cell_w_mm,
        "cell_h_mm": cell_h_mm,
        "max_row": max_row,
        "max_col": max_col,
        "is_wrapped_1d": is_wrapped_1d,
    }


def grid_layout_payload(spec: dict[str, Any]) -> dict[str, Any]:
    """Public-facing grid geometry — the frontend's :class:`GridLayout`.

    Returns the same numbers as :func:`_grid_layout_for_warped` but in
    the schema the cell-inspector overlay needs: pixel-space cell
    origin and stride, the warped image dimensions (so the frontend
    can map mouse → image-pixel), plus the wrapped/2D distinction.

    Pure function of *spec*; no I/O. Forward formula here MUST land on
    the same pixel rect that :func:`_cell_bounds_px` produces — hover
    on the cell that was sampled, not the one next door.
    """
    g = _grid_layout_for_warped(spec)
    px_per_mm = g["px_per_mm"]
    grid_origin_mm = g["grid_origin_mm"]

    is_2d = spec.get("y_param") is not None and not g["is_wrapped_1d"]
    cells_per_physical_row = g["max_col"]
    if is_2d:
        physical_rows = g["max_row"]
    elif g["is_wrapped_1d"]:
        physical_rows = g["max_row"]
    else:
        physical_rows = 1

    # Re-derive the warped image's burn-space dims the same way
    # capture._get_or_capture does, so we don't have to read the cached
    # PNG to learn its size. ``grid_origin_mm`` is already computed
    # upstream in ``_grid_layout_for_warped``, which uses the QR
    # offset, so we don't recompute it here.
    reg = spec.get("registration", {}) if isinstance(spec.get("registration"), dict) else {}
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    margin = MARKER_MARGIN_MM
    grid_w = spec["width_mm"]
    if g["is_wrapped_1d"]:
        # Wrapped 1D: total grid height = N rows × per-row + (N-1) gaps.
        rows_total = g["max_row"]
        cell_h_mm = g["cell_h_mm"]
        gap_mm = g["row_stride_mm"] - cell_h_mm
        grid_h_mm = rows_total * cell_h_mm + (rows_total - 1) * gap_mm
    else:
        grid_h_mm = spec["height_mm"]

    burn_w_mm = grid_origin_mm[0] + grid_w + aruco_size + margin
    burn_h_mm = grid_origin_mm[1] + grid_h_mm + aruco_size + margin

    return {
        "image_width_px": int(round(burn_w_mm * px_per_mm)),
        "image_height_px": int(round(burn_h_mm * px_per_mm)),
        "grid_origin_x_px": grid_origin_mm[0] * px_per_mm,
        "grid_origin_y_px": grid_origin_mm[1] * px_per_mm,
        "cell_width_px": g["cell_w_mm"] * px_per_mm,
        "cell_height_px": g["cell_h_mm"] * px_per_mm,
        "row_stride_px": g["row_stride_mm"] * px_per_mm,
        "cells_per_physical_row": cells_per_physical_row,
        "physical_rows": physical_rows,
        "is_2d": is_2d,
        "px_per_mm": px_per_mm,
    }


def _cell_bounds_px(g: dict[str, Any], row: int, col: int) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) in warped-image pixel coords for cell (row, col)."""
    px_per_mm = g["px_per_mm"]
    cx_mm = g["grid_origin_mm"][0] + (col + 0.5) * g["cell_w_mm"]
    cy_mm = g["grid_origin_mm"][1] + row * g["row_stride_mm"] + g["cell_h_mm"] / 2
    half_w_px = g["cell_w_mm"] * px_per_mm / 2
    half_h_px = g["cell_h_mm"] * px_per_mm / 2
    cx_px = cx_mm * px_per_mm
    cy_px = cy_mm * px_per_mm
    return (
        int(round(cx_px - half_w_px)),
        int(round(cy_px - half_h_px)),
        int(round(cx_px + half_w_px)),
        int(round(cy_px + half_h_px)),
    )


def render_warped_with_grid(warped: np.ndarray, spec: dict[str, Any]) -> bytes:
    """Render the warped capture with cell rectangles + sample-centre dots
    drawn on top, plus a yellow outline around the overall grid bounds.
    Returns PNG bytes.
    """
    import cv2

    g = _grid_layout_for_warped(spec)
    img = warped.copy()

    # Yellow outline around the whole grid bounding box.
    px_per_mm = g["px_per_mm"]
    gx_px = int(round(g["grid_origin_mm"][0] * px_per_mm))
    gy_px = int(round(g["grid_origin_mm"][1] * px_per_mm))
    grid_w_px = int(round(g["max_col"] * g["cell_w_mm"] * px_per_mm))
    # For wrapped 1D, total grid height includes inter-row gaps.
    if g["is_wrapped_1d"]:
        grid_h_px = int(round((g["max_row"] * g["cell_h_mm"]
                               + (g["max_row"] - 1) * (g["row_stride_mm"] - g["cell_h_mm"]))
                              * px_per_mm))
    else:
        grid_h_px = int(round(g["max_row"] * g["cell_h_mm"] * px_per_mm))
    cv2.rectangle(img, (gx_px, gy_px), (gx_px + grid_w_px, gy_px + grid_h_px),
                  color=(0, 255, 255), thickness=2)

    # Per-cell red rectangles + blue centre dots.
    for r in range(g["max_row"]):
        for c in range(g["max_col"]):
            x0, y0, x1, y1 = _cell_bounds_px(g, r, c)
            cv2.rectangle(img, (x0, y0), (x1, y1), color=(0, 0, 255), thickness=1)
            cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            cv2.circle(img, (cx, cy), radius=3, color=(255, 128, 0), thickness=-1)

    # Title strip across the top with a brief parameter summary. Drawn
    # by extending the canvas upward so the grid itself stays untouched.
    title = _debug_title(spec)
    if title:
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale = 0.45
        (tw, th), baseline = cv2.getTextSize(title, font, scale, 1)
        pad = 5
        band_h = th + 2 * pad + baseline
        band = np.full((band_h, img.shape[1], 3), 20, dtype=np.uint8)
        cv2.putText(band, title, (pad, pad + th),
                    font, scale, (255, 255, 255), 1, cv2.LINE_AA)
        img = np.vstack([band, img])

    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise CaptureError("failed to encode debug image")
    return bytes(buf)


def _debug_title(spec: dict[str, Any]) -> str:
    """Compact title string describing the swept axes + key base params."""
    parts = [f"{spec['x_param']} {spec['x_min']}-{spec['x_max']}"]
    if spec.get("y_param"):
        parts.append(f"{spec['y_param']} {spec.get('y_min')}-{spec.get('y_max')}")
    bp = spec.get("base_params", {}) or {}
    bits = []
    if "power" in bp: bits.append(f"P{bp['power']}%")
    if "speed" in bp: bits.append(f"S{bp['speed']}")
    if "frequency" in bp: bits.append(f"F{bp['frequency']}kHz")
    if "passes" in bp: bits.append(f"{bp['passes']}x")
    if bits: parts.append(" ".join(bits))
    return " / ".join(parts)


def render_row_strip(
    warped: np.ndarray,
    spec: dict[str, Any],
    swatches: list[dict[str, Any]],
    row: int,
) -> bytes:
    """Render one debug row strip: top half = actual cell crops from the
    warped image, bottom half = the captured colour swatch (flat fill of
    swatch.hex). Cells are concatenated horizontally with a 4-px black
    divider between them. Returns PNG bytes.
    """
    import cv2

    g = _grid_layout_for_warped(spec)
    if not (0 <= row < g["max_row"]):
        raise CaptureError(
            f"row {row} out of bounds (max_row={g['max_row']})"
        )

    row_swatches = sorted(
        [s for s in swatches if s.get("row") == row],
        key=lambda s: s.get("col", 0),
    )
    if not row_swatches:
        raise CaptureError(f"no swatches for row {row}")

    cells: list[np.ndarray] = []
    for s in row_swatches:
        col = int(s["col"])
        x0, y0, x1, y1 = _cell_bounds_px(g, row, col)
        # Clamp to image bounds.
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(warped.shape[1], x1); y1 = min(warped.shape[0], y1)
        actual = warped[y0:y1, x0:x1].copy()
        if actual.size == 0:
            continue
        h, w = actual.shape[:2]
        # Captured colour fill — same height as the actual crop, full width.
        hex_str = s.get("hex", "#000000").lstrip("#")
        try:
            r_, g_, b_ = (int(hex_str[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            r_, g_, b_ = 0, 0, 0
        captured = np.full((h, w, 3), (b_, g_, r_), dtype=np.uint8)
        # Stack vertically with a 4-px black divider.
        divider = np.zeros((4, w, 3), dtype=np.uint8)
        cells.append(np.vstack([actual, divider, captured]))

    if not cells:
        raise CaptureError(f"no renderable cells for row {row}")

    # Normalise heights (the cell crops can differ by 1 pixel from rounding).
    target_h = max(c.shape[0] for c in cells)
    normalised: list[np.ndarray] = []
    for c in cells:
        if c.shape[0] != target_h:
            pad = np.zeros((target_h - c.shape[0], c.shape[1], 3), dtype=np.uint8)
            c = np.vstack([c, pad])
        normalised.append(c)

    h_divider_w = 4
    h_div = np.zeros((target_h, h_divider_w, 3), dtype=np.uint8)
    pieces: list[np.ndarray] = []
    for i, c in enumerate(normalised):
        if i > 0:
            pieces.append(h_div)
        pieces.append(c)
    strip = np.hstack(pieces)
    ok, buf = cv2.imencode(".png", strip)
    if not ok:
        raise CaptureError("failed to encode row strip")
    return bytes(buf)


def grid_row_count(spec: dict[str, Any]) -> int:
    """How many physical rows the warped grid has — used by the debug
    modal to know how many per-row strips to request."""
    return _grid_layout_for_warped(spec)["max_row"]
