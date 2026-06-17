"""Edge-aware smoothing of grayscale depth maps for relief engraving.

The xTool machine maps a grayscale image's 0..255 onto N engraving pass-levels
itself (depth = pass count). Our job is to clean the heightfield so it engraves
without pixel oscillation or over-sharp risers, while preserving legitimate
sharp drops. Pure numpy/cv2 — no HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

__all__ = [
    "ReliefSmoothParams",
    "smooth_heightfield",
    "apply_clahe",
    "background_alpha",
    "encode_png_la",
    "to_grayscale_u8",
    "encode_png",
    "parse_rgb",
    "colour_background_alpha",
    "trim_alpha",
]


@dataclass(frozen=True)
class ReliefSmoothParams:
    strength: int = 8           # bilateral sigmaSpace (spatial radius, px)
    edge_preserve: bool = True  # the guard rail
    edge_threshold: int = 40    # preserve intensity jumps above this (0..255)
    spike_removal: bool = True
    median_ksize: int = 3  # snapped to 3 or 5 in __post_init__

    def __post_init__(self) -> None:
        object.__setattr__(self, "median_ksize", 5 if self.median_ksize >= 5 else 3)


def to_grayscale_u8(img: np.ndarray) -> np.ndarray:
    """Coerce a decoded image (BGR, BGRA, or single-channel) to contiguous uint8 gray."""
    if img.ndim == 2:
        gray = img
    elif img.ndim == 3 and img.shape[2] == 1:
        gray = img[:, :, 0]
    elif img.ndim == 3 and img.shape[2] == 4:
        gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    elif img.ndim == 3 and img.shape[2] == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        raise ValueError(f"unsupported image shape {img.shape}")
    return np.ascontiguousarray(gray, dtype=np.uint8)


def smooth_heightfield(gray: np.ndarray, p: ReliefSmoothParams) -> np.ndarray:
    """Edge-aware denoise of a single-channel uint8 heightfield."""
    if gray.ndim != 2:
        raise ValueError("smooth_heightfield expects a single-channel image")

    # 1. spike removal — kill single-pixel oscillation
    work = gray
    if p.spike_removal:
        work = cv2.medianBlur(work, p.median_ksize)

    # 2. edge-aware smooth — bilateral; sigmaColor IS the guard rail
    # d=0 → neighbourhood auto-derived from sigmaSpace (~2*strength+1 px); keep strength small (cost is O(d^2 * pixels)).
    smoothed = cv2.bilateralFilter(
        work, d=0,
        sigmaColor=max(1, int(p.edge_threshold)),
        sigmaSpace=max(1, int(p.strength)),
    )

    # 3. explicit guard-rail freeze — hard-preserve real sharp drops.
    #    Measured on the DE-SPIKED image so spikes (already gone) aren't refrozen;
    #    morphological gradient = local max-min range, in intensity units, so the
    #    threshold compares apples-to-apples with edge_threshold.
    if p.edge_preserve:
        kernel = np.ones((3, 3), np.uint8)
        local_range = cv2.morphologyEx(work, cv2.MORPH_GRADIENT, kernel)
        edge_mask = (local_range > int(p.edge_threshold)).astype(np.uint8)
        edge_mask = cv2.dilate(edge_mask, kernel, iterations=1)
        smoothed = np.where(edge_mask.astype(bool), work, smoothed)

    return np.ascontiguousarray(smoothed, dtype=np.uint8)


def apply_clahe(gray: np.ndarray, clip_limit: float, tiles: int) -> np.ndarray:
    """Contrast-limited adaptive histogram equalization of a uint8 heightfield.

    Tile-adaptive local-contrast equalization — not expressible as a single
    256-LUT, hence done here on the backend rather than client-side. Runs on
    the already-smoothed field (denoise-then-stretch)."""
    if gray.ndim != 2:
        raise ValueError("apply_clahe expects a single-channel image")
    n = max(1, int(tiles))
    clahe = cv2.createCLAHE(
        clipLimit=max(0.1, float(clip_limit)),
        tileGridSize=(n, n),
    )
    return np.ascontiguousarray(clahe.apply(gray), dtype=np.uint8)


def background_alpha(gray: np.ndarray, threshold: int, high: bool = False) -> np.ndarray:
    """Alpha mask (uint8 0/255) marking background pixels transparent.

    ``high=False``: background is the dark end (``gray <= threshold``) — the
    common case (surrounding black background). ``high=True``: the bright end
    (``gray >= threshold``) for inverted maps."""
    if gray.ndim != 2:
        raise ValueError("background_alpha expects a single-channel image")
    t = max(0, min(255, int(threshold)))
    mask = gray >= t if high else gray <= t
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(alpha)


def parse_rgb(s: str) -> tuple[int, int, int] | None:
    """Parse ``'r,g,b'`` (each 0..255, clamped) → tuple, or None if malformed/empty."""
    parts = str(s).split(",")
    if len(parts) != 3:
        return None
    try:
        vals = [max(0, min(255, int(round(float(p))))) for p in parts]
    except ValueError:
        return None
    return (vals[0], vals[1], vals[2])


def colour_background_alpha(
    bgr: np.ndarray, color_rgb: tuple[int, int, int], tolerance: float
) -> np.ndarray:
    """Alpha mask (uint8 0/255): background = pixels within Euclidean RGB distance
    ``tolerance`` of ``color_rgb`` (the picked background colour); foreground = 255.
    Accepts BGR / BGRA / single-channel (gray treated as R=G=B)."""
    if bgr.ndim == 2:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_GRAY2RGB)
    elif bgr.ndim == 3 and bgr.shape[2] == 4:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGRA2RGB)
    elif bgr.ndim == 3 and bgr.shape[2] == 3:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    else:
        raise ValueError(f"unsupported image shape {bgr.shape}")
    target = np.array(color_rgb, dtype=np.float32).reshape(1, 1, 3)
    dist = np.sqrt(((rgb.astype(np.float32) - target) ** 2).sum(axis=2))
    mask = dist <= float(tolerance)  # background
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(alpha)


def trim_alpha(alpha: np.ndarray, pct: float) -> np.ndarray:
    """Erode the foreground (``alpha > 0``) inward by ``pct``% of the object's
    shorter bbox side, shaving a fuzzy border. ``pct`` is relative to the WHOLE
    foreground bounding box (the union of all opaque regions). No-op for
    ``pct <= 0`` or a sub-pixel radius; clamps (returns the input) if the erosion
    would empty the object — never erase it."""
    if alpha.ndim != 2:
        raise ValueError("trim_alpha expects a single-channel alpha")
    if pct <= 0:
        return alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    radius = int(round(pct / 100.0 * short))
    if radius < 1:
        return alpha
    k = 2 * radius + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    eroded = cv2.erode(fg, kernel, iterations=1)
    if not eroded.any():
        return alpha  # clamp: never erase the whole object
    return np.ascontiguousarray(np.where(eroded > 0, 255, 0).astype(np.uint8))


def encode_png_la(gray: np.ndarray, alpha: np.ndarray) -> bytes:
    """Encode grayscale + alpha as an ``LA`` PNG (transparent background)."""
    lum = Image.fromarray(np.ascontiguousarray(gray, dtype=np.uint8), mode="L")
    a = Image.fromarray(np.ascontiguousarray(alpha, dtype=np.uint8), mode="L")
    buf = BytesIO()
    Image.merge("LA", [lum, a]).save(buf, format="PNG")
    return buf.getvalue()


def encode_png(gray: np.ndarray) -> bytes:
    """Encode a single-channel uint8 array to PNG bytes (mode L)."""
    buf = BytesIO()
    Image.fromarray(gray, mode="L").save(buf, format="PNG")
    return buf.getvalue()
