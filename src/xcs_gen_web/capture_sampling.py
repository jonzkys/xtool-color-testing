"""Sample colors from a warped burn-space image.

Input images are expected in OpenCV BGR uint8 convention — i.e. the
output of capture_pipeline.warp_to_burn_space. Sampling uses the
central 60% of each cell to avoid edge halo and inter-cell gaps.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

_CENTRAL_REGION_FRACTION = 0.6

# Parameters whose values are integer-valued laser settings. Any other swept
# param (currently only "power") is rounded to 1 decimal place instead — the
# laser accepts fractional power, so 14.6% is meaningful while 14.62069% is not.
_INT_PARAMS = frozenset({"speed", "frequency", "density", "passes", "pulse_width"})


def _round_param(name: str, value: float) -> float:
    if name in _INT_PARAMS:
        return float(round(value))
    return round(value, 1)


@dataclass
class Swatch:
    """One sampled cell/position."""
    row: int
    col: int
    x_value: float
    y_value: float | None
    hex: str
    sigma: float


def _bgr_to_lab(bgr_pixels: np.ndarray) -> np.ndarray:
    """Convert (N, 3) BGR uint8 pixels to (N, 3) float Lab.

    OpenCV returns Lab with L in [0, 255] and a/b in [0, 255] offset by
    128. Rescale to the conventional L ∈ [0, 100], a/b ∈ [-128, 127].
    """
    reshaped = bgr_pixels.reshape(-1, 1, 3).astype(np.uint8)
    lab = cv2.cvtColor(reshaped, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    lab[:, 0] *= 100.0 / 255.0
    lab[:, 1] -= 128.0
    lab[:, 2] -= 128.0
    return lab


def _sample_cell(
    img: np.ndarray,
    cx_px: float, cy_px: float,
    w_px: float, h_px: float,
    *,
    cell_shape: str,
    aggregator: str,
) -> tuple[str, float]:
    """Sample a region of pixels around (cx_px, cy_px) using the mask
    appropriate for ``cell_shape`` and the requested ``aggregator``.

    Returns ``(hex, sigma_lab)``.

    Mask:
      * ``cell_shape == "circle"``: inscribed circle of diameter
        ``min(w_px, h_px) * 0.5``. Corners of the bounding box are
        excluded.
      * Any other ``cell_shape``: 60% rectangle (legacy behaviour).

    Sigma is always computed over ALL pixels in the bounding rect, not
    just the masked region — keeps the "how uniform is this cell"
    signal comparable across shapes.
    """
    from xcs_gen.sampling_aggregators import aggregate

    # Bounding-rect halves for sigma + circle-mask coordinates.
    half_w = w_px * _CENTRAL_REGION_FRACTION / 2
    half_h = h_px * _CENTRAL_REGION_FRACTION / 2
    rx0 = max(0, int(round(cx_px - half_w)))
    ry0 = max(0, int(round(cy_px - half_h)))
    rx1 = min(img.shape[1], int(round(cx_px + half_w)))
    ry1 = min(img.shape[0], int(round(cy_px + half_h)))
    bbox = img[ry0:ry1, rx0:rx1]
    if bbox.size == 0:
        return "#000000", 0.0
    bbox_pixels = bbox.reshape(-1, 3)

    if cell_shape == "circle":
        # Build an inscribed-circle mask (50% of cell width).
        radius_px = min(w_px, h_px) * 0.5 / 2
        sx0 = max(0, int(round(cx_px - radius_px)))
        sy0 = max(0, int(round(cy_px - radius_px)))
        sx1 = min(img.shape[1], int(round(cx_px + radius_px)))
        sy1 = min(img.shape[0], int(round(cy_px + radius_px)))
        sample_box = img[sy0:sy1, sx0:sx1]
        if sample_box.size == 0:
            return "#000000", 0.0
        h_, w_ = sample_box.shape[:2]
        yy, xx = np.ogrid[:h_, :w_]
        cy_local = (cy_px - sy0)
        cx_local = (cx_px - sx0)
        inside = (xx - cx_local) ** 2 + (yy - cy_local) ** 2 <= radius_px ** 2
        masked = sample_box[inside]
        if masked.size == 0:
            return "#000000", 0.0
        b, g, r = aggregate(aggregator, masked)
    else:
        # rect (or any non-circle today) — 60% bounding rect, no mask.
        b, g, r = aggregate(aggregator, bbox_pixels)

    hex_ = f"#{r:02x}{g:02x}{b:02x}"

    # Sigma over the full bounding rect — unchanged semantics.
    lab = _bgr_to_lab(bbox_pixels)
    sigma = float(np.sqrt(np.sum(np.var(lab, axis=0))))
    return hex_, sigma


def _linspace(min_v: float, max_v: float, n: int) -> list[float]:
    if n == 1:
        return [min_v]
    step = (max_v - min_v) / (n - 1)
    return [min_v + i * step for i in range(n)]


def sample_grid(
    warped: np.ndarray,
    *,
    grid_origin_mm: tuple[float, float],
    grid_size_mm: tuple[float, float],
    px_per_mm: float,
    x_param: str, x_min: float, x_max: float, x_steps: int,
    y_param: str | None,
    y_min: float = 0.0, y_max: float = 0.0, y_steps: int = 1,
    rows: int = 1,
    row_stride_mm: float | None = None,
    cell_shape: str = "rect",
    aggregator: str = "saturation_median",
) -> list[Swatch]:
    """Sample every cell of a rectangular grid test.

    Handles three geometries:
      - 1D flat (rows=1, y_param=None): one horizontal strip.
      - 1D wrapped (rows>1, y_param=None): x_steps cells distributed across
        ``rows`` physical rows (like a typewriter). Per-row cell count is
        ceil(x_steps / rows); the last row may be shorter. ``row_stride_mm``
        is the distance between consecutive row origins (cell height + the
        inter-row gap reserved for axis labels). If not supplied, falls back
        to grid_h / rows (sufficient only when there's no inter-row gap).
      - 2D grid (y_param set): y_steps rows × x_steps cols.
    """
    import math

    ox, oy = grid_origin_mm
    gw, gh = grid_size_mm

    # 1D wrapped gets its own path — the Y coordinate of each cell depends
    # on (i // per_row) with the explicit stride, which the generic 1D / 2D
    # logic below can't express.
    if y_param is None and rows > 1:
        per_row = math.ceil(x_steps / rows)
        cell_w_mm = gw / per_row
        row_h_mm = gh / rows
        stride_mm = row_stride_mm if row_stride_mm is not None else row_h_mm
        cell_w_px = cell_w_mm * px_per_mm
        cell_h_px = row_h_mm * px_per_mm
        x_values = [_round_param(x_param, v) for v in _linspace(x_min, x_max, x_steps)]

        swatches: list[Swatch] = []
        for i in range(x_steps):
            r = i // per_row
            c = i % per_row
            cx_px = (ox + (c + 0.5) * cell_w_mm) * px_per_mm
            cy_px = (oy + r * stride_mm + row_h_mm / 2) * px_per_mm
            hex_, sigma = _sample_cell(
                warped, cx_px, cy_px, cell_w_px, cell_h_px,
                cell_shape=cell_shape, aggregator=aggregator,
            )
            swatches.append(Swatch(
                row=r, col=c,
                x_value=x_values[i],
                y_value=None,
                hex=hex_,
                sigma=sigma,
            ))
        return swatches

    # 1D flat or 2D grid.
    cell_w_mm = gw / x_steps
    n_y = y_steps if y_param is not None else 1
    cell_h_mm = gh / n_y
    cell_w_px = cell_w_mm * px_per_mm
    cell_h_px = cell_h_mm * px_per_mm

    x_values = [_round_param(x_param, v) for v in _linspace(x_min, x_max, x_steps)]
    if y_param is not None:
        y_values: list[float | None] = [_round_param(y_param, v) for v in _linspace(y_min, y_max, n_y)]
    else:
        y_values = [None] * n_y

    swatches = []
    for yi in range(n_y):
        for xi in range(x_steps):
            cx_px = (ox + (xi + 0.5) * cell_w_mm) * px_per_mm
            cy_px = (oy + (yi + 0.5) * cell_h_mm) * px_per_mm
            hex_, sigma = _sample_cell(
                warped, cx_px, cy_px, cell_w_px, cell_h_px,
                cell_shape=cell_shape, aggregator=aggregator,
            )
            swatches.append(Swatch(
                row=yi, col=xi,
                x_value=x_values[xi],
                y_value=y_values[yi],
                hex=hex_,
                sigma=sigma,
            ))
    return swatches


def sample_gradient(
    warped: np.ndarray,
    *,
    grid_origin_mm: tuple[float, float],
    grid_size_mm: tuple[float, float],
    px_per_mm: float,
    x_param: str, x_min: float, x_max: float, n_samples: int,
) -> list[Swatch]:
    """Sample a single-stripe gradient at n_samples evenly-spaced positions."""
    ox, oy = grid_origin_mm
    gw, gh = grid_size_mm
    cell_w_mm = gw / n_samples
    cell_w_px = cell_w_mm * px_per_mm
    cell_h_px = gh * px_per_mm

    x_values = [_round_param(x_param, v) for v in _linspace(x_min, x_max, n_samples)]
    cy_px = (oy + gh / 2) * px_per_mm

    swatches: list[Swatch] = []
    for i in range(n_samples):
        cx_px = (ox + (i + 0.5) * cell_w_mm) * px_per_mm
        hex_, sigma = _sample_cell(
            warped, cx_px, cy_px, cell_w_px, cell_h_px,
            cell_shape="rect", aggregator="saturation_median",
        )
        swatches.append(Swatch(
            row=0, col=i,
            x_value=x_values[i],
            y_value=None,
            hex=hex_,
            sigma=sigma,
        ))
    return swatches
