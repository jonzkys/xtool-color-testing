"""Validation profile evaluator — snap stepped fields, reject out-of-range."""

from __future__ import annotations

import pytest

from xcs_gen import machines
from xcs_gen.machines import (
    PROFILES,
    ValidationError,
    validate_against_profile,
)


# -- Profile shape ------------------------------------------------------------

def test_both_profiles_defined():
    assert "STANDARD" in PROFILES
    assert "COLOR_ENGRAVE" in PROFILES


def test_standard_profile_field_set():
    assert set(PROFILES["STANDARD"].keys()) == {
        "power", "speed", "frequency", "density",
        "passes", "pulse_width", "laser",
    }


def test_color_engrave_profile_field_set():
    assert set(PROFILES["COLOR_ENGRAVE"].keys()) == {
        "power", "speed", "frequency", "density",
        "passes", "pulse_width", "laser",
    }


def test_standard_pulse_width_is_not_applicable():
    assert PROFILES["STANDARD"]["pulse_width"]["kind"] == "not_applicable"


def test_color_engrave_pulse_width_is_stepped():
    pw = PROFILES["COLOR_ENGRAVE"]["pulse_width"]
    assert pw["kind"] == "stepped"
    assert pw["values"][0] == 2 and pw["values"][-1] == 500


def test_standard_density_is_stepped():
    density = PROFILES["STANDARD"]["density"]
    assert density["kind"] == "stepped"
    assert density["values"][0] == 10
    assert density["values"][-1] == 200
    assert 200 in density["values"]
    assert 100 in density["values"]


def test_color_engrave_density_is_continuous_range():
    density = PROFILES["COLOR_ENGRAVE"]["density"]
    assert density["kind"] == "range"
    assert density["min"] == 1 and density["max"] == 5000


# -- Evaluator: stepped snapping ---------------------------------------------

def test_stepped_density_snaps_to_nearest():
    res = validate_against_profile("STANDARD", {
        "power": 50, "speed": 1000, "frequency": 45_000,
        "density": 113,                    # nearest legal: 120
        "passes": 1, "laser": "red",
    })
    assert res.snapped["density"] == (113, 120)
    assert res.values["density"] == 120


def test_stepped_density_passes_through_legal_value():
    res = validate_against_profile("STANDARD", {
        "power": 50, "speed": 1000, "frequency": 45_000,
        "density": 100, "passes": 1, "laser": "red",
    })
    assert "density" not in res.snapped
    assert res.values["density"] == 100


def test_stepped_density_clamps_above_max():
    res = validate_against_profile("STANDARD", {
        "power": 50, "speed": 1000, "frequency": 45_000,
        "density": 9999, "passes": 1, "laser": "red",
    })
    # Snaps to the largest legal value (200).
    assert res.values["density"] == 200


# -- Evaluator: range rejection ----------------------------------------------

def test_range_frequency_rejects_above_max():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 999_000,    # over 60_000
            "density": 100, "passes": 1, "laser": "red",
        })
    assert exc.value.field == "frequency"


def test_range_frequency_rejects_below_min():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 5_000,     # below 30_000
            "density": 100, "passes": 1, "laser": "red",
        })
    assert exc.value.field == "frequency"


def test_range_speed_accepts_boundaries():
    for v in (2, 10000):
        res = validate_against_profile("STANDARD", {
            "power": 50, "speed": v, "frequency": 45_000,
            "density": 100, "passes": 1, "laser": "red",
        })
        assert res.values["speed"] == v


# -- Evaluator: not_applicable rejection -------------------------------------

def test_pulse_width_rejected_on_standard_when_present():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 45_000,
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
        })
    assert exc.value.field == "pulse_width"


def test_pulse_width_accepted_on_color_engrave_after_snap():
    res = validate_against_profile("COLOR_ENGRAVE", {
        "power": 50, "speed": 1000, "frequency": 200_000,
        "density": 100, "passes": 1, "laser": "red",
        "pulse_width": 47,                 # nearest legal: 45
    })
    assert res.snapped["pulse_width"] == (47, 45)
    assert res.values["pulse_width"] == 45


# -- Evaluator: enum rejection -----------------------------------------------

def test_unknown_laser_rejected():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 45_000,
            "density": 100, "passes": 1, "laser": "green",
        })
    assert exc.value.field == "laser"


# -- Evaluator: integration with the registry --------------------------------

def test_profile_for_machine_round_trip():
    profile_id = machines.profile_for("F1Ultra", "engrave")
    res = validate_against_profile(profile_id, {
        "power": 50, "speed": 1000, "frequency": 45_000,
        "density": 100, "passes": 1, "laser": "red",
    })
    assert res.values["frequency"] == 45_000


# -- Evaluator: missing required field ---------------------------------------

def test_missing_required_field_raises():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "speed": 1000, "frequency": 45_000,
            "density": 100, "passes": 1, "laser": "red",
            # power omitted
        })
    assert exc.value.field == "power"
