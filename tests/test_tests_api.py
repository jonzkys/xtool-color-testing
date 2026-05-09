from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import results as r_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.repositories import validation_cells as vc_repo


BASE = {"power": 50, "speed": 1000, "frequency": 60,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}

SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _client_and_material(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    return c, mid


def test_create_and_get(fresh_db):
    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "T1", "material_id": mid, "spec": SPEC, "notes": "",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "created" and body["locked"] is False
    tid = body["id"]
    assert c.get(f"/api/tests/{tid}").json()["name"] == "T1"


def test_list_filters(fresh_db):
    c, mid = _client_and_material(fresh_db)
    c.post("/api/tests", json={"name": "A", "material_id": mid, "spec": SPEC})
    c.post("/api/tests", json={"name": "B", "material_id": mid, "spec": SPEC})
    rows = c.get("/api/tests").json()
    assert {r["name"] for r in rows} == {"A", "B"}


def test_patch_spec_blocked_when_locked(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    r = c.patch(f"/api/tests/{tid}", json={"spec": {**SPEC, "x_steps": 20}})
    assert r.status_code == 409


def test_patch_name_notes_allowed_when_locked(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    r = c.patch(f"/api/tests/{tid}", json={"name": "renamed"})
    assert r.status_code == 200 and r.json()["name"] == "renamed"


def test_soft_delete_removes_from_default_list(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    c.delete(f"/api/tests/{tid}")
    assert c.get("/api/tests").json() == []
    assert c.get(f"/api/tests/{tid}").json()["status"] == "deleted"


def test_patch_material_allowed_when_unlocked(fresh_db):
    """Changing substrate is fine before a result is uploaded."""
    c, mid1 = _client_and_material(fresh_db)
    mid2 = m_repo.create(name="Brass")["id"]
    tid = c.post(
        "/api/tests", json={"name": "T", "material_id": mid1, "spec": SPEC},
    ).json()["id"]

    r = c.patch(f"/api/tests/{tid}", json={"material_id": mid2})
    assert r.status_code == 200
    assert r.json()["material_id"] == mid2


def test_patch_material_allowed_when_locked_and_cascades_palette(fresh_db):
    """Material is editable on locked tests so a wrong-material burn
    can be relabelled. Any palette entries already harvested from the
    test cascade to the new material in the same transaction."""
    c, mid1 = _client_and_material(fresh_db)
    mid2 = m_repo.create(name="Brass")["id"]
    tid = c.post(
        "/api/tests", json={"name": "T", "material_id": mid1, "spec": SPEC},
    ).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    [eid] = pal_repo.insert_bulk([{
        "test_id": tid, "material_id": mid1, "hex": "#aabbcc",
        "sigma": 1.0, "source": "single_result",
    }])

    r = c.patch(f"/api/tests/{tid}", json={"material_id": mid2})
    assert r.status_code == 200
    assert r.json()["material_id"] == mid2
    # Palette entry harvested under the old material was reassigned.
    [entry] = pal_repo.list_all(material_id=mid2)
    assert entry["id"] == eid
    assert pal_repo.list_all(material_id=mid1) == []


def test_patch_material_rejects_unknown_id(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post(
        "/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC},
    ).json()["id"]
    r = c.patch(f"/api/tests/{tid}", json={"material_id": 99999})
    assert r.status_code == 400
    assert "unknown material_id" in r.json()["detail"]


# ── Default-mode resolution ──────────────────────────────────────────────────

# COLOR_ENGRAVE allows frequency up to 500 kHz; STANDARD caps at 60 kHz.
# If F2Ultra silently defaults to color_engrave when mode is absent, a
# request with frequency=400 should succeed (201). If it defaulted to
# engrave/STANDARD instead it would 422.
_BASE_CE = {
    "power": 50,
    "speed": 1000,
    "frequency": 400,   # valid for COLOR_ENGRAVE (60-500 kHz), out-of-range for STANDARD (30-60 kHz)
    "density": 200,
    "passes": 1,
    "pulse_width": 200,
    "laser": "red",
}

_SPEC_CE = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 5,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": False, "angle_mode": "fixed",
    "unidirectional": False, "base_params": _BASE_CE,
    "registration": {"mode": "off"},
}


def test_tests_create_defaults_mode_color_engrave_for_f2(fresh_db):
    """F2Ultra with no mode in base_params defaults to color_engrave.

    A frequency of 400 kHz is within color_engrave's [60, 500] kHz
    range but above the STANDARD cap of 60 kHz. If the backend were
    wrongly defaulting to STANDARD (engrave) the request would 422.
    """
    c = TestClient(create_app())
    mid = m_repo.create(name="Stainless")["id"]
    r = c.post("/api/tests", json={
        "name": "CE-default",
        "material_id": mid,
        "machine_id": "F2Ultra",
        "spec": _SPEC_CE,
    })
    assert r.status_code == 201, r.json()
    # The stored spec should round-trip cleanly (mode field may be None
    # in the response — what matters is the 201, not the persisted mode value).
    body = r.json()
    assert body["machine_id"] == "F2Ultra"


def test_tests_create_explicit_mode_color_engrave_for_f2(fresh_db):
    """Explicitly passing mode=color_engrave also succeeds for F2Ultra."""
    c = TestClient(create_app())
    mid = m_repo.create(name="Stainless")["id"]
    spec_with_mode = dict(_SPEC_CE)
    spec_with_mode["base_params"] = {**_BASE_CE, "mode": "color_engrave"}
    r = c.post("/api/tests", json={
        "name": "CE-explicit",
        "material_id": mid,
        "machine_id": "F2Ultra",
        "spec": spec_with_mode,
    })
    assert r.status_code == 201, r.json()


def test_tests_create_f1_clamps_high_frequency_to_profile_max(fresh_db):
    """F1Ultra with no mode defaults to engrave (STANDARD, max 60 kHz).

    A spec with frequency=400 kHz used to 422; we now snap it to the
    profile's max instead so legacy specs (created on F2 / migrated
    from older defaults) survive a save under the new machine. Mirrors
    the pulse_width snap-on-load behaviour — see CLAUDE.md.
    """
    c = TestClient(create_app())
    mid = m_repo.create(name="Aluminium")["id"]
    base_f1 = dict(_BASE_CE)   # frequency=400_000 (kHz), pulse_width=200
    spec_f1 = dict(_SPEC_CE)
    spec_f1["base_params"] = base_f1
    r = c.post("/api/tests", json={
        "name": "F1-snapped-freq",
        "material_id": mid,
        "machine_id": "F1Ultra",
        "spec": spec_f1,
    })
    assert r.status_code == 201, r.json()
    saved = r.json()
    # F1Ultra STANDARD profile has frequency in [30, 60] kHz — the
    # excessive 400_000 should snap down to 60.
    assert saved["spec"]["base_params"]["frequency"] == 60


def test_tests_lock_route_locks_and_unlocks_before_results(fresh_db):
    """``POST /api/tests/{id}/lock`` flips the manual lock flag both
    ways while the test has no results uploaded. Use case: lock
    while engraving so accidental knob fiddling doesn't change the
    spec before the photo lands."""
    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "lockable", "material_id": mid,
        "machine_id": "F2Ultra", "spec": SPEC,
    })
    tid = r.json()["id"]
    assert r.json()["locked"] is False

    # Lock manually.
    r = c.post(f"/api/tests/{tid}/lock", json={"locked": True})
    assert r.status_code == 200
    assert r.json()["locked"] is True

    # Spec edits refused.
    r = c.patch(f"/api/tests/{tid}", json={"spec": SPEC})
    assert r.status_code == 409

    # Unlock manually — allowed because no results yet.
    r = c.post(f"/api/tests/{tid}/lock", json={"locked": False})
    assert r.status_code == 200
    assert r.json()["locked"] is False

    # Spec edits work again.
    r = c.patch(f"/api/tests/{tid}", json={"spec": SPEC})
    assert r.status_code == 200


def test_tests_lock_unlock_refused_after_results(fresh_db):
    """Once a result has been uploaded the auto-lock is permanent.
    The user duplicates the test to change the spec — re-burning the
    same QR has to use the same recipe."""
    from xcs_gen_web.repositories import results as r_repo

    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "post-result", "material_id": mid,
        "machine_id": "F2Ultra", "spec": SPEC,
    })
    tid = r.json()["id"]

    # Drop a result directly via the repo to trigger mark_tested_and_lock.
    r_repo.create(
        test_id=tid, image_path="/dev/null", image_sha256="x" * 64,
        swatches=[],
    )
    t_repo.mark_tested_and_lock(tid)

    # Manual unlock refused — auto-lock stays.
    r = c.post(f"/api/tests/{tid}/lock", json={"locked": False})
    assert r.status_code == 409
    assert "duplicate" in r.json()["detail"].lower()


# ── Validate batch — derived_from_entry_id lineage ───────────────────────────

# A minimal 1-row × 4-cell spec used for lineage tests. cells_per_row=4.
_VAL_SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 4,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": BASE,
    "registration": {"mode": "on"},
}


def test_validate_persists_derived_from_entry_id(fresh_db):
    """When a validation test ingests results, each new palette entry
    carries derived_from_entry_id pointing at the source palette entry
    whose cell was burned to validate.

    Strategy: use repos directly to avoid image-upload plumbing. Two
    results (same swatches) give stability_de ≈ 0, well within the
    default 8 ΔE tolerance, so cell 0 lands in the stable bucket and
    gets persisted (dry_run=false, no overrides).
    """
    c = TestClient(create_app())

    # Two materials: one for the source sweep, one for the validation run.
    src_mid = m_repo.create(name="SrcMaterial")["id"]
    val_mid = m_repo.create(name="ValMaterial")["id"]

    # Create a source sweep test and harvest one palette entry from it.
    src_tid = t_repo.create(name="SrcSweep", material_id=src_mid, spec=_VAL_SPEC)["id"]
    [src_eid] = pal_repo.insert_bulk([{
        "test_id": src_tid,
        "material_id": src_mid,
        "hex": "#3c3c3c",
        "sigma": 0.5,
        "source": "averaged",
        "params": {"power": 50, "speed": 500},
    }])

    # Create a validation test and populate cell 0 with palette_entry_id
    # pointing at the source entry.
    val_tid = t_repo.create(
        name="ValRun", material_id=val_mid, spec=_VAL_SPEC, kind="validation",
    )["id"]
    vc_repo.replace_for_test(test_id=val_tid, cells=[{
        "cell_index": 0,
        "palette_entry_id": src_eid,
        "expected_hex": "#3c3c3c",
        "expected_lab": [23.0, 0.0, 0.0],
        "params": {"power": 50, "speed": 500},
    }])

    # Two results, identical swatches for cell 0 (row=0, col=0).
    # stability_de ≈ 0 → stable bucket.
    swatch = {"row": 0, "col": 0, "lab": [24.0, 0.1, -0.1]}
    for _ in range(2):
        r_repo.create(
            test_id=val_tid,
            image_path="/dev/null",
            image_sha256="a" * 64,
            swatches=[swatch],
        )

    # POST to the validate endpoint — not dry_run, no overrides.
    resp = c.post(
        f"/api/tests/{val_tid}/validate",
        json={"tolerance_de": 8.0, "dry_run": False},
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()

    # Cell 0 must be in stable and persisted.
    stable = body["stable"]
    assert len(stable) >= 1
    persisted_cell = next((e for e in stable if e["cell_index"] == 0), None)
    assert persisted_cell is not None, "cell 0 not found in stable bucket"
    assert persisted_cell["persisted"] is True
    new_eid = persisted_cell["new_entry_id"]
    assert new_eid is not None

    # The new palette entry must carry derived_from_entry_id == src_eid.
    new_entry = pal_repo.get_by_id(new_eid)
    assert new_entry is not None
    assert new_entry["derived_from_entry_id"] == src_eid
