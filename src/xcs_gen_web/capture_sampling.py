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


def _sample_rect(
    img: np.ndarray,
    cx_px: float, cy_px: float,
    w_px: float, h_px: float,
) -> tuple[str, float]:
    """Sample the central 60% of a rect; return (hex, sigma_lab).

    The hex is the median of the most-saturated half of pixels in the sample
    region (HSV S channel). This biases the result toward vivid "peak" bands
    within a cell — e.g. a MOPA gradient strip where the characteristic
    colour sits in a thin horizontal band and the rest of the cell is muted
    background. A plain median would wash that peak out; filtering to the
    top-50% saturated pixels keeps it.

    Sigma is still computed across ALL pixels in the region (Lab stdev) so
    it remains a useful "how uniform is this cell" warning signal.
    """
    half_w = w_px * _CENTRAL_REGION_FRACTION / 2
    half_h = h_px * _CENTRAL_REGION_FRACTION / 2
    x0 = max(0, int(round(cx_px - half_w)))
    y0 = max(0, int(round(cy_px - half_h)))
    x1 = min(img.shape[1], int(round(cx_px + half_w)))
    y1 = min(img.shape[0], int(round(cy_px + half_h)))
    region = img[y0:y1, x0:x1]
    if region.size == 0:
        return "#000000", 0.0

    pixels = region.reshape(-1, 3)

    # Saturation-biased median: drop the bottom half (least-saturated)
    # pixels, then median-aggregate only the vivid remainder.
    hsv = cv2.cvtColor(pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV)
    sats = hsv.reshape(-1, 3)[:, 1]
    if sats.size >= 4:
        threshold = float(np.median(sats))
        mask = sats >= threshold
        vivid = pixels[mask] if mask.any() else pixels
    else:
        vivid = pixels

    median_bgr = np.median(vivid, axis=0).astype(np.uint8)
    b, g, r = int(median_bgr[0]), int(median_bgr[1]), int(median_bgr[2])
    hex_ = f"#{r:02x}{g:02x}{b:02x}"

    # Sigma is full-cell Lab stdev — unchanged semantics.
    lab = _bgr_to_lab(pixels)
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
            hex_, sigma = _sample_rect(warped, cx_px, cy_px, cell_w_px, cell_h_px)
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
            hex_, sigma = _sample_rect(warped, cx_px, cy_px, cell_w_px, cell_h_px)
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
        hex_, sigma = _sample_rect(warped, cx_px, cy_px, cell_w_px, cell_h_px)
        swatches.append(Swatch(
            row=0, col=i,
            x_value=x_values[i],
            y_value=None,
            hex=hex_,
            sigma=sigma,
        ))
    return swatches
