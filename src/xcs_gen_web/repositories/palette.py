"""Palette repository — persistence + ΔE2000 query over SQLite.

Scoped per owner. query_by_hex only searches within the caller's own
palette. Public entries from other owners aren't considered yet —
future work will widen the filter to ``owner == self OR visibility ==
'public'``.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import and_, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
from ..db import session_scope
from ..models import palette_entries
from ..palette import delta_e_2000, hex_to_lab


class NotMutableError(Exception):
    """Raised when callers try to mutate hex/material_id/params on a non-manual row."""


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
        "owner_id": r.owner_id,
        "visibility": r.visibility,
        "favorited": bool(r.favorited),
    }


def _build_row(
    e: dict[str, Any], now: str, owner_id: int, visibility: str,
) -> dict[str, Any]:
    """Build a DB row dict from an entry dict. Used by insert_bulk and replace_for_test."""
    L, a, b = hex_to_lab(e["hex"])
    return {
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
        "owner_id": owner_id,
        "visibility": e.get("visibility", visibility),
    }


def insert_bulk(
    entries: Iterable[dict[str, Any]], *, owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    if not rows:
        return []
    with session_scope() as s:
        ids: list[int] = []
        for row in rows:
            res = s.execute(palette_entries.insert().values(**row))
            ids.append(res.inserted_primary_key[0])
        return ids


def replace_for_test(
    test_id: int, entries: Iterable[dict[str, Any]],
    *, owner_id: int = STANDALONE_USER_ID, visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    """Delete all palette entries for test_id (owner-scoped) then insert new ones atomically."""
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    with session_scope() as s:
        s.execute(
            palette_entries.delete().where(
                and_(
                    palette_entries.c.test_id == test_id,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        )
        ids: list[int] = []
        for row in rows:
            res = s.execute(palette_entries.insert().values(**row))
            ids.append(res.inserted_primary_key[0])
        return ids


def list_all(
    *, owner_id: int = STANDALONE_USER_ID,
    material_id: int | None = None,
    favorites_only: bool = False,
    source: str | None = None,
) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(palette_entries).where(
            palette_entries.c.owner_id == owner_id,
        )
        if material_id is not None:
            q = q.where(palette_entries.c.material_id == material_id)
        if favorites_only:
            q = q.where(palette_entries.c.favorited == True)  # noqa: E712
        if source is not None:
            q = q.where(palette_entries.c.source == source)
        q = q.order_by(palette_entries.c.created_at.desc())
        return [_row_to_entry(r) for r in s.execute(q).all()]


def query_by_hex(
    hex_: str, *, owner_id: int = STANDALONE_USER_ID, limit: int = 5,
    material_id: int | None = None,
) -> list[dict[str, Any]]:
    target = hex_to_lab(hex_)
    rows = list_all(owner_id=owner_id, material_id=material_id)
    scored = []
    for r in rows:
        de = delta_e_2000(target, tuple(r["lab"]))
        scored.append({"entry": r, "delta_e": de})
    scored.sort(key=lambda x: x["delta_e"])
    return scored[:limit]


def delete_entry(eid: int, *, owner_id: int = STANDALONE_USER_ID) -> bool:
    with session_scope() as s:
        res = s.execute(
            palette_entries.delete().where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        )
        return res.rowcount > 0


def delete_by_test(test_id: int, *, owner_id: int = STANDALONE_USER_ID) -> int:
    with session_scope() as s:
        res = s.execute(
            palette_entries.delete().where(
                and_(
                    palette_entries.c.test_id == test_id,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        )
        return res.rowcount


def update_entry(
    eid: int,
    *,
    hex_: str | None = None,
    material_id: int | None = None,
    params: dict[str, Any] | None = None,
    notes: str | None = None,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(palette_entries).where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        ).one_or_none()
        if row is None:
            return None
        is_manual = row.source == "manual"
        wants_recipe_change = (
            hex_ is not None or material_id is not None or params is not None
        )
        if wants_recipe_change and not is_manual:
            raise NotMutableError(
                "cannot mutate hex/material_id/params on ingested swatch",
            )
        values: dict[str, Any] = {}
        if hex_ is not None:
            L, a, b = hex_to_lab(hex_)
            values["hex"] = hex_
            values["lab_l"] = L
            values["lab_a"] = a
            values["lab_b"] = b
        if material_id is not None:
            values["material_id"] = material_id
        if params is not None:
            values["params_json"] = json.dumps(params, separators=(",", ":"))
        if notes is not None:
            values["notes"] = notes
        if values:
            s.execute(
                palette_entries.update()
                .where(
                    and_(
                        palette_entries.c.id == eid,
                        palette_entries.c.owner_id == owner_id,
                    ),
                )
                .values(**values)
            )
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
        return _row_to_entry(out)


def set_favorited(
    eid: int, value: bool, *, owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    with session_scope() as s:
        res = s.execute(
            palette_entries.update()
            .where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
            .values(favorited=value)
        )
        if res.rowcount == 0:
            return None
        row = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
        return _row_to_entry(row)


def create_manual(
    *,
    material_id: int,
    hex_: str,
    params: dict[str, Any],
    notes: str,
    owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> dict[str, Any]:
    now = _now()
    base = _build_row(
        {
            "test_id": None,
            "material_id": material_id,
            "x_value": None,
            "y_value": None,
            "hex": hex_,
            "params": params,
            "sigma": 0.0,
            "source": "manual",
            "source_result_id": None,
            "notes": notes,
        },
        now, owner_id, visibility,
    )
    row = {**base, "favorited": False}
    with session_scope() as s:
        res = s.execute(palette_entries.insert().values(**row))
        new_id = res.inserted_primary_key[0]
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == new_id),
        ).one()
    return _row_to_entry(out)
