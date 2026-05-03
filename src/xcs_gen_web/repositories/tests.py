"""Tests (param-tests) repository — scoped per owner.

Other-owner rows are invisible to a given caller: get returns None,
list filters them out, update/delete against them are no-ops (id
mismatch).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
from ..db import session_scope
from ..models import palette_entries, tests


class LockedError(Exception):
    """spec_json edits attempted on a locked test."""


class MachineImmutableError(Exception):
    """machine_id changes attempted post-creation."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(r, *, ingested: bool = False) -> dict[str, Any]:
    kind = getattr(r, "kind", "sweep") or "sweep"
    if kind == "validation":
        # Local import to avoid a repository-level import cycle.
        from . import validation_cells as _vc_repo
        cells = _vc_repo.list_for_test(test_id=r.id)
    else:
        cells = []
    return {
        "id": r.id,
        "name": r.name,
        "material_id": r.material_id,
        "status": r.status,
        "kind": kind,
        "spec": json.loads(r.spec_json),
        "notes": r.notes,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "locked": bool(r.locked),
        "owner_id": r.owner_id,
        "visibility": r.visibility,
        # Pre-0006 rows don't have the column; getattr fallback keeps
        # tests that use older DB snapshots working. New reads always
        # carry an int.
        "retest_index": int(getattr(r, "retest_index", 0) or 0),
        "machine_id": getattr(r, "machine_id", "F2Ultra"),
        # Derived: does this test have at least one swatch in the
        # palette? Set per-call from the palette_entries table — see
        # ``_ingested_test_ids``. Defaults to False for safety on
        # paths that don't compute it.
        "ingested": ingested,
        # Frozen per-cell snapshots for kind=validation tests.
        # Always present; empty for sweep tests.
        "validation_cells": cells,
    }


def _ingested_test_ids(s, *, owner_id: int) -> set[int]:
    """Return the set of test_ids that have at least one palette
    entry for ``owner_id``. Single query — used by ``list_all`` to
    decorate every row in O(1)."""
    rows = s.execute(
        select(palette_entries.c.test_id)
        .where(
            and_(
                palette_entries.c.owner_id == owner_id,
                palette_entries.c.test_id.is_not(None),
            ),
        )
        .distinct()
    ).all()
    return {int(r.test_id) for r in rows}


def create(
    *, name: str, material_id: int, spec: dict[str, Any],
    notes: str = "", owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
    machine_id: str = "F2Ultra",
    kind: str = "sweep",
) -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        res = s.execute(tests.insert().values(
            name=name, material_id=material_id,
            machine_id=machine_id,
            status="created",
            kind=kind,
            spec_json=json.dumps(spec, separators=(",", ":")),
            notes=notes, created_at=ts, updated_at=ts, locked=0,
            owner_id=owner_id, visibility=visibility,
        ))
        tid = res.inserted_primary_key[0]
    return get(tid, owner_id=owner_id)  # type: ignore[return-value]


def get(tid: int, *, owner_id: int = STANDALONE_USER_ID) -> dict[str, Any] | None:
    with session_scope() as s:
        row = s.execute(
            select(tests).where(
                and_(tests.c.id == tid, tests.c.owner_id == owner_id),
            )
        ).one_or_none()
        if row is None:
            return None
        ingested = s.execute(
            select(palette_entries.c.id)
            .where(
                and_(
                    palette_entries.c.test_id == tid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
            .limit(1)
        ).first() is not None
        return _row(row, ingested=ingested)


def list_all(
    *, owner_id: int = STANDALONE_USER_ID,
    material_id: int | None = None,
    status: str | None = None,
    machine_id: str | None = None,
) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(tests).where(tests.c.owner_id == owner_id)
        if material_id is not None:
            q = q.where(tests.c.material_id == material_id)
        if machine_id is not None:
            q = q.where(tests.c.machine_id == machine_id)
        if status is not None:
            q = q.where(tests.c.status == status)
        else:
            q = q.where(tests.c.status != "deleted")
        q = q.order_by(tests.c.id.desc())
        rows = s.execute(q).all()
        ingested = _ingested_test_ids(s, owner_id=owner_id)
        return [_row(r, ingested=int(r.id) in ingested) for r in rows]


def update(
    tid: int, *, owner_id: int = STANDALONE_USER_ID,
    name: str | None = None, notes: str | None = None,
    spec: dict[str, Any] | None = None,
    material_id: int | None = None,
    visibility: str | None = None,
    machine_id: str | None = None,
) -> dict[str, Any] | None:
    cur = get(tid, owner_id=owner_id)
    if cur is None:
        return None
    if machine_id is not None and machine_id != cur["machine_id"]:
        raise MachineImmutableError(
            f"test {tid}: machine_id is immutable "
            f"(current {cur['machine_id']!r}, requested {machine_id!r})",
        )
    values: dict[str, Any] = {"updated_at": _now()}
    if name is not None:
        values["name"] = name
    if notes is not None:
        values["notes"] = notes
    if spec is not None:
        if cur["locked"]:
            raise LockedError(f"test {tid} is locked; duplicate it to change spec")
        values["spec_json"] = json.dumps(spec, separators=(",", ":"))
    if material_id is not None and material_id != cur["material_id"]:
        # Material is editable even on locked tests: the common case is
        # a test that was created against the wrong material and needs
        # to be relabelled. Any palette entries already harvested from
        # this test cascade to the new material in the same transaction
        # so they don't end up filed under the old (incorrect) one.
        values["material_id"] = material_id
    if visibility is not None:
        values["visibility"] = visibility
    with session_scope() as s:
        s.execute(
            tests.update()
            .where(and_(tests.c.id == tid, tests.c.owner_id == owner_id))
            .values(**values)
        )
        if "material_id" in values:
            s.execute(
                palette_entries.update()
                .where(
                    and_(
                        palette_entries.c.test_id == tid,
                        palette_entries.c.owner_id == owner_id,
                    )
                )
                .values(material_id=values["material_id"])
            )
    return get(tid, owner_id=owner_id)


def mark_tested_and_lock(tid: int, *, owner_id: int = STANDALONE_USER_ID) -> None:
    """Idempotent: called every time a result is written for `tid`."""
    with session_scope() as s:
        s.execute(
            tests.update()
            .where(and_(tests.c.id == tid, tests.c.owner_id == owner_id))
            .values(status="tested", locked=1, updated_at=_now())
        )


def soft_delete(tid: int, *, owner_id: int = STANDALONE_USER_ID) -> None:
    with session_scope() as s:
        s.execute(
            tests.update()
            .where(and_(tests.c.id == tid, tests.c.owner_id == owner_id))
            .values(status="deleted", updated_at=_now())
        )


def delete(tid: int, *, owner_id: int = STANDALONE_USER_ID) -> None:
    """Hard-delete a test row (and all FK-cascaded children).

    Used in tests and admin tooling. For soft removal in the UI use
    ``soft_delete`` instead — it keeps the row visible to the owner's
    archive view and lets saved-spectrum ``source_test_id`` FK references
    NULL out gracefully via ON DELETE SET NULL.
    """
    with session_scope() as s:
        s.execute(
            tests.delete().where(
                and_(tests.c.id == tid, tests.c.owner_id == owner_id),
            )
        )


def bump_retest_index(tid: int, *, owner_id: int = STANDALONE_USER_ID) -> dict[str, Any]:
    """Increment ``retest_index`` on the test row and return the updated row.

    Raises ``KeyError`` if the test doesn't exist for this owner — the
    caller (API handler) maps it to HTTP 404. Not idempotent on
    purpose: each call bumps by one because "retest" is an explicit
    user action that indexes a new burn.
    """
    with session_scope() as s:
        cur = s.execute(
            select(tests).where(
                and_(tests.c.id == tid, tests.c.owner_id == owner_id),
            )
        ).one_or_none()
        if cur is None:
            raise KeyError(tid)
        next_idx = int(getattr(cur, "retest_index", 0) or 0) + 1
        s.execute(
            tests.update()
            .where(and_(tests.c.id == tid, tests.c.owner_id == owner_id))
            .values(retest_index=next_idx, updated_at=_now())
        )
    updated = get(tid, owner_id=owner_id)
    # ``get`` can't return None here because we just held a row above;
    # the assert narrows the type for callers.
    assert updated is not None
    return updated
