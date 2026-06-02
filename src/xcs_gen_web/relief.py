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
    "to_grayscale_u8",
    "encode_png",
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


def encode_png(gray: np.ndarray) -> bytes:
    """Encode a single-channel uint8 array to PNG bytes (mode L)."""
    buf = BytesIO()
    Image.fromarray(gray, mode="L").save(buf, format="PNG")
    return buf.getvalue()
