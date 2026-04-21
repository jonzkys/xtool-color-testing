"""Materials repository (library table 1 of 2)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import materials, presets, tests


class InUseError(Exception):
    """Raised when attempting to delete a material still referenced by a preset or test."""


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id, "name": r.name, "notes": r.notes or "",
        "created_at": r.created_at,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(*, name: str, notes: str | None = None) -> dict[str, Any]:
    with session_scope() as s:
        res = s.execute(materials.insert().values(
            name=name, notes=notes, created_at=_now(),
        ))
        mid = res.inserted_primary_key[0]
    return get(mid)


def get(mid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(materials).where(materials.c.id == mid)).one_or_none()
        return _row_to_dict(row) if row else None


def list_all() -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(select(materials).order_by(materials.c.created_at)).all()
        return [_row_to_dict(r) for r in rows]


def update(mid: int, *, name: str | None = None, notes: str | None = None) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if name is not None:
        values["name"] = name
    if notes is not None:
        values["notes"] = notes
    if values:
        with session_scope() as s:
            s.execute(materials.update().where(materials.c.id == mid).values(**values))
    return get(mid)


def delete(mid: int) -> None:
    with session_scope() as s:
        in_preset = s.execute(
            select(presets.c.id).where(presets.c.material_id == mid).limit(1)
        ).first()
        in_test = s.execute(
            select(tests.c.id).where(tests.c.material_id == mid).limit(1)
        ).first()
        if in_preset or in_test:
            raise InUseError(
                f"material {mid} is referenced by existing presets or tests"
            )
        s.execute(materials.delete().where(materials.c.id == mid))
