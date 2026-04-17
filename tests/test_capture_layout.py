"""Tests for registration marker layout math."""

import pytest

from xcs_gen.capture.layout import (
    RegistrationLayout,
    MarkerPosition,
    compute_layout,
    AUTO_FULL_THRESHOLD_MM,
)


def test_compact_mode_returns_qr_only():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=22.0, grid_h=5.0,
        mode="compact",
    )
    assert layout.qr is not None
    assert layout.aruco_markers == []
    # QR should sit just outside the grid, in a corner
    assert layout.qr.x >= 10.0 or layout.qr.x + layout.qr.size <= 10.0 + 22.0


def test_full_mode_returns_qr_plus_3_aruco():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=100.0, grid_h=100.0,
        mode="full",
    )
    assert layout.qr is not None
    assert len(layout.aruco_markers) == 3
    # Each marker has an ID in 0..3 (4 corners; QR occupies one, 3 ArUco for the others)
    ids = {m.marker_id for m in layout.aruco_markers}
    assert ids.issubset({0, 1, 2, 3})
    assert len(ids) == 3


def test_auto_mode_small_grid_uses_compact():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=22.0, grid_h=5.0,
        mode="auto",
    )
    assert layout.aruco_markers == []


def test_auto_mode_large_grid_uses_full():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=AUTO_FULL_THRESHOLD_MM + 10,
        grid_h=AUTO_FULL_THRESHOLD_MM + 10,
        mode="auto",
    )
    assert len(layout.aruco_markers) == 3


def test_off_mode_returns_empty():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=100.0, grid_h=100.0,
        mode="off",
    )
    assert layout.qr is None
    assert layout.aruco_markers == []


def test_compact_qr_size_scales_with_payload_mode():
    compact_inline = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="inline",
    )
    compact_id_only = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="id_only",
    )
    # id-only QR is smaller
    assert compact_id_only.qr.size < compact_inline.qr.size


def test_marker_positions_do_not_overlap_grid():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=50.0, grid_h=50.0,
        mode="full",
    )
    grid_right = 10.0 + 50.0
    grid_bottom = 10.0 + 50.0
    for m in layout.aruco_markers:
        m_right = m.x + m.size
        m_bottom = m.y + m.size
        # Either entirely left of grid, right of grid, above, or below
        outside = (
            m_right <= 10.0 or m.x >= grid_right
            or m_bottom <= 10.0 or m.y >= grid_bottom
        )
        assert outside, f"marker at ({m.x},{m.y}) size {m.size} overlaps grid"
