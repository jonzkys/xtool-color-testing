"""Tests for burning registration markers into an XCSProject."""

import pytest

from xcs_gen.capture.layout import compute_layout
from xcs_gen.capture.marker_render import (
    emit_registration_markers,
    qr_payload_for_test,
)
from xcs_gen.capture.qr_payload import decode_payload
from xcs_gen.model import (
    ANNOTATION_LAYER_COLOR,
    ProcessingParams,
    XCSProject,
)


def test_qr_payload_for_test_includes_required_fields():
    payload = qr_payload_for_test(
        test_id="a1b2c3d4",
        x_param="speed", x_min=100, x_max=5000, x_steps=50,
        y_param="power", y_min=10, y_max=100, y_steps=10,
        grid_w=22.0, grid_h=44.0, rows=1, gap=0.0,
        grid_offset_x_mm=13.5, grid_offset_y_mm=13.5,
        base_params=ProcessingParams(),
        kind="grid",
    )
    decoded = decode_payload(payload)
    assert decoded["id"] == "a1b2c3d4"
    assert decoded["t"] == "grid"
    assert decoded["x"] == {"p": "speed", "min": 100, "max": 5000, "n": 50}
    assert decoded["y"] == {"p": "power", "min": 10, "max": 100, "n": 10}
    assert decoded["grid"]["ox"] == 13.5
    assert decoded["grid"]["oy"] == 13.5


def test_qr_payload_without_y():
    payload = qr_payload_for_test(
        test_id="abcdefgh",
        x_param="speed", x_min=100, x_max=5000, x_steps=50,
        y_param=None, y_min=0, y_max=0, y_steps=1,
        grid_w=22.0, grid_h=5.0, rows=1, gap=0.0,
        grid_offset_x_mm=13.5, grid_offset_y_mm=14.75,
        base_params=ProcessingParams(),
        kind="grid",
    )
    decoded = decode_payload(payload)
    assert "y" not in decoded


def test_emit_adds_annotation_layer_bitmap_for_qr():
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=22.0, grid_h=5.0,
        mode="compact",
    )
    emit_registration_markers(
        project,
        layout=layout,
        qr_text='{"v":1,"id":"abcdefgh"}',
        annotation_params=ProcessingParams(),
    )
    # Compact = exactly one BITMAP (the QR) on the annotation layer.
    assert len(project.bitmaps) == 1
    assert project.bitmaps[0].layer_color == ANNOTATION_LAYER_COLOR
    assert project.bitmaps[0].png_bytes.startswith(b"\x89PNG")


def test_emit_compact_and_full_modes_both_produce_one_qr():
    """Post-ArUco-removal, 'compact' and 'full' are identical: one QR bitmap."""
    qr_text = '{"v":1,"id":"abcdefgh"}'
    compact = XCSProject()
    emit_registration_markers(
        compact,
        layout=compute_layout(
            grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
            mode="compact",
        ),
        qr_text=qr_text,
        annotation_params=ProcessingParams(),
    )
    full = XCSProject()
    emit_registration_markers(
        full,
        layout=compute_layout(
            grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
            mode="full",
        ),
        qr_text=qr_text,
        annotation_params=ProcessingParams(),
    )
    assert len(compact.bitmaps) == 1
    assert len(full.bitmaps) == 1


def test_emit_off_layout_adds_nothing():
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
        mode="off",
    )
    emit_registration_markers(
        project,
        layout=layout,
        qr_text="unused",
        annotation_params=ProcessingParams(),
    )
    assert project.bitmaps == []
    assert project.extra_displays == []


def test_generate_gradient_with_registration_adds_markers():
    from xcs_gen.generators import generate_gradient

    without = generate_gradient(
        x_param="speed", x_min=100, x_max=5000, x_steps=20,
        total_width=22.0, total_height=5.0,
    )
    with_reg = generate_gradient(
        x_param="speed", x_min=100, x_max=5000, x_steps=20,
        total_width=22.0, total_height=5.0,
        registration_mode="compact",
        registration_qr_mode="inline",
        test_id="testid01",
    )
    assert len(without.bitmaps) == 0
    assert len(with_reg.bitmaps) >= 1


def test_registration_markers_stay_within_canvas_compact():
    """Compact+inline registration must not place any geometry at negative x/y."""
    from xcs_gen.generators import generate_gradient

    proj = generate_gradient(
        x_param="speed", x_min=500, x_max=2000, x_steps=10,
        total_width=22.0, total_height=5.0,
        start_x=10.0, start_y=10.0,
        registration_mode="compact",
        registration_qr_mode="inline",
        test_id="abcd1234",
    )
    for disp in proj.extra_displays:
        assert disp["x"] >= 0, f"display at negative x: {disp['x']}"
        assert disp["y"] >= 0, f"display at negative y: {disp['y']}"
    for b in proj.bitmaps:
        assert b.x >= 0, f"bitmap at negative x: {b.x}"
        assert b.y >= 0, f"bitmap at negative y: {b.y}"
    for elem in proj.elements:
        assert elem.x >= 0
        assert elem.y >= 0


def test_registration_markers_stay_within_canvas_full():
    """Full-mode registration must also keep everything inside the canvas."""
    from xcs_gen.generators import generate_gradient

    proj = generate_gradient(
        x_param="speed", x_min=500, x_max=2000, x_steps=10,
        total_width=22.0, total_height=5.0,
        start_x=10.0, start_y=10.0,
        registration_mode="full",
        registration_qr_mode="inline",
        test_id="abcd1234",
    )
    for disp in proj.extra_displays:
        assert disp["x"] >= 0, f"display at negative x: {disp['x']}"
        assert disp["y"] >= 0, f"display at negative y: {disp['y']}"
    for b in proj.bitmaps:
        assert b.x >= 0, f"bitmap at negative x: {b.x}"
        assert b.y >= 0, f"bitmap at negative y: {b.y}"
    for elem in proj.elements:
        assert elem.x >= 0
        assert elem.y >= 0


def test_registration_markers_stay_within_canvas_id_only():
    """id_only QR uses a smaller reservation; still must not go negative."""
    from xcs_gen.generators import generate_gradient

    proj = generate_gradient(
        x_param="speed", x_min=500, x_max=2000, x_steps=10,
        total_width=22.0, total_height=5.0,
        start_x=10.0, start_y=10.0,
        registration_mode="compact",
        registration_qr_mode="id_only",
        test_id="abcd1234",
    )
    for disp in proj.extra_displays:
        assert disp["x"] >= 0, f"display at negative x: {disp['x']}"
        assert disp["y"] >= 0, f"display at negative y: {disp['y']}"
    for b in proj.bitmaps:
        assert b.x >= 0, f"bitmap at negative x: {b.x}"
        assert b.y >= 0, f"bitmap at negative y: {b.y}"
    for elem in proj.elements:
        assert elem.x >= 0
        assert elem.y >= 0


def test_registration_reservation_helper():
    """Helper returns (0, 0) when off; shift depends on qr_position otherwise."""
    from xcs_gen.capture.layout import (
        MARKER_MARGIN_MM,
        _QR_SIZE_ID_ONLY_MM,
        _QR_SIZE_INLINE_MM,
        registration_reservation_mm,
    )

    reserve_inline = _QR_SIZE_INLINE_MM + MARKER_MARGIN_MM
    reserve_id_only = _QR_SIZE_ID_ONLY_MM + MARKER_MARGIN_MM

    assert registration_reservation_mm("off", "inline") == (0.0, 0.0)
    assert registration_reservation_mm("off", "id_only") == (0.0, 0.0)
    # Default position is top-left: shift both axes
    assert registration_reservation_mm("compact", "inline") == (reserve_inline, reserve_inline)
    assert registration_reservation_mm("compact", "id_only") == (reserve_id_only, reserve_id_only)
    assert registration_reservation_mm("full", "inline") == (reserve_inline, reserve_inline)
    assert registration_reservation_mm("auto", "inline") == (reserve_inline, reserve_inline)
