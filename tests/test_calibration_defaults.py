"""Tests for the per-substrate calibration default registry."""

from __future__ import annotations

from xcs_gen_web.calibration_defaults import (
    DEFAULT_PATCH_COUNT,
    default_calibration_patches,
    default_clean_pass,
)


def test_stainless_clean_pass_returns_baseparams_dict():
    cp = default_clean_pass("stainless-steel")
    assert isinstance(cp, dict)
    assert {"power", "speed", "frequency", "density", "passes",
            "pulse_width", "laser"}.issubset(cp.keys())


def test_stainless_three_patches_with_distinct_params():
    patches = default_calibration_patches("stainless-steel")
    assert len(patches) == DEFAULT_PATCH_COUNT == 3
    labels = [p["label"] for p in patches]
    assert labels == ["light", "mid", "dark"]
    powers = [p["params"]["power"] for p in patches]
    assert powers[0] < powers[1] < powers[2]
    for patch in patches:
        assert patch["canonical_rgb"] is None


def test_unknown_substrate_returns_none():
    assert default_clean_pass("titanium-magic") is None
    assert default_calibration_patches("titanium-magic") is None
