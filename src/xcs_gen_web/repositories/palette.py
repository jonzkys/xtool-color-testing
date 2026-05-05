"""Palette repository — persistence + ΔE2000 query over SQLite.

Scoped per owner. query_by_hex only searches within the caller's own
palette. Public entries from other owners aren't considered yet —
future work will widen the filter to ``owner == self OR visibility ==
'public'``.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import and_, or_ as sa_or, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
from ..db import session_scope
from ..models import palette_entries
from ..palette import delta_e_76, hex_to_lab, lab_to_hex


class NotMutableError(Exception):
    """Raised when callers try to mutate hex/material_id/params on a non-manual row."""


class MachineMismatchError(Exception):
    """A palette entry's machine_id doesn't match its referenced test."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_entry(r, *, original_validated: bool = False) -> dict[str, Any]:
    validated_lab: list[float] | None = None
    if (
        r.validated_lab_l is not None
        and r.validated_lab_a is not None
        and r.validated_lab_b is not None
    ):
        validated_lab = [r.validated_lab_l, r.validated_lab_a, r.validated_lab_b]
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
        "machine_id": r.machine_id,
        # Validated state. Stays ``False`` / ``None`` for unvalidated
        # entries, including every entry pre-migration. The flag is
        # the canonical filter for "show me only colours I trust";
        # ``validated_lab`` is the corrected colour the validation
        # run measured (which can differ from the ingestion-time
        # ``lab`` when the original was mis-measured).
        "is_validated": bool(r.is_validated),
        "validated_at": r.validated_at,
        "validated_test_id": r.validated_test_id,
        "validated_cell_index": r.validated_cell_index,
        "validated_lab": validated_lab,
        "validated_run_count": r.validated_run_count,
        "validated_residual_de": r.validated_residual_de,
        # Derived: this entry has been used as a validation cell in a
        # test that has at least one non-excluded result — i.e. the
        # user has tried to validate it once. Distinct from
        # ``is_validated`` (which means an explicit validate call
        # flipped the flag). Lets the picker's autopick skip colours
        # the user has already burned once. Computed by ``list_all``;
        # other callers default to False.
        "original_validated": original_validated,
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
        "machine_id": e.get("machine_id", "F2Ultra"),
    }


# Capture-derived columns refreshed on re-ingest; user-curated columns
# (notes, favorited, created_at) are preserved.
_REFRESH_COLUMNS = ("hex", "lab_l", "lab_a", "lab_b", "sigma", "params_json")


def _find_existing_id(s, row: dict[str, Any]) -> int | None:
    """Return the id of the existing palette_entries row whose natural
    identity matches ``row``, or None if none exists. Identity is
    (test_id, x_value, y_value, source, source_result_id, owner_id)
    with NULL-safe equality on the nullable fields."""
    cond = and_(
        palette_entries.c.test_id == row["test_id"],
        palette_entries.c.source == row["source"],
        palette_entries.c.owner_id == row["owner_id"],
        (
            palette_entries.c.x_value.is_(None)
            if row["x_value"] is None
            else palette_entries.c.x_value == row["x_value"]
        ),
        (
            palette_entries.c.y_value.is_(None)
            if row["y_value"] is None
            else palette_entries.c.y_value == row["y_value"]
        ),
        (
            palette_entries.c.source_result_id.is_(None)
            if row["source_result_id"] is None
            else palette_entries.c.source_result_id == row["source_result_id"]
        ),
    )
    existing = s.execute(
        select(palette_entries.c.id).where(cond).limit(1)
    ).one_or_none()
    return existing.id if existing else None


def insert_bulk(
    entries: Iterable[dict[str, Any]], *, owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    """Idempotent upsert: for each entry, refresh the existing row whose
    natural identity matches if one exists, else insert a new row.

    Natural identity is (test_id, x_value, y_value, source,
    source_result_id, owner_id). On UPDATE only the capture-derived
    columns (hex, lab_*, sigma, params_json) are refreshed —
    user-curated columns (notes, favorited, created_at) are preserved
    so that ingest never silently destroys annotations or favourite
    stars.

    Returns the list of row ids (existing or newly-inserted) in input
    order, so callers can correlate ``ids[i]`` with ``entries[i]``.

    Was previously 3N round-trips per call (per-entry machine check +
    per-entry existing-row lookup + per-entry insert/update). For a
    typical 60-cell test ingest that's 180 queries; a 200-cell test
    is 600. Both pre-checks are now batched: one query collects the
    unique test_ids' machine_ids, and one query pulls every potential
    existing-row candidate for the (test_id, owner_id, source) tuples
    we're about to write. The per-entry inserts/updates remain — they
    have to be individual statements to capture the inserted_primary_key.
    """
    entries = list(entries)
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    if not rows:
        return []
    with session_scope() as s:
        _check_machine_matches_tests_bulk(s, entries)

        # Pre-fetch candidate existing rows in one query, then build
        # an in-memory lookup. The natural-key shape is large but the
        # row count is bounded by the entry count we're writing × the
        # entries already in the table for the same (test_id, source,
        # owner_id) — typically small for ingestion.
        existing_lookup = _build_existing_lookup(s, rows)

        ids: list[int] = []
        for row in rows:
            existing_id = existing_lookup.get(_natural_key(row))
            if existing_id is not None:
                refresh_values = {col: row[col] for col in _REFRESH_COLUMNS}
                s.execute(
                    palette_entries.update()
                    .where(palette_entries.c.id == existing_id)
                    .values(**refresh_values)
                )
                ids.append(existing_id)
            else:
                res = s.execute(palette_entries.insert().values(**row))
                new_id = res.inserted_primary_key[0]
                # Keep the lookup in sync so a later entry with the
                # same natural key in this same call updates the row
                # we just inserted instead of inserting a duplicate.
                existing_lookup[_natural_key(row)] = new_id
                ids.append(new_id)
        return ids


def _natural_key(
    row: dict[str, Any],
) -> tuple[Any, Any, Any, Any, Any, Any]:
    """The (test_id, x_value, y_value, source, source_result_id,
    owner_id) tuple that ``_find_existing_id`` keyed on. Hashable, so
    the bulk path can use it as a dict key."""
    return (
        row.get("test_id"),
        row.get("x_value"),
        row.get("y_value"),
        row.get("source"),
        row.get("source_result_id"),
        row.get("owner_id"),
    )


def _build_existing_lookup(
    s, rows: list[dict[str, Any]],
) -> dict[tuple[Any, Any, Any, Any, Any, Any], int]:
    """One query to fetch every existing row that could collide with
    the rows we're about to write. Bounded by the (test_id, source,
    owner_id) tuples we're touching — usually one or two per call.
    Returns a ``{natural_key: id}`` map for O(1) lookup."""
    if not rows:
        return {}
    # Group by the (test_id, source, owner_id) prefix so we can issue
    # one OR-of-ANDs query that covers them all.
    groups: dict[tuple[Any, Any, Any], None] = {}
    for r in rows:
        groups[(r.get("test_id"), r.get("source"), r.get("owner_id"))] = None
    if not groups:
        return {}
    cond = sa_or(*(
        and_(
            palette_entries.c.test_id == tid
            if tid is not None
            else palette_entries.c.test_id.is_(None),
            palette_entries.c.source == src,
            palette_entries.c.owner_id == oid,
        )
        for tid, src, oid in groups
    ))
    fetched = s.execute(
        select(
            palette_entries.c.id,
            palette_entries.c.test_id,
            palette_entries.c.x_value,
            palette_entries.c.y_value,
            palette_entries.c.source,
            palette_entries.c.source_result_id,
            palette_entries.c.owner_id,
        ).where(cond),
    ).all()
    return {
        (r.test_id, r.x_value, r.y_value, r.source, r.source_result_id, r.owner_id): r.id
        for r in fetched
    }


def _check_machine_matches_tests_bulk(s, entries: list[dict[str, Any]]) -> None:
    """Raise ``MachineMismatchError`` if any entry's ``machine_id``
    disagrees with its referenced test's. Batched: one query for the
    unique ``test_id`` set, then iterate entries in Python instead of
    re-querying the same test row 60+ times during a single ingest."""
    test_ids = {e["test_id"] for e in entries if e.get("test_id") is not None}
    if not test_ids:
        return
    from ..models import tests as tests_table
    rows = s.execute(
        select(tests_table.c.id, tests_table.c.machine_id).where(
            tests_table.c.id.in_(test_ids),
        ),
    ).all()
    by_id = {int(r.id): r.machine_id for r in rows}
    for e in entries:
        tid = e.get("test_id")
        if tid is None:
            continue
        test_machine = by_id.get(int(tid))
        if test_machine is None:
            # FK ON DELETE may have left a dangling test_id; the row
            # would be rejected at insert time anyway.
            continue
        entry_machine = e.get("machine_id", "F2Ultra")
        if test_machine != entry_machine:
            raise MachineMismatchError(
                f"palette entry machine_id {entry_machine!r} does not match "
                f"test {tid} machine_id {test_machine!r}",
            )


def replace_for_test(
    test_id: int, entries: Iterable[dict[str, Any]],
    *, owner_id: int = STANDALONE_USER_ID, visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    """Delete all palette entries for test_id (owner-scoped) then insert new ones atomically."""
    entries = list(entries)
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    with session_scope() as s:
        _check_machine_matches_tests_bulk(s, entries)
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
    machine_id: str | None = None,
    validated_only: bool = False,
) -> list[dict[str, Any]]:
    """List palette entries scoped to the owner.

    ``validated_only=True`` restricts to entries where
    ``is_validated`` is set — the auto-match's "Prefer validated"
    toggle on the SVG layers tab uses this path so it doesn't have
    to do a second filter pass client-side.

    Each returned entry carries an ``original_validated`` derived
    flag — true iff this entry has been used as a validation cell
    in a test that has at least one non-excluded result. Lets the
    test creator's autopick skip colours they've already burned
    once before. Computed in one extra batch query rather than a
    correlated subquery per row so the cost is bounded regardless
    of how many entries the owner has.
    """
    with session_scope() as s:
        q = select(palette_entries).where(
            palette_entries.c.owner_id == owner_id,
        )
        if material_id is not None:
            q = q.where(palette_entries.c.material_id == material_id)
        if machine_id is not None:
            q = q.where(palette_entries.c.machine_id == machine_id)
        if favorites_only:
            q = q.where(palette_entries.c.favorited == True)  # noqa: E712
        if source is not None:
            q = q.where(palette_entries.c.source == source)
        if validated_only:
            q = q.where(palette_entries.c.is_validated == True)  # noqa: E712
        q = q.order_by(palette_entries.c.created_at.desc())
        rows = s.execute(q).all()
        tested_ids = _ids_referenced_by_a_tested_validation_cell(
            s, owner_id=owner_id,
        )
        return [
            _row_to_entry(r, original_validated=r.id in tested_ids)
            for r in rows
        ]


def _ids_referenced_by_a_tested_validation_cell(
    s, *, owner_id: int,
) -> set[int]:
    """Set of palette entry ids that have been used as a validation
    cell in a test (owner-scoped) that has at least one non-excluded
    result.

    Used by ``list_all`` to populate the ``original_validated`` flag
    on each entry. One query per call; the JOINs are over indexed
    columns (``validation_cells.palette_entry_id``,
    ``tests.id``, ``results.test_id``).
    """
    from ..models import results as results_table
    from ..models import tests as tests_table
    from ..models import validation_cells as vc_table

    rows = s.execute(
        select(vc_table.c.palette_entry_id)
        .distinct()
        .join(tests_table, tests_table.c.id == vc_table.c.test_id)
        .join(results_table, results_table.c.test_id == tests_table.c.id)
        .where(
            tests_table.c.owner_id == owner_id,
            results_table.c.excluded == 0,  # type: ignore[arg-type]
            vc_table.c.palette_entry_id.is_not(None),
        ),
    ).all()
    return {int(r[0]) for r in rows}


def get_by_id(eid: int, *, owner_id: int = STANDALONE_USER_ID) -> dict[str, Any] | None:
    """Return the palette entry with the given id (owner-scoped), or None."""
    with session_scope() as s:
        row = s.execute(
            select(palette_entries).where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        ).one_or_none()
        return _row_to_entry(row) if row else None


def query_by_hex(
    hex_: str, *, owner_id: int = STANDALONE_USER_ID, limit: int = 5,
    material_id: int | None = None,
    machine_id: str | None = None,
    validated_only: bool = False,
) -> list[dict[str, Any]]:
    """Closest-ΔE76 search inside the caller's palette.

    Was ΔE2000 — switched to ΔE76 because CIEDE2000 has a known edge
    case for low-chroma references (greys) where the averaged hue
    accidentally hits the dΘ Gaussian centred at 275° and pulls ΔE
    down by tens of units. We saw a vivid magenta rank closer to a
    grey than to an actual pink (15.06 vs 17.40) — perceptually
    nonsense (real ΔE76 was 98.5 vs 59.5). ΔE76 has no edge cases
    and matches what the FPS auto-pick already uses, so rankings
    are now consistent across both surfaces.

    ``validated_only=True`` restricts the candidate set to entries
    where ``is_validated`` is set — i.e. drop the lowest-ΔE match
    that wasn't actually verified to engrave the colour it claims.
    Defers the gate to ``list_all`` so the filter happens in SQL.
    """
    target = hex_to_lab(hex_)
    rows = list_all(
        owner_id=owner_id, material_id=material_id, machine_id=machine_id,
        validated_only=validated_only,
    )
    scored = []
    for r in rows:
        de = delta_e_76(target, tuple(r["lab"]))
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


def delete_by_material(
    material_id: int, *, owner_id: int = STANDALONE_USER_ID,
) -> int:
    """Wipe every palette entry for a material — both auto-ingested rows
    (test-derived) and manual ones. Tests, results, and the material
    itself stay untouched, so the user can re-ingest selectively from
    the existing results afterward. Returns the number of rows
    deleted."""
    with session_scope() as s:
        res = s.execute(
            palette_entries.delete().where(
                and_(
                    palette_entries.c.material_id == material_id,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        )
        return res.rowcount


def get_source(eid: int, *, owner_id: int = STANDALONE_USER_ID) -> str | None:
    """Return the entry's `source` ('averaged', 'single_result', or 'manual'),
    or None if it doesn't exist / wrong owner. Used by the API layer to gate
    PATCH requests before any write happens."""
    with session_scope() as s:
        row = s.execute(
            select(palette_entries.c.source).where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        ).one_or_none()
        return row.source if row else None


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
    machine_id: str = "F2Ultra",
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
            "machine_id": machine_id,
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


def validation_status_for_material(
    *,
    material_id: int,
    owner_id: int = STANDALONE_USER_ID,
    machine_id: str | None = None,
    max_de: float = 5.0,  # noqa: ARG001 — kept for wire-compat
) -> list[dict[str, Any]]:
    """Validation status per palette entry for a given material/machine.

    Returns one row per palette entry: ``validated`` is the canonical
    ``is_validated`` flag, ``best_de`` is the stored
    ``validated_residual_de`` (cross-run stability ΔE the validate
    flow recorded at save time), ``last_validated_at`` is the
    timestamp the entry was last validated.

    Originally a heavy on-the-fly compute that loaded every result's
    swatch JSON and ran a ΔE76 loop per (cell, result) pair to
    decide. Phase 2 added an explicit ``is_validated`` column that
    the validate flow sets directly, so this endpoint can short-
    circuit to a single SELECT — no swatch JSON parse, no per-cell
    loop, no result table scan. The ``max_de`` arg stays in the
    signature for wire-compat with callers that still pass it but is
    no longer consulted (the validation flow chose the gate when the
    entry was saved).
    """
    with session_scope() as s:
        q = select(
            palette_entries.c.id,
            palette_entries.c.is_validated,
            palette_entries.c.validated_at,
            palette_entries.c.validated_residual_de,
        ).where(
            palette_entries.c.owner_id == owner_id,
            palette_entries.c.material_id == material_id,
        )
        if machine_id is not None:
            q = q.where(palette_entries.c.machine_id == machine_id)
        rows = s.execute(q).all()
        return [
            {
                "entry_id": int(r.id),
                "best_de": r.validated_residual_de,
                "last_validated_at": r.validated_at,
                "validated": bool(r.is_validated),
            }
            for r in rows
        ]


def validate_entry(
    eid: int,
    *,
    validated_lab: tuple[float, float, float],
    validated_test_id: int | None = None,
    run_count: int | None = None,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    """Mark a palette entry as validated and persist the validated Lab.

    ``validated_lab`` is the burn-mean (typically robust-mean) Lab
    measured across the validation test's results — it can differ
    from the entry's original ``lab_*`` if the original was
    mis-ingested under bad lighting. ``validated_residual_de`` is
    computed and stored so callers can answer "how much did this
    entry move?" without a second query.

    Re-validation is a refresh: calling on an already-validated
    entry overwrites the Lab and timestamp. The flag stays ``True``.
    Returns the updated entry dict, or ``None`` if the entry doesn't
    exist (or wrong owner).
    """
    L_v, a_v, b_v = float(validated_lab[0]), float(validated_lab[1]), float(validated_lab[2])
    with session_scope() as s:
        existing = s.execute(
            select(palette_entries).where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        ).one_or_none()
        if existing is None:
            return None
        residual = math.sqrt(
            (L_v - existing.lab_l) ** 2
            + (a_v - existing.lab_a) ** 2
            + (b_v - existing.lab_b) ** 2
        )
        s.execute(
            palette_entries.update()
            .where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
            .values(
                is_validated=True,
                validated_at=_now(),
                validated_test_id=validated_test_id,
                validated_lab_l=L_v,
                validated_lab_a=a_v,
                validated_lab_b=b_v,
                validated_run_count=run_count,
                validated_residual_de=residual,
            )
        )
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
    return _row_to_entry(out)


def create_validated_entry(
    *,
    machine_id: str,
    material_id: int,
    burn_mean_lab: tuple[float, float, float],
    validated_test_id: int,
    validated_cell_index: int,
    run_count: int,
    stability_de: float,
    params: dict[str, Any] | None = None,
    notes: str = "",
    sigma: float = 0.0,
    owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> dict[str, Any]:
    """Upsert a validated palette entry for ``(validated_test_id,
    validated_cell_index, owner_id)``.

    The Stability page's VALIDATE save calls this once per cell that
    the user accepted as stable. The new entry's ``lab_*`` IS the
    consensus Lab — no separation between "first-ingested colour" and
    "validated colour" — but the ``validated_*`` columns are still
    populated for query convenience (so ``WHERE is_validated`` rolls
    up cleanly without a UNION). ``validated_residual_de`` stores the
    *stability* gate value (max cross-run drift) since that's the
    quality signal worth surfacing on the entry, not a residual
    against an obsolete pre-validation Lab.

    Re-running validate on the same (test, cell) refreshes the
    existing row's capture-derived columns (Lab, hex, params,
    validated_*) and leaves user-curated columns alone (``notes``,
    ``favorited``, ``created_at``). This makes the save endpoint
    idempotent under retries / double-clicks / re-validation after
    uploading more results — one cell, one entry, regardless of how
    many times the user hits Save.

    Returns the entry dict (newly-inserted or freshly-updated).
    """
    L, a, b = float(burn_mean_lab[0]), float(burn_mean_lab[1]), float(burn_mean_lab[2])
    hex_ = lab_to_hex(L, a, b)
    now = _now()
    refresh_values = {
        "hex": hex_,
        "lab_l": L, "lab_a": a, "lab_b": b,
        "params_json": json.dumps(params or {}, separators=(",", ":")),
        "sigma": sigma,
        "is_validated": True,
        "validated_at": now,
        "validated_test_id": validated_test_id,
        "validated_cell_index": validated_cell_index,
        "validated_lab_l": L,
        "validated_lab_a": a,
        "validated_lab_b": b,
        "validated_run_count": run_count,
        "validated_residual_de": stability_de,
    }
    with session_scope() as s:
        # Natural key: (validated_test_id, validated_cell_index, owner_id).
        # We require ``is_validated=True`` on the existing row so an
        # entry that was deliberately invalidated (validated_test_id
        # cleared by ``invalidate_entry``) doesn't get reused.
        existing = s.execute(
            select(palette_entries.c.id).where(
                and_(
                    palette_entries.c.validated_test_id == validated_test_id,
                    palette_entries.c.validated_cell_index == validated_cell_index,
                    palette_entries.c.owner_id == owner_id,
                    palette_entries.c.is_validated == True,  # noqa: E712
                ),
            )
        ).one_or_none()
        if existing is not None:
            s.execute(
                palette_entries.update()
                .where(palette_entries.c.id == existing.id)
                .values(**refresh_values)
            )
            new_id = existing.id
        else:
            # ``test_id`` mirrors ``validated_test_id`` so the entry
            # surfaces in the palette page's per-test BrowseView
            # grouping (which keys off ``test_id``). Otherwise
            # validated entries would only show up via the Query tab.
            row = {
                "test_id": validated_test_id,
                "material_id": material_id,
                "x_value": 0,
                "y_value": None,
                "source": "averaged",
                "source_result_id": None,
                "notes": notes,
                "created_at": now,
                "owner_id": owner_id,
                "visibility": visibility,
                "machine_id": machine_id,
                "favorited": False,
                **refresh_values,
            }
            res = s.execute(palette_entries.insert().values(**row))
            new_id = res.inserted_primary_key[0]
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == new_id),
        ).one()
    return _row_to_entry(out)


def invalidate_entry(
    eid: int,
    *,
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    """Clear the validated state on an entry — flag flips back to
    ``False`` and the validated_* columns reset to ``NULL``.

    The original ``lab_*`` is untouched. Returns the updated entry,
    or ``None`` when the row doesn't exist (or wrong owner).
    """
    with session_scope() as s:
        existing = s.execute(
            select(palette_entries.c.id).where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
        ).one_or_none()
        if existing is None:
            return None
        s.execute(
            palette_entries.update()
            .where(
                and_(
                    palette_entries.c.id == eid,
                    palette_entries.c.owner_id == owner_id,
                ),
            )
            .values(
                is_validated=False,
                validated_at=None,
                validated_test_id=None,
                validated_cell_index=None,
                validated_lab_l=None,
                validated_lab_a=None,
                validated_lab_b=None,
                validated_run_count=None,
                validated_residual_de=None,
            )
        )
        out = s.execute(
            select(palette_entries).where(palette_entries.c.id == eid),
        ).one()
    return _row_to_entry(out)
