from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as repo


def test_create_and_list(fresh_db):
    m = repo.create(name="Stainless", notes="304 grade")
    assert m["id"] == 1
    assert m["name"] == "Stainless"
    all_ = repo.list_all()
    assert [x["id"] for x in all_] == [1]


def test_rename(fresh_db):
    m = repo.create(name="Old")
    repo.update(m["id"], name="New")
    assert repo.get(m["id"])["name"] == "New"


def test_delete_blocked_when_preset_references_material(fresh_db):
    m = repo.create(name="Stainless")
    from xcs_gen_web.repositories import presets as p_repo
    p_repo.create(
        material_id=m["id"], name="Default", color=None,
        base_params={"power": 50, "speed": 1000, "frequency": 60,
                     "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    )
    with pytest.raises(repo.InUseError):
        repo.delete(m["id"])


def test_delete_when_empty(fresh_db):
    m = repo.create(name="Stainless")
    repo.delete(m["id"])
    assert repo.get(m["id"]) is None
