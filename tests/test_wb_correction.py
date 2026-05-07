"""Tests for the WB correction algorithms."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.wb_correction import (
    chromaticity_correct,
    ChromaticityResult,
)
from xcs_gen_web.wb_correction import (
    reject_specular,
    SpecularRejectionResult,
)
from xcs_gen_web.wb_correction import sample_strip_line
from xcs_gen_web.wb_correction import (
    flatfield_correct,
    FlatFieldResult,
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


def test_reject_specular_drops_top_quartile_by_luminance():
    pixels_rgb = np.array(
        [[100, 100, 100]] * 75 + [[250, 250, 250]] * 25,
        dtype=np.float32,
    )
    out = reject_specular(pixels_rgb, top_pct=0.25)
    assert isinstance(out, SpecularRejectionResult)
    assert out.kept.shape[0] == 75
    assert np.allclose(out.kept.mean(axis=0), [100, 100, 100], atol=1)


def test_reject_specular_handles_empty_input():
    out = reject_specular(np.zeros((0, 3), dtype=np.float32))
    assert out.kept.shape[0] == 0


def test_sample_strip_line_walks_a_horizontal_strip():
    # 200x200 px frame. Plant a known colour along a horizontal
    # band from (10, 95) to (190, 105) — that's the strip's rect.
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[95:106, 10:191, 0] = 80   # B
    img[95:106, 10:191, 1] = 160  # G
    img[95:106, 10:191, 2] = 200  # R
    out = sample_strip_line(
        img,
        x0_mm=10.0, y0_mm=25.0, x1_mm=190.0, y1_mm=25.0,
        px_per_mm=4.0, sample_step_mm=2.0, sample_size_mm=1.5,
    )
    # The strip's centre line at y=25 mm with px_per_mm=4 lands at
    # row 100, exactly within the painted band.
    assert out is not None
    R, G, B = out
    assert abs(R - 200) < 2 and abs(G - 160) < 2 and abs(B - 80) < 2


def test_sample_strip_line_returns_none_when_box_off_frame():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    out = sample_strip_line(
        img,
        x0_mm=-50.0, y0_mm=-50.0, x1_mm=-40.0, y1_mm=-50.0,
        px_per_mm=4.0, sample_step_mm=2.0, sample_size_mm=1.5,
    )
    assert out is None


def test_flatfield_correct_uniform_lighting_recovers_canonical():
    # When all 4 edges measure exactly the canonical neutral, the
    # gain is 1.0 everywhere → frame returns unchanged.
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    canonical = (160.0, 160.0, 145.0)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": (160.0, 160.0, 145.0),
    }
    out = flatfield_correct(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0),
            "right": (100.0, 50.0),
            "bottom": (50.0, 100.0),
            "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=canonical,
        px_per_mm=1.0,
    )
    assert isinstance(out, FlatFieldResult)
    assert np.allclose(out.frame, img, atol=1)


def test_flatfield_correct_gradient_pulls_dim_side_brighter():
    # Plant a measured-vs-canonical mismatch only on the left edge
    # (left is darker than canonical) and confirm the corrected
    # frame is brighter on the left than on the right at row centre.
    img = np.full((100, 100, 3), 100, dtype=np.uint8)
    canonical = (160.0, 160.0, 145.0)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": (80.0, 80.0, 73.0),  # darker → gain > 1 near left
    }
    out = flatfield_correct(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0),
            "right": (100.0, 50.0),
            "bottom": (50.0, 100.0),
            "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=canonical,
        px_per_mm=1.0,
    )
    left_px = out.frame[50, 5]
    right_px = out.frame[50, 95]
    # Left side should now be brighter than the right side.
    assert int(left_px[1]) > int(right_px[1])


from xcs_gen_web.wb_correction import (
    correct_warped_frame,
    CorrectionOutcome,
)


def test_orchestrator_picks_flatfield_when_4_edges_present():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": (160.0, 160.0, 145.0),
    }
    out = correct_warped_frame(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=None,
    )
    assert isinstance(out, CorrectionOutcome)
    assert out.mode == "flatfield"
    assert out.applied is True


def test_orchestrator_synthesises_missing_edge_when_3_present():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": None,   # missing
    }
    out = correct_warped_frame(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=(150.0, 140.0, 110.0),
    )
    assert out.mode == "flatfield"
    assert out.applied is True


def test_orchestrator_falls_back_to_chromaticity_when_2_edges():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": None,
        "bottom": (160.0, 160.0, 145.0),
        "left": None,
    }
    out = correct_warped_frame(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=(150.0, 140.0, 110.0),
    )
    assert out.mode == "chromaticity"
    assert out.applied is True


def test_orchestrator_skips_when_no_inputs():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    out = correct_warped_frame(
        img,
        edge_means={"top": None, "right": None, "bottom": None, "left": None},
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=None,
    )
    assert out.mode == "skipped"
    assert out.applied is False
    assert np.array_equal(out.frame, img)
