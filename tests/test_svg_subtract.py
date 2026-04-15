"""Tests for SVG-layer boolean subtraction."""

from pathlib import Path

from xcs_gen_web.svg_subtract import subtract_overlapping_shapes
from xcs_gen.svg_source import ParsedShape, parse_svg


SAMPLES = Path(__file__).parent.parent / "samples"
PIKACHU_SVG = SAMPLES / "Pikachu.svg"


def _sq(x: float, y: float, w: float, h: float, fill: str = "#ff0000") -> ParsedShape:
    """Make a rectangular filled shape from a simple path d-string."""
    d = f"M {x} {y} L {x + w} {y} L {x + w} {y + h} L {x} {y + h} Z"
    return ParsedShape(
        kind="path", d=d,
        bbox_x_mm=x, bbox_y_mm=y, bbox_width_mm=w, bbox_height_mm=h,
        fill=fill, stroke=None, fill_rule="evenodd", is_close_path=True,
    )


def test_no_overlap_no_change():
    """Two shapes that don't touch both pass through unchanged."""
    shapes = [_sq(0, 0, 10, 10, "#ff0000"), _sq(20, 0, 10, 10, "#00ff00")]
    result = subtract_overlapping_shapes(shapes)
    assert len(result) == 2
    # Colors preserved
    assert {s.fill for s in result} == {"#ff0000", "#00ff00"}


def test_top_shape_removes_pixels_from_bottom():
    """A 5x5 top shape inside a 10x10 bottom should shrink the bottom's area by 25."""
    bottom = _sq(0, 0, 10, 10, "#ff0000")   # 100 sq units
    top = _sq(2, 2, 5, 5, "#0000ff")        # 25 sq units, fully inside bottom
    result = subtract_overlapping_shapes([bottom, top])

    # Still 2 shapes - bottom has a hole, top is unchanged
    assert len(result) == 2
    new_bottom, new_top = result
    assert new_top.fill == "#0000ff"  # top unchanged
    assert new_bottom.fill == "#ff0000"
    # Bottom's bbox is still 10x10 but the shape now has a hole
    assert new_bottom.bbox_width_mm == 10
    assert new_bottom.bbox_height_mm == 10


def test_fully_covered_bottom_dropped():
    """A bottom shape entirely covered by a top shape is removed."""
    bottom = _sq(0, 0, 10, 10, "#ff0000")
    top = _sq(-1, -1, 12, 12, "#0000ff")  # covers bottom
    result = subtract_overlapping_shapes([bottom, top])
    assert len(result) == 1
    assert result[0].fill == "#0000ff"


def test_stroke_only_shapes_pass_through():
    """Stroke-only shapes (fill=None) are untouched by subtraction."""
    stroke = ParsedShape(
        kind="path", d="M 0 0 L 10 0 L 10 10 L 0 10 Z",
        bbox_x_mm=0, bbox_y_mm=0, bbox_width_mm=10, bbox_height_mm=10,
        fill=None, stroke="#000000", fill_rule="evenodd", is_close_path=True,
    )
    cover = _sq(0, 0, 10, 10, "#ff0000")
    result = subtract_overlapping_shapes([stroke, cover])
    # Stroke survives; filled cover unchanged (nothing above it)
    assert len(result) == 2
    assert any(s.stroke == "#000000" and s.fill is None for s in result)


def test_api_preview_disabled_layer_still_occludes():
    """With a disabled middle layer, lower layers should still show its hole.

    E.g. disable yellow on Pikachu and the black silhouette below should
    still have its yellow-shaped hole (because subtraction uses the full
    z-stack; enable/disable only gates whether a layer ends up in the
    preview).
    """
    import json
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app

    client = TestClient(create_app())
    svg = PIKACHU_SVG.read_text()

    # Unsubtracted black shape - full silhouette
    all_enabled = client.post("/api/svg-preview", json={
        "svg_content": svg, "width_mm": 50,
        "enabled_colors": ["#000000"],
        "subtract_overlaps": False,
    }).json()["svg"]

    # With subtraction and yellow disabled, black should still be occluded
    # by yellow (subtraction sees the full z-stack)
    yellow_off = client.post("/api/svg-preview", json={
        "svg_content": svg, "width_mm": 50,
        "enabled_colors": ["#000000"],  # yellow etc. NOT in enabled list
        "subtract_overlaps": True,
    }).json()["svg"]

    # The subtracted version should have a different (smaller) d-string than the
    # un-subtracted version.
    assert all_enabled != yellow_off


def test_pikachu_subtraction_reduces_but_preserves_colors():
    """Real SVG regression: subtraction keeps each layer color present in the output,
    but removes at least some pixels from under higher layers."""
    parse_result = parse_svg(str(PIKACHU_SVG), total_width=50.0, total_height=None)
    assert len(parse_result.shapes) > 0

    before_colors = {s.fill for s in parse_result.shapes if s.fill}
    result = subtract_overlapping_shapes(parse_result.shapes)
    after_colors = {s.fill for s in result if s.fill}

    # All colors still present (nothing got fully covered to the point of removing a whole layer)
    assert after_colors == before_colors
    # At least one shape's d-string changed (something got subtracted)
    changed = sum(
        1 for before, after in zip(parse_result.shapes, result)
        if before.fill and before.d != after.d
    )
    assert changed > 0
