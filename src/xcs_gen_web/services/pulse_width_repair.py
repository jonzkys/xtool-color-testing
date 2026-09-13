"""Repair rows written while pulse-width sweep axes were read as a ramp.

The F2 Ultra only burns preset pulse widths, and a ``pulse_width`` sweep
axis steps through the presets inside ``[min, max]``. Until the capture
sampler learned that, it labelled the rows with a linear ramp instead —
13–500 ns over 12 rows was stored as 13, 57, 102, … while the burn used
13, 20, 30, … — and ingest copied those numbers into palette recipes.

What is repaired, because the right value is provable from the test spec:

* ``results.swatches_json`` — each swatch's axis value is a function of
  its (row, col);
* palette entries saved from such a sweep — placed by their cell index
  when the batch ingest recorded one, otherwise by inverting the ramp.

What is only reported, because a ramp value was actually *burned* and
nothing here knows what the machine made of it:

* validation tests whose cell recipes carry a non-preset pulse width
  (built from an affected entry), and entries validated from them;
* saved spectrums on a pulse-width axis (their fit is over ramp values).

Conservative on purpose: a value that is both a ramp step and a preset
(2–60 ns over 9 rows ramps 2, 9, 16 … and burns 2, 4, 6, 9 …) is left
alone without a cell index; a sweep whose stored step count exceeds its
presets was *sampled* on the wrong grid, so its colours are not relabelled;
a result that matches neither ramp nor presets is skipped whole. With
``dry_run`` (the default) nothing is written.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from xcs_gen.pulse_width import ALLOWED_PULSE_WIDTHS

from ..capture_sampling import _linspace, _round_param, sweep_axis_values
from ..db import session_scope
from ..models import palette_entries, results, saved_spectrums, tests, validation_cells
from ..repositories.palette import _compute_index_values
from .ingest import _resolve_cells_per_row

_PW = "pulse_width"

CORRECT, REPAIR, AMBIGUOUS, MISMATCH, OVER_CAPPED = (
    "correct", "repair", "ambiguous", "mismatch", "over_capped",
)


@dataclass
class _Axis:
    """A sweep test's pulse-width axis: what was stored vs what was burned."""

    spec: dict[str, Any]
    name: str                # "x" or "y"
    ramp: list[float]        # the values the pre-fix sampler stored
    burned: list[float]      # the values the generator burned

    @property
    def over_capped(self) -> bool:
        return len(self.burned) < len(self.ramp)

    def index_of_cell(self, row: int, col: int) -> int:
        """Axis index of the swatch at (row, col), in the pre-fix layout."""
        if self.name == "y":
            return row
        if self.spec.get("y_param") is not None:
            return col
        rows = max(1, int(self.spec.get("rows") or 1))
        per_row = math.ceil(len(self.ramp) / rows)
        return row * per_row + col

    def at(self, idx: int, value: float) -> tuple[str, float | None]:
        """Classify a stored value whose axis index is known."""
        if 0 <= idx < len(self.burned) and value == self.burned[idx]:
            return CORRECT, None
        if 0 <= idx < len(self.ramp) and value == self.ramp[idx]:
            if self.over_capped:
                return OVER_CAPPED, None
            return REPAIR, self.burned[idx]
        return MISMATCH, None

    def anywhere(self, value: float) -> tuple[str, float | None]:
        """Classify a stored value without knowing its cell."""
        in_ramp = [i for i, v in enumerate(self.ramp) if v == value]
        in_burned = [i for i, v in enumerate(self.burned) if v == value]
        if in_burned and (not in_ramp or in_ramp == in_burned):
            return CORRECT, None
        if in_ramp and in_burned or len(in_ramp) > 1:
            return AMBIGUOUS, None
        if in_ramp:
            return self.at(in_ramp[0], value)
        return MISMATCH, None


def _pulse_width_axis(spec: dict[str, Any]) -> _Axis | None:
    for name in ("x", "y"):
        steps = spec.get(f"{name}_steps")
        if spec.get(f"{name}_param") != _PW or not steps:
            continue
        lo, hi = float(spec[f"{name}_min"]), float(spec[f"{name}_max"])
        return _Axis(
            spec=spec, name=name,
            ramp=[_round_param(_PW, v) for v in _linspace(lo, hi, int(steps))],
            burned=sweep_axis_values(_PW, lo, hi, int(steps)),
        )
    return None


def _is_preset(value: Any) -> bool:
    try:
        return float(value) in ALLOWED_PULSE_WIDTHS
    except (TypeError, ValueError):
        return False


def repair_pulse_width_values(*, dry_run: bool = True) -> dict[str, Any]:
    """Rewrite ramp-valued pulse widths on pulse-width sweeps; report the rest.

    Scans every owner — the damage follows the test, not the account.
    """
    report: dict[str, Any] = {
        "dry_run": dry_run,
        "sweep_tests": 0,
        "results": {"scanned": 0, "already_correct": 0, "repaired": 0, "unrepairable": 0},
        "entries": {"scanned": 0, "already_correct": 0, "repaired": 0, "unrepairable": 0},
        "changes": [],
        "flagged": {"validation_tests": [], "entries": [], "saved_spectrums": []},
    }

    with session_scope() as s:
        axes: dict[int, _Axis] = {}
        for t in s.execute(select(tests.c.id, tests.c.kind, tests.c.spec_json)).all():
            if t.kind != "sweep":
                continue
            axis = _pulse_width_axis(json.loads(t.spec_json or "{}"))
            if axis is not None:
                axes[t.id] = axis
        report["sweep_tests"] = len(axes)

        # ── Result swatches ────────────────────────────────────────────
        for r in s.execute(
            select(results.c.id, results.c.test_id, results.c.swatches_json)
            .where(results.c.test_id.in_(list(axes)))
        ).all():
            axis = axes[r.test_id]
            key = f"{axis.name}_value"
            swatches = json.loads(r.swatches_json or "[]")
            report["results"]["scanned"] += 1
            outcomes = []
            for sw in swatches:
                idx = axis.index_of_cell(int(sw["row"]), int(sw["col"]))
                outcomes.append((sw, *axis.at(idx, sw.get(key))))
            statuses = {status for _, status, _ in outcomes}
            if statuses == {CORRECT}:
                report["results"]["already_correct"] += 1
                continue
            if statuses - {CORRECT, REPAIR}:
                report["results"]["unrepairable"] += 1
                report["changes"].append({
                    "kind": "result", "id": r.id, "test_id": r.test_id,
                    "status": "unrepairable",
                    "reason": sorted(statuses - {CORRECT, REPAIR})[0],
                })
                continue
            for sw, status, new in outcomes:
                if status == REPAIR:
                    sw[key] = new
            report["results"]["repaired"] += 1
            report["changes"].append({
                "kind": "result", "id": r.id, "test_id": r.test_id,
                "status": "repaired",
                "swatches": sum(1 for _, st, _ in outcomes if st == REPAIR),
            })
            if not dry_run:
                s.execute(
                    results.update().where(results.c.id == r.id)
                    .values(swatches_json=json.dumps(swatches, separators=(",", ":")))
                )

        # ── Palette entries ────────────────────────────────────────────
        for e in s.execute(select(palette_entries)).all():
            params = json.loads(e.params_json or "{}")
            source_tid = e.validated_test_id or e.test_id
            axis = axes.get(source_tid)
            if axis is None:
                if params.get(_PW) is not None and not _is_preset(params[_PW]):
                    report["flagged"]["entries"].append({
                        "id": e.id, "hex": e.hex, "test_id": source_tid,
                        "pulse_width": params[_PW],
                    })
                continue

            report["entries"]["scanned"] += 1
            old = params.get(_PW)
            if old is None:
                status, new = MISMATCH, None
            elif e.validated_test_id == source_tid and e.validated_cell_index is not None:
                cpr = _resolve_cells_per_row(axis.spec)
                ci = int(e.validated_cell_index)
                status, new = axis.at(axis.index_of_cell(ci // cpr, ci % cpr), old)
            else:
                status, new = axis.anywhere(old)

            if status == CORRECT:
                report["entries"]["already_correct"] += 1
                continue
            if status != REPAIR:
                report["entries"]["unrepairable"] += 1
                report["changes"].append({
                    "kind": "entry", "id": e.id, "hex": e.hex, "test_id": source_tid,
                    "status": "unrepairable", "reason": status, "pulse_width": old,
                })
                continue

            report["entries"]["repaired"] += 1
            report["changes"].append({
                "kind": "entry", "id": e.id, "hex": e.hex, "test_id": source_tid,
                "status": "repaired", "pulse_width": [old, int(new)],
            })
            if dry_run:
                continue
            params[_PW] = int(new)
            column = f"{axis.name}_value"
            values: dict[str, Any] = {
                "params_json": json.dumps(params, separators=(",", ":")),
                **_compute_index_values(params),
            }
            if getattr(e, column) is not None and getattr(e, column) == old:
                values[column] = float(new)
            s.execute(
                palette_entries.update().where(palette_entries.c.id == e.id).values(**values)
            )

        # ── Report-only: burned with a non-preset value ───────────────
        by_test: dict[int, list[Any]] = {}
        for c in s.execute(
            select(validation_cells.c.test_id, validation_cells.c.params_json)
            .order_by(validation_cells.c.test_id, validation_cells.c.cell_index)
        ).all():
            pw = json.loads(c.params_json or "{}").get(_PW)
            if pw is not None and not _is_preset(pw):
                by_test.setdefault(c.test_id, []).append(pw)
        report["flagged"]["validation_tests"] = [
            {"test_id": tid, "cells": len(pws), "pulse_widths": sorted(set(pws))}
            for tid, pws in by_test.items()
        ]
        report["flagged"]["saved_spectrums"] = [
            {"id": sp.id, "name": sp.name, "source_test_id": sp.source_test_id}
            for sp in s.execute(
                select(saved_spectrums.c.id, saved_spectrums.c.name,
                       saved_spectrums.c.source_test_id)
                .where(saved_spectrums.c.axis_param == _PW)
            ).all()
        ]

    return report
