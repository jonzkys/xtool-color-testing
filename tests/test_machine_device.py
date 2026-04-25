"""Device dataclass — constructed from the machine registry."""

from __future__ import annotations

import pytest

from xcs_gen.model import Device


def test_device_from_machine_f2():
    d = Device.from_machine("F2Ultra")
    assert d.ext_id == "GS004-CLASS-4"
    assert d.ext_name == "F2 Ultra"
    assert d.power == [60, 40]


def test_device_from_machine_f1():
    d = Device.from_machine("F1Ultra")
    assert d.ext_id == "F1Ultra"
    assert d.ext_name == "F1 Ultra"
    assert d.power == [20, 20]


def test_device_from_unknown_machine_raises():
    with pytest.raises(KeyError):
        Device.from_machine("ZUltra")
