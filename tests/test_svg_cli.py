"""Tests for the svg CLI subcommands."""

import io
import sys
import tempfile

import pytest

from xcs_gen.cli import main


TWO_COLOR = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="0" y="0" width="50" height="50" fill="#000000"/>
  <rect x="50" y="50" width="50" height="50" fill="#ffffff"/>
</svg>
"""


def _write_svg(content: str) -> str:
    path = tempfile.mktemp(suffix=".svg")
    with open(path, "w") as f:
        f.write(content)
    return path


def test_svg_detect_prints_colors(capsys):
    svg_path = _write_svg(TWO_COLOR)
    main(["svg", "detect", svg_path])
    out = capsys.readouterr().out
    assert "#000000" in out
    assert "#ffffff" in out
    assert "fill" in out


import json
import os


def test_svg_generate_with_auto_ramp(tmp_path):
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")

    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--ramp-param", "power",
        "--ramp-min", "20", "--ramp-max", "80",
    ])

    assert os.path.exists(out_path)
    with open(out_path) as f:
        data = json.load(f)
    displays = data["canvas"][0]["displays"]
    path_types = [d["type"] for d in displays]
    assert path_types.count("PATH") == 2


def test_svg_generate_with_explicit_color(tmp_path):
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")

    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--color", "#000000:vector_cut:500,80,65,100,2,200",
        "--ramp-param", "power",
        "--ramp-min", "20", "--ramp-max", "80",
    ])

    with open(out_path) as f:
        data = json.load(f)

    # #000000 is explicit with processing=VECTOR_CUTTING, power=80, speed=500.
    dev_entries = data["device"]["data"]["value"][0][1]["displays"]["value"]
    cuts = [e for e in dev_entries if e[1]["processingType"] == "VECTOR_CUTTING"]
    assert len(cuts) == 1
    cut_params = cuts[0][1]["data"]["VECTOR_CUTTING"]["parameter"]["customize"]
    assert cut_params["speed"] == 500
    assert cut_params["power"] == 80


def test_svg_generate_color_syntax_blank_fields(tmp_path):
    """Blank fields in --color inherit from --base-* defaults."""
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")

    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--power", "42",
        "--color", "#000000:fill_engrave:,,,,,",  # blanks everywhere
        "--ramp-param", "speed",
        "--ramp-min", "500", "--ramp-max", "2000",
    ])

    with open(out_path) as f:
        data = json.load(f)

    dev_entries = data["device"]["data"]["value"][0][1]["displays"]["value"]
    # #000000 is explicit; its power should come from --power default (42).
    black_entry = next(
        e for e in dev_entries
        if e[1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["power"] == 42
    )
    assert black_entry is not None
