from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as repo


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "y_param": None, "y_min": None, "y_max": None, "y_steps": None,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
}


def _seed(fresh_db):
    return m_repo.create(name="SS")["id"]


def test_create_sets_status_created_and_locked_zero(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    assert t["status"] == "created"
    assert t["locked"] is False


def test_update_spec_allowed_while_unlocked(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    updated = repo.update(t["id"], spec={**SPEC, "x_steps": 20})
    assert updated["spec"]["x_steps"] == 20


def test_update_spec_blocked_when_locked(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    repo.mark_tested_and_lock(t["id"])
    with pytest.raises(repo.LockedError):
        repo.update(t["id"], spec={**SPEC, "x_steps": 20})


def test_update_name_and_notes_allowed_when_locked(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    repo.mark_tested_and_lock(t["id"])
    updated = repo.update(t["id"], name="T1 renamed", notes="after burn")
    assert updated["name"] == "T1 renamed"
    assert updated["notes"] == "after burn"


def test_soft_delete(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    repo.soft_delete(t["id"])
    listed = [x["id"] for x in repo.list_all()]
    assert t["id"] not in listed
    assert repo.get(t["id"])["status"] == "deleted"


def test_list_filters(fresh_db):
    m1 = m_repo.create(name="A")["id"]
    m2 = m_repo.create(name="B")["id"]
    a = repo.create(name="A1", material_id=m1, spec=SPEC)
    b = repo.create(name="B1", material_id=m2, spec=SPEC)
    repo.mark_tested_and_lock(b["id"])
    assert [t["id"] for t in repo.list_all(material_id=m1)] == [a["id"]]
    assert [t["id"] for t in repo.list_all(status="tested")] == [b["id"]]
