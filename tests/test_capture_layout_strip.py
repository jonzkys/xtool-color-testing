"""Tests for calibration-strip extension to the registration layout."""

from __future__ import annotations

from xcs_gen.capture.layout import (
    CalibrationPatch,
    CalibrationStrip,
    compute_layout,
)


def test_strip_disabled_by_default():
    layout = compute_layout(grid_x=10, grid_y=10, grid_w=50, grid_h=50)
    assert layout.calibration_strip is None


def test_strip_enabled_with_three_patches_default_geometry():
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=50, grid_h=50,
        with_calibration_strip=True, patch_count=3,
    )
    strip = layout.calibration_strip
    assert isinstance(strip, CalibrationStrip)
    assert len(strip.patches) == 3
    for p in strip.patches:
        assert isinstance(p, CalibrationPatch)
        assert p.width_mm == 5.0
        assert p.height_mm == 5.0
    span_x = strip.patches[-1].x + strip.patches[-1].width_mm - strip.patches[0].x
    assert abs(span_x - 17.0) < 0.01
    cp = strip.clean_pass_bbox
    assert cp.width_mm == 17.0 + 4.0
    assert cp.height_mm == 5.0 + 4.0


def test_strip_positioned_top_centre_between_qr_and_top_right_aruco():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_calibration_strip=True,
    )
    strip = layout.calibration_strip
    assert strip is not None
    qr = layout.qr
    tr = next(a for a in layout.arucos if a.marker_id == 1)
    assert strip.patches[0].x > qr.x + qr.size
    assert strip.patches[0].y < 20
    assert strip.patches[-1].x + strip.patches[-1].width_mm < tr.x


def test_strip_falls_back_when_grid_too_narrow():
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=15, grid_h=20,
        with_calibration_strip=True,
    )
    assert layout.calibration_strip is None
