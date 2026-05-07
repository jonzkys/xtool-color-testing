"""WB correction for ingested test photos.

Spec: docs/superpowers/specs/2026-05-07-wb-flatfield-design.md

Two correction modes:

- **Flat-field** (preferred): bilinear gain across 4 perimeter
  clean-pass strips, neutralises both colour cast AND spatial
  brightness variance.
- **Chromaticity-only** (fallback): single per-channel ratio
  derived from unburned material around the markers; neutralises
  colour cast only.

The orchestrator ``correct_warped_frame`` picks flat-field when
inputs allow, falls back to chromaticity, otherwise marks skipped.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class ChromaticityResult:
    """Output of chromaticity correction."""
    frame: np.ndarray             # BGR uint8, same shape as input
    measured_rgb: tuple[float, float, float]   # the U we measured (R, G, B)
    scales: tuple[float, float, float]         # per-channel multiplicative factors


def chromaticity_correct(
    frame_bgr: np.ndarray,
    unburned_rgb: tuple[float, float, float],
    canonical_rgb: tuple[float, float, float],
) -> ChromaticityResult:
    """Apply chromaticity-only correction.

    Per-channel scale factors normalise the photo's measured unburned-
    material ratios to the canonical ratios; G is the anchor (s_G=1)
    so absolute luminance is preserved.
    """
    Ru, Gu, Bu = unburned_rgb
    Rc, Gc, Bc = canonical_rgb
    if Gu <= 0:
        return ChromaticityResult(
            frame=frame_bgr.copy(),
            measured_rgb=unburned_rgb,
            scales=(1.0, 1.0, 1.0),
        )
    sR = (Rc / Gc) * Gu / Ru if Ru > 0 else 1.0
    sG = 1.0
    sB = (Bc / Gc) * Gu / Bu if Bu > 0 else 1.0

    # OpenCV uses BGR; index 0=B, 1=G, 2=R.
    f = frame_bgr.astype(np.float32)
    f[:, :, 0] *= sB
    f[:, :, 1] *= sG
    f[:, :, 2] *= sR
    out = np.clip(f, 0, 255).astype(np.uint8)

    return ChromaticityResult(
        frame=out,
        measured_rgb=unburned_rgb,
        scales=(sR, sG, sB),
    )


@dataclass
class SpecularRejectionResult:
    kept: np.ndarray
    rejected: np.ndarray
    rejected_count: int


def reject_specular(
    pixels_rgb: np.ndarray,
    *,
    top_pct: float = 0.25,
) -> SpecularRejectionResult:
    """Drop the brightest ``top_pct`` of pixels by luminance."""
    if pixels_rgb.size == 0:
        return SpecularRejectionResult(
            kept=pixels_rgb, rejected=pixels_rgb, rejected_count=0
        )
    lum = (
        0.299 * pixels_rgb[:, 0]
        + 0.587 * pixels_rgb[:, 1]
        + 0.114 * pixels_rgb[:, 2]
    )
    cutoff = np.quantile(lum, 1.0 - top_pct)
    keep_mask = lum <= cutoff
    return SpecularRejectionResult(
        kept=pixels_rgb[keep_mask],
        rejected=pixels_rgb[~keep_mask],
        rejected_count=int((~keep_mask).sum()),
    )


def sample_strip_line(
    frame_bgr: np.ndarray,
    *,
    x0_mm: float, y0_mm: float, x1_mm: float, y1_mm: float,
    px_per_mm: float,
    sample_step_mm: float = 2.0,
    sample_size_mm: float = 1.5,
) -> tuple[float, float, float] | None:
    """Walk a strip's centre-line in burn-space mm, sample a small
    box at every ``sample_step_mm``, specular-reject, then pool to
    one (R, G, B). Returns ``None`` when no usable samples survive.
    """
    length_mm = float(np.hypot(x1_mm - x0_mm, y1_mm - y0_mm))
    if length_mm <= 0:
        return None
    n = max(2, int(length_mm / sample_step_mm) + 1)
    half_box_px = (sample_size_mm * px_per_mm) / 2.0
    h, w = frame_bgr.shape[:2]
    pooled: list[np.ndarray] = []
    for i in range(n):
        t = i / (n - 1)
        cx_mm = x0_mm + t * (x1_mm - x0_mm)
        cy_mm = y0_mm + t * (y1_mm - y0_mm)
        cx_px = int(cx_mm * px_per_mm)
        cy_px = int(cy_mm * px_per_mm)
        x0 = max(0, int(cx_px - half_box_px))
        y0 = max(0, int(cy_px - half_box_px))
        x1 = min(w, int(cx_px + half_box_px))
        y1 = min(h, int(cy_px + half_box_px))
        if x1 <= x0 or y1 <= y0:
            continue
        sub = frame_bgr[y0:y1, x0:x1]
        rgb = sub[:, :, ::-1].reshape(-1, 3).astype(np.float32)
        kept = reject_specular(rgb).kept
        if kept.size == 0:
            continue
        pooled.append(kept)
    if not pooled:
        return None
    all_kept = np.concatenate(pooled, axis=0)
    # Reject per-point outliers > 2σ from the strip's pooled mean
    # before averaging — guards against a single sample box that
    # happened to straddle a scratch.
    mean = all_kept.mean(axis=0)
    sigma = all_kept.std(axis=0)
    if float(sigma.max()) > 0:
        keep = np.all(
            np.abs(all_kept - mean) <= 2.0 * np.maximum(sigma, 1.0),
            axis=1,
        )
        if keep.any():
            all_kept = all_kept[keep]
    final = all_kept.mean(axis=0)
    return float(final[0]), float(final[1]), float(final[2])
