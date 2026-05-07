"""Integration tests for WB correction in the live capture pipeline."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.capture_pipeline import (
    apply_wb_correction_to_warped,
    sample_perimeter_strips,
)


def test_apply_wb_correction_disabled_returns_input_unchanged():
    img = np.full((200, 200, 3), (140, 160, 160), dtype=np.uint8)   # BGR
    out = apply_wb_correction_to_warped(
        img,
        edge_means={"top": None, "right": None, "bottom": None, "left": None},
        edge_positions={
            "top": (50, 0), "right": (100, 50),
            "bottom": (50, 100), "left": (0, 50),
        },
        grid_bbox=(0, 0, 100, 100),
        canonical_neutral=(160, 160, 145),
        px_per_mm=1.0,
        unburned_rgb=None,
        canonical_id=None,
        enabled=False,
    )
    assert out.mode == "disabled"
    assert out.applied is False
    assert np.array_equal(out.frame, img)


def test_sample_perimeter_strips_pools_each_segment():
    # 200x200 px frame. Plant a known colour along a horizontal band
    # at y=10 mm (with px_per_mm=4 → row 40) for the top strip.
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[35:46, 20:181, 0] = 80     # B
    img[35:46, 20:181, 1] = 160    # G
    img[35:46, 20:181, 2] = 200    # R
    segments = [
        {"side": "top", "x0": 5, "y0": 10, "x1": 45, "y1": 10},
        # Other sides intentionally on solid black so they read as
        # zeros — testing that the top sampler returns the planted
        # colour and the others return None.
        {"side": "right", "x0": 49, "y0": 5, "x1": 49, "y1": 45},
        {"side": "bottom", "x0": 45, "y0": 49, "x1": 5, "y1": 49},
        {"side": "left", "x0": 0, "y0": 45, "x1": 0, "y1": 5},
    ]
    out = sample_perimeter_strips(img, segments, px_per_mm=4.0)
    assert out["top"] is not None
    R, G, B = out["top"]
    assert abs(R - 200) < 5 and abs(G - 160) < 5 and abs(B - 80) < 5
