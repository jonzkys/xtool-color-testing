"""Repository changes for machine_id — persistence, filtering, immutability."""

from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import presets as p_repo
from xcs_gen_web.repositories import tests as t_repo


BASE_PARAMS = {
    "power": 50, "speed": 1000, "frequency": 45_000,
    "density": 100, "passes": 1, "pulse_width": 200, "laser": "red",
}
SPEC = {"x_param": "power", "x_min": 10, "x_max": 90, "x_steps": 5,
        "rows": 1, "width_mm": 50, "height_mm": 50, "gap_mm": 1,
        "base_params": BASE_PARAMS}


def test_test_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    assert t["machine_id"] == "F1Ultra"
    assert t_repo.get(t["id"])["machine_id"] == "F1Ultra"


def test_test_machine_id_defaults_to_f2(fresh_db):
    """Backwards-compat: callers that omit machine_id get the default."""
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC)
    assert t["machine_id"] == "F2Ultra"


def test_test_machine_id_immutable(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    with pytest.raises(t_repo.MachineImmutableError):
        t_repo.update(t["id"], machine_id="F2Ultra")


def test_list_tests_filters_by_machine(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    f1 = t_repo.create(name="f1", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    f2 = t_repo.create(name="f2", material_id=mid, spec=SPEC, machine_id="F2Ultra")
    only_f1 = t_repo.list_all(machine_id="F1Ultra")
    only_f2 = t_repo.list_all(machine_id="F2Ultra")
    assert {t["id"] for t in only_f1} == {f1["id"]}
    assert {t["id"] for t in only_f2} == {f2["id"]}


def test_preset_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p = p_repo.create(material_id=mid, name="default", color=None,
                      base_params=BASE_PARAMS, machine_id="F1Ultra")
    assert p["machine_id"] == "F1Ultra"
    assert p_repo.get(p["id"])["machine_id"] == "F1Ultra"


def test_preset_machine_id_immutable(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p = p_repo.create(material_id=mid, name="d", color=None,
                      base_params=BASE_PARAMS, machine_id="F1Ultra")
    with pytest.raises(p_repo.MachineImmutableError):
        p_repo.update(p["id"], machine_id="F2Ultra")


def test_palette_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    entry = {
        "test_id": None, "material_id": mid,
        "hex": "#aa00bb", "params": {}, "sigma": 0.0, "source": "manual",
        "machine_id": "F1Ultra",
    }
    [pid] = pal_repo.insert_bulk([entry])
    rows = pal_repo.list_all(machine_id="F1Ultra")
    assert any(r["id"] == pid for r in rows)
    assert all(r["machine_id"] == "F1Ultra" for r in rows)


def test_palette_machine_must_match_test(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F2Ultra")
    bad = {
        "test_id": t["id"], "material_id": mid,
        "hex": "#ff0000", "params": {}, "sigma": 0.0, "source": "averaged",
        "machine_id": "F1Ultra",     # mismatch
    }
    with pytest.raises(pal_repo.MachineMismatchError):
        pal_repo.insert_bulk([bad])
