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


def sample_unburned_around_markers(
    frame_bgr: np.ndarray,
    markers: list[dict],
    *,
    px_per_mm: float,
    band_mm: float = 1.5,
    margin_mm: float = 0.5,
) -> tuple[float, float, float] | None:
    """Sample a thin band of substrate just outside each registration
    marker, pool, and return one (R, G, B) reading.

    ``markers`` is a list of ``{"x", "y", "size_mm"}`` dicts in burn-
    space mm, where ``(x, y)`` is the marker's top-left corner and
    ``size_mm`` is its side length. We grab a small box ``band_mm`` wide
    on the substrate side of the marker, ``margin_mm`` away from the
    marker edge, on each of the four faces; pool the kept (non-specular)
    pixels across all faces and all markers; reject 2σ outliers; mean.

    Returns ``None`` if no usable pixels survive — the caller falls back
    to "no correction" when this and the perimeter strips both fail.
    """
    h, w = frame_bgr.shape[:2]
    band_px = max(1, int(band_mm * px_per_mm))
    margin_px = max(0, int(margin_mm * px_per_mm))
    pooled: list[np.ndarray] = []
    for m in markers:
        cx_mm = float(m["x"])
        cy_mm = float(m["y"])
        size_mm = float(m["size_mm"])
        x0_px = int(cx_mm * px_per_mm)
        y0_px = int(cy_mm * px_per_mm)
        size_px = int(size_mm * px_per_mm)
        # Four substrate faces: above (top edge), below (bottom edge),
        # left of, right of the marker. Pull a band_px-thick strip on
        # the outside of the marker, offset by margin_px.
        boxes = [
            # above
            (x0_px, y0_px - margin_px - band_px,
             x0_px + size_px, y0_px - margin_px),
            # below
            (x0_px, y0_px + size_px + margin_px,
             x0_px + size_px, y0_px + size_px + margin_px + band_px),
            # left
            (x0_px - margin_px - band_px, y0_px,
             x0_px - margin_px, y0_px + size_px),
            # right
            (x0_px + size_px + margin_px, y0_px,
             x0_px + size_px + margin_px + band_px, y0_px + size_px),
        ]
        for bx0, by0, bx1, by1 in boxes:
            bx0 = max(0, bx0)
            by0 = max(0, by0)
            bx1 = min(w, bx1)
            by1 = min(h, by1)
            if bx1 <= bx0 or by1 <= by0:
                continue
            sub = frame_bgr[by0:by1, bx0:bx1]
            rgb = sub[:, :, ::-1].reshape(-1, 3).astype(np.float32)
            kept = reject_specular(rgb).kept
            if kept.size > 0:
                pooled.append(kept)
    if not pooled:
        return None
    all_kept = np.concatenate(pooled, axis=0)
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


@dataclass
class FlatFieldResult:
    frame: np.ndarray
    edge_means: dict[str, tuple[float, float, float]]
    edge_positions: dict[str, tuple[float, float]]
    canonical_neutral: tuple[float, float, float]


def flatfield_correct(
    frame_bgr: np.ndarray,
    *,
    edge_means: dict[str, tuple[float, float, float]],
    edge_positions: dict[str, tuple[float, float]],
    grid_bbox: tuple[float, float, float, float],   # x_min, y_min, x_max, y_max in mm
    canonical_neutral: tuple[float, float, float],
    px_per_mm: float,
) -> FlatFieldResult:
    """Apply per-pixel bilinear-blend gain across the frame.

    For each pixel at burn-space (mm) position p, the interpolated
    measured RGB is (h_lerp + v_lerp) / 2 where h_lerp blends left and
    right edges, v_lerp blends top and bottom. Per-channel gain at p
    is canonical / interpolated; pixel value scales accordingly.
    """
    h, w = frame_bgr.shape[:2]
    canonical = np.asarray(canonical_neutral, dtype=np.float32)
    top = np.asarray(edge_means["top"], dtype=np.float32)
    right = np.asarray(edge_means["right"], dtype=np.float32)
    bottom = np.asarray(edge_means["bottom"], dtype=np.float32)
    left = np.asarray(edge_means["left"], dtype=np.float32)

    # Build (u, v) grids in [0, 1] across the frame, then convert to
    # burn-space mm and finally to grid_bbox-relative coordinates so
    # the blend sees u=0 at grid_x_min and u=1 at grid_x_max.
    x_min, y_min, x_max, y_max = grid_bbox
    grid_w_mm = max(x_max - x_min, 1e-3)
    grid_h_mm = max(y_max - y_min, 1e-3)
    px_x = np.arange(w, dtype=np.float32) / px_per_mm
    px_y = np.arange(h, dtype=np.float32) / px_per_mm
    u_row = np.clip((px_x - x_min) / grid_w_mm, 0.0, 1.0)
    v_col = np.clip((px_y - y_min) / grid_h_mm, 0.0, 1.0)
    U, V = np.meshgrid(u_row, v_col)              # both (h, w)

    # Per-channel interpolated RGB at every pixel — broadcast over channels.
    # h_lerp = (1-u)*left + u*right, v_lerp = (1-v)*top + v*bottom
    h_lerp = (1 - U)[..., None] * left + U[..., None] * right     # (h, w, 3)
    v_lerp = (1 - V)[..., None] * top + V[..., None] * bottom     # (h, w, 3)
    interpolated = (h_lerp + v_lerp) / 2.0                         # (h, w, 3) RGB

    # Per-pixel per-channel gain. Guard against zero divides.
    gain = canonical / np.maximum(interpolated, 1.0)               # (h, w, 3) RGB

    f = frame_bgr.astype(np.float32)
    # OpenCV BGR ↔ our gain is RGB. Reverse the last axis to align.
    gain_bgr = gain[:, :, ::-1]
    out = np.clip(f * gain_bgr, 0, 255).astype(np.uint8)

    return FlatFieldResult(
        frame=out,
        edge_means=edge_means,
        edge_positions=edge_positions,
        canonical_neutral=canonical_neutral,
    )


@dataclass
class CorrectionOutcome:
    """High-level result returned to the capture pipeline."""
    frame: np.ndarray
    mode: str             # "flatfield" | "chromaticity" | "skipped"
    applied: bool
    edge_means: dict[str, tuple[float, float, float]] | None
    edge_positions: dict[str, tuple[float, float]] | None
    chromaticity_anchor_rgb: tuple[float, float, float] | None
    chromaticity_scales: tuple[float, float, float] | None
    canonical_id: str | None


def correct_warped_frame(
    frame_bgr: np.ndarray,
    *,
    edge_means: dict[str, tuple[float, float, float] | None],
    edge_positions: dict[str, tuple[float, float]],
    grid_bbox: tuple[float, float, float, float],
    canonical_neutral: tuple[float, float, float] = (160.0, 160.0, 145.0),
    px_per_mm: float = 10.0,
    unburned_rgb: tuple[float, float, float] | None = None,
    canonical_id: str | None = None,
) -> CorrectionOutcome:
    """Top-level correction entry point.

    Counts how many of the 4 edges produced a non-None measurement.
    >=3 -> flat-field path (synthesising any single missing edge as
    the mean of the other three so the bilinear blend has 4 corners
    to read from). 2 or fewer -> chromaticity-only fallback when
    ``unburned_rgb`` is set; otherwise skip.
    """
    usable = {k: v for k, v in edge_means.items() if v is not None}
    if len(usable) >= 3:
        if len(usable) == 3:
            mean_rgb = tuple(
                float(np.mean([v[i] for v in usable.values()]))
                for i in range(3)
            )
            for key in ("top", "right", "bottom", "left"):
                if key not in usable:
                    usable[key] = mean_rgb     # type: ignore[assignment]
        ff = flatfield_correct(
            frame_bgr,
            edge_means=usable,
            edge_positions=edge_positions,
            grid_bbox=grid_bbox,
            canonical_neutral=canonical_neutral,
            px_per_mm=px_per_mm,
        )
        return CorrectionOutcome(
            frame=ff.frame,
            mode="flatfield",
            applied=True,
            edge_means=ff.edge_means,
            edge_positions=ff.edge_positions,
            chromaticity_anchor_rgb=None,
            chromaticity_scales=None,
            canonical_id=canonical_id,
        )

    if unburned_rgb is not None:
        canon_normalised = (
            canonical_neutral[0] / max(canonical_neutral[1], 1e-3),
            1.0,
            canonical_neutral[2] / max(canonical_neutral[1], 1e-3),
        )
        chrom = chromaticity_correct(
            frame_bgr,
            unburned_rgb=unburned_rgb,
            canonical_rgb=canon_normalised,
        )
        return CorrectionOutcome(
            frame=chrom.frame,
            mode="chromaticity",
            applied=True,
            edge_means=None,
            edge_positions=None,
            chromaticity_anchor_rgb=chrom.measured_rgb,
            chromaticity_scales=chrom.scales,
            canonical_id=canonical_id,
        )

    return CorrectionOutcome(
        frame=frame_bgr.copy(),
        mode="skipped",
        applied=False,
        edge_means=None,
        edge_positions=None,
        chromaticity_anchor_rgb=None,
        chromaticity_scales=None,
        canonical_id=canonical_id,
    )
