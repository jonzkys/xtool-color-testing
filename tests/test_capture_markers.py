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
        base_params=ProcessingParams(),
        kind="grid",
    )
    decoded = decode_payload(payload)
    assert decoded["id"] == "a1b2c3d4"
    assert decoded["t"] == "grid"
    assert decoded["x"] == {"p": "speed", "min": 100, "max": 5000, "n": 50}
    assert decoded["y"] == {"p": "power", "min": 10, "max": 100, "n": 10}


def test_qr_payload_without_y():
    payload = qr_payload_for_test(
        test_id="abcdefgh",
        x_param="speed", x_min=100, x_max=5000, x_steps=50,
        y_param=None, y_min=0, y_max=0, y_steps=1,
        grid_w=22.0, grid_h=5.0, rows=1, gap=0.0,
        base_params=ProcessingParams(),
        kind="grid",
    )
    decoded = decode_payload(payload)
    assert "y" not in decoded


def test_emit_adds_annotation_layer_rects_for_qr():
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
    # Every extra_display added for markers should be on the annotation layer.
    assert len(project.extra_displays) > 0
    for disp in project.extra_displays:
        assert disp.get("layerColor") == ANNOTATION_LAYER_COLOR


def test_emit_full_mode_produces_more_displays_than_compact():
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
    assert len(full.extra_displays) > len(compact.extra_displays)


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
    assert len(with_reg.extra_displays) > len(without.extra_displays)
