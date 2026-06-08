"""Tests for the pixel-art converter (build_pixel_art_project + serialisers)."""

from __future__ import annotations

from xcs_gen.model import Path, XCSProject
from xcs_gen_web.pixel_art_converter import (
    build_pixel_art_project,
    pixel_art_to_svg,
    pixel_art_to_xcs_bytes,
)
from xcs_gen_web.schemas import (
    BaseParams,
    PixelArtLayerSpec,
    PixelArtRequest,
    PixelArtShapeSpec,
)


def _params() -> BaseParams:
    return BaseParams(
        power=50, speed=1000, frequency=65, density=100,
        passes=1, pulse_width=200, laser="red",
    )


# A single 2x2 square loop (one shape, one loop).
def _square(x: float, y: float, s: float, color: str) -> PixelArtShapeSpec:
    return PixelArtShapeSpec(
        color=color,
        loops=[[(x, y), (x + s, y), (x + s, y + s), (x, y + s)]],
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
        shapes=[_square(0, 0, 2, "#000000")],
        layers=[PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params())],
    )
    base.update(overrides)
    return PixelArtRequest(**base)


def test_single_shape_emits_one_path_element():
    project = build_pixel_art_project(_req())
    assert isinstance(project, XCSProject)
    assert len(project.paths) == 1
    path = project.paths[0]
    assert isinstance(path, Path)
    assert path.processing_type == "COLOR_FILL_ENGRAVE"
    assert path.layer_color == "#000000"
    assert path.width == 2
    assert path.height == 2
    assert path.is_close_path is True
    assert path.is_compound_path is False  # one loop
    assert path.fill_rule == "evenodd"
    assert path.d.count("M") == 1


def test_disabled_layer_is_dropped():
    req = _req(
        shapes=[
            _square(0, 0, 2, "#000000"),  # enabled
            _square(4, 0, 2, "#ffffff"),  # disabled
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=False, base_params=_params()),
        ],
    )
    project = build_pixel_art_project(req)
    assert len(project.paths) == 1
    assert project.paths[0].layer_color == "#000000"


def test_multi_loop_shape_is_compound():
    # One colour, two loops (e.g. a ring + hole, or two regions).
    req = _req(
        shapes=[
            PixelArtShapeSpec(
                color="#000000",
                loops=[
                    [(0, 0), (2, 0), (2, 2), (0, 2)],
                    [(4, 0), (6, 0), (6, 2), (4, 2)],
                ],
            ),
        ],
    )
    path = build_pixel_art_project(req).paths[0]
    assert path.is_compound_path is True
    assert path.d.count("M") == 2


def test_all_disabled_raises():
    import pytest

    req = _req(
        layers=[PixelArtLayerSpec(color="#000000", enabled=False, base_params=_params())],
    )
    with pytest.raises(ValueError, match="No enabled shapes"):
        build_pixel_art_project(req)


def test_start_offset_is_added_to_loop_points():
    req = _req(
        start_x=15.0,
        start_y=25.0,
        shapes=[_square(3.0, 4.0, 1, "#000000")],
    )
    path = build_pixel_art_project(req).paths[0]
    assert path.x == 18.0  # 15 + 3
    assert path.y == 29.0  # 25 + 4
    assert path.width == 1
    assert path.height == 1


def test_two_colours_emit_two_paths():
    req = _req(
        shapes=[
            _square(0, 0, 1, "#000000"),
            _square(2, 0, 1, "#ffffff"),
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=True, base_params=_params()),
        ],
    )
    project = build_pixel_art_project(req)
    assert len(project.paths) == 2
    by_color = {p.layer_color: p for p in project.paths}
    assert by_color["#000000"].d.count("M") == 1
    assert by_color["#ffffff"].d.count("M") == 1


def test_xcs_bytes_round_trip():
    import json

    body, media, ext = pixel_art_to_xcs_bytes(_req(format="xcs"))
    assert (media, ext) == ("application/json", "xcs")
    assert isinstance(body, bytes)
    payload = json.loads(body.decode("utf-8"))
    assert isinstance(payload, dict)
    assert payload


def test_svg_has_correct_viewbox_and_path_count():
    from xml.etree import ElementTree as ET

    req = _req(
        width_mm=20.0,
        height_mm=15.0,
        shapes=[
            PixelArtShapeSpec(
                color="#000000",
                loops=[
                    [(0, 0), (2, 0), (2, 2), (0, 2)],
                    [(4, 0), (6, 0), (6, 2), (4, 2)],
                ],
            ),
        ],
    )
    svg = pixel_art_to_svg(req)
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")
    assert root.attrib["viewBox"] == "0 0 20.0 15.0"
    paths = root.findall(".//{http://www.w3.org/2000/svg}path")
    assert len(paths) == 1  # one colour → one path
    assert paths[0].attrib["fill"] == "#000000"
    assert paths[0].attrib["d"].count("M") == 2  # two loops


def test_svg_omits_disabled_layer_paths():
    from xml.etree import ElementTree as ET

    req = _req(
        shapes=[
            _square(0, 0, 2, "#000000"),
            _square(4, 0, 2, "#ffffff"),
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=False, base_params=_params()),
        ],
    )
    svg = pixel_art_to_svg(req)
    root = ET.fromstring(svg)
    paths = root.findall(".//{http://www.w3.org/2000/svg}path")
    assert len(paths) == 1
    assert paths[0].attrib["fill"] == "#000000"


def test_display_color_drives_layer_color_and_svg_fill():
    """A matched layer's display_color (palette entry hex) overrides the
    centroid for both the .xcs layer_color and the SVG fill; None falls back
    to the centroid (covered by the single-shape test above)."""
    from xml.etree import ElementTree as ET

    req = _req(
        shapes=[_square(0, 0, 2, "#000000")],
        layers=[
            PixelArtLayerSpec(
                color="#000000",
                enabled=True,
                base_params=_params(),
                display_color="#d4af37",
            ),
        ],
    )
    path = build_pixel_art_project(req).paths[0]
    assert path.layer_color == "#d4af37"  # matched palette hex, not the centroid

    root = ET.fromstring(pixel_art_to_svg(req))
    fill = root.findall(".//{http://www.w3.org/2000/svg}path")[0].attrib["fill"]
    assert fill == "#d4af37"
