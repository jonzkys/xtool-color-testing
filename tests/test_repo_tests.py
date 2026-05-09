from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import tests as repo
from xcs_gen_web.repositories import validation_cells as vc_repo


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "y_param": None, "y_min": None, "y_max": None, "y_steps": None,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60,
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


def test_update_material_cascades_palette_when_locked(fresh_db):
    """Reassigning a locked test's material moves any palette entries
    harvested from it to the new material in the same transaction."""
    mid1 = _seed(fresh_db)
    mid2 = m_repo.create(name="Brass")["id"]
    t = repo.create(name="T1", material_id=mid1, spec=SPEC)
    repo.mark_tested_and_lock(t["id"])
    [eid] = pal_repo.insert_bulk([{
        "test_id": t["id"], "material_id": mid1, "hex": "#aabbcc",
        "sigma": 1.0, "source": "single_result",
    }])

    updated = repo.update(t["id"], material_id=mid2)

    assert updated["material_id"] == mid2
    [entry] = pal_repo.list_all(material_id=mid2)
    assert entry["id"] == eid
    assert pal_repo.list_all(material_id=mid1) == []


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


def test_create_default_kind_is_sweep(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="T1", material_id=mid, spec=SPEC)
    assert t["kind"] == "sweep"
    assert t["validation_cells"] == []


def test_create_validation_kind_inlines_cells(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="V1", material_id=mid, spec=SPEC, kind="validation")
    assert t["kind"] == "validation"
    assert t["validation_cells"] == []

    # Insert cells out of order to confirm ordering on read.
    vc_repo.replace_for_test(test_id=t["id"], cells=[
        {
            "cell_index": 1,
            "palette_entry_id": None,
            "expected_hex": "#ddccbb",
            "expected_lab": [70.0, 5.0, -5.0],
            "params": {"power": 60, "speed": 1500},
        },
        {
            "cell_index": 0,
            "palette_entry_id": None,
            "expected_hex": "#aabbcc",
            "expected_lab": [50.0, -2.0, 3.0],
            "params": {"power": 50, "speed": 1000},
        },
    ])

    refetched = repo.get(t["id"])
    cells = refetched["validation_cells"]
    assert [c["cell_index"] for c in cells] == [0, 1]
    assert cells[0]["expected_hex"] == "#aabbcc"
    assert cells[0]["expected_lab"] == [50.0, -2.0, 3.0]
    assert cells[0]["params"] == {"power": 50, "speed": 1000}
    assert cells[1]["expected_hex"] == "#ddccbb"

    # list_all must surface the same shape consistently.
    [listed] = [x for x in repo.list_all() if x["id"] == t["id"]]
    assert listed["kind"] == "validation"
    assert [c["cell_index"] for c in listed["validation_cells"]] == [0, 1]


def test_test_dict_has_lineage_fields(fresh_db):
    mid = _seed(fresh_db)
    t = repo.create(name="t", material_id=mid, spec=SPEC)
    assert t["source_test_id"] is None
    assert t["parent_test_id"] is None
    assert t["tag"] is None


def test_update_accepts_parent_test_id_and_tag(fresh_db):
    mid = _seed(fresh_db)
    parent = repo.create(name="parent", material_id=mid, spec=SPEC)
    child = repo.create(name="child", material_id=mid, spec=SPEC)
    updated = repo.update(
        child["id"],
        parent_test_id=parent["id"], tag="blues-exploration",
    )
    assert updated["parent_test_id"] == parent["id"]
    assert updated["tag"] == "blues-exploration"


def test_replace_validation_cells_recomputes_source_test_id(fresh_db):
    """Setting validation cells whose palette_entry_ids all came from the
    same source test populates tests.source_test_id with that id."""
    mid = _seed(fresh_db)
    src_test = repo.create(name="sweep", material_id=mid, spec=SPEC)
    src_entry_ids = pal_repo.insert_bulk([
        {
            "test_id": src_test["id"],
            "material_id": mid,
            "x_value": float(i), "y_value": None,
            "hex": f"#{i:02x}aa00",
            "params": {"speed": 600, "power": 50, "density": 100,
                       "mopa_frequency": 30, "pulse_width": 2, "repeat": 1},
            "sigma": 0.0, "source": "averaged",
        }
        for i in range(3)
    ])
    val_test = repo.create(
        name="val", material_id=mid, spec=SPEC, kind="validation",
    )
    cells = [
        {"cell_index": i,
         "palette_entry_id": src_entry_ids[i],
         "expected_hex": "#000000",
         "expected_lab": [50.0, 0.0, 0.0],
         "params": {}} for i in range(3)
    ]
    vc_repo.replace_for_test(test_id=val_test["id"], cells=cells)

    refreshed = repo.get(val_test["id"])
    assert refreshed["source_test_id"] == src_test["id"]
