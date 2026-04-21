"""Tests (param-tests) repository."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..db import session_scope
from ..models import tests


class LockedError(Exception):
    """spec_json edits attempted on a locked test."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "material_id": r.material_id,
        "status": r.status,
        "spec": json.loads(r.spec_json),
        "notes": r.notes,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "locked": bool(r.locked),
    }


def create(*, name: str, material_id: int, spec: dict[str, Any],
           notes: str = "") -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        res = s.execute(tests.insert().values(
            name=name, material_id=material_id,
            status="created",
            spec_json=json.dumps(spec, separators=(",", ":")),
            notes=notes, created_at=ts, updated_at=ts, locked=0,
        ))
        tid = res.inserted_primary_key[0]
    return get(tid)


def get(tid: int) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(select(tests).where(tests.c.id == tid)).one_or_none()
        return _row(row) if row else None


def list_all(*, material_id: int | None = None,
             status: str | None = None) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(tests)
        if material_id is not None:
            q = q.where(tests.c.material_id == material_id)
        if status is not None:
            q = q.where(tests.c.status == status)
        else:
            q = q.where(tests.c.status != "deleted")
        q = q.order_by(tests.c.id.desc())
        return [_row(r) for r in s.execute(q).all()]


def update(tid: int, *, name: str | None = None, notes: str | None = None,
           spec: dict[str, Any] | None = None) -> dict[str, Any] | None:
    cur = get(tid)
    if cur is None:
        return None
    values: dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        values["name"] = name
    if notes is not None:
        values["notes"] = notes
    if spec is not None:
        if cur["locked"]:
            raise LockedError(f"test {tid} is locked; duplicate it to change spec")
        values["spec_json"] = json.dumps(spec, separators=(",", ":"))
    with session_scope() as s:
        s.execute(tests.update().where(tests.c.id == tid).values(**values))
    return get(tid)


def mark_tested_and_lock(tid: int) -> None:
    """Idempotent: called every time a result is written for `tid`."""
    with session_scope() as s:
        s.execute(
            tests.update().where(tests.c.id == tid)
            .values(status="tested", locked=1, updated_at=_now())
        )


def soft_delete(tid: int) -> None:
    with session_scope() as s:
        s.execute(
            tests.update().where(tests.c.id == tid)
            .values(status="deleted", updated_at=_now())
        )
