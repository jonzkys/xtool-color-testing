"""Tests for laser_indices.compute_indices.

Reference values are hand-computed from the formulas in the spec:
- pulse_spacing_mm     = speed / (mopa_frequency_khz * 1000)
- line_spacing_index   = 1 / density
- pulse_energy_index   = power_percent / mopa_frequency_khz
- pulse_intensity_index = power_percent / (mopa_frequency_khz * pulse_width_ns)
- surface_exposure_index = power_percent * density * repeat / speed
"""
from __future__ import annotations

import math
from dataclasses import FrozenInstanceError

import pytest

from xcs_gen.laser_indices import (
    INDICES_FORMULA_VERSION,
    LaserIndices,
    compute_indices,
)
from xcs_gen.model import ProcessingParams


def test_defaults_match_hand_computation() -> None:
    indices = compute_indices(ProcessingParams())
    assert isinstance(indices, LaserIndices)
    assert indices.pulse_spacing_mm == pytest.approx(1000 / (65 * 1000))
    assert indices.line_spacing_index == pytest.approx(1 / 100)
    assert indices.line_spacing_mm is None
    assert indices.pulse_energy_index == pytest.approx(50 / 65)
    assert indices.pulse_intensity_index == pytest.approx(50 / (65 * 200))
    assert indices.surface_exposure_index == pytest.approx(50 * 100 * 1 / 1000)
    assert indices.formula_version == INDICES_FORMULA_VERSION
    assert indices.density_model == "opaque"
    assert indices.power_model == "controller_percent"


def test_stainless_high_density_case() -> None:
    p = ProcessingParams(speed=400, density=2566, repeat=2)
    indices = compute_indices(p)
    assert indices.surface_exposure_index == pytest.approx(50 * 2566 * 2 / 400)
    assert indices.line_spacing_index == pytest.approx(1 / 2566)


def test_zero_speed_raises_value_error_naming_field() -> None:
    p = ProcessingParams(speed=0)
    with pytest.raises(ValueError, match="speed"):
        compute_indices(p)


def test_zero_frequency_raises_value_error_naming_field() -> None:
    p = ProcessingParams(mopa_frequency=0)
    with pytest.raises(ValueError, match="mopa_frequency"):
        compute_indices(p)


def test_zero_density_raises_value_error_naming_field() -> None:
    p = ProcessingParams(density=0)
    with pytest.raises(ValueError, match="density"):
        compute_indices(p)


def test_zero_pulse_width_raises_value_error_naming_field() -> None:
    p = ProcessingParams(pulse_width=0)
    with pytest.raises(ValueError, match="pulse_width"):
        compute_indices(p)


def test_line_spacing_mm_stays_none_under_opaque_model() -> None:
    indices = compute_indices(ProcessingParams(), density_model="opaque")
    assert indices.line_spacing_mm is None


def test_formula_version_is_one() -> None:
    assert INDICES_FORMULA_VERSION == 1


def test_immutable_dataclass() -> None:
    p = ProcessingParams()
    indices = compute_indices(p)
    with pytest.raises(FrozenInstanceError):
        indices.surface_exposure_index = 999.0  # type: ignore[misc]


def test_finite_values_for_all_indices() -> None:
    indices = compute_indices(ProcessingParams())
    for name in (
        "pulse_spacing_mm",
        "line_spacing_index",
        "pulse_energy_index",
        "pulse_intensity_index",
        "surface_exposure_index",
    ):
        v = getattr(indices, name)
        assert math.isfinite(v), f"{name} is not finite: {v}"
