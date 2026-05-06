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


@dataclass
class CorrectionOutcome:
    """High-level result returned to the capture pipeline."""
    frame: np.ndarray
    mode: str             # "anchored" | "chromaticity" | "skipped"
    applied: bool
    measured_rgbs: list[tuple[float, float, float]] | None
    fit: list[tuple[float, ...]] | tuple[float, float, float] | None
    fit_kind: str | None  # "linear" | "gamma" | "chromaticity_scale" | None
    canonical_id: str | None


def correct_warped_frame(
    frame_bgr: np.ndarray,
    *,
    strip_anchors: list[tuple[
        tuple[float, float, float], tuple[float, float, float]
    ]] | None,
    unburned_rgb: tuple[float, float, float] | None,
    canonical_chromaticity_rgb: tuple[float, float, float] = (1.0, 1.0, 0.91),
    canonical_id: str | None = None,
) -> CorrectionOutcome:
    """Top-level correction entry point.

    Picks the best mode given what's available:

    - Anchored mode if ``strip_anchors`` has >=2 (measured, canonical)
      pairs. Tries gamma first if N>=3; on AnchoredFitError or N==2,
      falls back to linear.
    - Chromaticity-only mode if ``unburned_rgb`` is provided.
    - Skip otherwise (frame returned unchanged).
    """
    if strip_anchors and len(strip_anchors) >= 2:
        measured = [m for m, _ in strip_anchors]
        canonical = [c for _, c in strip_anchors]
        anch: AnchoredResult | None = None
        try:
            if len(strip_anchors) >= 3:
                anch = anchored_correct_gamma(
                    frame_bgr,
                    measured_rgbs=measured,
                    canonical_rgbs=canonical,
                )
            else:
                anch = anchored_correct_linear(
                    frame_bgr,
                    measured_rgbs=measured,
                    canonical_rgbs=canonical,
                )
        except AnchoredFitError:
            try:
                anch = anchored_correct_linear(
                    frame_bgr,
                    measured_rgbs=measured,
                    canonical_rgbs=canonical,
                )
            except AnchoredFitError:
                anch = None
        if anch is not None:
            return CorrectionOutcome(
                frame=anch.frame,
                mode="anchored",
                applied=True,
                measured_rgbs=anch.measured_rgbs,
                fit=anch.fit,
                fit_kind=anch.fit_kind,
                canonical_id=canonical_id,
            )

    if unburned_rgb is not None:
        chrom = chromaticity_correct(
            frame_bgr,
            unburned_rgb=unburned_rgb,
            canonical_rgb=canonical_chromaticity_rgb,
        )
        return CorrectionOutcome(
            frame=chrom.frame,
            mode="chromaticity",
            applied=True,
            measured_rgbs=[chrom.measured_rgb],
            fit=chrom.scales,
            fit_kind="chromaticity_scale",
            canonical_id=canonical_id,
        )

    return CorrectionOutcome(
        frame=frame_bgr.copy(),
        mode="skipped",
        applied=False,
        measured_rgbs=None,
        fit=None,
        fit_kind=None,
        canonical_id=canonical_id,
    )


def sample_strip_anchors(
    frame_bgr: np.ndarray,
    strip_patches: list[dict[str, float]],
    *,
    px_per_mm: float,
    sample_inner_mm: float = 1.5,
) -> list[tuple[float, float, float]]:
    """Sample the centre of each calibration patch.

    Each patch dict has ``x``, ``y`` (top-left, mm) and ``size_mm``.
    Sampled region: a centred ``sample_inner_mm × sample_inner_mm``
    box, with the brightest 25% rejected (specular guard).
    Returns a list of (R, G, B) per patch.
    """
    out: list[tuple[float, float, float]] = []
    for patch in strip_patches:
        x_mm, y_mm, s_mm = patch["x"], patch["y"], patch["size_mm"]
        cx_mm = x_mm + s_mm / 2.0
        cy_mm = y_mm + s_mm / 2.0
        half_mm = sample_inner_mm / 2.0
        x0 = int((cx_mm - half_mm) * px_per_mm)
        y0 = int((cy_mm - half_mm) * px_per_mm)
        x1 = int((cx_mm + half_mm) * px_per_mm)
        y1 = int((cy_mm + half_mm) * px_per_mm)
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(frame_bgr.shape[1], x1); y1 = min(frame_bgr.shape[0], y1)
        sub = frame_bgr[y0:y1, x0:x1]
        if sub.size == 0:
            out.append((0.0, 0.0, 0.0))
            continue
        rgb = sub[:, :, ::-1].reshape(-1, 3).astype(np.float32)
        kept = reject_specular(rgb).kept
        if kept.size == 0:
            kept = rgb
        mean = kept.mean(axis=0)
        out.append((float(mean[0]), float(mean[1]), float(mean[2])))
    return out


def sample_unburned_around_markers(
    frame_bgr: np.ndarray,
    markers: list[dict[str, float]],
    *,
    px_per_mm: float,
    sample_outer_offset_mm: float = 2.0,
    sample_size_mm: float = 3.0,
) -> tuple[float, float, float] | None:
    """Sample unburned material in a small box just above each marker,
    pool across markers, return the per-channel mean RGB.

    Returns None if no usable samples were found.
    """
    pooled: list[np.ndarray] = []
    half_size_px = (sample_size_mm * px_per_mm) / 2.0
    for m in markers:
        cx_mm = m["x"] + m["size_mm"] / 2.0
        cy_mm = m["y"] + m["size_mm"] / 2.0
        sample_cy_mm = cy_mm - m["size_mm"] / 2.0 - sample_outer_offset_mm
        sample_cx_mm = cx_mm
        cx_px = int(sample_cx_mm * px_per_mm)
        cy_px = int(sample_cy_mm * px_per_mm)
        x0 = max(0, int(cx_px - half_size_px))
        y0 = max(0, int(cy_px - half_size_px))
        x1 = min(frame_bgr.shape[1], int(cx_px + half_size_px))
        y1 = min(frame_bgr.shape[0], int(cy_px + half_size_px))
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
    mean = all_kept.mean(axis=0)
    return float(mean[0]), float(mean[1]), float(mean[2])
