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

from sqlalchemy import and_, select

from ..config import DEFAULT_VISIBILITY, STANDALONE_USER_ID
from ..db import session_scope
from ..models import palette_entries
from ..palette import delta_e_2000, hex_to_lab


class NotMutableError(Exception):
    """Raised when callers try to mutate hex/material_id/params on a non-manual row."""


class MachineMismatchError(Exception):
    """A palette entry's machine_id doesn't match its referenced test."""


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
        "machine_id": r.machine_id,
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


def _check_machine_matches_test(s, e: dict[str, Any]) -> None:
    """Raise MachineMismatchError if e's machine_id doesn't match its test's machine_id."""
    if e.get("test_id") is None:
        return
    from ..models import tests as tests_table
    row = s.execute(
        select(tests_table.c.machine_id).where(tests_table.c.id == e["test_id"])
    ).one_or_none()
    if row is None:
        return  # test deletion is allowed; the FK handles dangling refs
    test_machine = row.machine_id
    entry_machine = e.get("machine_id", "F2Ultra")
    if test_machine != entry_machine:
        raise MachineMismatchError(
            f"palette entry machine_id {entry_machine!r} does not match "
            f"test {e['test_id']} machine_id {test_machine!r}",
        )


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
    """
    entries = list(entries)
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    if not rows:
        return []
    with session_scope() as s:
        for e in entries:
            _check_machine_matches_test(s, e)
        ids: list[int] = []
        for row in rows:
            existing_id = _find_existing_id(s, row)
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
                ids.append(res.inserted_primary_key[0])
        return ids


def replace_for_test(
    test_id: int, entries: Iterable[dict[str, Any]],
    *, owner_id: int = STANDALONE_USER_ID, visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    """Delete all palette entries for test_id (owner-scoped) then insert new ones atomically."""
    entries = list(entries)
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    with session_scope() as s:
        for e in entries:
            _check_machine_matches_test(s, e)
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
) -> list[dict[str, Any]]:
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
        q = q.order_by(palette_entries.c.created_at.desc())
        return [_row_to_entry(r) for r in s.execute(q).all()]


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
) -> list[dict[str, Any]]:
    target = hex_to_lab(hex_)
    rows = list_all(owner_id=owner_id, material_id=material_id, machine_id=machine_id)
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
    max_de: float = 5.0,
) -> list[dict[str, Any]]:
    """Validation status per palette entry for a given material/machine.

    For each palette entry scoped to ``material_id`` (and optionally
    ``machine_id``), find every validation cell that points to the
    entry via ``palette_entry_id``. Across all non-excluded results of
    those tests, compute ΔE76 between the cell's measured Lab and its
    expected Lab. The entry's ``best_de`` is the minimum across all
    matched (test, result, cell) tuples; ``last_validated_at`` is the
    upload timestamp of the result that produced ``best_de``.

    An entry is ``validated`` when ``best_de`` is finite and ≤
    ``max_de`` (default 5.0 — at the just-perceptible boundary). The
    threshold is a knob the caller can tighten for stricter palettes.

    Returns one dict per palette entry, even those with no matching
    validation cells (``best_de = None``, ``validated = False``). The
    SVG-layers UI uses this to badge layers whose auto-matched colour
    is known to print correctly.
    """
    # Imported lazily to avoid circular imports — the models module
    # can pull in this repo via the FK-relationship surface.
    from ..models import results as results_table
    from ..models import tests as tests_table
    from ..models import validation_cells as vc_table

    with session_scope() as s:
        entries_q = select(palette_entries.c.id).where(
            palette_entries.c.owner_id == owner_id,
            palette_entries.c.material_id == material_id,
        )
        if machine_id is not None:
            entries_q = entries_q.where(
                palette_entries.c.machine_id == machine_id,
            )
        entry_ids = [r.id for r in s.execute(entries_q).all()]
        if not entry_ids:
            return []

        # Bring in every validation cell that targets one of our
        # entries. ``palette_entry_id`` is indexed; the IN list size
        # is bounded by the entry count which is typically small.
        cells_q = select(
            vc_table.c.id,
            vc_table.c.test_id,
            vc_table.c.cell_index,
            vc_table.c.palette_entry_id,
            vc_table.c.expected_lab_l,
            vc_table.c.expected_lab_a,
            vc_table.c.expected_lab_b,
        ).where(vc_table.c.palette_entry_id.in_(entry_ids))
        cells = list(s.execute(cells_q).all())

        per_entry: dict[int, dict[str, Any]] = {
            eid: {"best_de": None, "last_at": None} for eid in entry_ids
        }
        if not cells:
            return [
                {
                    "entry_id": eid,
                    "best_de": None,
                    "last_validated_at": None,
                    "validated": False,
                }
                for eid in entry_ids
            ]

        test_ids = list({int(c.test_id) for c in cells})
        # Pull spec_json so we can derive cells_per_row to map a
        # swatch's (row, col) → cell_index. Only validation tests
        # have validation cells in the first place, but we read spec
        # values defensively.
        test_specs: dict[int, dict[str, Any]] = {}
        for r in s.execute(
            select(tests_table.c.id, tests_table.c.spec_json).where(
                tests_table.c.id.in_(test_ids),
            ),
        ).all():
            try:
                test_specs[int(r.id)] = json.loads(r.spec_json) or {}
            except Exception:
                test_specs[int(r.id)] = {}

        # Group cells per test for the per-result loop below; also
        # count cells per test for the cells_per_row fallback when
        # the spec doesn't carry one (older validation tests).
        cells_by_test: dict[int, list[Any]] = {}
        for c in cells:
            cells_by_test.setdefault(int(c.test_id), []).append(c)

        # Pull every non-excluded result for these tests in one go.
        results_q = select(
            results_table.c.id,
            results_table.c.test_id,
            results_table.c.uploaded_at,
            results_table.c.swatches_json,
            results_table.c.excluded,
        ).where(results_table.c.test_id.in_(test_ids))
        result_rows = list(s.execute(results_q).all())

        for r in result_rows:
            if r.excluded:
                continue
            tid = int(r.test_id)
            spec = test_specs.get(tid, {})
            cells_per_row = spec.get("cells_per_row")
            if not cells_per_row or cells_per_row <= 0:
                rows_count = max(1, int(spec.get("rows") or 1))
                cell_count = max(1, len(cells_by_test.get(tid, [])))
                cells_per_row = max(1, math.ceil(cell_count / rows_count))

            try:
                swatches = json.loads(r.swatches_json) or []
            except Exception:
                continue

            sw_by_idx: dict[int, dict[str, Any]] = {}
            for sw in swatches:
                try:
                    row_n = int(sw.get("row", 0))
                    col_n = int(sw.get("col", 0))
                except (TypeError, ValueError):
                    continue
                sw_by_idx[row_n * cells_per_row + col_n] = sw

            for c in cells_by_test.get(tid, []):
                sw = sw_by_idx.get(int(c.cell_index))
                if sw is None:
                    continue
                lab = sw.get("lab")
                if not isinstance(lab, list) or len(lab) != 3:
                    continue
                try:
                    measured = (float(lab[0]), float(lab[1]), float(lab[2]))
                except (TypeError, ValueError):
                    continue
                expected = (
                    float(c.expected_lab_l),
                    float(c.expected_lab_a),
                    float(c.expected_lab_b),
                )
                de = math.sqrt(
                    (expected[0] - measured[0]) ** 2
                    + (expected[1] - measured[1]) ** 2
                    + (expected[2] - measured[2]) ** 2
                )
                eid = int(c.palette_entry_id)
                slot = per_entry.get(eid)
                if slot is None:
                    continue
                if slot["best_de"] is None or de < slot["best_de"]:
                    slot["best_de"] = de
                    slot["last_at"] = r.uploaded_at

        return [
            {
                "entry_id": eid,
                "best_de": v["best_de"],
                "last_validated_at": v["last_at"],
                "validated": (
                    v["best_de"] is not None and v["best_de"] <= max_de
                ),
            }
            for eid, v in per_entry.items()
        ]
