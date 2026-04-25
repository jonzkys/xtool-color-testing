from __future__ import annotations

import pytest

from xcs_gen_web.repositories import palette as repo
from xcs_gen_web.repositories import materials as m_repo


def _seed_material(name: str = "SS") -> int:
    return m_repo.create(name=name)["id"]


def test_insert_and_query(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=500, y_value=None,
             hex="#ff0000", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 50}),
        dict(test_id=1, material_id=mid, x_value=600, y_value=None,
             hex="#00ff00", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 60}),
    ])
    results = repo.query_by_hex("#ff0101", limit=2, material_id=mid)
    assert results[0]["entry"]["hex"] == "#ff0000"
    assert results[0]["delta_e"] < results[1]["delta_e"]


def test_list_filter_by_material(fresh_db):
    m1 = _seed_material("A")
    m2 = _seed_material("B")
    repo.insert_bulk([dict(test_id=1, material_id=m1, x_value=0, y_value=None,
                           hex="#000000", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.insert_bulk([dict(test_id=2, material_id=m2, x_value=0, y_value=None,
                           hex="#111111", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    assert [e["material_id"] for e in repo.list_all(material_id=m1)] == [m1]


def test_delete_by_test(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([dict(test_id=7, material_id=mid, x_value=0, y_value=None,
                           hex="#abcdef", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.delete_by_test(7)
    assert repo.list_all() == []


def test_list_filters_by_source(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=2, material_id=mid, x_value=0, y_value=None,
             hex="#fedcba", sigma=0.0, source="single_result",
             source_result_id=None, params={}),
    ])
    averaged = repo.list_all(source="averaged")
    assert [e["hex"] for e in averaged] == ["#abcdef"]


def test_list_filters_by_favorites_only(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#000000", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    # No favorites yet
    assert repo.list_all(favorites_only=True) == []


def test_create_manual(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(
        material_id=mid, hex_="#abcdef",
        params={"power": 50, "speed": 1000, "laser": "red"},
        notes="quick test",
    )
    assert e["source"] == "manual"
    assert e["test_id"] is None
    assert e["sigma"] == 0.0
    assert e["favorited"] is False
    assert e["notes"] == "quick test"
    # Lab is computed
    assert len(e["lab"]) == 3
    # Round-trips via list
    assert any(x["id"] == e["id"] for x in repo.list_all())
    # Distinct hexes produce distinct lab values
    e2 = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    assert e["lab"] != e2["lab"]


def test_create_manual_owner_scoped(fresh_db):
    mid = _seed_material()
    repo.create_manual(material_id=mid, hex_="#abcdef", params={}, notes="", owner_id=1)
    # Different owner sees nothing
    assert repo.list_all(owner_id=2) == []


def test_update_entry_manual_changes_hex_and_lab(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    updated = repo.update_entry(e["id"], hex_="#ffffff")
    assert updated["hex"] == "#ffffff"
    # Lab should differ from the original (black → white)
    assert updated["lab"][0] > e["lab"][0]


def test_update_entry_manual_partial_patch(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={"power": 1}, notes="")
    updated = repo.update_entry(e["id"], notes="renamed")
    assert updated["notes"] == "renamed"
    assert updated["hex"] == "#000000"
    assert updated["params"] == {"power": 1}


def test_update_entry_rejects_param_mutation_on_ingested(fresh_db):
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={"power": 10}),
    ])
    eid = repo.list_all()[0]["id"]
    with pytest.raises(repo.NotMutableError):
        repo.update_entry(eid, hex_="#ffffff")


def test_update_entry_notes_allowed_on_ingested(fresh_db):
    """Notes are mutable on any source (preserves today's behavior)."""
    mid = _seed_material()
    repo.insert_bulk([
        dict(test_id=1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    eid = repo.list_all()[0]["id"]
    updated = repo.update_entry(eid, notes="ok to rename")
    assert updated["notes"] == "ok to rename"


def test_update_entry_missing_returns_none(fresh_db):
    assert repo.update_entry(99999, notes="x") is None
