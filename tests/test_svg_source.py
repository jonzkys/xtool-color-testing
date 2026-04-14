"""Tests for svg_source parsing."""

import io
import tempfile

from xcs_gen.svg_source import ParsedShape, parse_svg


def _write(content: str) -> str:
    path = tempfile.mktemp(suffix=".svg")
    with open(path, "w") as f:
        f.write(content)
    return path


INLINE_BASIC = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="10" y="20" width="30" height="40" fill="#ff0000"/>
  <circle cx="50" cy="50" r="10" fill="none" stroke="#00ff00" stroke-width="1"/>
  <path d="M 0,0 L 20,20 Z" fill="#0000ff"/>
</svg>
"""


INLINE_TRANSFORMED = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <g transform="translate(50, 0)">
    <rect x="0" y="0" width="20" height="20" fill="#ffd73e"/>
  </g>
</svg>
"""


def test_parse_svg_basic_shape_count():
    path = _write(INLINE_BASIC)
    result = parse_svg(path, total_width=100.0, total_height=None)
    # rect + circle + path = 3 shapes
    assert len(result.shapes) == 3


def test_parse_svg_fill_and_stroke_resolved():
    path = _write(INLINE_BASIC)
    result = parse_svg(path, total_width=100.0, total_height=None)

    by_kind = {s.kind: s for s in result.shapes}
    assert by_kind["rect"].fill == "#ff0000"
    assert by_kind["rect"].stroke is None  # no stroke attribute

    assert by_kind["circle"].fill is None  # fill="none"
    assert by_kind["circle"].stroke == "#00ff00"

    assert by_kind["path"].fill == "#0000ff"


def test_parse_svg_transform_baked_into_bbox():
    path = _write(INLINE_TRANSFORMED)
    # SVG is 100x100 in doc units, asking for 100mm output → scale 1:1
    result = parse_svg(path, total_width=100.0, total_height=None)
    shape = result.shapes[0]
    # The rect was translated by (50, 0) in doc space, should end up around x=50.
    # Plus the default start_x offset of 0 (we pass 0 here via total_width only).
    assert shape.bbox_x_mm >= 50 - 0.01
    assert shape.bbox_x_mm < 51
    assert shape.bbox_width_mm >= 19.9
    assert shape.bbox_width_mm <= 20.1


def test_parse_svg_lowercase_hex_normalization():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="#FFD73E"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=10.0, total_height=None)
    assert result.shapes[0].fill == "#ffd73e"


def test_parse_svg_named_color_expanded():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="red"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=10.0, total_height=None)
    assert result.shapes[0].fill == "#ff0000"


def test_parse_svg_none_and_transparent_become_none():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="none" stroke="transparent"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=10.0, total_height=None)
    assert result.shapes[0].fill is None
    assert result.shapes[0].stroke is None


def test_parse_svg_aspect_preserved_when_only_width():
    # 200x100 viewBox, ask for 100mm wide → 50mm tall
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200mm" height="100mm">
  <rect x="0" y="0" width="200" height="100" fill="#000000"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=100.0, total_height=None)
    assert abs(result.output_width_mm - 100.0) < 0.01
    assert abs(result.output_height_mm - 50.0) < 0.01
