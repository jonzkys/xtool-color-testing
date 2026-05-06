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
