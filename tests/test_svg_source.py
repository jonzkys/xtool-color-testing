"""Tests for svg_source parsing."""

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


from xcs_gen.svg_source import DetectedColor, detect_svg_colors


def test_detect_colors_basic():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="#ff0000"/>
  <rect x="5" y="0" width="5" height="5" fill="#ff0000"/>
  <circle cx="5" cy="5" r="2" fill="none" stroke="#00ff00"/>
</svg>
"""
    path = _write(content)
    colors = detect_svg_colors(path)
    by_hex = {c.hex: c for c in colors}
    assert by_hex["#ff0000"].source == "fill"
    assert by_hex["#ff0000"].shape_count == 2
    assert by_hex["#00ff00"].source == "stroke"
    assert by_hex["#00ff00"].shape_count == 1


def test_detect_colors_both_fill_and_stroke():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="#000000" stroke="#000000"/>
</svg>
"""
    path = _write(content)
    colors = detect_svg_colors(path)
    assert len(colors) == 1
    assert colors[0].hex == "#000000"
    assert colors[0].source == "both"
    assert colors[0].shape_count == 1


def test_is_near_white_pure_white():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#ffffff") is True


def test_is_near_white_vtracer_artefact():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#fdfdfd") is True
    assert is_near_white("#fefefe") is True


def test_is_near_white_threshold_boundary_inclusive():
    """#dcdcdc is (220,220,220) — exactly on the threshold, spread=0, near-white."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#dcdcdc") is True


def test_is_near_white_threshold_just_below_is_false():
    """#dbdbdb is (219,219,219) — one below threshold, not near-white."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#dbdbdb") is False


def test_is_near_white_yellow_one_channel_zero():
    """One channel below threshold disqualifies the colour."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#ffff00") is False  # blue channel = 0


def test_is_near_white_vtracer_greys_caught():
    """Real near-neutral vtracer outputs on a white background — all caught."""
    from xcs_gen.svg_source import is_near_white
    # Sampled from vtracer output on a real PNG with white background:
    assert is_near_white("#dcdddd") is True  # (220,221,221) — min=220, spread=1
    assert is_near_white("#dfe0e2") is True  # (223,224,226)
    assert is_near_white("#e4e5e5") is True  # (228,229,229)
    assert is_near_white("#f0f0f1") is True  # (240,240,241)
    assert is_near_white("#f6f4f4") is True  # (246,244,244)


def test_is_near_white_just_below_bright_threshold():
    """#dbdcdd (219,220,221) — min=219 < 220 bright threshold, excluded."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#dbdcdd") is False


def test_is_near_white_spread_too_wide_excludes_pale_colours():
    """Cream and pale blue have coloured tints — channel spread > 20 excludes them."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#fff5e6") is False  # cream: spread=25 (red-yellow tint)
    assert is_near_white("#e0f7fa") is False  # pale blue: spread=26
    assert is_near_white("#f2ec93") is False  # pale yellow: min=147 fails bright check


def test_is_near_white_slight_tint_within_spread_caught():
    """A slight pink tint in a near-white (vtracer artefact) should still count."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#faeef0") is True  # (250,238,240), spread=12


def test_is_near_white_cyan_one_channel_below():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#f5f5f4") is True  # (245,245,244) — bright + spread=1


def test_is_near_white_invalid_inputs():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("") is False
    assert is_near_white("none") is False
    assert is_near_white("#fff") is False  # 3-digit hex not supported
    assert is_near_white("ffffff") is False  # missing leading #
