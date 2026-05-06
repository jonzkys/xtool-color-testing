"""Integration tests for WB correction in the capture pipeline."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.capture_pipeline import (
    apply_wb_correction_to_warped,
)


def _solid_warped(color: tuple[int, int, int], h: int = 200, w: int = 200) -> np.ndarray:
    """A flat warped-frame stand-in (BGR uint8)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, :] = (color[2], color[1], color[0])
    return img


def test_apply_wb_correction_chromaticity_only_path():
    img = _solid_warped((150, 140, 110))
    out = apply_wb_correction_to_warped(
        img,
        strip_anchors=None,
        unburned_rgb=(150.0, 140.0, 110.0),
        canonical_id="v1.steel-default.2026-05-06",
    )
    assert out.mode == "chromaticity"
    assert out.canonical_id == "v1.steel-default.2026-05-06"
    assert out.applied is True


def test_apply_wb_correction_skips_when_disabled():
    img = _solid_warped((150, 140, 110))
    out = apply_wb_correction_to_warped(
        img, strip_anchors=None, unburned_rgb=None,
        canonical_id=None, enabled=False,
    )
    assert out.mode == "disabled"
    assert out.applied is False
    assert np.array_equal(out.frame, img)


def test_pipeline_picks_anchored_when_strip_in_layout():
    # Synthetic warped frame with planted strip patch pixels.
    px_per_mm = 4.0
    img = np.full((400, 400, 3), (140, 160, 160), dtype=np.uint8)   # silver-ish BGR
    strip_patches = [
        {"x": 30.0, "y": 5.0, "size_mm": 5.0, "label": "light",
         "canonical_rgb": [200.0, 200.0, 182.0]},
        {"x": 36.0, "y": 5.0, "size_mm": 5.0, "label": "mid",
         "canonical_rgb": [128.0, 128.0, 117.0]},
        {"x": 42.0, "y": 5.0, "size_mm": 5.0, "label": "dark",
         "canonical_rgb": [50.0, 50.0, 45.5]},
    ]
    # Paint each patch with a "warm-cast" measured tone (R/G/B BGR-stored).
    for patch, R, G, B in zip(
        strip_patches, [220, 140, 55], [200, 128, 50], [150, 105, 40]
    ):
        x_mm, y_mm, s = patch["x"], patch["y"], patch["size_mm"]
        x0 = int(x_mm * px_per_mm); x1 = int((x_mm + s) * px_per_mm)
        y0 = int(y_mm * px_per_mm); y1 = int((y_mm + s) * px_per_mm)
        img[y0:y1, x0:x1, 0] = B
        img[y0:y1, x0:x1, 1] = G
        img[y0:y1, x0:x1, 2] = R

    from xcs_gen_web.capture_pipeline import correct_with_strip_or_fallback

    out = correct_with_strip_or_fallback(
        img,
        px_per_mm=px_per_mm,
        strip_patches=strip_patches,
        markers=[{"x": 5.0, "y": 5.0, "size_mm": 2.0}],
        canonical_id="v1.steel-default.2026-05-06",
        enabled=True,
    )
    assert out.mode == "anchored"
    assert out.applied is True


def test_pipeline_falls_back_to_chromaticity_when_no_canonical_rgb():
    px_per_mm = 4.0
    # 200x200 image, plant a "silver" tone above the marker so the
    # unburned-material sampler has something to read.
    img = np.full((200, 200, 3), (140, 160, 160), dtype=np.uint8)
    strip_patches_uncalibrated = [
        {"x": 30.0, "y": 5.0, "size_mm": 5.0, "label": "light", "canonical_rgb": None},
        {"x": 36.0, "y": 5.0, "size_mm": 5.0, "label": "mid", "canonical_rgb": None},
    ]
    from xcs_gen_web.capture_pipeline import correct_with_strip_or_fallback

    out = correct_with_strip_or_fallback(
        img,
        px_per_mm=px_per_mm,
        strip_patches=strip_patches_uncalibrated,
        markers=[{"x": 5.0, "y": 25.0, "size_mm": 2.0}],   # marker far enough down that the unburned sample stays in-frame
        canonical_id="v1.steel-default.2026-05-06",
        enabled=True,
    )
    assert out.mode == "chromaticity"
    assert out.applied is True


def test_pipeline_disabled_short_circuits():
    px_per_mm = 4.0
    img = np.full((200, 200, 3), (140, 160, 160), dtype=np.uint8)
    from xcs_gen_web.capture_pipeline import correct_with_strip_or_fallback

    out = correct_with_strip_or_fallback(
        img,
        px_per_mm=px_per_mm,
        strip_patches=None,
        markers=[],
        canonical_id=None,
        enabled=False,
    )
    assert out.mode == "disabled"
    assert out.applied is False
