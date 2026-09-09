"""Backfill for palette entries that recorded only the axes their cell varied.

Until the validate-batch ingest was fixed, such an entry stored just the
cell's params overlay and dropped every parameter the test held constant —
so it could not state the recipe that produced its colour.
"""
from __future__ import annotations

import json

from xcs_gen_web.db import session_scope
from xcs_gen_web.models import palette_entries
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import tests as t_repo

BASE = {"power": 12.0, "speed": 1000, "frequency": 202, "density": 3000,
        "passes": 2, "pulse_width": 80, "laser": "red"}

SPEC = {
    "x_param": "frequency", "x_min": 100, "x_max": 500, "x_steps": 2,
    "rows": 1, "width_mm": 40, "height_mm": 4, "gap_mm": 0.3,
    "cell_shape": "circle", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _seed(fresh_db, params: dict, *, spec=SPEC):
    """One palette entry carrying ``params``, attached to a test with SPEC."""
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="t", material_id=mid, spec=spec, kind="validation")["id"]
    ids = pal_repo.insert_bulk([{
        "test_id": tid, "material_id": mid, "x_value": 0, "y_value": None,
        "hex": "#b7afa1", "sigma": 0.1, "source": "averaged",
        "source_result_id": None, "params": params, "machine_id": "F2Ultra",
    }])
    return ids[0]


def _params_of(eid: int) -> dict:
    with session_scope() as s:
        row = s.execute(
            palette_entries.select().where(palette_entries.c.id == eid)
        ).one()
        return json.loads(row.params_json or "{}")


def test_dry_run_reports_but_writes_nothing(fresh_db):
    eid = _seed(fresh_db, {"frequency": 249.87, "speed": 2073.72})
    before = _params_of(eid)

    report = pal_repo.repair_partial_params(dry_run=True)

    assert report["repaired"] == 1
    assert report["unrepairable"] == 0
    assert _params_of(eid) == before, "dry run must not touch the database"


def test_apply_fills_only_the_missing_keys(fresh_db):
    eid = _seed(fresh_db, {"frequency": 249.87, "speed": 2073.72})

    pal_repo.repair_partial_params(dry_run=False)

    after = _params_of(eid)
    # The entry's own measured values win over the test defaults...
    assert after["frequency"] == 249.87
    assert after["speed"] == 2073.72
    # ...and the constants the test held are recovered.
    assert after["power"] == BASE["power"]
    assert after["density"] == BASE["density"]
    assert after["passes"] == BASE["passes"]
    assert after["pulse_width"] == BASE["pulse_width"]
    assert after["laser"] == BASE["laser"]


def test_an_already_complete_entry_is_left_alone(fresh_db):
    eid = _seed(fresh_db, dict(BASE))
    before = _params_of(eid)

    report = pal_repo.repair_partial_params(dry_run=False)

    assert report["repaired"] == 0
    assert report["already_complete"] == 1
    assert _params_of(eid) == before


def test_an_entry_whose_test_cannot_supply_every_key_is_skipped_whole(fresh_db):
    """Half-filling would be worse than not touching it: the entry would look
    complete to a consumer while carrying a value the burn never used."""
    thin_spec = {**SPEC, "base_params": {"speed": 1000, "frequency": 202}}
    eid = _seed(fresh_db, {"frequency": 249.87}, spec=thin_spec)

    report = pal_repo.repair_partial_params(dry_run=False)

    assert report["repaired"] == 0
    assert report["unrepairable"] == 1
    after = _params_of(eid)
    assert "power" not in after or after["power"] is None
    # Not even the keys it COULD have filled.
    assert after.get("speed") is None


def test_recomputes_the_derived_indices(fresh_db):
    """The stored indices were computed from the incomplete params — a missing
    density silently became a default line spacing — so they must be redone."""
    eid = _seed(fresh_db, {"frequency": 249.87, "speed": 2073.72})
    with session_scope() as s:
        before = s.execute(
            palette_entries.select().where(palette_entries.c.id == eid)
        ).one().line_spacing_mm

    pal_repo.repair_partial_params(dry_run=False)

    with session_scope() as s:
        after = s.execute(
            palette_entries.select().where(palette_entries.c.id == eid)
        ).one().line_spacing_mm
    assert after != before, "indices still reflect the incomplete params"
    # density 3000 lines/cm -> 1/3000 cm -> 0.00333 mm
    assert abs(after - (10.0 / BASE["density"])) < 1e-9
