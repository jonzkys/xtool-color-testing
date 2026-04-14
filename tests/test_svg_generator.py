"""Tests for generate_from_svg."""

import tempfile

from xcs_gen.builder import build_xcs
from xcs_gen.generators import generate_from_svg
from xcs_gen.model import ProcessingParams
from xcs_gen.svg_source import AutoRamp, LayerConfig


def _write(content: str) -> str:
    path = tempfile.mktemp(suffix=".svg")
    with open(path, "w") as f:
        f.write(content)
    return path


TWO_COLOR = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="0" y="0" width="50" height="50" fill="#000000"/>
  <rect x="50" y="50" width="50" height="50" fill="#ffffff"/>
</svg>
"""


FILL_AND_STROKE = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="0" y="0" width="50" height="50" fill="#ff0000" stroke="#000000" stroke-width="1"/>
</svg>
"""


def test_generate_from_svg_element_count():
    path = _write(TWO_COLOR)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80,
            sort_by="luminance",
        ),
    )
    # Two fills, no strokes → two paths.
    assert len(project.paths) == 2


def test_generate_from_svg_fill_and_stroke_double_emission():
    path = _write(FILL_AND_STROKE)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        layer_config={
            "#ff0000": LayerConfig(params=ProcessingParams(power=40)),
            "#000000": LayerConfig(
                params=ProcessingParams(power=90), render_mode="vector_cut",
            ),
        },
    )
    # One shape, one fill, one stroke → two emitted paths.
    assert len(project.paths) == 2
    fill_path = next(p for p in project.paths if p.layer_color == "#ff0000")
    stroke_path = next(p for p in project.paths if p.layer_color == "#000000")
    assert fill_path.processing_type == "COLOR_FILL_ENGRAVE"
    assert stroke_path.processing_type == "VECTOR_CUTTING"
    assert fill_path.params.power == 40
    assert stroke_path.params.power == 90


def test_generate_from_svg_power_ramp_by_luminance():
    path = _write(TWO_COLOR)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80, sort_by="luminance",
        ),
    )
    black_path = next(p for p in project.paths if p.layer_color == "#000000")
    white_path = next(p for p in project.paths if p.layer_color == "#ffffff")
    assert black_path.params.power == 80
    assert white_path.params.power == 20


def test_generate_from_svg_roundtrips_through_builder():
    path = _write(TWO_COLOR)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80, sort_by="luminance",
        ),
    )
    out = build_xcs(project)
    types = [d["type"] for d in out["canvas"][0]["displays"]]
    assert types.count("PATH") == 2


from pathlib import Path as _Path

from xcs_gen.svg_source import detect_svg_colors


SAMPLE_PIKACHU = _Path(__file__).parent.parent / "samples" / "Pikachu.svg"


def test_pikachu_colors_detected():
    if not SAMPLE_PIKACHU.exists():
        import pytest
        pytest.skip("samples/Pikachu.svg missing")
    colors = detect_svg_colors(str(SAMPLE_PIKACHU))
    hex_set = {c.hex for c in colors}
    # Pikachu has at least black outlines and yellow body.
    assert "#000000" in hex_set
    assert "#ffd73e" in hex_set


def test_pikachu_round_trip(tmp_path):
    if not SAMPLE_PIKACHU.exists():
        import pytest
        pytest.skip("samples/Pikachu.svg missing")

    from xcs_gen.builder import write_xcs

    project = generate_from_svg(
        svg_path=str(SAMPLE_PIKACHU),
        total_width=80.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80, sort_by="luminance",
        ),
    )
    # Every path has a non-empty d and a layer_color.
    for p in project.paths:
        assert p.d
        assert p.layer_color.startswith("#")
        assert p.width >= 0
        assert p.height >= 0

    # Round-trip through builder and write.
    out = tmp_path / "pikachu.xcs"
    write_xcs(project, str(out))
    import json as _json
    with open(out) as f:
        data = _json.load(f)
    display_types = [d["type"] for d in data["canvas"][0]["displays"]]
    assert display_types.count("PATH") == len(project.paths)
