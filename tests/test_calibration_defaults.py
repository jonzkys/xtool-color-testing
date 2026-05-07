"""Tests for the per-substrate clean-pass defaults registry."""

from __future__ import annotations

from xcs_gen_web.calibration_defaults import default_clean_pass


def test_stainless_returns_baseparams_dict():
    cp = default_clean_pass("stainless-steel")
    assert isinstance(cp, dict)
    assert {"power", "speed", "frequency", "density", "passes",
            "pulse_width", "laser"}.issubset(cp.keys())


def test_unknown_substrate_returns_none():
    assert default_clean_pass("titanium-magic") is None


def test_returned_dict_is_a_copy():
    a = default_clean_pass("stainless-steel")
    a["power"] = 999
    b = default_clean_pass("stainless-steel")
    assert b["power"] != 999
