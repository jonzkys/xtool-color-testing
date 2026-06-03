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

def test_all_28_profiles_defined():
    expected = {
        "F2Ultra:engrave", "F2Ultra:score", "F2Ultra:cut",
        "F2Ultra:color_engrave", "F2Ultra:intaglio", "F2Ultra:relief",
        "F2UltraSingle:engrave", "F2UltraSingle:score", "F2UltraSingle:cut",
        "F2UltraSingle:color_engrave", "F2UltraSingle:intaglio", "F2UltraSingle:relief",
        "F2UltraUV:engrave", "F2UltraUV:score", "F2UltraUV:cut",
        "F2UltraUV:intaglio", "F2UltraUV:relief",
        "F1Ultra:engrave", "F1Ultra:score", "F1Ultra:cut",
        "F1Ultra:intaglio", "F1Ultra:relief",
        "F1Lite:engrave", "F1Lite:score", "F1Lite:cut",
        "F1:engrave", "F1:score", "F1:cut",
    }
    assert expected <= set(PROFILES.keys())


def test_f2ultra_engrave_profile_field_set():
    assert set(PROFILES["F2Ultra:engrave"].keys()) == {
        "power", "speed", "frequency", "density",
        "passes", "pulse_width", "laser",
    }


def test_f2ultra_color_engrave_profile_field_set():
    assert set(PROFILES["F2Ultra:color_engrave"].keys()) == {
        "power", "speed", "frequency", "density",
        "passes", "pulse_width", "laser",
    }


def test_f1ultra_engrave_pulse_width_is_not_applicable():
    # F1Ultra has no MOPA: pulse_width is not applicable
    assert PROFILES["F1Ultra:engrave"]["pulse_width"]["kind"] == "not_applicable"


def test_f2ultra_engrave_pulse_width_is_stepped():
    # F2Ultra fiber laser has MOPA: pulse_width is stepped
    pw = PROFILES["F2Ultra:engrave"]["pulse_width"]
    assert pw["kind"] == "stepped"
    assert pw["values"][0] == 2 and pw["values"][-1] == 500


def test_f2ultra_color_engrave_pulse_width_is_stepped():
    pw = PROFILES["F2Ultra:color_engrave"]["pulse_width"]
    assert pw["kind"] == "stepped"
    assert pw["values"][0] == 2 and pw["values"][-1] == 500


def test_f2ultra_engrave_density_is_continuous_range():
    density = PROFILES["F2Ultra:engrave"]["density"]
    assert density["kind"] == "range"
    assert density["min"] == 1 and density["max"] == 300


def test_f2ultra_color_engrave_density_is_continuous_range():
    density = PROFILES["F2Ultra:color_engrave"]["density"]
    assert density["kind"] == "range"
    assert density["min"] == 1 and density["max"] == 5000


# -- Evaluator: stepped snapping (pulse_width on F2Ultra:engrave) -------------

def test_stepped_pulse_width_snaps_to_nearest():
    # 47 is between 45 and 60; nearest is 45
    res = validate_against_profile("F2Ultra:engrave", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100,
        "passes": 1, "laser": "red",
        "pulse_width": 47,
    })
    assert res.snapped["pulse_width"] == (47, 45)
    assert res.values["pulse_width"] == 45


def test_stepped_pulse_width_passes_through_legal_value():
    res = validate_against_profile("F2Ultra:engrave", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100, "passes": 1, "laser": "red",
        "pulse_width": 200,
    })
    assert "pulse_width" not in res.snapped
    assert res.values["pulse_width"] == 200


def test_stepped_pulse_width_clamps_above_max():
    res = validate_against_profile("F2Ultra:engrave", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100, "passes": 1, "laser": "red",
        "pulse_width": 9999,
    })
    # Snaps to the largest legal value (500).
    assert res.values["pulse_width"] == 500


# -- Evaluator: range rejection ----------------------------------------------

def test_range_frequency_rejects_above_max():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("F2Ultra:engrave", {
            "power": 50, "speed": 1000, "frequency": 5000,  # over 4000 (MOPA max)
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
        })
    assert exc.value.field == "frequency"


def test_range_frequency_rejects_below_min():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("F2Ultra:engrave", {
            "power": 50, "speed": 1000, "frequency": 0,     # below 1
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
        })
    assert exc.value.field == "frequency"


def test_range_speed_accepts_boundaries():
    for v in (2, 10000):
        res = validate_against_profile("F2Ultra:engrave", {
            "power": 50, "speed": v, "frequency": 45,
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
        })
        assert res.values["speed"] == v


# -- Evaluator: not_applicable rejection -------------------------------------

def test_pulse_width_rejected_on_f1ultra_when_present():
    # F1Ultra:engrave has pulse_width: not_applicable
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("F1Ultra:engrave", {
            "power": 50, "speed": 1000, "frequency": 45,
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
        })
    assert exc.value.field == "pulse_width"


def test_pulse_width_accepted_on_color_engrave_after_snap():
    res = validate_against_profile("F2Ultra:color_engrave", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100, "passes": 1, "laser": "red",
        "pulse_width": 47,                 # nearest legal: 45
    })
    assert res.snapped["pulse_width"] == (47, 45)
    assert res.values["pulse_width"] == 45


# -- Evaluator: enum rejection -----------------------------------------------

def test_unknown_laser_rejected():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("F2Ultra:engrave", {
            "power": 50, "speed": 1000, "frequency": 45,
            "density": 100, "passes": 1, "laser": "green",
            "pulse_width": 200,
        })
    assert exc.value.field == "laser"


# -- Evaluator: integration with the registry --------------------------------

def test_profile_for_machine_round_trip():
    profile_id = machines.profile_for("F1Ultra", "engrave")
    # F1Ultra:engrave has pulse_width: not_applicable — omit it
    res = validate_against_profile(profile_id, {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100, "passes": 1, "laser": "red",
    })
    assert res.values["frequency"] == 45


# -- Evaluator: missing required field ---------------------------------------

def test_missing_required_field_raises():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("F2Ultra:engrave", {
            "speed": 1000, "frequency": 45,
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
            # power omitted
        })
    assert exc.value.field == "power"


# -- coerce_against_profile ---------------------------------------------------

def test_coerce_against_profile_clamps_and_snaps():
    from xcs_gen import machines
    pid = machines.profile_for("F2Ultra", "color_engrave")  # power 1-100, pulse_width stepped, laser enum
    out = machines.coerce_against_profile(pid, {
        "power": 999,          # range -> clamp to 100
        "pulse_width": 7,      # stepped -> snap to 6
        "laser": "green",      # enum -> first allowed
        "speed": 1000,         # in range -> unchanged
    })
    assert out["power"] == 100
    assert out["pulse_width"] == 6
    assert out["laser"] in ("red", "blue")
    assert out["speed"] == 1000


def test_coerce_against_profile_passes_through_unconstrained_fields():
    from xcs_gen import machines
    # F1Lite: diode-only -> pulse_width is not_applicable; frequency not_applicable.
    pid = machines.profile_for("F1Lite", "engrave")
    out = machines.coerce_against_profile(pid, {
        "pulse_width": 200,    # not_applicable -> passthrough (NOT dropped)
        "frequency": 9999,     # not_applicable -> passthrough
        "scan_angle": 45,      # absent from profile -> passthrough
        "power": 999,          # range -> clamp
    })
    assert out["pulse_width"] == 200
    assert out["frequency"] == 9999
    assert out["scan_angle"] == 45
    assert out["power"] == 100
