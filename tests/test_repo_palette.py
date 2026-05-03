from __future__ import annotations

import pytest

from xcs_gen_web.repositories import palette as repo
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.repositories import results as r_repo


_SPEC = {"x_param": "speed", "x_min": 100, "x_max": 1000, "x_steps": 5,
         "rows": 1, "width_mm": 20, "height_mm": 8, "gap_mm": 0.5,
         "cell_shape": "rect", "square_cells": False, "angle_mode": "fixed",
         "unidirectional": False,
         "base_params": {"power": 50, "speed": 500, "frequency": 60,
                         "density": 200, "passes": 1, "pulse_width": 200,
                         "laser": "red"},
         "registration": {"mode": "on"}}


def _seed_material(name: str = "SS") -> int:
    return m_repo.create(name=name)["id"]


def _seed_test(mid: int) -> int:
    return t_repo.create(name="t", material_id=mid, spec=_SPEC)["id"]


def _seed_result(tid: int) -> int:
    return r_repo.create(
        test_id=tid, image_path="/tmp/x.jpg", image_sha256="aa" * 32,
        swatches=[],
    )["id"]


def test_insert_and_query(fresh_db):
    mid = _seed_material()
    tid = _seed_test(mid)
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#ff0000", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 50}),
        dict(test_id=tid, material_id=mid, x_value=600, y_value=None,
             hex="#00ff00", sigma=1.0, source="averaged", source_result_id=None,
             params={"power": 60}),
    ])
    results = repo.query_by_hex("#ff0101", limit=2, material_id=mid)
    assert results[0]["entry"]["hex"] == "#ff0000"
    assert results[0]["delta_e"] < results[1]["delta_e"]


def test_list_filter_by_material(fresh_db):
    m1 = _seed_material("A")
    m2 = _seed_material("B")
    t1 = _seed_test(m1)
    t2 = _seed_test(m2)
    repo.insert_bulk([dict(test_id=t1, material_id=m1, x_value=0, y_value=None,
                           hex="#000000", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.insert_bulk([dict(test_id=t2, material_id=m2, x_value=0, y_value=None,
                           hex="#111111", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    assert [e["material_id"] for e in repo.list_all(material_id=m1)] == [m1]


def test_delete_by_test(fresh_db):
    mid = _seed_material()
    tid = _seed_test(mid)
    repo.insert_bulk([dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
                           hex="#abcdef", sigma=0.0, source="averaged",
                           source_result_id=None, params={})])
    repo.delete_by_test(tid)
    assert repo.list_all() == []


def test_delete_by_material_only_touches_matching_material(fresh_db):
    m1 = _seed_material("A")
    m2 = _seed_material("B")
    t1 = _seed_test(m1)
    t2 = _seed_test(m2)
    repo.insert_bulk([
        dict(test_id=t1, material_id=m1, x_value=0, y_value=None,
             hex="#000000", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=t1, material_id=m1, x_value=1, y_value=None,
             hex="#111111", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=t2, material_id=m2, x_value=0, y_value=None,
             hex="#222222", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    deleted = repo.delete_by_material(m1)
    assert deleted == 2
    remaining = repo.list_all()
    assert len(remaining) == 1
    assert remaining[0]["material_id"] == m2


def test_delete_by_material_zero_when_nothing_matches(fresh_db):
    mid = _seed_material()
    deleted = repo.delete_by_material(mid)
    assert deleted == 0


def test_delete_by_material_owner_scoped(fresh_db):
    """A different owner's palette entries on the same material are
    untouched — the owner_id filter is part of the WHERE clause, not
    just a default."""
    mid = _seed_material()
    tid = _seed_test(mid)
    # Default owner row.
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
             hex="#aaaaaa", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    # Foreign owner row, same material.
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=1, y_value=None,
             hex="#bbbbbb", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ], owner_id=999)
    repo.delete_by_material(mid)  # default owner
    survivors = repo.list_all(owner_id=999)
    assert len(survivors) == 1
    assert survivors[0]["hex"] == "#bbbbbb"


def test_list_filters_by_source(fresh_db):
    mid = _seed_material()
    t1 = _seed_test(mid)
    t2 = _seed_test(mid)
    repo.insert_bulk([
        dict(test_id=t1, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=t2, material_id=mid, x_value=0, y_value=None,
             hex="#fedcba", sigma=0.0, source="single_result",
             source_result_id=None, params={}),
    ])
    averaged = repo.list_all(source="averaged")
    assert [e["hex"] for e in averaged] == ["#abcdef"]


def test_list_filters_by_favorites_only(fresh_db):
    mid = _seed_material()
    tid = _seed_test(mid)
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
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
    tid = _seed_test(mid)
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={"power": 10}),
    ])
    eid = repo.list_all()[0]["id"]
    with pytest.raises(repo.NotMutableError):
        repo.update_entry(eid, hex_="#ffffff")


def test_update_entry_notes_allowed_on_ingested(fresh_db):
    """Notes are mutable on any source (preserves today's behavior)."""
    mid = _seed_material()
    tid = _seed_test(mid)
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    eid = repo.list_all()[0]["id"]
    updated = repo.update_entry(eid, notes="ok to rename")
    assert updated["notes"] == "ok to rename"


def test_update_entry_missing_returns_none(fresh_db):
    assert repo.update_entry(99999, notes="x") is None


def test_set_favorited_toggle(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    on = repo.set_favorited(e["id"], True)
    assert on["favorited"] is True
    off = repo.set_favorited(e["id"], False)
    assert off["favorited"] is False


def test_set_favorited_idempotent(fresh_db):
    mid = _seed_material()
    e = repo.create_manual(material_id=mid, hex_="#000000", params={}, notes="")
    repo.set_favorited(e["id"], True)
    again = repo.set_favorited(e["id"], True)
    assert again["favorited"] is True


def test_set_favorited_works_on_any_source(fresh_db):
    """Stars are a personal pin — works on ingested rows too."""
    mid = _seed_material()
    tid = _seed_test(mid)
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
             hex="#abcdef", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    eid = repo.list_all()[0]["id"]
    out = repo.set_favorited(eid, True)
    assert out["favorited"] is True


def test_set_favorited_missing_returns_none(fresh_db):
    assert repo.set_favorited(99999, True) is None


def test_insert_bulk_is_idempotent_for_same_identity(fresh_db):
    """Calling insert_bulk twice with the same entries must produce
    the same rows — no duplicates. The second call returns the same
    ids as the first."""
    mid = _seed_material()
    tid = _seed_test(mid)
    entries = [
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#ff0000", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 50}),
        dict(test_id=tid, material_id=mid, x_value=600, y_value=None,
             hex="#00ff00", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 60}),
    ]
    first_ids = repo.insert_bulk(entries)
    second_ids = repo.insert_bulk(entries)
    assert first_ids == second_ids
    # Only the original two rows exist, not four.
    assert len(repo.list_all(material_id=mid)) == 2


def test_insert_bulk_refreshes_capture_fields_preserves_user_state(fresh_db):
    """A re-ingest with a different hex must update the row in place,
    refreshing hex/lab/sigma/params but preserving notes, favorited,
    and created_at."""
    mid = _seed_material()
    tid = _seed_test(mid)
    [rid] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#aa0000", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 40}),
    ])
    # Mark the row favorited and add a note via the existing repo API.
    repo.set_favorited(rid, True)
    repo.update_entry(rid, notes="perfect for stainless 316")
    original = repo.get_by_id(rid)
    original_created_at = original["created_at"]

    # Re-ingest with a different hex + sigma + params.
    [rid_again] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#bb1111", sigma=2.5, source="averaged",
             source_result_id=None, params={"power": 50}),
    ])
    assert rid_again == rid  # same row, refreshed in place
    refreshed = repo.get_by_id(rid)
    # Capture-derived fields refreshed:
    assert refreshed["hex"] == "#bb1111"
    assert refreshed["sigma"] == 2.5
    assert refreshed["params"] == {"power": 50}
    # lab_l should reflect the new hex (just check it changed).
    assert refreshed["lab"] != original["lab"]
    # User-curated state preserved:
    assert refreshed["notes"] == "perfect for stainless 316"
    assert refreshed["favorited"] is True
    assert refreshed["created_at"] == original_created_at


def test_insert_bulk_distinct_source_result_ids_stay_distinct(fresh_db):
    """Two rows with the same (test_id, x, y, source) but different
    source_result_id are DIFFERENT logical entries — they must not
    merge."""
    mid = _seed_material()
    tid = _seed_test(mid)
    rid_a = _seed_result(tid)
    rid_b = _seed_result(tid)
    [id_a] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#aa0000", sigma=1.0, source="single_result",
             source_result_id=rid_a, params={"power": 50}),
    ])
    [id_b] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#bb0000", sigma=1.0, source="single_result",
             source_result_id=rid_b, params={"power": 50}),
    ])
    assert id_a != id_b
    assert len(repo.list_all(material_id=mid)) == 2
    # Re-ingesting just one should refresh only that row.
    [id_a_again] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#cc0000", sigma=1.0, source="single_result",
             source_result_id=rid_a, params={"power": 50}),
    ])
    assert id_a_again == id_a
    rows = {e["id"]: e for e in repo.list_all(material_id=mid)}
    assert rows[id_a]["hex"] == "#cc0000"
    assert rows[id_b]["hex"] == "#bb0000"  # untouched
