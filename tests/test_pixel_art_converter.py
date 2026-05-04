"""Tests for the pixel-art converter (build_pixel_art_project + serialisers)."""

from __future__ import annotations

from xcs_gen.model import Rect, XCSProject
from xcs_gen_web.pixel_art_converter import build_pixel_art_project
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
