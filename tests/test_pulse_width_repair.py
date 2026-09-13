"""Repair for rows written while pulse-width sweep axes were read as a ramp.

Until the capture sampler learned about the F2 Ultra's pulse-width presets,
a sweep from 13 to 500 ns over 12 rows stored its rows as 13, 57, 102, …
(a linear ramp) although the burn used 13, 20, 30, …. Ingest copied those
numbers into palette recipes. The swatches and sweep-derived entries are
provably recoverable from the test spec; anything that was *burned* with a
ramp value (a validation test built from such an entry) is only reported.
"""
from __future__ import annotations

import json

from xcs_gen_web.db import session_scope
from xcs_gen_web.models import palette_entries, results, validation_cells
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import results as r_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.repositories import validation_cells as vc_repo
from xcs_gen_web.repositories.palette import _compute_index_values
from xcs_gen_web.services.pulse_width_repair import repair_pulse_width_values

BASE = {"power": 10.0, "speed": 800, "frequency": 125, "density": 5000,
        "passes": 4, "pulse_width": 250, "laser": "red"}

# speed × pulse_width, 2 columns × 12 rows.
SPEC = {
    "x_param": "speed", "x_min": 200, "x_max": 2000, "x_steps": 2,
    "y_param": "pulse_width", "y_min": 13, "y_max": 500, "y_steps": 12,
    "rows": 1, "width_mm": 20, "height_mm": 60, "gap_mm": 0.1,
    "cell_shape": "circle", "square_cells": False, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}
RAMP = [13, 57, 102, 146, 190, 234, 279, 323, 367, 411, 456, 500]
BURNED = [13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500]


def _sweep(spec=SPEC) -> tuple[int, int]:
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="sweep", material_id=mid, spec=spec)["id"]
    return mid, tid


def _result(tid: int, ys: list[float], sha: str = "a") -> int:
    swatches = [
        {"row": r, "col": c, "x_value": [200.0, 2000.0][c], "y_value": float(y),
         "hex": "#808080", "lab": [50, 0, 0], "sigma": 1.0}
        for r, y in enumerate(ys) for c in range(2)
    ]
    return r_repo.create(
        test_id=tid, image_path="x.png", image_sha256=sha, swatches=swatches,
    )["id"]


def _picked_entry(mid: int, tid: int, pw: float) -> int:
    """An entry saved by picking one swatch (ingest-to-palette)."""
    return pal_repo.insert_bulk([{
        "test_id": tid, "material_id": mid, "x_value": 200.0, "y_value": pw,
        "hex": "#b7afa1", "sigma": 0.1, "source": "averaged",
        "source_result_id": None, "machine_id": "F2Ultra",
        "params": {**BASE, "speed": 200.0, "pulse_width": pw},
    }])[0]


def _ingested_entry(mid: int, tid: int, pw: float, cell_index: int) -> int:
    """An entry saved by the batch ingest, which records the cell it came from."""
    return pal_repo.create_validated_entry(
        machine_id="F2Ultra", material_id=mid, burn_mean_lab=(40.0, 5.0, 5.0),
        validated_test_id=tid, validated_cell_index=cell_index,
        run_count=2, stability_de=1.0,
        params={**BASE, "speed": 2000.0, "pulse_width": pw},
    )["id"]


def _swatch_ys(rid: int) -> list[float]:
    with session_scope() as s:
        row = s.execute(results.select().where(results.c.id == rid)).one()
    sw = json.loads(row.swatches_json)
    return [s["y_value"] for s in sorted(sw, key=lambda s: (s["row"], s["col"])) if s["col"] == 0]


def _entry(eid: int):
    with session_scope() as s:
        return s.execute(
            palette_entries.select().where(palette_entries.c.id == eid)
        ).one()


def test_dry_run_reports_but_writes_nothing(fresh_db):
    mid, tid = _sweep()
    rid = _result(tid, RAMP)
    eid = _picked_entry(mid, tid, 57.0)
    before_entry = _entry(eid)

    report = repair_pulse_width_values(dry_run=True)

    assert report["results"]["repaired"] == 1
    assert report["entries"]["repaired"] == 1
    assert _swatch_ys(rid) == RAMP
    assert _entry(eid) == before_entry


def test_result_swatches_take_the_burned_value_of_their_row(fresh_db):
    _, tid = _sweep()
    rid = _result(tid, RAMP)

    repair_pulse_width_values(dry_run=False)

    assert _swatch_ys(rid) == BURNED


def test_a_picked_entry_gets_the_burned_pulse_width_and_fresh_indices(fresh_db):
    mid, tid = _sweep()
    eid = _picked_entry(mid, tid, 57.0)

    repair_pulse_width_values(dry_run=False)

    row = _entry(eid)
    params = json.loads(row.params_json)
    assert params["pulse_width"] == 20
    assert row.y_value == 20
    # Pulse width feeds the exposure indices, so they are recomputed too.
    assert row.duty_cycle_index == _compute_index_values(params)["duty_cycle_index"]


def test_an_ingested_entry_is_placed_by_its_cell_index(fresh_db):
    """The batch ingest records the cell, which settles a value the ramp
    alone can't: on 2–60 ns over 9 rows, 9 is ramp row 1 AND preset row 3."""
    spec = {**SPEC, "y_min": 2, "y_max": 60, "y_steps": 9}
    mid, tid = _sweep(spec)
    # 2 columns: cell 3 is row 1 (burned at 4 ns); cell 6 is row 3 (9 ns).
    stale = _ingested_entry(mid, tid, 9.0, cell_index=3)
    fine = _ingested_entry(mid, tid, 9.0, cell_index=6)

    report = repair_pulse_width_values(dry_run=False)

    assert json.loads(_entry(stale).params_json)["pulse_width"] == 4
    assert json.loads(_entry(fine).params_json)["pulse_width"] == 9.0
    assert report["entries"]["unrepairable"] == 0


def test_a_second_apply_changes_nothing(fresh_db):
    mid, tid = _sweep()
    _result(tid, RAMP)
    _picked_entry(mid, tid, 57.0)
    _ingested_entry(mid, tid, 190.0, cell_index=9)
    repair_pulse_width_values(dry_run=False)

    report = repair_pulse_width_values(dry_run=False)

    assert report["results"]["repaired"] == 0
    assert report["entries"]["repaired"] == 0
    assert report["results"]["already_correct"] == 1
    assert report["entries"]["already_correct"] == 2


def test_a_value_that_is_both_a_ramp_step_and_a_preset_is_left_alone(fresh_db):
    """2–60 ns over 9 rows ramps 2, 9, 16, 24 … and burns 2, 4, 6, 9 …: a
    picked entry reading 9 could be row 1 (really 4 ns) or already-correct
    row 3. Without a cell index there is no way to tell, so don't guess."""
    spec = {**SPEC, "y_min": 2, "y_max": 60, "y_steps": 9}
    mid, tid = _sweep(spec)
    ambiguous = _picked_entry(mid, tid, 9.0)
    clear = _picked_entry(mid, tid, 24.0)

    report = repair_pulse_width_values(dry_run=False)

    assert json.loads(_entry(ambiguous).params_json)["pulse_width"] == 9.0
    assert json.loads(_entry(clear).params_json)["pulse_width"] == 9
    assert report["entries"]["unrepairable"] == 1


def test_a_sweep_asking_for_more_steps_than_presets_is_not_rewritten(fresh_db):
    """2–60 ns holds 9 presets; a spec storing 16 steps burned 9 rows but was
    sampled as 16, so its colours came from the wrong places — relabelling
    them would make bad data look good."""
    spec = {**SPEC, "y_min": 2, "y_max": 60, "y_steps": 16}
    mid, tid = _sweep(spec)
    ramp16 = [round(2 + i * 58 / 15) for i in range(16)]
    rid = _result(tid, ramp16)
    eid = _picked_entry(mid, tid, float(ramp16[3]))

    report = repair_pulse_width_values(dry_run=False)

    assert _swatch_ys(rid) == ramp16
    assert json.loads(_entry(eid).params_json)["pulse_width"] == ramp16[3]
    assert report["results"]["unrepairable"] == 1
    assert report["entries"]["unrepairable"] == 1


def test_a_result_that_no_longer_matches_its_spec_is_skipped(fresh_db):
    """If a swatch holds neither the ramp nor the burned value for its row,
    the spec changed after capture — rewriting would be a guess."""
    _, tid = _sweep()
    edited = list(RAMP)
    edited[5] = 999
    rid = _result(tid, edited)

    report = repair_pulse_width_values(dry_run=False)

    assert _swatch_ys(rid) == edited
    assert report["results"]["unrepairable"] == 1


def test_validation_rows_burned_with_a_ramp_value_are_reported_not_rewritten(fresh_db):
    mid, sweep_tid = _sweep()
    source = _picked_entry(mid, sweep_tid, 57.0)
    val_tid = t_repo.create(
        name="validate", material_id=mid, spec=SPEC, kind="validation",
    )["id"]
    vc_repo.replace_for_test(test_id=val_tid, cells=[{
        "cell_index": 0, "palette_entry_id": source,
        "expected_hex": "#b7afa1", "expected_lab": [70, 1, 6],
        "params": {**BASE, "speed": 200.0, "pulse_width": 57.0},
    }])
    validated = _ingested_entry(mid, val_tid, 57.0, cell_index=0)

    report = repair_pulse_width_values(dry_run=False)

    with session_scope() as s:
        cell = s.execute(
            validation_cells.select().where(validation_cells.c.test_id == val_tid)
        ).one()
    assert json.loads(cell.params_json)["pulse_width"] == 57.0
    assert json.loads(_entry(validated).params_json)["pulse_width"] == 57.0
    assert report["flagged"]["validation_tests"] == [
        {"test_id": val_tid, "cells": 1, "pulse_widths": [57.0]},
    ]
    assert [e["id"] for e in report["flagged"]["entries"]] == [validated]
    # The sweep-derived source entry itself is still repaired.
    assert json.loads(_entry(source).params_json)["pulse_width"] == 20


def test_cli_reports_without_writing_until_apply(fresh_db, capsys):
    from xcs_gen.cli import main

    mid, tid = _sweep()
    rid = _result(tid, RAMP)
    eid = _picked_entry(mid, tid, 57.0)

    main(["repair-pulse-width-values", "--verbose"])
    out = capsys.readouterr().out
    assert "Dry run" in out
    assert f"#{eid}" in out and "57.0 → 20" in out
    assert _swatch_ys(rid) == RAMP

    main(["repair-pulse-width-values", "--apply"])
    assert "Wrote 1 results and 1 palette entries." in capsys.readouterr().out
    assert _swatch_ys(rid) == BURNED


def test_cli_lists_what_it_only_reports(fresh_db, capsys):
    from xcs_gen.cli import main

    mid, _ = _sweep()
    val_tid = t_repo.create(
        name="validate", material_id=mid, spec=SPEC, kind="validation",
    )["id"]
    vc_repo.replace_for_test(test_id=val_tid, cells=[{
        "cell_index": 0, "palette_entry_id": None,
        "expected_hex": "#b7afa1", "expected_lab": [70, 1, 6],
        "params": {**BASE, "pulse_width": 53},
    }])

    main(["repair-pulse-width-values"])

    out = capsys.readouterr().out
    assert f"validation test #{val_tid}: 1 cell burned with 53" in out
