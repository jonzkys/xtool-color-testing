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
from typing import Any, Iterable

from sqlalchemy import delete, insert, select

from ..db import session_scope
from ..models import validation_cells


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
    """Atomic replace — wipes existing cells and inserts the new batch."""
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
        for c in cells
    ]
    with session_scope() as s:
        s.execute(
            delete(validation_cells).where(validation_cells.c.test_id == test_id),
        )
        if payload:
            s.execute(insert(validation_cells), payload)


def delete_for_test(*, test_id: int) -> None:
    with session_scope() as s:
        s.execute(
            delete(validation_cells).where(validation_cells.c.test_id == test_id),
        )
