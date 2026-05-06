"""Tests for the WB correction algorithms."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.wb_correction import (
    chromaticity_correct,
    ChromaticityResult,
)

# Canonical reference for stainless-ish silver: G normalised to 1.0,
# B/G ~ 0.91 (derived from samples/color/* empirical work).
U_CANON = (1.0, 1.0, 0.91)


def _frame(color: tuple[int, int, int], h: int = 100, w: int = 100) -> np.ndarray:
    """A flat solid-colour frame in BGR (OpenCV's native order)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, :] = (color[2], color[1], color[0])
    return img


def test_chromaticity_correct_neutralises_warm_cast_to_canonical():
    img = _frame((150, 140, 110))   # R=150, G=140, B=110
    out = chromaticity_correct(img, (150.0, 140.0, 110.0), U_CANON)
    assert isinstance(out, ChromaticityResult)
    px = out.frame[50, 50]   # BGR
    R, G, B = float(px[2]), float(px[1]), float(px[0])
    assert abs(R / G - U_CANON[0]) < 0.02
    assert abs(B / G - U_CANON[2]) < 0.02


def test_chromaticity_no_op_when_already_canonical():
    Gv = 120
    Rv = int(Gv * U_CANON[0])
    Bv = int(Gv * U_CANON[2])
    img = _frame((Rv, Gv, Bv))
    out = chromaticity_correct(img, (Rv, Gv, Bv), U_CANON)
    assert np.allclose(out.frame, img, atol=1)


def test_chromaticity_records_scale_factors():
    img = _frame((150, 140, 110))
    out = chromaticity_correct(img, (150.0, 140.0, 110.0), U_CANON)
    # G is the anchor; scale stays exactly 1.0
    assert abs(out.scales[1] - 1.0) < 1e-9
    assert out.scales[0] != 1.0
    assert out.scales[2] != 1.0
