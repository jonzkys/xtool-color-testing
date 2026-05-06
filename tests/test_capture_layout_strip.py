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


from xcs_gen.capture.marker_render import render_calibration_strip


def test_render_emits_clean_pass_plus_per_patch_burns():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_calibration_strip=True, patch_count=3,
    )
    strip = layout.calibration_strip
    assert strip is not None
    clean_pass_params = {
        "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
        "passes": 2, "pulse_width": 200, "laser": "red",
    }
    patches_params = [
        {"power": 8.0, "speed": 1500, "frequency": 30, "density": 800,
         "passes": 1, "pulse_width": 120, "laser": "red"},
        {"power": 18.0, "speed": 1000, "frequency": 80, "density": 1000,
         "passes": 1, "pulse_width": 160, "laser": "red"},
        {"power": 40.0, "speed": 400, "frequency": 120, "density": 1200,
         "passes": 2, "pulse_width": 240, "laser": "red"},
    ]
    elements = render_calibration_strip(
        strip,
        clean_pass_params=clean_pass_params,
        patches_params=patches_params,
    )
    assert len(elements) == 4
    assert elements[0].width == strip.clean_pass_bbox.width_mm
    assert elements[0].height == strip.clean_pass_bbox.height_mm
    for i in range(1, 4):
        assert elements[i].width == 5.0
        assert elements[i].height == 5.0
