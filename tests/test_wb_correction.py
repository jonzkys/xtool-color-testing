"""Tests for the WB correction algorithms."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.wb_correction import (
    chromaticity_correct,
    ChromaticityResult,
)

# Canonical reference for stainless: anodised silver tint normalised to G.
U_CANON = (1.0, 1.0, 0.91)


def _frame(color: tuple[int, int, int], h: int = 100, w: int = 100) -> np.ndarray:
    """A flat solid-colour frame in BGR (OpenCV's native order)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, :] = (color[2], color[1], color[0])
    return img


def test_chromaticity_correct_neutralises_warm_cast_to_canonical():
    img = _frame((150, 140, 110))   # R=150, G=140, B=110
    u_measured = (150.0, 140.0, 110.0)
    out = chromaticity_correct(img, u_measured, U_CANON)
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
    assert abs(out.scales[1] - 1.0) < 1e-9
    assert out.scales[0] != 1.0
    assert out.scales[2] != 1.0


from xcs_gen_web.wb_correction import (
    AnchoredResult,
    anchored_correct_linear,
    AnchoredFitError,
)


def test_anchored_linear_recovers_inverse_transform():
    base = _frame((100, 100, 100))   # neutral grey
    tinted = base.astype(np.float32)
    tinted[:, :, 2] = np.clip(tinted[:, :, 2] * 1.2 + 5, 0, 255)
    tinted[:, :, 0] = np.clip(tinted[:, :, 0] * 0.8 + 5, 0, 255)
    tinted_u8 = tinted.astype(np.uint8)
    measured_dark_rgb = (
        50 * 1.2 + 5,
        50,
        50 * 0.8 + 5,
    )
    measured_light_rgb = (
        200 * 1.2 + 5,
        200,
        200 * 0.8 + 5,
    )
    canonical_dark = (50.0, 50.0, 50.0)
    canonical_light = (200.0, 200.0, 200.0)

    out = anchored_correct_linear(
        tinted_u8,
        measured_rgbs=[measured_dark_rgb, measured_light_rgb],
        canonical_rgbs=[canonical_dark, canonical_light],
    )
    px = out.frame[50, 50]
    assert abs(int(px[2]) - 100) <= 2
    assert abs(int(px[1]) - 100) <= 2
    assert abs(int(px[0]) - 100) <= 2
    assert isinstance(out, AnchoredResult)
    assert out.fit_kind == "linear"
    assert len(out.fit) == 3   # one (a, b) per channel


def test_anchored_linear_raises_when_too_few_patches():
    import pytest

    img = _frame((100, 100, 100))
    with pytest.raises(AnchoredFitError):
        anchored_correct_linear(
            img,
            measured_rgbs=[(100.0, 100.0, 100.0)],
            canonical_rgbs=[(100.0, 100.0, 100.0)],
        )


from xcs_gen_web.wb_correction import (
    reject_specular,
    SpecularRejectionResult,
    anchored_correct_gamma,
)


def test_reject_specular_drops_top_quartile_by_luminance():
    pixels_rgb = np.array(
        [[100, 100, 100]] * 75 + [[250, 250, 250]] * 25,
        dtype=np.float32,
    )
    out = reject_specular(pixels_rgb, top_pct=0.25)
    assert isinstance(out, SpecularRejectionResult)
    assert out.kept.shape[0] == 75
    assert np.allclose(out.kept.mean(axis=0), [100, 100, 100], atol=1)


def test_anchored_gamma_better_fit_with_three_anchors():
    base = _frame((100, 100, 100))
    raw = base.astype(np.float32) / 255.0
    bumped = np.power(raw, 1.5) * 255.0
    bumped_u8 = np.clip(bumped, 0, 255).astype(np.uint8)
    levels_canon = [50.0, 128.0, 200.0]
    levels_meas = [(np.power(L / 255.0, 1.5) * 255.0) for L in levels_canon]
    measured = [(m, m, m) for m in levels_meas]
    canonical = [(L, L, L) for L in levels_canon]

    out = anchored_correct_gamma(
        bumped_u8, measured_rgbs=measured, canonical_rgbs=canonical
    )
    assert out.fit_kind == "gamma"
    assert len(out.fit) == 3
    px = out.frame[50, 50]
    assert abs(int(px[2]) - 100) <= 5


from xcs_gen_web.wb_correction import (
    correct_warped_frame,
    CorrectionOutcome,
)


def test_orchestrator_picks_anchored_when_strip_present():
    img = _frame((150, 140, 110))
    strip = [
        ((50.0, 47.0, 38.0), (50.0, 50.0, 45.5)),
        ((128.0, 120.0, 96.0), (128.0, 128.0, 117.0)),
        ((200.0, 188.0, 152.0), (200.0, 200.0, 182.0)),
    ]
    out = correct_warped_frame(img, strip_anchors=strip, unburned_rgb=None)
    assert isinstance(out, CorrectionOutcome)
    assert out.mode == "anchored"
    assert out.applied is True


def test_orchestrator_falls_back_to_chromaticity_when_no_strip():
    img = _frame((150, 140, 110))
    out = correct_warped_frame(
        img, strip_anchors=None, unburned_rgb=(150.0, 140.0, 110.0)
    )
    assert out.mode == "chromaticity"
    assert out.applied is True


def test_orchestrator_skips_when_no_inputs():
    img = _frame((150, 140, 110))
    out = correct_warped_frame(img, strip_anchors=None, unburned_rgb=None)
    assert out.mode == "skipped"
    assert out.applied is False
    assert np.array_equal(out.frame, img)


def test_orchestrator_falls_back_to_linear_when_gamma_pathological():
    img = _frame((100, 100, 100))
    strip = [
        ((50.0, 50.0, 50.0), (50.0, 50.0, 50.0)),
        ((100.0, 100.0, 100.0), (100.0, 100.0, 100.0)),
        ((200.0, 200.0, 200.0), (200.0, 200.0, 200.0)),
    ]
    out = correct_warped_frame(img, strip_anchors=strip, unburned_rgb=None)
    assert out.mode == "anchored"
    assert out.applied is True
