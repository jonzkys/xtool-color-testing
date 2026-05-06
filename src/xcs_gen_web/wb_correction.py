"""WB correction for ingested test photos.

Spec: docs/superpowers/specs/2026-05-06-marker-chromaticity-correction-design.md

Two correction modes:

- **Anchored** (preferred): per-channel linear (or 3-anchor gamma)
  fit using calibration-strip patches with known canonical RGBs.
- **Chromaticity-only** (fallback): per-channel ratio normalisation
  using unburned material adjacent to detected markers.

The orchestrator ``correct_warped_frame`` picks anchored when the
inputs allow, otherwise falls back, otherwise marks the result as
skipped.
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
    so absolute luminance is preserved (we don't try to fix exposure
    on reflective material).
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


class AnchoredFitError(ValueError):
    """Raised when the anchored fit can't be computed (too few patches,
    degenerate inputs)."""


@dataclass
class AnchoredResult:
    """Output of anchored correction (linear or gamma)."""
    frame: np.ndarray
    measured_rgbs: list[tuple[float, float, float]]
    fit_kind: str             # "linear" | "gamma"
    fit: list[tuple[float, ...]]   # per-channel coefficients


def anchored_correct_linear(
    frame_bgr: np.ndarray,
    *,
    measured_rgbs: list[tuple[float, float, float]],
    canonical_rgbs: list[tuple[float, float, float]],
) -> AnchoredResult:
    """Fit a per-channel linear ``corrected = a * raw + b`` from two
    or more (measured, canonical) anchor pairs and apply.
    """
    if len(measured_rgbs) < 2 or len(canonical_rgbs) < 2:
        raise AnchoredFitError(
            f"need at least 2 anchors, got {len(measured_rgbs)}"
        )
    if len(measured_rgbs) != len(canonical_rgbs):
        raise AnchoredFitError(
            "measured_rgbs and canonical_rgbs must have same length"
        )

    n = len(measured_rgbs)
    measured = np.asarray(measured_rgbs, dtype=np.float64)
    canonical = np.asarray(canonical_rgbs, dtype=np.float64)

    fit: list[tuple[float, ...]] = []
    for c in range(3):
        x = measured[:, c]
        y = canonical[:, c]
        A = np.column_stack([x, np.ones(n)])
        try:
            coeffs, *_ = np.linalg.lstsq(A, y, rcond=None)
        except np.linalg.LinAlgError as e:
            raise AnchoredFitError(f"channel {c} fit failed: {e}") from e
        a, b = float(coeffs[0]), float(coeffs[1])
        fit.append((a, b))

    f = frame_bgr.astype(np.float32)
    aR, bR = fit[0]
    aG, bG = fit[1]
    aB, bB = fit[2]
    f[:, :, 0] = f[:, :, 0] * aB + bB
    f[:, :, 1] = f[:, :, 1] * aG + bG
    f[:, :, 2] = f[:, :, 2] * aR + bR
    out = np.clip(f, 0, 255).astype(np.uint8)

    return AnchoredResult(
        frame=out,
        measured_rgbs=list(measured_rgbs),
        fit_kind="linear",
        fit=fit,
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
    lum = 0.299 * pixels_rgb[:, 0] + 0.587 * pixels_rgb[:, 1] + 0.114 * pixels_rgb[:, 2]
    cutoff = np.quantile(lum, 1.0 - top_pct)
    keep_mask = lum <= cutoff
    return SpecularRejectionResult(
        kept=pixels_rgb[keep_mask],
        rejected=pixels_rgb[~keep_mask],
        rejected_count=int((~keep_mask).sum()),
    )


def anchored_correct_gamma(
    frame_bgr: np.ndarray,
    *,
    measured_rgbs: list[tuple[float, float, float]],
    canonical_rgbs: list[tuple[float, float, float]],
) -> AnchoredResult:
    """Fit a per-channel ``corrected = a * raw**gamma + b`` from 3+
    anchors and apply.
    """
    if len(measured_rgbs) < 3 or len(canonical_rgbs) < 3:
        raise AnchoredFitError(
            f"gamma fit needs >=3 anchors, got {len(measured_rgbs)}"
        )
    measured = np.asarray(measured_rgbs, dtype=np.float64)
    canonical = np.asarray(canonical_rgbs, dtype=np.float64)

    fit: list[tuple[float, ...]] = []
    for c in range(3):
        x = measured[:, c]
        y = canonical[:, c]
        eps = 1e-3
        x_safe = np.maximum(x, eps)
        y_safe = np.maximum(y, eps)
        log_x = np.log(x_safe)
        log_y = np.log(y_safe)
        A = np.column_stack([log_x, np.ones(len(x))])
        coeffs, *_ = np.linalg.lstsq(A, log_y, rcond=None)
        gamma = float(coeffs[0])
        log_a = float(coeffs[1])
        a = float(np.exp(log_a))
        if not (0.3 <= gamma <= 3.0):
            raise AnchoredFitError(
                f"channel {c} gamma {gamma:.3f} outside [0.3, 3.0]"
            )
        fit.append((a, 0.0, gamma))

    f = frame_bgr.astype(np.float32)
    eps = 1e-3
    aR, _, gR = fit[0]
    aG, _, gG = fit[1]
    aB, _, gB = fit[2]
    f[:, :, 0] = aB * np.power(np.maximum(f[:, :, 0], eps), gB)
    f[:, :, 1] = aG * np.power(np.maximum(f[:, :, 1], eps), gG)
    f[:, :, 2] = aR * np.power(np.maximum(f[:, :, 2], eps), gR)
    out = np.clip(f, 0, 255).astype(np.uint8)

    return AnchoredResult(
        frame=out,
        measured_rgbs=list(measured_rgbs),
        fit_kind="gamma",
        fit=fit,
    )
