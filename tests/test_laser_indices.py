"""Tests for laser_indices.compute_indices.

Reference values are hand-computed from the formulas in the spec:
- pulse_spacing_mm      = speed / (mopa_frequency_khz * 1000)
- line_spacing_mm       = 10 / density  (lines/cm → mm/line)
- pulse_energy_index    = power_percent / mopa_frequency_khz
- pulse_intensity_index = power_percent / (mopa_frequency_khz * pulse_width_ns)
- total_exposure_index  = power_percent * mopa_frequency_khz * density * repeat / speed
"""
from __future__ import annotations

import dataclasses
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
    assert indices.line_spacing_mm == pytest.approx(10 / 100)
    assert indices.pulse_energy_index == pytest.approx(50 / 65)
    assert indices.pulse_intensity_index == pytest.approx(50 / (65 * 200))
    assert indices.total_exposure_index == pytest.approx(50 * 65 * 100 * 1 / 1000)
    assert indices.duty_cycle_index == pytest.approx(65 * 200 / 10_000)
    assert indices.formula_version == INDICES_FORMULA_VERSION
    assert indices.density_model == "lpc"
    assert indices.power_model == "controller_percent"


def test_stainless_high_density_case() -> None:
    p = ProcessingParams(speed=400, density=2566, repeat=2)
    indices = compute_indices(p)
    # power=50, freq=65 (defaults), density=2566, repeat=2, speed=400
    assert indices.total_exposure_index == pytest.approx(50 * 65 * 2566 * 2 / 400)
    assert indices.line_spacing_mm == pytest.approx(10 / 2566)


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


def test_formula_version_is_six() -> None:
    assert INDICES_FORMULA_VERSION == 6


def test_immutable_dataclass() -> None:
    p = ProcessingParams()
    indices = compute_indices(p)
    with pytest.raises(FrozenInstanceError):
        indices.total_exposure_index = 999.0  # type: ignore[misc]


def test_finite_values_for_all_indices() -> None:
    indices = compute_indices(ProcessingParams())
    for name in (
        "pulse_spacing_mm",
        "line_spacing_mm",
        "pulse_energy_index",
        "pulse_intensity_index",
        "total_exposure_index",
        "duty_cycle_index",
    ):
        v = getattr(indices, name)
        assert math.isfinite(v), f"{name} is not finite: {v}"


def test_ablation_aggression_is_total_exposure_times_pulse_intensity() -> None:
    indices = compute_indices(ProcessingParams())
    expected = indices.total_exposure_index * indices.pulse_intensity_index
    assert indices.ablation_aggression_index == pytest.approx(expected)


def test_delivery_smoothness_is_total_exposure_over_pulse_intensity() -> None:
    indices = compute_indices(ProcessingParams())
    expected = indices.total_exposure_index / indices.pulse_intensity_index
    assert indices.delivery_smoothness_index == pytest.approx(expected)


def test_log_space_rotation_identities() -> None:
    """The new pair is a 45° rotation of (total_exposure,
    pulse_intensity) in log-space. Verify two consequences:
    geometric mean recovers total_exposure; ratio is pulse_intensity²."""
    import math
    indices = compute_indices(ProcessingParams())
    aggr = indices.ablation_aggression_index
    smooth = indices.delivery_smoothness_index
    geom_mean = math.sqrt(aggr * smooth)
    ratio = aggr / smooth
    assert geom_mean == pytest.approx(indices.total_exposure_index, rel=1e-9)
    assert ratio == pytest.approx(indices.pulse_intensity_index ** 2, rel=1e-9)


def test_compute_indices_returns_line_spacing_mm():
    p = ProcessingParams(speed=600, power=50, density=5000,
                         mopa_frequency=200, pulse_width=100, repeat=1)
    out = compute_indices(p)
    # line_spacing_mm = 10 / density (cm → mm; lines/cm → mm/line)
    assert out.line_spacing_mm == 10 / 5000
    assert out.density_model == "lpc"
    assert out.formula_version == INDICES_FORMULA_VERSION


def test_compute_indices_defaults_density_model_to_lpc():
    p = ProcessingParams(speed=600, power=50, density=100,
                         mopa_frequency=30, pulse_width=2,
                         repeat=1)
    out = compute_indices(p)
    assert out.density_model == "lpc"


def test_compute_indices_rejects_legacy_opaque_density_model():
    p = ProcessingParams(speed=600, power=50, density=100,
                         mopa_frequency=30, pulse_width=2,
                         repeat=1)
    with pytest.raises(ValueError, match="density_model"):
        compute_indices(p, density_model="opaque")


def test_laser_indices_dataclass_has_no_line_spacing_index():
    fields = {f.name for f in dataclasses.fields(LaserIndices)}
    assert "line_spacing_index" not in fields
    assert "line_spacing_mm" in fields


# ---------------------------------------------------------------------------
# v4 crosshatch tests
# ---------------------------------------------------------------------------

def _pp(**kwargs):
    base = dict(
        power=14.6, speed=1152, mopa_frequency=100, density=5000,
        pulse_width=200, repeat=1,
    )
    base.update(kwargs)
    return ProcessingParams(**base)


def test_crosshatch_doubles_total_exposure_index():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.total_exposure_index == pytest.approx(a.total_exposure_index * 2)


def test_crosshatch_doubles_ablation_aggression_index():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.ablation_aggression_index == pytest.approx(a.ablation_aggression_index * 2)


def test_crosshatch_doubles_delivery_smoothness_index():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.delivery_smoothness_index == pytest.approx(a.delivery_smoothness_index * 2)


def test_crosshatch_leaves_per_pulse_indices_unchanged():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.pulse_spacing_mm == pytest.approx(a.pulse_spacing_mm)
    assert b.line_spacing_mm == pytest.approx(a.line_spacing_mm)
    assert b.pulse_energy_index == pytest.approx(a.pulse_energy_index)
    assert b.pulse_intensity_index == pytest.approx(a.pulse_intensity_index)


def test_crosshatch_default_false_matches_no_kwarg():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=False)
    assert a == b


def test_formula_version_in_result():
    indices = compute_indices(_pp())
    assert indices.formula_version == 6


# ---------------------------------------------------------------------------
# v6 duty_cycle_index tests
# ---------------------------------------------------------------------------

def test_duty_cycle_index_matches_g_code_observation():
    """xTool F2 Ultra G-code at 444 kHz × 500 ns → duty ≈ 22.2%
    (cross-checked against the per-move S values, which clamp at 100%
    of the slider). The index expresses this as a 0–100 percentage."""
    p = ProcessingParams(mopa_frequency=444, pulse_width=500)
    indices = compute_indices(p)
    assert indices.duty_cycle_index == pytest.approx(22.2)


def test_duty_cycle_index_zero_pulse_width_raises_before_compute():
    """The existing pulse_width=0 guard fires before duty_cycle would,
    so the user gets a clear field name in the error."""
    p = ProcessingParams(pulse_width=0)
    with pytest.raises(ValueError, match="pulse_width"):
        compute_indices(p)


def test_duty_cycle_index_independent_of_power_and_speed():
    """Duty cycle is a pure function of (freq, pulse_width). Changing
    power, speed, density, or passes must leave it unchanged."""
    base = compute_indices(_pp()).duty_cycle_index
    assert compute_indices(_pp(power=99)).duty_cycle_index == pytest.approx(base)
    assert compute_indices(_pp(speed=99)).duty_cycle_index == pytest.approx(base)
    assert compute_indices(_pp(density=999)).duty_cycle_index == pytest.approx(base)
    assert compute_indices(_pp(repeat=9)).duty_cycle_index == pytest.approx(base)


def test_duty_cycle_index_unchanged_by_crosshatch():
    a = compute_indices(_pp()).duty_cycle_index
    b = compute_indices(_pp(), crosshatch=True).duty_cycle_index
    assert a == pytest.approx(b)
