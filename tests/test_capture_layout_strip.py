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
        assert p.width_mm == 3.0
        assert p.height_mm == 3.0
    # 3 patches × 3 mm + 2 gaps × 0.5 mm = 10 mm strip width
    span_x = strip.patches[-1].x + strip.patches[-1].width_mm - strip.patches[0].x
    assert abs(span_x - 10.0) < 0.01
    # Clean-pass area = patch bbox + 1 mm border on every side.
    cp = strip.clean_pass_bbox
    assert cp.width_mm == 10.0 + 2.0
    assert cp.height_mm == 3.0 + 2.0


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
    # With the default 3-patch geometry the strip's clean-pass area
    # is 12 mm wide; grid_w=10 is too narrow to host it.
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=10, grid_h=20,
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
        assert elements[i].width == 3.0
        assert elements[i].height == 3.0


def test_strip_honours_user_supplied_labels_for_more_than_3_patches():
    # Regression: previously patch_count=4 with default labels
    # silently truncated to 3 patches because patch_labels[:4] is
    # only 3 elements long, and downstream rendering raised a
    # length mismatch.
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_calibration_strip=True, patch_count=4,
        patch_labels=("light", "mid", "dark", "Dark2"),
    )
    strip = layout.calibration_strip
    assert strip is not None
    assert [p.label for p in strip.patches] == ["light", "mid", "dark", "Dark2"]


def test_strip_falls_back_to_numeric_label_when_too_few_provided():
    # When patch_count exceeds the supplied labels, missing slots
    # are filled with "pN" placeholders rather than dropped.
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_calibration_strip=True, patch_count=5,
        patch_labels=("light", "mid"),
    )
    strip = layout.calibration_strip
    assert strip is not None
    assert [p.label for p in strip.patches] == ["light", "mid", "p3", "p4", "p5"]
