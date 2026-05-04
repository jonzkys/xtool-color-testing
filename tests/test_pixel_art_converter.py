"""Tests for the pixel-art converter (build_pixel_art_project + serialisers)."""

from __future__ import annotations

from xcs_gen.model import Rect, XCSProject
from xcs_gen_web.pixel_art_converter import (
    build_pixel_art_project,
    pixel_art_to_xcs_bytes,
)
from xcs_gen_web.schemas import (
    BaseParams,
    PixelArtLayerSpec,
    PixelArtRectSpec,
    PixelArtRequest,
)


def _params() -> BaseParams:
    return BaseParams(
        power=50, speed=1000, frequency=65, density=100,
        passes=1, pulse_width=200, laser="red",
    )


def _req(**overrides) -> PixelArtRequest:
    base = dict(
        name="test",
        material_id="mat-1",
        width_mm=10.0,
        height_mm=10.0,
        start_x=10.0,
        start_y=20.0,
        cell_mm=1.0,
        rects=[PixelArtRectSpec(x=0, y=0, width=2, height=2, color="#000000")],
        layers=[PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params())],
    )
    base.update(overrides)
    return PixelArtRequest(**base)


def test_single_rect_emits_one_rect_element():
    project = build_pixel_art_project(_req())
    assert isinstance(project, XCSProject)
    assert len(project.elements) == 1
    rect = project.elements[0]
    assert isinstance(rect, Rect)
    assert rect.processing_type == "COLOR_FILL_ENGRAVE"
    assert rect.layer_color == "#000000"
    assert rect.width == 2
    assert rect.height == 2


def test_disabled_layer_drops_its_rects():
    req = _req(
        rects=[
            PixelArtRectSpec(x=0, y=0, width=2, height=2, color="#000000"),  # enabled
            PixelArtRectSpec(x=4, y=0, width=2, height=2, color="#ffffff"),  # disabled
            PixelArtRectSpec(x=8, y=0, width=2, height=2, color="#000000"),  # enabled
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=False, base_params=_params()),
        ],
    )
    project = build_pixel_art_project(req)
    assert len(project.elements) == 2
    assert all(e.layer_color == "#000000" for e in project.elements)


def test_all_disabled_raises():
    import pytest

    req = _req(
        layers=[PixelArtLayerSpec(color="#000000", enabled=False, base_params=_params())],
    )
    with pytest.raises(ValueError, match="No enabled rects"):
        build_pixel_art_project(req)


def test_start_offset_is_added_to_rect_position():
    req = _req(
        start_x=15.0,
        start_y=25.0,
        rects=[PixelArtRectSpec(x=3.0, y=4.0, width=1, height=1, color="#000000")],
    )
    rect = build_pixel_art_project(req).elements[0]
    assert rect.x == 18.0  # 15 + 3
    assert rect.y == 29.0  # 25 + 4


def test_xcs_bytes_round_trip():
    import json

    body = pixel_art_to_xcs_bytes(_req())
    assert isinstance(body, bytes)
    payload = json.loads(body.decode("utf-8"))
    assert isinstance(payload, dict)
    assert payload  # non-empty
