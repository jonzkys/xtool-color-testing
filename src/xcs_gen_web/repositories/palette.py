"""Palette repository — persistence + ΔE2000 query over SQLite."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import select

from ..db import session_scope
from ..models import palette_entries
from ..palette import delta_e_2000, hex_to_lab


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_entry(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "test_id": r.test_id,
        "material_id": r.material_id,
        "x_value": r.x_value,
        "y_value": r.y_value,
        "hex": r.hex,
        "lab": [r.lab_l, r.lab_a, r.lab_b],
        "params": json.loads(r.params_json),
        "sigma": r.sigma,
        "source": r.source,
        "source_result_id": r.source_result_id,
        "notes": r.notes,
        "created_at": r.created_at,
    }


def insert_bulk(entries: Iterable[dict[str, Any]]) -> list[int]:
    now = _now()
    rows = []
    for e in entries:
        L, a, b = hex_to_lab(e["hex"])
        rows.append({
            "test_id": e["test_id"],
            "material_id": e["material_id"],
            "x_value": e.get("x_value"),
            "y_value": e.get("y_value"),
            "hex": e["hex"],
            "lab_l": L, "lab_a": a, "lab_b": b,
            "params_json": json.dumps(e.get("params", {}), separators=(",", ":")),
            "sigma": e["sigma"],
            "source": e["source"],
            "source_result_id": e.get("source_result_id"),
            "notes": e.get("notes", ""),
            "created_at": now,
        })
    if not rows:
        return []
    with session_scope() as s:
        ids: list[int] = []
        for row in rows:
            res = s.execute(palette_entries.insert().values(**row))
            ids.append(res.inserted_primary_key[0])
        return ids


def list_all(*, material_id: int | None = None) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(palette_entries)
        if material_id is not None:
            q = q.where(palette_entries.c.material_id == material_id)
        q = q.order_by(palette_entries.c.created_at.desc())
        return [_row_to_entry(r) for r in s.execute(q).all()]


def query_by_hex(hex_: str, *, limit: int = 5,
                 material_id: int | None = None) -> list[dict[str, Any]]:
    target = hex_to_lab(hex_)
    rows = list_all(material_id=material_id)
    scored = []
    for r in rows:
        de = delta_e_2000(target, tuple(r["lab"]))
        scored.append({"entry": r, "delta_e": de})
    scored.sort(key=lambda x: x["delta_e"])
    return scored[:limit]


def delete_entry(eid: int) -> bool:
    with session_scope() as s:
        res = s.execute(palette_entries.delete().where(palette_entries.c.id == eid))
        return res.rowcount > 0


def delete_by_test(test_id: int) -> int:
    with session_scope() as s:
        res = s.execute(
            palette_entries.delete().where(palette_entries.c.test_id == test_id)
        )
        return res.rowcount


def update_notes(eid: int, notes: str) -> dict[str, Any] | None:
    with session_scope() as s:
        s.execute(
            palette_entries.update()
            .where(palette_entries.c.id == eid)
            .values(notes=notes)
        )
        row = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid)
        ).one_or_none()
        return _row_to_entry(row) if row else None
