"""Tests for burning registration markers into an XCSProject."""

import pytest

from xcs_gen.capture.layout import compute_layout
from xcs_gen.capture.marker_render import (
    emit_registration_markers,
    render_aruco_bits,
)
from xcs_gen.model import (
    ANNOTATION_LAYER_COLOR,
    ProcessingParams,
    XCSProject,
)


# ---------------------------------------------------------------------------
# ArUco rendering tests (new in Task 16)
# ---------------------------------------------------------------------------

def test_aruco_bits_shape():
    bits = render_aruco_bits(marker_id=1, modules_side=6)
    # 4x4 code + 1 black-border on each side = 6x6 modules
    assert bits.shape == (6, 6)
    # All 4 edge modules are black (True)
    assert bits[0, :].all() and bits[-1, :].all()
    assert bits[:, 0].all() and bits[:, -1].all()


def test_aruco_ids_differ():
    b1 = render_aruco_bits(marker_id=1)
    b2 = render_aruco_bits(marker_id=2)
    # the inner 4x4 must be different for different IDs
    assert not (b1[1:-1, 1:-1] == b2[1:-1, 1:-1]).all()


# ---------------------------------------------------------------------------
# emit_registration_markers tests
# ---------------------------------------------------------------------------

def test_emit_adds_annotation_layer_bitmap_for_qr():
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=22.0, grid_h=5.0,
        mode="on",
    )
    emit_registration_markers(
        project,
        layout=layout,
        test_id=1,
        annotation_params=ProcessingParams(),
    )
    # QR + 3 ArUcos = 4 BITMAPs on the annotation layer
    assert len(project.bitmaps) >= 1
    assert project.bitmaps[0].layer_color == ANNOTATION_LAYER_COLOR
    assert project.bitmaps[0].png_bytes.startswith(b"\x89PNG")


def test_emit_on_mode_produces_qr_plus_arucos():
    """mode='on' layout has QR + 3 ArUcos → 4 bitmaps total."""
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
        mode="on",
    )
    emit_registration_markers(
        project,
        layout=layout,
        test_id=42,
        annotation_params=ProcessingParams(),
    )
    # 1 QR + 3 ArUcos
    assert len(project.bitmaps) == 4


def test_emit_off_layout_adds_nothing():
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
        mode="off",
    )
    emit_registration_markers(
        project,
        layout=layout,
        test_id=1,
        annotation_params=ProcessingParams(),
    )
    assert project.bitmaps == []
    assert project.extra_displays == []


# ---------------------------------------------------------------------------
# registration_reservation_mm helper
# ---------------------------------------------------------------------------

def test_registration_reservation_helper():
    """Helper returns (0, 0) when off; non-zero shift when on."""
    from xcs_gen.capture.layout import (
        MARKER_MARGIN_MM,
        QR_SIZE_DEFAULT_MM,
        registration_reservation_mm,
    )

    reserve = QR_SIZE_DEFAULT_MM + MARKER_MARGIN_MM

    assert registration_reservation_mm("off") == (0.0, 0.0)
    # Default qr_size → symmetric shift
    shift = registration_reservation_mm("on")
    assert shift[0] > 0 and shift[1] > 0
    assert shift == (reserve, reserve)
