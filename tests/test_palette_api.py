"""Tests for palette CRUD + query HTTP endpoints."""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import tests as t_repo


_SPEC = {"x_param": "speed", "x_min": 100, "x_max": 1000, "x_steps": 5,
         "rows": 1, "width_mm": 20, "height_mm": 8, "gap_mm": 0.5,
         "cell_shape": "rect", "square_cells": False, "angle_mode": "fixed",
         "unidirectional": False,
         "base_params": {"power": 50, "speed": 500, "frequency": 60,
                         "density": 200, "passes": 1, "pulse_width": 200,
                         "laser": "red"},
         "registration": {"mode": "on"}}


@pytest.fixture
def client(fresh_db):
    return TestClient(create_app())


@pytest.fixture
def mid(fresh_db):
    """A material id valid for the fresh_db."""
    return m_repo.create(name="Stainless")["id"]


def _seed_test(material_id: int) -> int:
    return t_repo.create(name="t", material_id=material_id, spec=_SPEC)["id"]


def _seed_entries(mid: int, test_id: int | None = None) -> list[int]:
    if test_id is None:
        test_id = _seed_test(mid)
    return pal_repo.insert_bulk([
        dict(test_id=test_id, material_id=mid, x_value=500, y_value=10,
             hex="#ff0000", sigma=1.2, source="averaged", source_result_id=None,
             params={"power": 10, "speed": 500}),
        dict(test_id=test_id, material_id=mid, x_value=1000, y_value=10,
             hex="#cc0000", sigma=0.8, source="averaged", source_result_id=None,
             params={"power": 10, "speed": 1000}),
    ])


def test_list_empty(client, fresh_db):
    resp = client.get("/api/palette")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_returns_entries(client, mid):
    _seed_entries(mid)
    entries = client.get("/api/palette").json()
    assert len(entries) == 2
    assert all(e["material_id"] == mid for e in entries)


def test_query_returns_nearest(client, mid):
    _seed_entries(mid)
    resp = client.get("/api/palette/query", params={"hex": "#ff0100", "limit": 2})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 2
    assert results[0]["entry"]["hex"] in ("#ff0000", "#cc0000")
    assert results[0]["delta_e"] <= results[1]["delta_e"]


def test_delete_by_id(client, mid):
    ids = _seed_entries(mid)
    first_id = ids[0]
    resp = client.delete(f"/api/palette/{first_id}")
    assert resp.status_code == 204
    remaining = client.get("/api/palette").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] != first_id


def test_delete_by_id_404_when_missing(client, fresh_db):
    resp = client.delete("/api/palette/99999")
    assert resp.status_code == 404


def test_delete_by_test(client, mid):
    tid = _seed_test(mid)
    _seed_entries(mid, test_id=tid)
    resp = client.delete(f"/api/palette/by-test/{tid}")
    assert resp.status_code == 204
    assert client.get("/api/palette").json() == []


def test_delete_by_test_missing_is_noop(client, fresh_db):
    """Deleting a non-existent test_id should succeed (idempotent)."""
    resp = client.delete("/api/palette/by-test/99999")
    assert resp.status_code == 204


def test_patch_notes(client, mid):
    ids = _seed_entries(mid)
    entry_id = ids[0]
    resp = client.patch(f"/api/palette/{entry_id}", json={"notes": "favourite teal"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "favourite teal"
    # And the persisted copy also has it
    persisted = next(e for e in client.get("/api/palette").json() if e["id"] == entry_id)
    assert persisted["notes"] == "favourite teal"


def test_patch_404_when_missing(client, fresh_db):
    resp = client.patch("/api/palette/99999", json={"notes": "x"})
    assert resp.status_code == 404


def test_list_filters_by_material_id(client, fresh_db):
    m1 = m_repo.create(name="Stainless")["id"]
    m2 = m_repo.create(name="Brass")["id"]
    t1 = _seed_test(m1)
    t2 = _seed_test(m2)
    pal_repo.insert_bulk([dict(test_id=t1, material_id=m1, x_value=0, y_value=None,
                               hex="#ff0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    pal_repo.insert_bulk([dict(test_id=t2, material_id=m2, x_value=0, y_value=None,
                               hex="#cc0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    # No filter: 2 entries
    all_ = client.get("/api/palette").json()
    assert len(all_) == 2
    # With filter: 1 entry from stainless only
    stainless = client.get("/api/palette", params={"material_id": m1}).json()
    assert len(stainless) == 1
    assert stainless[0]["material_id"] == m1


def test_query_filters_by_material_id(client, fresh_db):
    m1 = m_repo.create(name="Stainless")["id"]
    m2 = m_repo.create(name="Brass")["id"]
    t1 = _seed_test(m1)
    t2 = _seed_test(m2)
    # Two entries from DIFFERENT tests (one per material). Using the same
    # test_id for both materials would conflict with insert_bulk's
    # idempotency: a palette_entry's material is determined by its test,
    # so (test_id, x, y, source, source_result_id) at the same position
    # must be the same material. Companion test_list_filters_by_material_id
    # already uses this pattern.
    pal_repo.insert_bulk([dict(test_id=t1, material_id=m1, x_value=0, y_value=None,
                               hex="#ff0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    pal_repo.insert_bulk([dict(test_id=t2, material_id=m2, x_value=0, y_value=None,
                               hex="#ef0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    results = client.get(
        "/api/palette/query",
        params={"hex": "#ff0000", "limit": 5, "material_id": m2},
    ).json()
    assert len(results) == 1
    assert results[0]["entry"]["material_id"] == m2


def test_create_manual_success(client, mid):
    body = {
        "material_id": mid,
        "hex": "#abcdef",
        "params": {"power": 50, "speed": 1000, "laser": "red"},
        "notes": "first manual",
    }
    resp = client.post("/api/palette/manual", json=body)
    assert resp.status_code == 201
    e = resp.json()
    assert e["source"] == "manual"
    assert e["test_id"] is None
    assert e["favorited"] is False
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", e["hex"])


def test_create_manual_invalid_hex(client, mid):
    resp = client.post("/api/palette/manual", json={
        "material_id": mid, "hex": "blue", "params": {}, "notes": "",
    })
    assert resp.status_code == 422


def test_create_manual_missing_material(client, fresh_db):
    resp = client.post("/api/palette/manual", json={
        "hex": "#abcdef", "params": {}, "notes": "",
    })
    assert resp.status_code == 422


def test_patch_favorited(client, mid):
    ids = _seed_entries(mid)
    eid = ids[0]
    resp = client.patch(f"/api/palette/{eid}", json={"favorited": True})
    assert resp.status_code == 200
    assert resp.json()["favorited"] is True
    listed = next(e for e in client.get("/api/palette").json() if e["id"] == eid)
    assert listed["favorited"] is True


def test_patch_recipe_on_manual_succeeds(client, mid):
    body = {"material_id": mid, "hex": "#000000", "params": {"power": 1}, "notes": "x"}
    e = client.post("/api/palette/manual", json=body).json()
    resp = client.patch(f"/api/palette/{e['id']}", json={"hex": "#ffffff"})
    assert resp.status_code == 200
    assert resp.json()["hex"] == "#ffffff"


def test_patch_recipe_on_ingested_409(client, mid):
    ids = _seed_entries(mid)
    resp = client.patch(f"/api/palette/{ids[0]}", json={"hex": "#ffffff"})
    assert resp.status_code == 409


def test_list_filters_favorites_only(client, mid):
    ids = _seed_entries(mid)
    client.patch(f"/api/palette/{ids[0]}", json={"favorited": True})
    favs = client.get("/api/palette", params={"favorites_only": "true"}).json()
    assert len(favs) == 1
    assert favs[0]["id"] == ids[0]


def test_list_filters_by_source(client, mid):
    _seed_entries(mid)  # 'averaged'
    client.post("/api/palette/manual", json={
        "material_id": mid, "hex": "#cafefe", "params": {}, "notes": "",
    })
    manual = client.get("/api/palette", params={"source": "manual"}).json()
    assert len(manual) == 1
    assert manual[0]["source"] == "manual"


def test_patch_favorited_plus_recipe_on_ingested_is_atomic(client, mid):
    """Combining favorited + recipe-mutation on an ingested row must be all-or-nothing.
    Without the pre-flight, set_favorited runs first and partially commits."""
    ids = _seed_entries(mid)
    eid = ids[0]
    resp = client.patch(
        f"/api/palette/{eid}",
        json={"favorited": True, "hex": "#ffffff"},
    )
    assert resp.status_code == 409
    listed = next(e for e in client.get("/api/palette").json() if e["id"] == eid)
    assert listed["favorited"] is False  # No partial application


# ───── Validation status ─────────────────────────────────────────────────


def _seed_validation_with_result(
    mid: int,
    *,
    expected_lab: list[float],
    measured_lab: list[float],
) -> int:
    """Seed a palette entry, a validation test that targets it via a
    single cell, and a result whose swatch carries ``measured_lab``.
    Returns the seeded palette entry's id so the test can assert
    against it. ``cells_per_row=1`` keeps the row/col → cell-index
    math trivial."""
    from xcs_gen_web.repositories import results as r_repo
    from xcs_gen_web.repositories import validation_cells as vc_repo

    val_spec = {
        **_SPEC,
        "x_param": "power",
        "x_min": 0,
        "x_max": 0,
        "x_steps": 1,
        "rows": 1,
        "cells_per_row": 1,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    [eid] = pal_repo.insert_bulk([
        dict(
            test_id=tid, material_id=mid, x_value=0, y_value=None,
            hex="#aabbcc", sigma=0.5, source="averaged",
            source_result_id=None,
            params={"power": 14.6, "speed": 2400},
        ),
    ])
    vc_repo.replace_for_test(test_id=tid, cells=[
        {
            "cell_index": 0,
            "expected_hex": "#aabbcc",
            "expected_lab": expected_lab,
            "palette_entry_id": eid,
            "params": {"power": 14.6, "speed": 2400},
        },
    ])
    r_repo.create(
        test_id=tid,
        image_path="/dev/null",
        image_sha256="x" * 64,
        swatches=[{
            "row": 0, "col": 0, "x_value": 0, "y_value": None,
            "hex": "#aabbcc", "lab": measured_lab, "sigma": 0.5,
        }],
    )
    return eid


def test_validation_status_reads_is_validated_flag(client, mid):
    """``validated`` mirrors the entry's ``is_validated`` column. The
    Phase 2 validate flow flips this flag on save; the heuristic
    "low-ΔE measurement implies validated" is gone."""
    eid = _seed_validation_with_result(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_lab=[41.0, 5.5, -9.0],
    )
    # Default state: not validated, even with a tight measurement.
    rows = client.get(
        "/api/palette/validation-status", params={"material_id": mid},
    ).json()
    by_id = {r["entry_id"]: r for r in rows}
    assert by_id[eid]["validated"] is False
    # Flip the flag via the per-entry validate route.
    client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [41.0, 5.5, -9.0], "run_count": 3},
    )
    rows = client.get(
        "/api/palette/validation-status", params={"material_id": mid},
    ).json()
    by_id = {r["entry_id"]: r for r in rows}
    assert by_id[eid]["validated"] is True
    assert by_id[eid]["best_de"] is not None
    assert by_id[eid]["last_validated_at"] is not None


def test_validation_status_unvalidated_for_far_measurements(client, mid):
    """A high-ΔE measurement no longer matters — the only thing that
    flips ``validated`` is the explicit per-entry / batch validate
    route. An untouched entry stays unvalidated regardless of how
    its results landed."""
    eid = _seed_validation_with_result(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_lab=[80.0, 5.0, -10.0],  # very far off — irrelevant now
    )
    rows = client.get(
        "/api/palette/validation-status", params={"material_id": mid},
    ).json()
    by_id = {r["entry_id"]: r for r in rows}
    assert by_id[eid]["validated"] is False
    assert by_id[eid]["best_de"] is None  # no validate call made


def test_validation_status_unvalidated_when_no_validation_test(client, mid):
    """An entry with no validation cell pointing to it has best_de=None."""
    _seed_entries(mid)
    rows = client.get(
        "/api/palette/validation-status", params={"material_id": mid},
    ).json()
    assert all(r["best_de"] is None for r in rows)
    assert all(r["validated"] is False for r in rows)


def test_validation_status_filters_by_machine_id(client, mid):
    """``machine_id`` filters the entry universe; entries on a different
    machine are excluded entirely."""
    _seed_validation_with_result(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_lab=[40.0, 5.0, -10.0],
    )
    # Default machine is F2Ultra; ask for a different one and we get
    # an empty list (no entries scoped there).
    rows = client.get(
        "/api/palette/validation-status",
        params={"material_id": mid, "machine_id": "DoesNotExist"},
    ).json()
    assert rows == []


def test_validation_status_max_de_param_is_accepted_but_ignored(client, mid):
    """``max_de`` is wire-compat — old callers still pass it. The
    actual gate is ``is_validated``, set when the entry was saved
    via the validate flow, so ``max_de`` no longer changes the
    result. Endpoint must still accept the parameter (no 422)."""
    eid = _seed_validation_with_result(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_lab=[44.0, 5.0, -10.0],
    )
    client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [44.0, 5.0, -10.0], "run_count": 2},
    )
    # Loose threshold + strict threshold both report the same thing
    # now: the flag is what matters, not the legacy ΔE knob.
    rows_loose = client.get(
        "/api/palette/validation-status", params={"material_id": mid},
    ).json()
    rows_strict = client.get(
        "/api/palette/validation-status",
        params={"material_id": mid, "max_de": 0.1},
    ).json()
    loose_by_id = {r["entry_id"]: r for r in rows_loose}
    strict_by_id = {r["entry_id"]: r for r in rows_strict}
    assert loose_by_id[eid]["validated"] is True
    assert strict_by_id[eid]["validated"] is True


# ───── Validated state (per-entry) ─────────────────────────────────────


def test_palette_response_carries_validated_defaults(client, mid):
    """Untouched entries serialize with is_validated=false and the
    validated_* fields all None — the canonical baseline for entries
    that haven't been through a validation analysis."""
    _seed_entries(mid)
    entries = client.get("/api/palette").json()
    assert len(entries) == 2
    for e in entries:
        assert e["is_validated"] is False
        assert e["validated_at"] is None
        assert e["validated_test_id"] is None
        assert e["validated_lab"] is None
        assert e["validated_run_count"] is None
        assert e["validated_residual_de"] is None


def test_validate_entry_persists_lab_and_residual(client, mid):
    """POST /api/palette/{id}/validate stores the corrected Lab,
    flips the flag, and computes the residual ΔE76 from the
    original — surfaced so callers can flag big movers."""
    [eid_a, eid_b] = _seed_entries(mid)
    # Original lab for eid_a was hex_to_lab('#ff0000') ≈ (53, 80, 67).
    # Pick a validated_lab a few units away on each axis.
    body = {
        "validated_lab": [55.0, 78.0, 65.0],
        "validated_test_id": _seed_test(mid),
        "run_count": 4,
    }
    r = client.post(f"/api/palette/{eid_a}/validate", json=body)
    assert r.status_code == 200, r.text
    entry = r.json()
    assert entry["is_validated"] is True
    assert entry["validated_lab"] == [55.0, 78.0, 65.0]
    assert entry["validated_test_id"] == body["validated_test_id"]
    assert entry["validated_run_count"] == 4
    assert entry["validated_at"] is not None
    # √((55-53)² + (78-80)² + (65-67)²) ≈ 3.46
    assert entry["validated_residual_de"] is not None
    assert 3.0 < entry["validated_residual_de"] < 4.0
    # The other entry stays unvalidated.
    others = client.get("/api/palette").json()
    other = next(e for e in others if e["id"] == eid_b)
    assert other["is_validated"] is False


def test_validate_entry_refresh_overwrites(client, mid):
    """Re-validating an already-validated entry refreshes the
    Lab and timestamp without keeping a history (per the design
    decision: warn-and-refresh)."""
    [eid] = _seed_entries(mid)[:1]
    client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [50.0, 60.0, 60.0], "run_count": 2},
    )
    first = client.get("/api/palette").json()
    first_at = next(e for e in first if e["id"] == eid)["validated_at"]

    r = client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [52.0, 62.0, 58.0], "run_count": 5},
    )
    entry = r.json()
    assert entry["validated_lab"] == [52.0, 62.0, 58.0]
    assert entry["validated_run_count"] == 5
    # Timestamp refreshed (or at least non-decreasing).
    assert entry["validated_at"] >= first_at


def test_validate_entry_404_when_missing(client, fresh_db):
    r = client.post(
        "/api/palette/99999/validate",
        json={"validated_lab": [50.0, 0.0, 0.0]},
    )
    assert r.status_code == 404


def test_validate_entry_422_on_bad_lab(client, mid):
    [eid] = _seed_entries(mid)[:1]
    # Wrong arity.
    r = client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [50.0, 0.0]},
    )
    assert r.status_code == 422


def test_invalidate_clears_state(client, mid):
    [eid] = _seed_entries(mid)[:1]
    client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [55.0, 78.0, 65.0], "run_count": 3},
    )
    r = client.delete(f"/api/palette/{eid}/validate")
    assert r.status_code == 200
    entry = r.json()
    assert entry["is_validated"] is False
    assert entry["validated_at"] is None
    assert entry["validated_lab"] is None
    assert entry["validated_run_count"] is None
    assert entry["validated_residual_de"] is None
    # Original lab is preserved.
    assert len(entry["lab"]) == 3


def test_invalidate_404_when_missing(client, fresh_db):
    r = client.delete("/api/palette/99999/validate")
    assert r.status_code == 404


def test_palette_list_validated_only_filter(client, mid):
    """``?validated_only=true`` restricts to entries with the flag set
    — the auto-match's "Prefer validated" toggle uses this path."""
    [eid_a, eid_b] = _seed_entries(mid)
    # No entry validated yet → empty.
    rows = client.get("/api/palette?validated_only=true").json()
    assert rows == []

    client.post(
        f"/api/palette/{eid_a}/validate",
        json={"validated_lab": [55.0, 78.0, 65.0]},
    )
    rows = client.get("/api/palette?validated_only=true").json()
    assert [e["id"] for e in rows] == [eid_a]
    # Without the filter, both still appear.
    rows_all = client.get("/api/palette").json()
    assert {e["id"] for e in rows_all} == {eid_a, eid_b}


def test_validated_test_id_set_to_null_on_test_delete(client, mid):
    """The FK uses ``ON DELETE SET NULL`` so deleting the source
    test preserves validated_lab + the flag, only clearing the
    test reference."""
    [eid] = _seed_entries(mid)[:1]
    val_tid = _seed_test(mid)
    client.post(
        f"/api/palette/{eid}/validate",
        json={"validated_lab": [55.0, 78.0, 65.0], "validated_test_id": val_tid},
    )
    # Hard-delete the validated test row to exercise the FK.
    from xcs_gen_web.repositories import tests as tt_repo
    tt_repo.delete(val_tid)
    entry = next(
        e for e in client.get("/api/palette").json() if e["id"] == eid
    )
    # Validated state retained; only the FK reference cleared.
    assert entry["is_validated"] is True
    assert entry["validated_lab"] == [55.0, 78.0, 65.0]
    assert entry["validated_test_id"] is None


# ───── Batch validate (POST /api/tests/{tid}/validate) ─────────────────


def _seed_validation_with_n_results(
    mid: int,
    *,
    expected_lab: list[float],
    measured_labs: list[list[float]],
) -> tuple[int, int]:
    """Two-result variant of ``_seed_validation_with_result`` so the
    batch validate route's MIN_RESULTS=2 gate is satisfied.

    Returns ``(test_id, palette_entry_id)`` so the caller can both
    drive the validate endpoint AND inspect the entry afterwards.
    """
    from xcs_gen_web.repositories import results as r_repo
    from xcs_gen_web.repositories import validation_cells as vc_repo

    val_spec = {
        **_SPEC,
        "x_param": "power",
        "x_min": 0, "x_max": 0, "x_steps": 1, "rows": 1,
        "cells_per_row": 1,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    [eid] = pal_repo.insert_bulk([
        dict(
            test_id=tid, material_id=mid, x_value=0, y_value=None,
            hex="#aabbcc", sigma=0.5, source="averaged",
            source_result_id=None,
            params={"power": 14.6, "speed": 2400},
        ),
    ])
    vc_repo.replace_for_test(test_id=tid, cells=[
        {
            "cell_index": 0,
            "expected_hex": "#aabbcc",
            "expected_lab": expected_lab,
            "palette_entry_id": eid,
            "params": {"power": 14.6, "speed": 2400},
        },
    ])
    for i, lab in enumerate(measured_labs):
        r_repo.create(
            test_id=tid,
            image_path=f"/dev/null/{i}",
            image_sha256=("x" * 63) + str(i),
            swatches=[{
                "row": 0, "col": 0, "x_value": 0, "y_value": None,
                "hex": "#aabbcc", "lab": lab, "sigma": 0.5,
            }],
        )
    return tid, eid


def test_batch_validate_404_when_test_missing(client, fresh_db):
    r = client.post("/api/tests/99999/validate", json={"tolerance_de": 8})
    assert r.status_code == 404


def test_batch_validate_400_when_test_is_not_validation_kind(client, mid):
    """Sweep tests have no validation_cells; the route must refuse."""
    tid = _seed_test(mid)  # kind="sweep" by default
    r = client.post(f"/api/tests/{tid}/validate", json={"tolerance_de": 8})
    assert r.status_code == 400
    assert "validation" in r.json()["detail"].lower()


def test_batch_validate_dry_run_doesnt_persist(client, mid):
    """``dry_run=true`` returns the bucketing without writing
    anything — no new entries created, source entry untouched."""
    tid, eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        # Two runs that both centre at (41, 5, -10) → tight cluster
        # → low stability_de.
        measured_labs=[[41.0, 5.0, -10.0], [41.0, 5.0, -10.0]],
    )
    palette_before = client.get("/api/palette").json()
    r = client.post(
        f"/api/tests/{tid}/validate",
        json={"tolerance_de": 8, "dry_run": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert body["dry_run"] is True
    assert body["result_count"] == 2
    assert len(body["stable"]) == 1
    stable = body["stable"][0]
    assert stable["palette_entry_id"] == eid  # provenance, not target
    assert stable["persisted"] is False
    assert stable["new_entry_id"] is None
    # No new entry created; source entry stays unvalidated.
    palette_after = client.get("/api/palette").json()
    assert len(palette_after) == len(palette_before)
    src = next(e for e in palette_after if e["id"] == eid)
    assert src["is_validated"] is False


def test_batch_validate_persists_creates_new_entry(client, mid):
    """Stable cells produce brand-new validated palette entries on
    save — the linked source entry stays untouched, so the user can
    keep both around."""
    tid, eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_labs=[[41.0, 5.0, -10.0], [41.0, 5.0, -10.0]],
    )
    r = client.post(
        f"/api/tests/{tid}/validate",
        json={"tolerance_de": 8},
    )
    body = r.json()
    assert body["dry_run"] is False
    assert len(body["stable"]) == 1
    stable = body["stable"][0]
    assert stable["persisted"] is True
    new_id = stable["new_entry_id"]
    assert new_id is not None
    assert new_id != eid

    palette = client.get("/api/palette").json()
    src = next(e for e in palette if e["id"] == eid)
    assert src["is_validated"] is False  # original untouched
    new_entry = next(e for e in palette if e["id"] == new_id)
    assert new_entry["is_validated"] is True
    assert new_entry["validated_test_id"] == tid
    # Cell index back-reference lets the UI link directly to the
    # source cell instead of forcing the user to find it by params.
    assert new_entry["validated_cell_index"] == 0
    assert new_entry["source"] == "averaged"
    # New entry's lab IS the burn-mean (≈ 41, 5, -10).
    assert abs(new_entry["lab"][0] - 41.0) < 0.5
    # validated_lab mirrors lab on these new entries (same value).
    assert new_entry["validated_lab"] == new_entry["lab"]
    # Stability gate value lands on validated_residual_de.
    assert new_entry["validated_residual_de"] is not None
    assert new_entry["validated_residual_de"] < 1.0


def test_batch_validate_unstable_runs_go_to_drifted(client, mid):
    """Two runs whose per-cell means are far apart land in the
    ``drifted`` bucket and are NOT persisted by default — even if
    each individual run looks tight on its own."""
    tid, eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        # Run 0 at (40, 5, -10); Run 1 at (60, 5, -10) — consensus
        # ≈ (50, 5, -10) but each run is 10 ΔE from consensus.
        measured_labs=[[40.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
    )
    r = client.post(
        f"/api/tests/{tid}/validate",
        json={"tolerance_de": 8},
    )
    body = r.json()
    assert len(body["stable"]) == 0
    assert len(body["drifted"]) == 1
    drifted = body["drifted"][0]
    assert drifted["palette_entry_id"] == eid
    assert drifted["persisted"] is False
    assert drifted["new_entry_id"] is None
    assert drifted["stability_de"] >= 8  # over tolerance
    # No new entry created.
    palette = client.get("/api/palette").json()
    assert all(e["validated_test_id"] != tid for e in palette)


def test_batch_validate_stable_far_from_expected_still_stable(client, mid):
    """A burn-mean far from the *original* expected Lab is fine as
    long as it's stable across runs — the gate is intra-cell σ, not
    closeness-to-original. Original might be wrong."""
    tid, _eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        # Both runs at (60, 5, -10) — far from expected (ΔE 20) but
        # tightly clustered (stability_de ≈ 0).
        measured_labs=[[60.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
    )
    r = client.post(
        f"/api/tests/{tid}/validate",
        json={"tolerance_de": 8, "dry_run": True},
    )
    body = r.json()
    assert len(body["stable"]) == 1
    stable = body["stable"][0]
    assert stable["stability_de"] < 1.0
    assert stable["de_vs_expected"] >= 19  # informational, not gating


def test_batch_validate_override_accepts_drifted_cell(client, mid):
    """The user can force a drifted cell to persist via the
    overrides list — "yes, save this colour even though it wandered
    between runs"."""
    tid, _eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_labs=[[40.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
    )
    r = client.post(
        f"/api/tests/{tid}/validate",
        json={
            "tolerance_de": 8,
            "overrides": [{"cell_index": 0, "accept": True}],
        },
    )
    body = r.json()
    assert len(body["drifted"]) == 1
    drifted = body["drifted"][0]
    assert drifted["persisted"] is True
    assert drifted["new_entry_id"] is not None
    new_entry = next(
        e for e in client.get("/api/palette").json()
        if e["id"] == drifted["new_entry_id"]
    )
    assert new_entry["is_validated"] is True


def test_batch_validate_override_skips_stable_cell(client, mid):
    """The user can also veto a stable cell — "I don't want this in
    the palette". No new entry is created."""
    tid, _eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_labs=[[41.0, 5.0, -10.0], [41.0, 5.0, -10.0]],
    )
    r = client.post(
        f"/api/tests/{tid}/validate",
        json={
            "tolerance_de": 8,
            "overrides": [{"cell_index": 0, "accept": False}],
        },
    )
    body = r.json()
    assert len(body["stable"]) == 1
    stable = body["stable"][0]
    assert stable["persisted"] is False
    assert stable["new_entry_id"] is None
    palette = client.get("/api/palette").json()
    assert all(e["validated_test_id"] != tid for e in palette)


def test_batch_validate_unlinked_cells_create_fresh_entries(client, mid):
    """Validation cells with NULL palette_entry_id are first-class
    citizens — no longer skipped. They get bucketed normally and on
    save produce a brand-new palette entry on their own."""
    from xcs_gen_web.repositories import results as r_repo
    from xcs_gen_web.repositories import validation_cells as vc_repo

    val_spec = {
        **_SPEC,
        "x_param": "power", "x_min": 0, "x_max": 0,
        "x_steps": 1, "rows": 1, "cells_per_row": 1,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    vc_repo.replace_for_test(test_id=tid, cells=[
        {
            "cell_index": 0,
            "expected_hex": "#aabbcc",
            "expected_lab": [40.0, 5.0, -10.0],
            "palette_entry_id": None,  # unlinked
            "params": {"power": 14.6},
        },
    ])
    for i in range(2):
        r_repo.create(
            test_id=tid, image_path=f"/dev/null/{i}",
            image_sha256=("x" * 63) + str(i),
            swatches=[{
                "row": 0, "col": 0, "x_value": 0,
                "hex": "#aabbcc", "lab": [41.0, 5.0, -10.0], "sigma": 0.5,
            }],
        )
    r = client.post(f"/api/tests/{tid}/validate", json={"tolerance_de": 8})
    body = r.json()
    # No skipped — unlinked cells should bucket like any other.
    assert len(body["skipped"]) == 0
    assert len(body["stable"]) == 1
    stable = body["stable"][0]
    assert stable["palette_entry_id"] is None
    assert stable["persisted"] is True
    assert stable["new_entry_id"] is not None
    new_entry = next(
        e for e in client.get("/api/palette").json()
        if e["id"] == stable["new_entry_id"]
    )
    assert new_entry["is_validated"] is True
    assert new_entry["validated_test_id"] == tid


def test_batch_validate_skips_cells_with_one_run(client, mid):
    """Single-result validation falls into skipped — stability is
    undefined when there's only one cross-run datapoint."""
    from xcs_gen_web.repositories import results as r_repo
    from xcs_gen_web.repositories import validation_cells as vc_repo

    val_spec = {
        **_SPEC,
        "x_param": "power", "x_min": 0, "x_max": 0,
        "x_steps": 1, "rows": 1, "cells_per_row": 1,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    [eid] = pal_repo.insert_bulk([
        dict(test_id=tid, material_id=mid, x_value=0, y_value=None,
             hex="#aabbcc", sigma=0.5, source="averaged",
             source_result_id=None, params={}),
    ])
    vc_repo.replace_for_test(test_id=tid, cells=[
        {
            "cell_index": 0,
            "expected_hex": "#aabbcc",
            "expected_lab": [40.0, 5.0, -10.0],
            "palette_entry_id": eid,
            "params": {},
        },
    ])
    r_repo.create(
        test_id=tid, image_path="/dev/null",
        image_sha256="x" * 64,
        swatches=[{
            "row": 0, "col": 0, "x_value": 0,
            "hex": "#aabbcc", "lab": [41.0, 5.0, -10.0], "sigma": 0.5,
        }],
    )
    r = client.post(f"/api/tests/{tid}/validate", json={"tolerance_de": 8})
    body = r.json()
    assert len(body["skipped"]) == 1
    assert body["skipped"][0]["reason"] == "insufficient_runs"


def test_batch_validate_filters_by_result_ids(client, mid):
    """``result_ids`` restricts the contributing results — useful
    for "validate from these specific runs only" workflows."""
    tid, _eid = _seed_validation_with_n_results(
        mid,
        expected_lab=[40.0, 5.0, -10.0],
        measured_labs=[[41.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
    )
    # All results: stability_de ≈ 9 → drifted at tol=8.
    r_all = client.post(
        f"/api/tests/{tid}/validate",
        json={"tolerance_de": 8, "dry_run": True},
    ).json()
    rids = [
        r["id"] for r in client.get(f"/api/tests/{tid}/results").json()
    ]
    r_one = client.post(
        f"/api/tests/{tid}/validate",
        json={
            "tolerance_de": 8, "dry_run": True,
            "result_ids": [rids[0]],
        },
    ).json()
    # Single result → can't measure stability → skipped.
    assert r_one["result_count"] == 1
    assert len(r_one["skipped"]) == 1
    assert r_one["skipped"][0]["reason"] == "insufficient_runs"
    # Both results → bucketed (drifted because each run is 9.5 from mean).
    assert r_all["result_count"] == 2
    assert len(r_all["skipped"]) == 0
    assert len(r_all["drifted"]) == 1
