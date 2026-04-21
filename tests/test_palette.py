"""Tests for CIE Lab conversion and CIEDE2000 color-distance helpers."""

from __future__ import annotations

from xcs_gen_web.palette import delta_e_2000, hex_to_lab


def test_delta_e_2000_identical_is_zero():
    lab = hex_to_lab("#c4a87b")
    assert delta_e_2000(lab, lab) < 0.01


def test_delta_e_2000_pure_colors_are_large():
    red = hex_to_lab("#ff0000")
    green = hex_to_lab("#00ff00")
    assert delta_e_2000(red, green) > 50
