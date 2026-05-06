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
