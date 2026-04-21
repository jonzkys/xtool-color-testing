"""Tests for registration marker layout math.

Covers the new fiducial scheme: QR at top-left + 3 ArUco corners at the
remaining corners (top-right, bottom-left, bottom-right).
"""

import pytest

from xcs_gen.capture.layout import (
    ARUCO_ID_BOTTOM_LEFT,
    ARUCO_ID_BOTTOM_RIGHT,
    ARUCO_ID_TOP_RIGHT,
    ARUCO_SIZE_DEFAULT_MM,
    MARKER_MARGIN_MM,
    QR_SIZE_DEFAULT_MM,
    compute_layout,
    registration_reservation_mm,
)


def test_reservation_off_returns_zero():
    assert registration_reservation_mm("off") == (0.0, 0.0)


def test_reservation_on_uses_defaults():
    x_shift, y_shift = registration_reservation_mm("on")
    expected = max(QR_SIZE_DEFAULT_MM, ARUCO_SIZE_DEFAULT_MM) + MARKER_MARGIN_MM
    assert x_shift == pytest.approx(expected)
    assert y_shift == pytest.approx(expected)


def test_reservation_on_with_custom_sizes():
    x_shift, y_shift = registration_reservation_mm("on", qr_size_mm=8.0, aruco_size_mm=3.0)
    expected = max(8.0, 3.0) + MARKER_MARGIN_MM
    assert x_shift == pytest.approx(expected)
    assert y_shift == pytest.approx(expected)


def test_reservation_on_aruco_larger_than_qr():
    x_shift, y_shift = registration_reservation_mm("on", qr_size_mm=3.0, aruco_size_mm=6.0)
    assert x_shift == pytest.approx(6.0 + 1.5)
    assert y_shift == pytest.approx(6.0 + 1.5)


def test_compute_layout_off_returns_empty():
    layout = compute_layout(grid_x=10.0, grid_y=10.0, grid_w=40.0, grid_h=20.0, mode="off")
    assert layout.qr is None
    assert layout.arucos == []


def test_compute_layout_pinned_geometry():
    """Pinning test: exact coordinates for default marker sizes on a fixed grid.

    grid: x=10, y=10, w=40, h=20; defaults qr_size=5, aruco_size=2, margin=1.5

    QR (top-left corner):
        x = 10 - 5 - 1.5 = 3.5
        y = 10 - 5 - 1.5 = 3.5

    Top-right ArUco (ID=1):
        x = 10 + 40 + 1.5 = 51.5
        y = 10 - 2 - 1.5  = 6.5

    Bottom-left ArUco (ID=2):
        x = 10 - 2 - 1.5  = 6.5
        y = 10 + 20 + 1.5 = 31.5

    Bottom-right ArUco (ID=3):
        x = 10 + 40 + 1.5 = 51.5
        y = 10 + 20 + 1.5 = 31.5
    """
    layout = compute_layout(grid_x=10.0, grid_y=10.0, grid_w=40.0, grid_h=20.0)

    # QR
    assert layout.qr is not None
    assert layout.qr.x == pytest.approx(3.5)
    assert layout.qr.y == pytest.approx(3.5)
    assert layout.qr.size == pytest.approx(QR_SIZE_DEFAULT_MM)
    assert layout.qr.marker_id == 0

    # Three ArUcos
    assert len(layout.arucos) == 3
    by_id = {a.marker_id: a for a in layout.arucos}

    tr = by_id[ARUCO_ID_TOP_RIGHT]
    assert tr.x == pytest.approx(51.5)
    assert tr.y == pytest.approx(6.5)
    assert tr.size == pytest.approx(ARUCO_SIZE_DEFAULT_MM)

    bl = by_id[ARUCO_ID_BOTTOM_LEFT]
    assert bl.x == pytest.approx(6.5)
    assert bl.y == pytest.approx(31.5)
    assert bl.size == pytest.approx(ARUCO_SIZE_DEFAULT_MM)

    br = by_id[ARUCO_ID_BOTTOM_RIGHT]
    assert br.x == pytest.approx(51.5)
    assert br.y == pytest.approx(31.5)
    assert br.size == pytest.approx(ARUCO_SIZE_DEFAULT_MM)


def test_compute_layout_custom_sizes():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=40.0, grid_h=20.0,
        qr_size_mm=6.0, aruco_size_mm=3.0,
    )
    assert layout.qr.size == pytest.approx(6.0)
    for a in layout.arucos:
        assert a.size == pytest.approx(3.0)
