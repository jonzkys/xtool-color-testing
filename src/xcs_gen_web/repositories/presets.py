"""Presets repository — default-per-material invariant enforced here."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import presets


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "material_id": r.material_id,
        "name": r.name,
        "color": r.color,
        "is_default": bool(r.is_default),
        "base_params": json.loads(r.base_params_json),
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(
    *, material_id: int, name: str, color: str | None,
    base_params: dict[str, Any],
) -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        is_first = s.execute(
            select(presets.c.id).where(presets.c.material_id == material_id).limit(1)
        ).first() is None
        res = s.execute(presets.insert().values(
            material_id=material_id,
            name=name, color=color,
            is_default=1 if is_first else 0,
            base_params_json=json.dumps(base_params, separators=(",", ":")),
            created_at=ts, updated_at=ts,
        ))
        pid = res.inserted_primary_key[0]
    return get(pid)


def get(pid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(presets).where(presets.c.id == pid)).one_or_none()
        return _row_to_dict(row) if row else None


def list_by_material(mid: int) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(presets).where(presets.c.material_id == mid)
            .order_by(presets.c.created_at)
        ).all()
        return [_row_to_dict(r) for r in rows]


def list_all() -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(select(presets).order_by(presets.c.created_at)).all()
        return [_row_to_dict(r) for r in rows]


def update(pid: int, *, name: str | None = None, color: str | None = None,
           base_params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    values: dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        values["name"] = name
    if color is not None:
        values["color"] = color
    if base_params is not None:
        values["base_params_json"] = json.dumps(base_params, separators=(",", ":"))
    with session_scope() as s:
        s.execute(presets.update().where(presets.c.id == pid).values(**values))
    return get(pid)


def delete(pid: int) -> None:
    with session_scope() as s:
        row = s.execute(select(presets).where(presets.c.id == pid)).one_or_none()
        if row is None:
            return
        s.execute(presets.delete().where(presets.c.id == pid))
        if row.is_default:
            # Promote the oldest remaining preset in the same material.
            promote = s.execute(
                select(presets.c.id)
                .where(presets.c.material_id == row.material_id)
                .order_by(presets.c.created_at)
                .limit(1)
            ).first()
            if promote:
                s.execute(
                    presets.update().where(presets.c.id == promote.id)
                    .values(is_default=1)
                )


def set_default(pid: int) -> None:
    with session_scope() as s:
        row = s.execute(select(presets).where(presets.c.id == pid)).one_or_none()
        if row is None:
            return
        s.execute(
            presets.update()
            .where(presets.c.material_id == row.material_id)
            .values(is_default=0)
        )
        s.execute(
            presets.update().where(presets.c.id == pid).values(is_default=1)
        )
