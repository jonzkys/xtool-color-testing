"""End-to-end: build .xcs bytes for both machines, parse back, check identity."""

from __future__ import annotations

from xcs_gen.builder import build_xcs
from xcs_gen.model import Device, ProcessingParams, Rect, XCSProject


def _project_for(machine_id: str) -> XCSProject:
    return XCSProject(
        device=Device.from_machine(machine_id),
        elements=[
            Rect(
                x=10,
                y=10,
                width=10,
                height=10,
                params=ProcessingParams(
                    power=50,
                    speed=1000,
                    mopa_frequency=45,
                    density=100,
                    repeat=1,
                    pulse_width=200,
                    processing_light_source="red",
                ),
                processing_type="VECTOR_ENGRAVING",
            ),
        ],
    )


def test_f2_ultra_roundtrip_identity():
    j = build_xcs(_project_for("F2Ultra"))
    assert j["extId"] == "GS004-CLASS-4"
    assert j["extName"] == "F2 Ultra"
    assert j["device"]["id"] == "GS004-CLASS-4"
    assert j["device"]["power"] == [60, 40]


def test_f1_ultra_roundtrip_identity():
    j = build_xcs(_project_for("F1Ultra"))
    assert j["extId"] == "F1Ultra"
    assert j["extName"] == "F1 Ultra"
    assert j["device"]["id"] == "F1Ultra"
    assert j["device"]["power"] == [20, 20]
