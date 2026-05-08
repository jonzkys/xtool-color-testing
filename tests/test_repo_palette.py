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


def test_query_by_hex_ranks_magenta_closer_to_pink_than_grey(fresh_db):
    """Regression: a vivid magenta target should rank a pink entry
    above a grey entry. Under the old ΔE2000 ranking the magenta
    landed closer to grey than to pink (15.06 vs 17.40 — a known
    CIEDE2000 quirk where the dΘ Gaussian fires when the averaged
    hue lands at ~275° because the grey's atan2 noise pulled the
    average there). ΔE76 has no edge case and ranks correctly:
    magenta vs grey ≈ 98, magenta vs pink ≈ 60."""
    mid = _seed_material()
    tid = _seed_test(mid)
    # The exact hexes the user reported on prod. ``#d546f2`` is the
    # query target; ``#798f96`` is the offending grey; ``#d67db0``
    # is the actual perceptual nearest-neighbour.
    repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=1, y_value=None,
             hex="#798f96", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=tid, material_id=mid, x_value=2, y_value=None,
             hex="#d67db0", sigma=0.0, source="averaged",
             source_result_id=None, params={}),
    ])
    results = repo.query_by_hex("#d546f2", limit=2, material_id=mid)
    assert results[0]["entry"]["hex"] == "#d67db0", (
        "Expected pink to rank #1 against vivid magenta; got "
        f"{results[0]['entry']['hex']} (the old ΔE2000 ranking would "
        "have put grey #798f96 first)"
    )
    assert results[1]["entry"]["hex"] == "#798f96"
    # Sanity: the ΔE76 numbers should match the math we expect.
    assert results[0]["delta_e"] < 80   # pink is well under the grey
    assert results[1]["delta_e"] > 90   # grey is far


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


# ───── Validated state ────────────────────────────────────────────────


def test_validate_entry_sets_flag_lab_and_residual(fresh_db):
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_SPEC)["id"]
    [eid] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#806040", sigma=1.0, source="averaged",
             source_result_id=None, params={"power": 10}),
    ])
    out = repo.validate_entry(
        eid,
        validated_lab=(45.0, 14.0, 28.0),
        validated_test_id=tid,
        run_count=3,
    )
    assert out is not None
    assert out["is_validated"] is True
    assert out["validated_lab"] == [45.0, 14.0, 28.0]
    assert out["validated_test_id"] == tid
    assert out["validated_run_count"] == 3
    assert out["validated_at"] is not None
    # Residual is √Σ(diff²) — non-negative finite float.
    assert out["validated_residual_de"] >= 0


def test_validate_entry_returns_none_for_unknown_id(fresh_db):
    assert repo.validate_entry(99999, validated_lab=(50.0, 0.0, 0.0)) is None


def test_invalidate_clears_validated_columns(fresh_db):
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_SPEC)["id"]
    [eid] = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#806040", sigma=1.0, source="averaged",
             source_result_id=None, params={}),
    ])
    repo.validate_entry(eid, validated_lab=(45.0, 14.0, 28.0), run_count=2)
    out = repo.invalidate_entry(eid)
    assert out is not None
    assert out["is_validated"] is False
    assert out["validated_at"] is None
    assert out["validated_lab"] is None
    assert out["validated_run_count"] is None
    assert out["validated_residual_de"] is None
    # Original lab remained.
    assert len(out["lab"]) == 3


def test_invalidate_returns_none_for_unknown_id(fresh_db):
    assert repo.invalidate_entry(99999) is None


def test_create_validated_entry_inserts_fresh_row(fresh_db):
    """``create_validated_entry`` inserts a brand-new row carrying
    the burn-mean Lab + the test/cell back-reference + stability gate
    value as the residual_de field."""
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_SPEC)["id"]
    out = repo.create_validated_entry(
        machine_id="F2Ultra",
        material_id=mid,
        burn_mean_lab=(45.0, 14.0, 28.0),
        validated_test_id=tid,
        validated_cell_index=7,
        run_count=4,
        stability_de=2.5,
        params={"power": 10, "speed": 800},
    )
    assert out["is_validated"] is True
    assert out["validated_test_id"] == tid
    assert out["validated_cell_index"] == 7
    assert out["validated_run_count"] == 4
    assert out["validated_residual_de"] == 2.5
    assert out["validated_lab"] == [45.0, 14.0, 28.0]
    # New entry's lab IS the burn-mean — no separation between
    # ingestion-time and validated values for entries created this way.
    assert out["lab"] == out["validated_lab"]
    assert out["source"] == "averaged"


def test_create_validated_entry_is_idempotent_per_cell(fresh_db):
    """Re-running ``create_validated_entry`` for the same (test, cell,
    owner) refreshes the existing row rather than inserting a new
    one. Protects against duplicate-on-double-click + lets the user
    re-validate freely after uploading more results without their
    palette accumulating a new entry per save."""
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_SPEC)["id"]
    first = repo.create_validated_entry(
        machine_id="F2Ultra",
        material_id=mid,
        burn_mean_lab=(45.0, 14.0, 28.0),
        validated_test_id=tid,
        validated_cell_index=7,
        run_count=4,
        stability_de=3.0,
        params={"power": 10},
    )
    # User stars + annotates the entry — the upsert must preserve
    # both, otherwise the second save would silently wipe their work.
    repo.set_favorited(first["id"], True)
    repo.update_entry(first["id"], notes="keep me")
    second = repo.create_validated_entry(
        machine_id="F2Ultra",
        material_id=mid,
        burn_mean_lab=(50.0, 12.0, 30.0),  # a different burn-mean
        validated_test_id=tid,
        validated_cell_index=7,
        run_count=6,
        stability_de=1.5,
        params={"power": 10},
    )
    # Same row id — refreshed in place, not duplicated.
    assert second["id"] == first["id"]
    # Capture-derived values reflect the most recent save.
    assert second["validated_lab"] == [50.0, 12.0, 30.0]
    assert second["lab"] == [50.0, 12.0, 30.0]
    assert second["validated_run_count"] == 6
    assert second["validated_residual_de"] == 1.5
    # User-curated columns survive.
    assert second["favorited"] is True
    assert second["notes"] == "keep me"
    # Only one entry in the palette for this cell.
    rows = repo.list_all(validated_only=True)
    assert len([r for r in rows if r["validated_test_id"] == tid and r["validated_cell_index"] == 7]) == 1


def test_create_validated_entry_distinct_cells_dont_collide(fresh_db):
    """The natural key includes ``validated_cell_index``, so saves for
    different cells of the same test produce separate rows."""
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_SPEC)["id"]
    a = repo.create_validated_entry(
        machine_id="F2Ultra", material_id=mid,
        burn_mean_lab=(40.0, 10.0, 20.0),
        validated_test_id=tid, validated_cell_index=3,
        run_count=4, stability_de=2.0, params={},
    )
    b = repo.create_validated_entry(
        machine_id="F2Ultra", material_id=mid,
        burn_mean_lab=(60.0, -5.0, 10.0),
        validated_test_id=tid, validated_cell_index=4,
        run_count=4, stability_de=2.0, params={},
    )
    assert a["id"] != b["id"]


def test_list_all_marks_original_validated_when_results_uploaded(fresh_db):
    """``list_all`` returns ``original_validated=True`` for each entry
    that is the target of a validation cell on a test that has at
    least one non-excluded result. The flag flips ON when the test's
    first result lands — never before, even if cells reference the
    entry — so picker autopick can use it as "have I tried this colour"."""
    from xcs_gen_web.repositories import validation_cells as vc_repo

    mid = m_repo.create(name="SS")["id"]
    val_spec = {
        **_SPEC,
        "x_param": "power", "x_min": 0, "x_max": 0,
        "x_steps": 1, "rows": 1, "cells_per_row": 1,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    # Distinct ``x_value``s give the two entries different natural
    # keys; without that ``insert_bulk`` would upsert the second over
    # the first (same test_id+source+x+y+...).
    [used_id, unused_id] = repo.insert_bulk([
        dict(test_id=None, material_id=mid, x_value=1, y_value=None,
             hex="#aabbcc", sigma=0.5, source="manual",
             source_result_id=None, params={}),
        dict(test_id=None, material_id=mid, x_value=2, y_value=None,
             hex="#ddeeff", sigma=0.5, source="manual",
             source_result_id=None, params={}),
    ])
    vc_repo.replace_for_test(test_id=tid, cells=[
        {
            "cell_index": 0,
            "expected_hex": "#aabbcc",
            "expected_lab": [40.0, 5.0, -10.0],
            "palette_entry_id": used_id,
            "params": {},
        },
    ])

    # Before any results land, ``original_validated`` is False even
    # though the cell points at ``used_id``. The whole point of the
    # signal is "I've burned this once", so the test having no
    # results yet means it doesn't count.
    rows = {r["id"]: r for r in repo.list_all()}
    assert rows[used_id]["original_validated"] is False
    assert rows[unused_id]["original_validated"] is False

    # Drop a non-excluded result onto the test → flag flips on the
    # linked entry only.
    r_repo.create(
        test_id=tid, image_path="/dev/null",
        image_sha256="x" * 64,
        swatches=[{
            "row": 0, "col": 0, "x_value": 0,
            "hex": "#aabbcc", "lab": [41.0, 5.0, -10.0], "sigma": 0.5,
        }],
    )
    rows = {r["id"]: r for r in repo.list_all()}
    assert rows[used_id]["original_validated"] is True
    assert rows[unused_id]["original_validated"] is False


def test_list_all_validated_only_filter(fresh_db):
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=_SPEC)["id"]
    ids = repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=500, y_value=None,
             hex="#aa0000", sigma=1.0, source="averaged",
             source_result_id=None, params={}),
        dict(test_id=tid, material_id=mid, x_value=1000, y_value=None,
             hex="#00aa00", sigma=1.0, source="averaged",
             source_result_id=None, params={}),
    ])
    repo.validate_entry(ids[0], validated_lab=(50.0, 60.0, 50.0))
    rows = repo.list_all(validated_only=True)
    assert [r["id"] for r in rows] == [ids[0]]
    rows_all = repo.list_all()
    assert {r["id"] for r in rows_all} == set(ids)


def test_processing_params_from_palette_dict_handles_legacy_keys() -> None:
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    raw = {
        "speed": 800,
        "power": 35.0,
        "density": 250,
        "frequency": 60,        # → mopa_frequency on dataclass
        "passes": 3,            # → repeat on dataclass
        "pulse_width": 100,
    }
    p = _processing_params_from_palette_dict(raw)
    assert p.speed == 800
    assert p.power == 35.0
    assert p.density == 250
    assert p.mopa_frequency == 60
    assert p.pulse_width == 100
    assert p.repeat == 3


def test_processing_params_from_palette_dict_falls_back_to_defaults() -> None:
    from xcs_gen.model import ProcessingParams
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    p = _processing_params_from_palette_dict({})
    defaults = ProcessingParams()
    assert p.speed == defaults.speed
    assert p.power == defaults.power
    assert p.density == defaults.density
    assert p.mopa_frequency == defaults.mopa_frequency
    assert p.pulse_width == defaults.pulse_width
    assert p.repeat == defaults.repeat


def test_processing_params_from_palette_dict_accepts_canonical_keys() -> None:
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    raw = {
        "speed": 500,
        "power": 80.0,
        "density": 150,
        "mopa_frequency": 80,    # canonical dataclass name
        "repeat": 2,             # canonical dataclass name
        "pulse_width": 60,
    }
    p = _processing_params_from_palette_dict(raw)
    assert p.mopa_frequency == 80
    assert p.repeat == 2


def test_processing_params_from_palette_dict_canonical_beats_legacy_on_collision() -> None:
    from xcs_gen_web.repositories.palette import (
        _processing_params_from_palette_dict,
    )

    raw = {
        "mopa_frequency": 80,
        "frequency": 60,        # legacy — should be ignored
        "repeat": 4,
        "passes": 2,            # legacy — should be ignored
    }
    p = _processing_params_from_palette_dict(raw)
    assert p.mopa_frequency == 80
    assert p.repeat == 4


def test_insert_bulk_populates_indices(fresh_db) -> None:
    """A new palette entry inserted via insert_bulk has all six index
    values populated and metadata stamped at the current formula
    version."""
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION
    from xcs_gen_web.repositories.palette import insert_bulk, get_by_id

    mid = _seed_material()
    entry = {
        "test_id": None,
        "material_id": mid,
        "x_value": 0.5,
        "y_value": None,
        "hex": "#abcdef",
        "params": {
            "speed": 1000,
            "power": 50.0,
            "density": 100,
            "frequency": 65,
            "passes": 1,
            "pulse_width": 200,
        },
        "sigma": 0.1,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }
    [eid] = insert_bulk([entry])
    out = get_by_id(eid)
    assert out is not None
    assert "indices" in out
    idx = out["indices"]
    assert idx["pulse_spacing_mm"] == pytest.approx(1000 / (65 * 1000))
    assert idx["line_spacing_index"] == pytest.approx(1 / 100)
    assert idx["line_spacing_mm"] is None
    assert idx["pulse_energy_index"] == pytest.approx(50 / 65)
    assert idx["pulse_intensity_index"] == pytest.approx(50 / (65 * 200))
    assert idx["surface_exposure_index"] == pytest.approx(50 * 100 * 1 / 1000)
    assert idx["formula_version"] == INDICES_FORMULA_VERSION
    assert idx["density_model"] == "opaque"
    assert idx["power_model"] == "controller_percent"


def test_create_manual_populates_indices(fresh_db) -> None:
    from xcs_gen.laser_indices import INDICES_FORMULA_VERSION
    from xcs_gen_web.repositories.palette import create_manual

    mid = _seed_material()
    out = create_manual(
        material_id=mid,
        hex_="#112233",
        params={
            "speed": 800, "power": 40.0, "density": 200,
            "frequency": 60, "passes": 2, "pulse_width": 100,
        },
        notes="manual",
    )
    idx = out["indices"]
    assert idx["surface_exposure_index"] == pytest.approx(40 * 200 * 2 / 800)
    assert idx["formula_version"] == INDICES_FORMULA_VERSION


def test_list_all_includes_indices(fresh_db) -> None:
    from xcs_gen_web.repositories.palette import insert_bulk, list_all

    mid = _seed_material()
    insert_bulk([{
        "test_id": None,
        "material_id": mid,
        "x_value": 1.0, "y_value": None,
        "hex": "#aabbcc",
        "params": {
            "speed": 600, "power": 70.0, "density": 150,
            "frequency": 80, "passes": 1, "pulse_width": 60,
        },
        "sigma": 0.0,
        "source": "averaged",
        "source_result_id": None,
        "machine_id": "F2Ultra",
    }])
    rows = list_all()
    assert rows
    for r in rows:
        assert "indices" in r
        assert r["indices"]["formula_version"] >= 1


def test_update_entry_refreshes_indices_when_params_change(fresh_db) -> None:
    from xcs_gen_web.repositories.palette import (
        create_manual, update_entry, get_by_id,
    )

    mid = _seed_material()
    out = create_manual(
        material_id=mid,
        hex_="#445566",
        params={
            "speed": 1000, "power": 50, "density": 100,
            "frequency": 65, "passes": 1, "pulse_width": 200,
        },
        notes="",
    )
    eid = out["id"]
    original_exposure = out["indices"]["surface_exposure_index"]

    update_entry(eid, params={
        "speed": 1000, "power": 100, "density": 100,
        "frequency": 65, "passes": 1, "pulse_width": 200,
    })

    refreshed = get_by_id(eid)
    assert refreshed is not None
    assert refreshed["indices"]["surface_exposure_index"] == pytest.approx(
        original_exposure * 2,
    )
