"""Tests for SVG-layer boolean subtraction."""

from pathlib import Path

import pytest

from xcs_gen.hatch import svg_d_to_polygon
from xcs_gen_web.svg_subtract import (
    clip_shapes_to_rect,
    subtract_and_clip,
    subtract_overlapping_shapes,
)
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


# ── clip_shapes_to_rect ─────────────────────────────────────────────────────


def test_clip_inside_rect_passes_through():
    """A shape strictly inside the canvas survives untouched."""
    shapes = [_sq(2, 2, 5, 5, "#ff0000")]
    out = clip_shapes_to_rect(shapes, x=0, y=0, width=10, height=10)
    assert len(out) == 1
    assert out[0].d == shapes[0].d  # unchanged
    assert out[0].fill == "#ff0000"


def test_clip_outside_rect_drops_shape():
    """A shape entirely outside the canvas is removed."""
    shapes = [_sq(20, 20, 5, 5, "#ff0000")]
    out = clip_shapes_to_rect(shapes, x=0, y=0, width=10, height=10)
    assert out == []


def test_clip_overhanging_shape_trimmed_to_rect():
    """A shape that pokes past the canvas edge gets trimmed to the rect."""
    shapes = [_sq(-2, -2, 14, 14, "#ff0000")]  # 14×14 centred to overhang on all sides
    out = clip_shapes_to_rect(shapes, x=0, y=0, width=10, height=10)
    assert len(out) == 1
    s = out[0]
    # bbox now exactly the canvas
    assert s.bbox_x_mm == 0
    assert s.bbox_y_mm == 0
    assert s.bbox_width_mm == 10
    assert s.bbox_height_mm == 10
    assert s.fill == "#ff0000"


def test_clip_stroke_only_passes_through():
    """Stroke-only shapes (fill=None) pass through unchanged."""
    s = _sq(0, 0, 5, 5, "#ff0000")
    s = ParsedShape(
        kind=s.kind, d=s.d,
        bbox_x_mm=s.bbox_x_mm, bbox_y_mm=s.bbox_y_mm,
        bbox_width_mm=s.bbox_width_mm, bbox_height_mm=s.bbox_height_mm,
        fill=None, stroke="#000", fill_rule="evenodd", is_close_path=True,
    )
    out = clip_shapes_to_rect([s], x=0, y=0, width=2, height=2)
    assert len(out) == 1
    assert out[0].fill is None


# ── subtract_and_clip (fused) ───────────────────────────────────────────────

def test_subtract_and_clip_matches_running_the_two_steps_separately():
    """The fused pass must agree with subtract-then-clip on real geometry.

    Fusing exists because the separate steps build every polygon twice:
    subtraction computes a shapely geometry, serialises it to a d-string, and
    the clip immediately parses that string back just to ask whether it sits
    inside the canvas.
    """
    parse_result = parse_svg(str(PIKACHU_SVG), total_width=50, total_height=None)
    shapes = list(parse_result.shapes)
    w, h = parse_result.output_width_mm, parse_result.output_height_mm

    fused = subtract_and_clip(shapes, x=0, y=0, width=w, height=h)
    separate = clip_shapes_to_rect(
        subtract_overlapping_shapes(shapes), x=0, y=0, width=w, height=h,
    )

    assert len(fused) == len(separate)
    assert [s.fill for s in fused] == [s.fill for s in separate]

    # Most d-strings are byte-identical. The few that differ are float noise —
    # the fused pass unions an ``intersects``-filtered candidate set and clips
    # from unrounded geometry, where the separate path unions a bbox-query set
    # and clips from a re-parsed %.4f string. Compare by area, not by bytes.
    # (Both paths already preserved a shape's original curves when neither
    # step touched it; measured 120/122 on this fixture either way.)
    for a, b in zip(fused, separate):
        if a.d == b.d:
            continue
        pa = svg_d_to_polygon(a.d, fill_rule=a.fill_rule)
        pb = svg_d_to_polygon(b.d, fill_rule=b.fill_rule)
        if pa is None or pb is None:
            continue
        assert pa.symmetric_difference(pb).area < 1e-4


def test_subtract_and_clip_still_subtracts():
    """Sanity: the fused pass has not quietly become clip-only."""
    bottom = _sq(0, 0, 10, 10, "#ff0000")
    top = _sq(0, 0, 5, 10, "#00ff00")
    out = subtract_and_clip([bottom, top], x=0, y=0, width=10, height=10)
    assert len(out) == 2
    red = next(s for s in out if s.fill == "#ff0000")
    poly = svg_d_to_polygon(red.d, fill_rule=red.fill_rule)
    # The left half was covered by the green shape above it.
    assert poly.area == pytest.approx(50, abs=0.5)


def test_subtract_and_clip_drops_a_shape_fully_outside_the_canvas():
    lone = _sq(20, 20, 10, 10, "#0000ff")
    out = subtract_and_clip([lone], x=0, y=0, width=10, height=10)
    assert out == []


def test_bbox_fast_path_does_not_trust_a_shape_sitting_exactly_on_the_edge():
    """A shape flush with the canvas edge must not take the bbox shortcut.

    Post-subtract d-strings are written at %.4f while the bbox came from
    unrounded shapely bounds, so a flattened ring can sit fractionally outside
    its own recorded bbox. ``_bbox_inside`` therefore demands a margin; a shape
    whose bbox exactly equals the canvas must fall through to a real
    intersection rather than being waved past.
    """
    from xcs_gen_web.svg_subtract import _bbox_inside

    flush_with_edge = _sq(0, 0, 10, 10)
    assert not _bbox_inside(flush_with_edge, 0, 0, 10, 10)

    well_inside = _sq(2, 2, 6, 6)
    assert _bbox_inside(well_inside, 0, 0, 10, 10)


def test_clip_does_not_trust_the_bbox_of_an_arc_path():
    """An arc path must be clipped by real geometry, not by its recorded bbox.

    ``_path_to_rings`` samples curves at points that lie ON the curve, so for
    lines, cubics and quadratics the flattened polygon is inscribed in the true
    curve and svgelements' exact segment bbox necessarily contains it — which
    is what makes the bbox fast path sound.

    svgelements 1.9.6's ``Arc.bbox()`` breaks that: it under-estimates the
    extrema of an eccentric rotated arc, so the flattened ring extends BEYOND
    the bbox the shape carries. Waving such a shape through on its bbox lets
    geometry bleed past the canvas — the exact failure this clip exists to
    prevent.
    """
    import os
    import tempfile

    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        '<path d="M 10 50 A 40 15 30 1 0 90 50 Z" fill="#ff0000"/></svg>'
    )
    fd, path = tempfile.mkstemp(suffix=".svg")
    os.write(fd, svg.encode())
    os.close(fd)
    try:
        parsed = parse_svg(path, total_width=100, total_height=None)
    finally:
        os.unlink(path)

    shape = parsed.shapes[0]
    poly = svg_d_to_polygon(shape.d, fill_rule=shape.fill_rule)

    # Precondition: the flattened geometry really does exceed its own bbox.
    # If svgelements ever fixes Arc.bbox() this assertion fails loudly and the
    # guard below can be reconsidered, rather than silently becoming dead code.
    recorded_right = shape.bbox_x_mm + shape.bbox_width_mm
    assert poly.bounds[2] > recorded_right, (
        "Arc.bbox() no longer under-estimates; revisit the _bbox_inside guard"
    )

    # Put the canvas edge between the two so only real geometry can decide.
    width = poly.bounds[2] - 0.002
    out = clip_shapes_to_rect([shape], x=0, y=0, width=width, height=100)
    assert out, "the shape should survive, trimmed"
    clipped = svg_d_to_polygon(out[0].d, fill_rule=out[0].fill_rule)
    # Tolerance is one %.4f quantum: ``_geom_to_svg_d`` writes coordinates at
    # four decimal places, so a correctly-clipped edge can still read back up
    # to 5e-5 mm high. The unclipped bleed this guards against is ~0.03 mm,
    # nearly three orders of magnitude larger.
    assert clipped.bounds[2] <= width + 1e-4, (
        f"geometry bled {clipped.bounds[2] - width:.4f} mm past the canvas"
    )
