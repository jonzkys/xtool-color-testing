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


def test_generate_from_svg_hatched_layer_emits_lines(tmp_path):
    """A hatched layer emits Lines into extra_displays/extra_device_entries."""
    path = _write(TWO_COLOR)
    from xcs_gen.svg_source import HatchPass
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        layer_config={
            "#000000": LayerConfig(
                params=ProcessingParams(),
                render_mode="hatched",
                hatch_passes=[HatchPass(angle=0, spacing=1.0)],
            ),
            "#ffffff": LayerConfig(
                params=ProcessingParams(),
                render_mode="fill_engrave",
            ),
        },
    )
    # The black half gets hatched; should produce many LINE displays.
    line_displays = [d for d in project.extra_displays if d.get("type") == "LINE"]
    assert len(line_displays) > 0
    # There should be matching device entries by id.
    line_ids = {d["id"] for d in line_displays}
    entry_ids = {eid for eid, _ in project.extra_device_entries}
    assert line_ids.issubset(entry_ids)


def test_generate_from_svg_rejects_hatched_on_stroke_layer():
    """A color that only appears as a stroke cannot have render_mode='hatched'."""
    import pytest
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10">
  <rect x="0" y="0" width="5" height="5" fill="none" stroke="#ff0000"/>
</svg>
"""
    path = _write(content)
    from xcs_gen.svg_source import HatchPass
    with pytest.raises(ValueError, match="stroke"):
        generate_from_svg(
            svg_path=path,
            total_width=100.0,
            layer_config={
                "#ff0000": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="hatched",
                    hatch_passes=[HatchPass(angle=0, spacing=1.0)],
                ),
            },
        )


def test_generate_from_svg_max_segments_enforced(tmp_path):
    """When max_segments is set low, hatched shapes refuse to generate."""
    import pytest
    path = _write(TWO_COLOR)
    from xcs_gen.svg_source import HatchPass
    with pytest.raises(ValueError, match="max_segments"):
        generate_from_svg(
            svg_path=path,
            total_width=100.0,
            layer_config={
                "#000000": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="hatched",
                    hatch_passes=[HatchPass(angle=0, spacing=0.1)],  # 500 lines
                ),
                "#ffffff": LayerConfig(
                    params=ProcessingParams(), render_mode="fill_engrave",
                ),
            },
            max_segments=50,
        )


def test_pikachu_hatched_yellow_round_trip(tmp_path):
    """Pikachu with a hatched yellow layer generates cleanly and passes build_xcs."""
    if not SAMPLE_PIKACHU.exists():
        import pytest
        pytest.skip("samples/Pikachu.svg missing")

    from xcs_gen.builder import write_xcs
    from xcs_gen.svg_source import HatchPass, HatchRamp

    from xcs_gen.svg_source import AutoRamp

    project = generate_from_svg(
        svg_path=str(SAMPLE_PIKACHU),
        total_width=80.0,
        layer_config={
            "#ffd73e": LayerConfig(
                params=ProcessingParams(),
                render_mode="hatched",
                hatch_passes=[
                    HatchPass(
                        angle=0, spacing=1.0,
                        ramps=[HatchRamp(param="power", axis="perp", min_value=30, max_value=70)],
                    ),
                ],
            ),
            "#000000": LayerConfig(
                params=ProcessingParams(speed=500, power=80),
                render_mode="vector_engrave",
            ),
        },
        auto_ramp=AutoRamp(param="power", min_value=20, max_value=80, sort_by="luminance"),
        max_segments=100000,
    )

    # Yellow produces LINEs, black produces a PATH per shape.
    line_count = sum(1 for d in project.extra_displays if d.get("type") == "LINE")
    path_count = len(project.paths)
    assert line_count > 0
    assert path_count > 0

    # Each LINE has a matching device entry.
    line_ids = {d["id"] for d in project.extra_displays if d.get("type") == "LINE"}
    entry_ids = {eid for eid, _ in project.extra_device_entries}
    assert line_ids.issubset(entry_ids)

    # Round-trip through builder + json.
    out = tmp_path / "pikachu_hatched.xcs"
    write_xcs(project, str(out))
    import json as _json
    with open(out) as f:
        data = _json.load(f)
    display_types = [d["type"] for d in data["canvas"][0]["displays"]]
    assert display_types.count("LINE") == line_count
    assert display_types.count("PATH") == path_count
