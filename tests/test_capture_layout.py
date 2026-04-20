"""Tests for registration marker layout math.

ArUco corners were removed (they weren't wired into the capture pipeline
and were taking ~40% of substrate space). Only the QR is emitted now;
tests cover each supported qr_position and the optional qr_size_mm override.
"""

import pytest

from xcs_gen.capture.layout import (
    MARKER_MARGIN_MM,
    compute_layout,
    registration_reservation_mm,
)


def test_compact_mode_places_qr_outside_top_left():
    layout = compute_layout(
        grid_x=20.0, grid_y=15.0,
        grid_w=22.0, grid_h=5.0,
        mode="compact",
    )
    assert layout.qr is not None
    # QR sits to the upper-left of the grid
    assert layout.qr.x + layout.qr.size <= 20.0
    assert layout.qr.y + layout.qr.size <= 15.0


def test_full_mode_is_equivalent_to_compact_post_aruco_removal():
    """'full' used to emit ArUcos too; now it's identical to 'compact'."""
    compact = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=22.0, grid_h=5.0, mode="compact",
    )
    full = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=22.0, grid_h=5.0, mode="full",
    )
    assert compact.qr == full.qr


def test_off_mode_returns_empty():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=100.0, grid_h=100.0, mode="off",
    )
    assert layout.qr is None


def test_qr_size_scales_with_payload_mode_by_default():
    inline = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="inline",
    )
    id_only = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="id_only",
    )
    assert id_only.qr.size < inline.qr.size


def test_qr_size_mm_override_wins_over_payload_default():
    layout = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="inline", qr_size_mm=8.5,
    )
    assert layout.qr.size == pytest.approx(8.5)


@pytest.mark.parametrize("position", ["top-left", "top-right", "bottom-right", "left-middle"])
def test_qr_never_overlaps_grid_at_any_position(position):
    grid_x, grid_y, w, h = 20.0, 15.0, 30.0, 20.0
    layout = compute_layout(
        grid_x=grid_x, grid_y=grid_y, grid_w=w, grid_h=h,
        mode="compact", position=position,
    )
    qr = layout.qr
    assert qr is not None
    grid_right, grid_bottom = grid_x + w, grid_y + h
    qr_right = qr.x + qr.size
    qr_bottom = qr.y + qr.size
    outside = (
        qr_right <= grid_x or qr.x >= grid_right
        or qr_bottom <= grid_y or qr.y >= grid_bottom
    )
    assert outside, f"QR at ({qr.x},{qr.y}) size {qr.size} overlaps grid in {position}"


def test_top_right_position_places_qr_right_of_grid():
    layout = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=30.0, grid_h=20.0,
        mode="compact", position="top-right",
    )
    qr = layout.qr
    # Aligned right: QR's left edge past the grid's right edge
    assert qr.x >= 20.0 + 30.0
    # Above the grid (top-right, not bottom-right)
    assert qr.y + qr.size <= 15.0


def test_bottom_right_position_places_qr_below_right_of_grid():
    layout = compute_layout(
        grid_x=20.0, grid_y=15.0, grid_w=30.0, grid_h=20.0,
        mode="compact", position="bottom-right",
    )
    qr = layout.qr
    assert qr.x >= 20.0 + 30.0
    assert qr.y >= 15.0 + 20.0


def test_left_middle_position_vertically_centres_qr_on_grid():
    grid_x, grid_y, w, h = 20.0, 15.0, 30.0, 20.0
    layout = compute_layout(
        grid_x=grid_x, grid_y=grid_y, grid_w=w, grid_h=h,
        mode="compact", position="left-middle",
    )
    qr = layout.qr
    # Horizontally: left of the grid
    assert qr.x + qr.size <= grid_x
    # Vertically: QR centre matches grid centre
    qr_centre_y = qr.y + qr.size / 2
    grid_centre_y = grid_y + h / 2
    assert qr_centre_y == pytest.approx(grid_centre_y)


def test_left_middle_reservation_adds_y_overhang_when_qr_taller_than_grid():
    # Thin strip (3 mm) vs 12 mm QR ⇒ 4.5 mm overhang above + below.
    shift_x, shift_y = registration_reservation_mm(
        "compact", "inline", position="left-middle", grid_h_mm=3.0,
    )
    assert shift_x > 0
    assert shift_y == pytest.approx(4.5)

    # Grid taller than QR ⇒ no Y shift needed.
    _, no_shift_y = registration_reservation_mm(
        "compact", "inline", position="left-middle", grid_h_mm=30.0,
    )
    assert no_shift_y == 0.0


def test_registration_reservation_tuple_depends_on_position():
    # Off: no shift
    assert registration_reservation_mm("off", "inline") == (0.0, 0.0)
    # Top-left: shift both
    tl = registration_reservation_mm("compact", "inline", position="top-left")
    assert tl[0] > 0 and tl[1] > 0
    assert tl[0] == tl[1]
    # Top-right: only Y shift
    tr = registration_reservation_mm("compact", "inline", position="top-right")
    assert tr[0] == 0.0 and tr[1] > 0
    # Bottom-right: no shift
    br = registration_reservation_mm("compact", "inline", position="bottom-right")
    assert br == (0.0, 0.0)


def test_registration_reservation_honours_qr_size_override():
    base = registration_reservation_mm("compact", "inline", position="top-left")
    bigger = registration_reservation_mm(
        "compact", "inline", position="top-left", qr_size_mm=20.0,
    )
    assert bigger[0] == pytest.approx(20.0 + MARKER_MARGIN_MM)
    assert bigger[0] > base[0]
