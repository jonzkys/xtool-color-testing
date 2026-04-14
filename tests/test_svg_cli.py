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
