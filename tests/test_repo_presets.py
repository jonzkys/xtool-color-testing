from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import presets as repo

BASE = {
    "power": 50, "speed": 1000, "frequency": 60000,
    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
}


def test_first_preset_in_material_becomes_default(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="Default", color=None, base_params=BASE)
    assert p1["is_default"] is True


def test_second_preset_is_not_default_unless_promoted(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="P1", color=None, base_params=BASE)
    p2 = repo.create(material_id=mid, name="P2", color=None, base_params=BASE)
    assert p1["is_default"] is True
    assert p2["is_default"] is False


def test_set_default_is_exclusive_per_material(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="P1", color=None, base_params=BASE)
    p2 = repo.create(material_id=mid, name="P2", color=None, base_params=BASE)
    repo.set_default(p2["id"])
    assert repo.get(p1["id"])["is_default"] is False
    assert repo.get(p2["id"])["is_default"] is True


def test_deleting_default_promotes_next(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p1 = repo.create(material_id=mid, name="P1", color=None, base_params=BASE)
    p2 = repo.create(material_id=mid, name="P2", color=None, base_params=BASE)
    repo.delete(p1["id"])
    # p2 was the only remaining preset in material → promoted
    assert repo.get(p2["id"])["is_default"] is True


def test_list_by_material(fresh_db):
    m1 = m_repo.create(name="A")["id"]
    m2 = m_repo.create(name="B")["id"]
    repo.create(material_id=m1, name="P1", color=None, base_params=BASE)
    repo.create(material_id=m2, name="P2", color=None, base_params=BASE)
    assert [p["name"] for p in repo.list_by_material(m1)] == ["P1"]
