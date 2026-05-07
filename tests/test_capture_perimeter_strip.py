"""Tests for the perimeter-strip extension to the registration layout."""

from __future__ import annotations

from xcs_gen.capture.layout import (
    PerimeterStrip,
    PerimeterStripSegment,
    compute_layout,
)
from xcs_gen.capture.marker_render import render_perimeter_strip


def test_strip_disabled_by_default():
    layout = compute_layout(grid_x=10, grid_y=10, grid_w=50, grid_h=50)
    assert layout.perimeter_strip is None


def test_strip_enabled_returns_4_segments():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_perimeter_strip=True,
    )
    strip = layout.perimeter_strip
    assert isinstance(strip, PerimeterStrip)
    sides = {s.side for s in strip.segments}
    assert sides == {"top", "right", "bottom", "left"}
    for seg in strip.segments:
        assert isinstance(seg, PerimeterStripSegment)
        assert seg.width_mm == 3.0
        # Each segment is non-degenerate.
        length = ((seg.x1 - seg.x0) ** 2 + (seg.y1 - seg.y0) ** 2) ** 0.5
        assert length > 5.0


def test_top_strip_runs_between_qr_and_top_right_aruco():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_perimeter_strip=True,
    )
    qr = layout.qr
    tr = next(a for a in layout.arucos if a.marker_id == 1)
    top = next(s for s in layout.perimeter_strip.segments if s.side == "top")
    # Top strip starts to the right of QR's right edge and ends to
    # the left of the top-right ArUco's left edge.
    assert top.x0 >= qr.x + qr.size
    assert top.x1 <= tr.x
    # Both endpoints share the same y on the top edge.
    assert abs(top.y0 - top.y1) < 0.01


def test_strip_falls_back_when_grid_too_narrow():
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=4, grid_h=20,
        with_perimeter_strip=True,
    )
    assert layout.perimeter_strip is None


def test_render_emits_4_rect_elements():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_perimeter_strip=True,
    )
    strip = layout.perimeter_strip
    assert strip is not None
    clean_params = {
        "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
        "passes": 2, "pulse_width": 200, "laser": "red",
    }
    elements = render_perimeter_strip(strip, clean_params=clean_params)
    assert len(elements) == 4
    # Each element is a Rect of the right width.
    for el in elements:
        # Long axis (orientation-dependent) is at least 5 mm.
        assert max(el.width, el.height) >= 5.0
        # Short axis is the strip width (3 mm).
        assert el.height == 3.0 or el.width == 3.0   # one axis is the strip width
