"""Text/registration default ProcessingParams — per machine, optionally
per material.

Two tables back this:

* ``text_reg_defaults_machine`` — machine-wide fallback for an owner.
* ``text_reg_defaults_material`` — material override on top of the
  machine fallback for an owner.

Resolution order at burn time::

    test override → material default → machine default → built-in constants

The repository exposes upsert helpers for both, getter helpers, and a
single ``resolve_params(...)`` that walks the order and returns a
``ProcessingParams`` ready to hand to the renderer (or ``None`` when
no defaults exist — the caller can then fall back to its own constant).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert

from xcs_gen.model import ProcessingParams

from ..config import STANDALONE_USER_ID
from ..db import session_scope
from ..models import text_reg_defaults_machine, text_reg_defaults_material


# Param column names shared by both tables. Mirrors
# ``ProcessingParams`` field names — kept here as a single tuple so
# row→dict and dict→row mappings stay symmetric.
_PARAM_FIELDS: tuple[str, ...] = (
    "speed",
    "power",
    "density",
    "repeat",
    "pulse_width",
    "mopa_frequency",
    "processing_light_source",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict_machine(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "owner_id": r.owner_id,
        "machine_id": r.machine_id,
        **{f: getattr(r, f) for f in _PARAM_FIELDS},
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "import_source": getattr(r, "import_source", None),
    }


def _row_to_dict_material(r) -> dict[str, Any]:
    return {
        "id": r.id,
        "owner_id": r.owner_id,
        "machine_id": r.machine_id,
        "material_id": r.material_id,
        **{f: getattr(r, f) for f in _PARAM_FIELDS},
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "import_source": getattr(r, "import_source", None),
    }


def _row_to_processing_params(r) -> ProcessingParams:
    return ProcessingParams(
        speed=int(r.speed),
        power=float(r.power),
        density=int(r.density),
        repeat=int(r.repeat),
        pulse_width=int(r.pulse_width),
        mopa_frequency=int(r.mopa_frequency),
        processing_light_source=str(r.processing_light_source),
    )


# ── Machine-level defaults ───────────────────────────────────────────────────


def get_machine(
    *, owner_id: int = STANDALONE_USER_ID, machine_id: str,
) -> dict[str, Any] | None:
    """Return the machine-level default row for this owner, or None."""
    with session_scope() as s:
        row = s.execute(
            select(text_reg_defaults_machine).where(
                and_(
                    text_reg_defaults_machine.c.owner_id == owner_id,
                    text_reg_defaults_machine.c.machine_id == machine_id,
                ),
            )
        ).one_or_none()
        return _row_to_dict_machine(row) if row else None


def upsert_machine(
    *, owner_id: int = STANDALONE_USER_ID, machine_id: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Insert-or-update the machine-level default for ``(owner, machine)``.

    Uses a portable upsert via per-dialect ``ON CONFLICT`` syntax so
    SQLite, MySQL, and Postgres all collapse into a single query
    (cheaper than a SELECT-then-INSERT-or-UPDATE round-trip).
    """
    ts = _now()
    payload = {
        "owner_id": owner_id,
        "machine_id": machine_id,
        **{f: params[f] for f in _PARAM_FIELDS},
        "created_at": ts,
        "updated_at": ts,
    }
    with session_scope() as s:
        dialect = s.bind.dialect.name if s.bind is not None else "sqlite"
        if dialect == "mysql":
            stmt = mysql_insert(text_reg_defaults_machine).values(payload)
            update_cols = {f: stmt.inserted[f] for f in _PARAM_FIELDS}
            update_cols["updated_at"] = stmt.inserted.updated_at
            stmt = stmt.on_duplicate_key_update(**update_cols)
        elif dialect == "postgresql":
            stmt = pg_insert(text_reg_defaults_machine).values(payload)
            update_cols = {f: getattr(stmt.excluded, f) for f in _PARAM_FIELDS}
            update_cols["updated_at"] = stmt.excluded.updated_at
            stmt = stmt.on_conflict_do_update(
                index_elements=["owner_id", "machine_id"],
                set_=update_cols,
            )
        else:
            stmt = sqlite_insert(text_reg_defaults_machine).values(payload)
            update_cols = {f: getattr(stmt.excluded, f) for f in _PARAM_FIELDS}
            update_cols["updated_at"] = stmt.excluded.updated_at
            stmt = stmt.on_conflict_do_update(
                index_elements=["owner_id", "machine_id"],
                set_=update_cols,
            )
        s.execute(stmt)
    got = get_machine(owner_id=owner_id, machine_id=machine_id)
    assert got is not None
    return got


def delete_machine(
    *, owner_id: int = STANDALONE_USER_ID, machine_id: str,
) -> bool:
    """Drop the machine-level default. Returns True if a row was removed."""
    with session_scope() as s:
        result = s.execute(
            text_reg_defaults_machine.delete().where(
                and_(
                    text_reg_defaults_machine.c.owner_id == owner_id,
                    text_reg_defaults_machine.c.machine_id == machine_id,
                ),
            )
        )
        return (result.rowcount or 0) > 0


# ── Material-level overrides ─────────────────────────────────────────────────


def get_material(
    *, owner_id: int = STANDALONE_USER_ID, machine_id: str, material_id: int,
) -> dict[str, Any] | None:
    """Return the material-level override row for this (owner, machine,
    material), or None."""
    with session_scope() as s:
        row = s.execute(
            select(text_reg_defaults_material).where(
                and_(
                    text_reg_defaults_material.c.owner_id == owner_id,
                    text_reg_defaults_material.c.machine_id == machine_id,
                    text_reg_defaults_material.c.material_id == material_id,
                ),
            )
        ).one_or_none()
        return _row_to_dict_material(row) if row else None


def list_for_material(
    *, owner_id: int = STANDALONE_USER_ID, material_id: int,
) -> list[dict[str, Any]]:
    """Every per-machine override an owner has for this material."""
    with session_scope() as s:
        rows = s.execute(
            select(text_reg_defaults_material).where(
                and_(
                    text_reg_defaults_material.c.owner_id == owner_id,
                    text_reg_defaults_material.c.material_id == material_id,
                ),
            ).order_by(text_reg_defaults_material.c.machine_id)
        ).all()
    return [_row_to_dict_material(r) for r in rows]


def upsert_material(
    *,
    owner_id: int = STANDALONE_USER_ID,
    machine_id: str,
    material_id: int,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Insert-or-update the material-level override for ``(owner, machine,
    material)``."""
    ts = _now()
    payload = {
        "owner_id": owner_id,
        "machine_id": machine_id,
        "material_id": material_id,
        **{f: params[f] for f in _PARAM_FIELDS},
        "created_at": ts,
        "updated_at": ts,
    }
    with session_scope() as s:
        dialect = s.bind.dialect.name if s.bind is not None else "sqlite"
        if dialect == "mysql":
            stmt = mysql_insert(text_reg_defaults_material).values(payload)
            update_cols = {f: stmt.inserted[f] for f in _PARAM_FIELDS}
            update_cols["updated_at"] = stmt.inserted.updated_at
            stmt = stmt.on_duplicate_key_update(**update_cols)
        elif dialect == "postgresql":
            stmt = pg_insert(text_reg_defaults_material).values(payload)
            update_cols = {f: getattr(stmt.excluded, f) for f in _PARAM_FIELDS}
            update_cols["updated_at"] = stmt.excluded.updated_at
            stmt = stmt.on_conflict_do_update(
                index_elements=["owner_id", "machine_id", "material_id"],
                set_=update_cols,
            )
        else:
            stmt = sqlite_insert(text_reg_defaults_material).values(payload)
            update_cols = {f: getattr(stmt.excluded, f) for f in _PARAM_FIELDS}
            update_cols["updated_at"] = stmt.excluded.updated_at
            stmt = stmt.on_conflict_do_update(
                index_elements=["owner_id", "machine_id", "material_id"],
                set_=update_cols,
            )
        s.execute(stmt)
    got = get_material(
        owner_id=owner_id, machine_id=machine_id, material_id=material_id,
    )
    assert got is not None
    return got


def delete_material(
    *, owner_id: int = STANDALONE_USER_ID, machine_id: str, material_id: int,
) -> bool:
    """Drop the material-level override. Returns True if a row was removed."""
    with session_scope() as s:
        result = s.execute(
            text_reg_defaults_material.delete().where(
                and_(
                    text_reg_defaults_material.c.owner_id == owner_id,
                    text_reg_defaults_material.c.machine_id == machine_id,
                    text_reg_defaults_material.c.material_id == material_id,
                ),
            )
        )
        return (result.rowcount or 0) > 0


# ── Resolver ─────────────────────────────────────────────────────────────────


def resolve_params(
    *,
    owner_id: int = STANDALONE_USER_ID,
    machine_id: str,
    material_id: int | None,
) -> ProcessingParams | None:
    """Walk material → machine and return the first hit as a
    :class:`ProcessingParams`. ``None`` when neither level has been
    configured for this owner — caller falls back to the built-in
    constants.

    Single SELECT per level so the worst case is two queries; we don't
    bother UNION'ing them because the second one only fires when the
    first miss-matches and the row payload is the same shape regardless.
    """
    with session_scope() as s:
        if material_id is not None:
            row = s.execute(
                select(text_reg_defaults_material).where(
                    and_(
                        text_reg_defaults_material.c.owner_id == owner_id,
                        text_reg_defaults_material.c.machine_id == machine_id,
                        text_reg_defaults_material.c.material_id == material_id,
                    ),
                )
            ).one_or_none()
            if row is not None:
                return _row_to_processing_params(row)
        row = s.execute(
            select(text_reg_defaults_machine).where(
                and_(
                    text_reg_defaults_machine.c.owner_id == owner_id,
                    text_reg_defaults_machine.c.machine_id == machine_id,
                ),
            )
        ).one_or_none()
        if row is not None:
            return _row_to_processing_params(row)
    return None
