"""Presets repository — default-per-material invariant enforced here.

Scoped by owner — only the creating user's presets for a given material
are considered when promoting a new default, listing, or enforcing
uniqueness. Cross-owner preset lookups return None.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
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
        "owner_id": r.owner_id,
        "visibility": r.visibility,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(
    *, material_id: int, name: str, color: str | None,
    base_params: dict[str, Any], owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        is_first = s.execute(
            select(presets.c.id).where(
                and_(
                    presets.c.material_id == material_id,
                    presets.c.owner_id == owner_id,
                ),
            ).limit(1)
        ).first() is None
        res = s.execute(presets.insert().values(
            material_id=material_id,
            name=name, color=color,
            is_default=1 if is_first else 0,
            base_params_json=json.dumps(base_params, separators=(",", ":")),
            created_at=ts, updated_at=ts,
            owner_id=owner_id, visibility=visibility,
        ))
        pid = res.inserted_primary_key[0]
    return get(pid, owner_id=owner_id)  # type: ignore[return-value]


def get(pid: int, *, owner_id: int = STANDALONE_USER_ID) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(presets).where(
                and_(presets.c.id == pid, presets.c.owner_id == owner_id),
            )
        ).one_or_none()
        return _row_to_dict(row) if row else None


def list_by_material(mid: int, *, owner_id: int = STANDALONE_USER_ID) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(presets)
            .where(
                and_(
                    presets.c.material_id == mid,
                    presets.c.owner_id == owner_id,
                ),
            )
            .order_by(presets.c.created_at)
        ).all()
        return [_row_to_dict(r) for r in rows]


def list_all(*, owner_id: int = STANDALONE_USER_ID) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(presets)
            .where(presets.c.owner_id == owner_id)
            .order_by(presets.c.created_at)
        ).all()
        return [_row_to_dict(r) for r in rows]


def update(
    pid: int, *, owner_id: int = STANDALONE_USER_ID,
    name: str | None = None, color: str | None = None,
    base_params: dict[str, Any] | None = None,
    visibility: str | None = None,
) -> dict[str, Any] | None:
    values: dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        values["name"] = name
    if color is not None:
        values["color"] = color
    if base_params is not None:
        values["base_params_json"] = json.dumps(base_params, separators=(",", ":"))
    if visibility is not None:
        values["visibility"] = visibility
    with session_scope() as s:
        s.execute(
            presets.update()
            .where(and_(presets.c.id == pid, presets.c.owner_id == owner_id))
            .values(**values)
        )
    return get(pid, owner_id=owner_id)


def delete(pid: int, *, owner_id: int = STANDALONE_USER_ID) -> None:
    with session_scope() as s:
        row = s.execute(
            select(presets).where(
                and_(presets.c.id == pid, presets.c.owner_id == owner_id),
            )
        ).one_or_none()
        if row is None:
            return
        s.execute(
            presets.delete().where(
                and_(presets.c.id == pid, presets.c.owner_id == owner_id),
            )
        )
        if row.is_default:
            # Promote the oldest remaining preset in the same material
            # for this owner. Other users' presets are untouched.
            promote = s.execute(
                select(presets.c.id)
                .where(
                    and_(
                        presets.c.material_id == row.material_id,
                        presets.c.owner_id == owner_id,
                    ),
                )
                .order_by(presets.c.created_at)
                .limit(1)
            ).first()
            if promote:
                s.execute(
                    presets.update().where(presets.c.id == promote.id)
                    .values(is_default=1)
                )


def set_default(pid: int, *, owner_id: int = STANDALONE_USER_ID) -> None:
    with session_scope() as s:
        row = s.execute(
            select(presets).where(
                and_(presets.c.id == pid, presets.c.owner_id == owner_id),
            )
        ).one_or_none()
        if row is None:
            return
        s.execute(
            presets.update()
            .where(
                and_(
                    presets.c.material_id == row.material_id,
                    presets.c.owner_id == owner_id,
                ),
            )
            .values(is_default=0)
        )
        s.execute(
            presets.update().where(presets.c.id == pid).values(is_default=1)
        )
