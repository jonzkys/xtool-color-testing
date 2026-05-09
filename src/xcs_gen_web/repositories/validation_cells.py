"""Repository for validation_cells — frozen per-cell snapshots used by
kind=validation tests.

Read shape (returned by ``list_for_test``):
    [{
        "id": int,
        "test_id": int,
        "cell_index": int,
        "palette_entry_id": int | None,
        "expected_hex": str,
        "expected_lab": [L*, a*, b*],
        "params": {param_name: value, ...},
    }, ...]

Write shape (accepted by ``replace_for_test``):
    [{
        "cell_index": int,
        "palette_entry_id": int | None,
        "expected_hex": str,
        "expected_lab": [L*, a*, b*],
        "params": {param_name: value, ...},
    }, ...]
"""
from __future__ import annotations

import json
from collections import Counter
from typing import Any, Iterable

from sqlalchemy import delete, insert, select

from ..db import session_scope
from ..models import palette_entries, tests as tests_table, validation_cells


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "test_id": r.test_id,
        "cell_index": r.cell_index,
        "palette_entry_id": r.palette_entry_id,
        "expected_hex": r.expected_hex,
        "expected_lab": [r.expected_lab_l, r.expected_lab_a, r.expected_lab_b],
        "params": json.loads(r.params_json),
    }


def list_for_test(*, test_id: int) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(validation_cells)
            .where(validation_cells.c.test_id == test_id)
            .order_by(validation_cells.c.cell_index.asc()),
        ).all()
    return [_row_to_dict(r) for r in rows]


def replace_for_test(*, test_id: int, cells: Iterable[dict[str, Any]]) -> None:
    """Atomic replace — wipes existing cells and inserts the new batch.

    Also recomputes tests.source_test_id from the modal
    palette_entries.test_id of the new cells, so a validation test
    auto-records which test produced the palette it's validating.
    """
    cell_list = list(cells)
    payload = [
        {
            "test_id": test_id,
            "cell_index": int(c["cell_index"]),
            "palette_entry_id": c.get("palette_entry_id"),
            "expected_hex": c["expected_hex"],
            "expected_lab_l": float(c["expected_lab"][0]),
            "expected_lab_a": float(c["expected_lab"][1]),
            "expected_lab_b": float(c["expected_lab"][2]),
            "params_json": json.dumps(c.get("params", {}), separators=(",", ":")),
        }
        for c in cell_list
    ]
    with session_scope() as s:
        s.execute(
            delete(validation_cells).where(validation_cells.c.test_id == test_id),
        )
        if payload:
            s.execute(insert(validation_cells), payload)

        # Recompute tests.source_test_id from the modal palette_entries
        # .test_id of the new cells. NULL if no resolvable source.
        entry_ids = [
            c.get("palette_entry_id") for c in cell_list
            if c.get("palette_entry_id") is not None
        ]
        source_test_id: int | None = None
        if entry_ids:
            rows = s.execute(
                select(palette_entries.c.test_id)
                .where(palette_entries.c.id.in_(entry_ids))
            ).all()
            counts = Counter(int(r.test_id) for r in rows if r.test_id is not None)
            if counts:
                source_test_id = counts.most_common(1)[0][0]
        s.execute(
            tests_table.update()
            .where(tests_table.c.id == test_id)
            .values(source_test_id=source_test_id)
        )


def delete_for_test(*, test_id: int) -> None:
    with session_scope() as s:
        s.execute(
            delete(validation_cells).where(validation_cells.c.test_id == test_id),
        )
