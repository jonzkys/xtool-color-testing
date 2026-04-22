"""Materials repository (library table 1 of 2).

All reads + writes are scoped by ``owner_id``. Callers must obtain the
owner id from ``deps.get_current_user`` (route layer) or pass one
explicitly (tests / internal tooling). Cross-owner access simply
returns ``None`` or a no-op — we never raise permission errors, so the
standalone and multi-user paths share identical not-found semantics.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
from ..db import session_scope
from ..models import materials, presets, tests


class InUseError(Exception):
    """Raised when attempting to delete a material still referenced by a preset or test."""


def _row_to_dict(r) -> dict[str, Any]:
    return {
        "id": r.id, "name": r.name, "notes": r.notes or "",
        "created_at": r.created_at,
        "owner_id": r.owner_id,
        "visibility": r.visibility,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create(
    *, name: str, notes: str | None = None, owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> dict[str, Any]:
    with session_scope() as s:
        res = s.execute(materials.insert().values(
            name=name, notes=notes, created_at=_now(),
            owner_id=owner_id, visibility=visibility,
        ))
        mid = res.inserted_primary_key[0]
    return get(mid, owner_id=owner_id)  # type: ignore[return-value]


def get(mid: int, *, owner_id: int = STANDALONE_USER_ID) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(materials).where(
                and_(materials.c.id == mid, materials.c.owner_id == owner_id),
            )
        ).one_or_none()
        return _row_to_dict(row) if row else None


def list_all(*, owner_id: int = STANDALONE_USER_ID) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(materials)
            .where(materials.c.owner_id == owner_id)
            .order_by(materials.c.created_at)
        ).all()
        return [_row_to_dict(r) for r in rows]


def update(
    mid: int, *, owner_id: int = STANDALONE_USER_ID,
    name: str | None = None, notes: str | None = None,
    visibility: str | None = None,
) -> dict[str, Any] | None:
    values: dict[str, Any] = {}
    if name is not None:
        values["name"] = name
    if notes is not None:
        values["notes"] = notes
    if visibility is not None:
        values["visibility"] = visibility
    if values:
        with session_scope() as s:
            s.execute(
                materials.update()
                .where(
                    and_(materials.c.id == mid, materials.c.owner_id == owner_id),
                )
                .values(**values)
            )
    return get(mid, owner_id=owner_id)


def delete(mid: int, *, owner_id: int = STANDALONE_USER_ID) -> None:
    with session_scope() as s:
        # Only check references within the same owner's scope.
        in_preset = s.execute(
            select(presets.c.id).where(
                and_(
                    presets.c.material_id == mid,
                    presets.c.owner_id == owner_id,
                ),
            ).limit(1)
        ).first()
        in_test = s.execute(
            select(tests.c.id).where(
                and_(
                    tests.c.material_id == mid,
                    tests.c.owner_id == owner_id,
                ),
            ).limit(1)
        ).first()
        if in_preset or in_test:
            raise InUseError(
                f"material {mid} is referenced by existing presets or tests"
            )
        s.execute(
            materials.delete().where(
                and_(materials.c.id == mid, materials.c.owner_id == owner_id),
            )
        )
