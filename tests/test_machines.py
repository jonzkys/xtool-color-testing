"""Machine registry — built-in machines, mode→profile mapping, lookup helpers."""

from __future__ import annotations

import pytest

from xcs_gen import machines


def test_builtin_machines_present():
    ids = {m.id for m in machines.all_machines()}
    assert {"F2Ultra", "F1Ultra"} <= ids


def test_f2_ultra_identity():
    m = machines.get("F2Ultra")
    assert m.ext_id == "GS004-CLASS-4"
    assert m.ext_name == "F2 Ultra"
    wattages = {laser.kind: laser.wattage for laser in m.lasers}
    assert wattages == {"fiber": 60, "blue": 40}
    assert {laser.kind for laser in m.lasers} == {"fiber", "blue"}


def test_f1_ultra_identity():
    m = machines.get("F1Ultra")
    assert m.ext_id == "F1Ultra"
    assert m.ext_name == "F1 Ultra"
    wattages = {laser.kind: laser.wattage for laser in m.lasers}
    assert wattages == {"fiber": 20, "blue": 20}
    assert {laser.kind for laser in m.lasers} == {"fiber", "blue"}


def test_f1_does_not_have_color_engrave():
    m = machines.get("F1Ultra")
    mode_ids = {mode.id for mode in m.modes}
    assert "color_engrave" not in mode_ids
    assert {"engrave", "score", "cut"} <= mode_ids


def test_f2_has_color_engrave():
    m = machines.get("F2Ultra")
    mode_ids = {mode.id for mode in m.modes}
    assert "color_engrave" in mode_ids


def test_unknown_machine_id_raises():
    with pytest.raises(KeyError, match="ZUltra"):
        machines.get("ZUltra")


def test_profile_for_known_pair():
    assert machines.profile_for("F1Ultra", "engrave") == "STANDARD"
    assert machines.profile_for("F2Ultra", "color_engrave") == "COLOR_ENGRAVE"
    assert machines.profile_for("F2Ultra", "engrave") == "STANDARD"


def test_profile_for_unsupported_pair_raises():
    with pytest.raises(KeyError, match="color_engrave"):
        machines.profile_for("F1Ultra", "color_engrave")


def test_blue_laser_is_rectangular_on_both():
    for mid in ("F1Ultra", "F2Ultra"):
        blue = next(laser for laser in machines.get(mid).lasers if laser.kind == "blue")
        assert blue.spot_mm == (0.08, 0.10)


def test_fiber_laser_is_square_on_both():
    for mid in ("F1Ultra", "F2Ultra"):
        fiber = next(laser for laser in machines.get(mid).lasers if laser.kind == "fiber")
        assert fiber.spot_mm == (0.03, 0.03)


def test_laser_for_returns_named_laser():
    m = machines.get("F2Ultra")
    fiber = machines.laser_for(m, "red")   # red == fiber, blue == diode
    assert fiber.kind == "fiber"
    blue = machines.laser_for(m, "blue")
    assert blue.kind == "blue"


def test_device_power_list_for_xcs():
    """The .xcs `device.power` field is a [w_fiber, w_blue] list."""
    assert machines.device_power("F1Ultra") == [20, 20]
    assert machines.device_power("F2Ultra") == [60, 40]
