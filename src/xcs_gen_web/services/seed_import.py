"""Seed-import service — deep-copy a seed user's library into a target
user with full foreign-key remapping.

The flow:

* Operator picks one well-curated source account ("the seed") and stamps
  every copied row with ``import_source = 'seed'``. A new user landing
  on the empty workbench can one-click import that catalogue so the
  Palette / Tests / Materials pages aren't empty on first visit.

* The copy is a deep clone — every parent row gets a fresh ``id``
  assigned by the DB, and every child row's foreign key is remapped to
  the new parent id before the child is inserted. Self-referential FKs
  (``tests.source_test_id``, ``palette_entries.derived_from_entry_id``)
  are nulled on insert and patched in a second pass once all new ids
  are known. The ``validation_cells.palette_entry_id`` FK is similarly
  patched after palette entries are copied (cells are inserted before
  palette entries, because palette entries reference tests, which the
  cells also reference).

* ``preview`` is a cheap read-only count + idempotency check used by
  the modal's "before you click import" panel. ``run_import`` does
  the actual copy under a single ``session_scope`` transaction — if
  anything raises, nothing is written.

Constraint handling — owner-scoped uniques (``text_reg_defaults_*``,
``materials`` ``ix_materials_owner``-style indexes) don't fire on this
path because the destination owner_id differs from the source. The
``saved_spectrum_swatches.uq_saved_spectrum_swatch_cell`` and
``saved_spectrum_fit_coefficients.uq_saved_spectrum_fit_coeff_cell``
constraints are scoped per parent id, and we generate fresh parent
ids per copied spectrum, so they're safe too. The only constraint
that could realistically fire is if the dst user already has a
``text_reg_defaults_machine`` row for the same ``(owner_id,
machine_id)`` pair before the import runs — but the idempotency
guard fires first, so the only way to hit that state is to call
``run_import`` against a dst that has non-seed rows of its own. We
treat that as an operator decision: the unique violation will rollback
the whole copy and the route returns 409. We don't silently skip the
text_reg_defaults rows; if your dst has any own data the import is
the wrong tool — invite the user to a fresh account instead.

Image bytes ARE copied: ``_copy_results`` reads the source's stored
image (and warped sidecar + HEIC transcode cache, if present) and
writes them under the new ``(test_id, result_id)`` keys so the dst
owner's namespace owns the bytes. Storage writes are not transactional
— if the wrapping DB rollback fires after a storage write, the bytes
become unreachable orphans under freshly-allocated keys. See the
"Failure mode" comment in ``_copy_results``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import and_, func, insert, select

from .. import images
from ..db import session_scope
from ..models import (
    materials,
    palette_entries,
    presets,
    results,
    saved_spectrum_fit_coefficients,
    saved_spectrum_swatches,
    saved_spectrums,
    tests,
    text_reg_defaults_machine,
    text_reg_defaults_material,
    validation_cells,
)

SEED_IMPORT_SOURCE = "seed"


# ── Exceptions ───────────────────────────────────────────────────────────────


class AlreadyImportedError(Exception):
    """Destination already carries at least one row tagged
    ``import_source='seed'`` — refuse to import twice. Routes map to 409."""


class EmptySeedError(Exception):
    """Source account has no rows to copy. Routes map to 409."""


class SameUserError(Exception):
    """Refuse to copy a user's data onto themselves — that would silently
    duplicate every row and re-tag the duplicates as 'seed', polluting
    the user's own catalogue. Routes map to 400."""


# ── Result types ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SeedPreview:
    """Read-only summary the modal shows before the user confirms."""
    src_owner_id: int
    dst_owner_id: int
    materials: int
    tests: int
    results: int
    palette_entries: int
    presets: int
    saved_spectrums: int
    already_imported: bool
    src_has_data: bool


@dataclass(frozen=True)
class SeedImportResult:
    """Count of rows written, per table. Bytes copied in B3 surface here too."""
    materials: int = 0
    tests: int = 0
    results: int = 0
    palette_entries: int = 0
    presets: int = 0
    saved_spectrums: int = 0
    validation_cells: int = 0
    text_reg_machine: int = 0
    text_reg_material: int = 0
    image_warnings: list[str] = field(default_factory=list)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _count_owned(s, table, owner_id: int) -> int:
    return int(
        s.scalar(
            select(func.count())
            .select_from(table)
            .where(table.c.owner_id == owner_id)
        )
        or 0
    )


def _dst_has_seed(s, owner_id: int) -> bool:
    """True if the destination owner has any rows on the four "primary"
    tables that already carry ``import_source='seed'``. We check the
    most representative tables rather than every one — if those are
    clean we trust the rest are too (the service inserts atomically)."""
    for table in (materials, tests, palette_entries, presets):
        n = s.scalar(
            select(func.count())
            .select_from(table)
            .where(
                and_(
                    table.c.owner_id == owner_id,
                    table.c.import_source == SEED_IMPORT_SOURCE,
                ),
            )
        )
        if int(n or 0) > 0:
            return True
    return False


def _row_to_dict(row) -> dict[str, Any]:
    """Convert a SQLAlchemy Row mapping to a plain dict.

    ``Row._mapping`` is the documented stable accessor — using ``dict(row)``
    works on 2.x but spawns deprecation noise on some configs.
    """
    return dict(row._mapping)


def _strip(d: dict[str, Any], *keys: str) -> dict[str, Any]:
    """Return a shallow copy of ``d`` with any ``keys`` removed. Used to
    drop auto-managed columns (``id``, ``created_at``) before re-inserting."""
    return {k: v for k, v in d.items() if k not in keys}


# ── Public API ───────────────────────────────────────────────────────────────


def preview(src_owner_id: int, dst_owner_id: int) -> SeedPreview:
    """Cheap count + idempotency check. Read-only."""
    with session_scope() as s:
        m_n = _count_owned(s, materials, src_owner_id)
        t_n = _count_owned(s, tests, src_owner_id)
        r_n = _count_owned(s, results, src_owner_id)
        p_n = _count_owned(s, palette_entries, src_owner_id)
        pr_n = _count_owned(s, presets, src_owner_id)
        ss_n = _count_owned(s, saved_spectrums, src_owner_id)
        already = _dst_has_seed(s, dst_owner_id)
        src_has_data = (m_n + t_n + r_n + p_n + pr_n + ss_n) > 0
    return SeedPreview(
        src_owner_id=src_owner_id,
        dst_owner_id=dst_owner_id,
        materials=m_n,
        tests=t_n,
        results=r_n,
        palette_entries=p_n,
        presets=pr_n,
        saved_spectrums=ss_n,
        already_imported=already,
        src_has_data=src_has_data,
    )


def run_import(src_owner_id: int, dst_owner_id: int) -> SeedImportResult:
    """Deep-copy the seed user's library to the destination user.

    Atomic — the whole copy lives inside a single ``session_scope`` so a
    constraint violation half-way through rolls back every prior insert.

    Raises:
        SameUserError: src and dst are the same id.
        EmptySeedError: src account has no rows on any of the six counted tables.
        AlreadyImportedError: dst already has rows tagged ``import_source='seed'``.
    """
    if src_owner_id == dst_owner_id:
        raise SameUserError(
            f"refusing to copy owner_id {src_owner_id} onto itself",
        )

    with session_scope() as s:
        # Re-check idempotency inside the transaction so a concurrent
        # second call can't slip past the modal's earlier preview.
        if _dst_has_seed(s, dst_owner_id):
            raise AlreadyImportedError(
                f"dst owner {dst_owner_id} already has import_source='seed' rows",
            )

        # Empty-seed guard: refuse to "import" nothing.
        src_total = sum(
            _count_owned(s, t, src_owner_id)
            for t in (materials, tests, results, palette_entries, presets, saved_spectrums)
        )
        if src_total == 0:
            raise EmptySeedError(
                f"src owner {src_owner_id} has no rows to copy",
            )

        materials_map = _copy_materials(s, src_owner_id, dst_owner_id)
        presets_map = _copy_presets(
            s, src_owner_id, dst_owner_id, materials_map,
        )
        tests_map = _copy_tests_pass_1(
            s, src_owner_id, dst_owner_id, materials_map,
        )
        vc_count = _copy_validation_cells_pass_1(s, src_owner_id, tests_map)
        image_warnings: list[str] = []
        results_map = _copy_results(
            s, src_owner_id, dst_owner_id, tests_map, image_warnings,
        )
        palette_map = _copy_palette_entries_pass_1(
            s, src_owner_id, dst_owner_id,
            tests_map, materials_map, results_map,
        )
        spectrums_count = _copy_saved_spectrums_with_children(
            s, src_owner_id, dst_owner_id, tests_map, materials_map,
        )
        trm_count = _copy_text_reg_machine(s, src_owner_id, dst_owner_id)
        trmat_count = _copy_text_reg_material(
            s, src_owner_id, dst_owner_id, materials_map,
        )

        # Pass 2 — patch the self-FKs + cross-FKs that pass 1 nulled.
        _patch_tests_self_refs(s, src_owner_id, tests_map)
        _patch_palette_self_refs(s, src_owner_id, palette_map)
        _patch_validation_cells_palette_fk(
            s, src_owner_id, tests_map, palette_map,
        )

        return SeedImportResult(
            materials=len(materials_map),
            tests=len(tests_map),
            results=len(results_map),
            palette_entries=len(palette_map),
            presets=len(presets_map),
            saved_spectrums=spectrums_count,
            validation_cells=vc_count,
            text_reg_machine=trm_count,
            text_reg_material=trmat_count,
            image_warnings=image_warnings,
        )


# ── Per-table copiers ────────────────────────────────────────────────────────
#
# Each copier reads rows owned by ``src_owner_id``, builds a row dict for
# the destination, inserts one-at-a-time so we can capture the new id, and
# returns a {old_id: new_id} map (or a row count for tables with no
# children that reference them).


def _copy_materials(s, src: int, dst: int) -> dict[int, int]:
    rows = s.execute(
        select(materials).where(materials.c.owner_id == src)
    ).all()
    id_map: dict[int, int] = {}
    for row in rows:
        d = _row_to_dict(row)
        old_id = d["id"]
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["created_at"] = _now()
        res = s.execute(insert(materials).values(**new_row))
        id_map[old_id] = int(res.inserted_primary_key[0])
    return id_map


def _copy_presets(
    s, src: int, dst: int, materials_map: dict[int, int],
) -> dict[int, int]:
    rows = s.execute(
        select(presets).where(presets.c.owner_id == src)
    ).all()
    id_map: dict[int, int] = {}
    now = _now()
    for row in rows:
        d = _row_to_dict(row)
        old_id = d["id"]
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["material_id"] = materials_map[d["material_id"]]
        new_row["created_at"] = now
        new_row["updated_at"] = now
        res = s.execute(insert(presets).values(**new_row))
        id_map[old_id] = int(res.inserted_primary_key[0])
    return id_map


def _copy_tests_pass_1(
    s, src: int, dst: int, materials_map: dict[int, int],
) -> dict[int, int]:
    """Insert tests with ``source_test_id`` / ``parent_test_id`` set to
    NULL — those FKs are patched in pass 2 once every new test id is
    known (handles A → B → A cycles cleanly)."""
    rows = s.execute(
        select(tests).where(tests.c.owner_id == src)
    ).all()
    id_map: dict[int, int] = {}
    now = _now()
    for row in rows:
        d = _row_to_dict(row)
        old_id = d["id"]
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["material_id"] = materials_map[d["material_id"]]
        new_row["source_test_id"] = None  # patched in pass 2
        new_row["parent_test_id"] = None  # patched in pass 2
        new_row["created_at"] = now
        new_row["updated_at"] = now
        res = s.execute(insert(tests).values(**new_row))
        id_map[old_id] = int(res.inserted_primary_key[0])
    return id_map


def _copy_validation_cells_pass_1(
    s, src: int, tests_map: dict[int, int],
) -> int:
    """Validation_cells are owned indirectly via tests (no own owner_id
    column). We walk the src test ids and copy each test's cells with
    the new test_id; ``palette_entry_id`` is nulled and patched after
    palette entries are copied (cells reference palette entries that
    don't exist yet at this point)."""
    if not tests_map:
        return 0
    total = 0
    for old_tid, new_tid in tests_map.items():
        rows = s.execute(
            select(validation_cells).where(
                validation_cells.c.test_id == old_tid,
            )
        ).all()
        for row in rows:
            d = _row_to_dict(row)
            new_row = _strip(d, "id")
            new_row["test_id"] = new_tid
            new_row["palette_entry_id"] = None  # patched in pass 2
            s.execute(insert(validation_cells).values(**new_row))
            total += 1
    return total


def _copy_results(
    s, src: int, dst: int, tests_map: dict[int, int],
    image_warnings: list[str],
) -> dict[int, int]:
    """Copy result rows AND their on-disk image artefacts.

    For each source result we:

    1. Insert a new DB row to allocate ``new_rid``. We seed the
       ``image_path`` column with a placeholder ("") because the column
       is NOT NULL — we patch it with the real new path once the bytes
       are written and we know what path the storage layer chose.
    2. Read source bytes via ``images.read``. On ``FileNotFoundError``
       we keep the source ``image_path`` verbatim on the new row and
       record a warning — the row stays useful (cell readings, indices)
       even without the image, and the NOT NULL constraint is satisfied.
    3. Save bytes under ``(new_tid, new_rid)`` so they land in the
       dst namespace, then UPDATE the row's ``image_path``.
    4. Repeat for the optional warped sidecar (kind="warped"). Missing
       warped bytes are silent — it's a derived cache that the
       /api/results/{rid}/warped endpoint will regenerate.
    5. Copy the HEIC→JPEG transcode sidecar if the source has one.
       That cache lives at "<image_path>.cached.jpg" by convention
       (see commit 42bc588) — we mirror the convention against the new
       image_path so the dst's first /image GET serves the cached JPEG
       rather than re-transcoding.

    Failure mode note: storage writes are NOT transactional. If the DB
    transaction wrapping ``run_import`` rolls back after this function
    has already written some image bytes, those bytes are orphaned
    under the dst owner's storage. That's acceptable because the keys
    are ``(new_test_id, new_result_id)`` which never get re-issued
    (autoincrement) — the orphans are unreachable rather than colliding
    with future data, and the next successful run gets fresh ids.
    """
    rows = s.execute(
        select(results).where(results.c.owner_id == src)
    ).all()
    id_map: dict[int, int] = {}
    for row in rows:
        d = _row_to_dict(row)
        old_id = d["id"]
        src_image_path = d["image_path"]
        src_warped_path = d["warped_image_path"]

        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["test_id"] = tests_map[d["test_id"]]
        new_row["uploaded_at"] = _now()
        # Placeholder — patched below once we know the new storage path.
        # Kept as src path so the NOT NULL constraint is satisfied even
        # if the storage write below blows up between the INSERT and the
        # UPDATE (the outer session_scope would then rollback the row).
        new_row["image_path"] = src_image_path
        new_row["warped_image_path"] = None  # patched below if applicable

        res = s.execute(insert(results).values(**new_row))
        new_rid = int(res.inserted_primary_key[0])
        id_map[old_id] = new_rid
        new_tid = tests_map[d["test_id"]]

        # Copy the original image bytes.
        new_image_path: str | None = None
        if src_image_path:
            try:
                src_bytes = images.read(src_image_path)
            except FileNotFoundError:
                image_warnings.append(
                    f"source image missing for result {old_id}: {src_image_path}"
                )
                src_bytes = None
            if src_bytes is not None:
                suffix = Path(src_image_path).suffix or ".jpg"
                saved = images.save(
                    test_id=new_tid, result_id=new_rid,
                    data=src_bytes, suffix=suffix, kind="",
                )
                new_image_path = saved["path"]

        # Copy the warped-PNG sidecar if the source has one. Missing
        # bytes are silent — it's a derived cache.
        new_warped_path: str | None = None
        if src_warped_path:
            try:
                warped_bytes = images.read(src_warped_path)
            except FileNotFoundError:
                warped_bytes = None
            if warped_bytes is not None:
                saved_warped = images.save(
                    test_id=new_tid, result_id=new_rid,
                    data=warped_bytes, suffix=".png", kind="warped",
                )
                new_warped_path = saved_warped["path"]

        # Copy the HEIC→JPEG transcode cache sidecar (path convention
        # from commit 42bc588 — see images.save_at). Only meaningful
        # when the source is an HEIC; for other formats no sidecar exists.
        if (
            new_image_path
            and src_image_path
            and src_image_path.lower().endswith((".heic", ".heif"))
        ):
            src_cached = f"{src_image_path}.cached.jpg"
            try:
                cached_bytes = images.read(src_cached)
            except FileNotFoundError:
                cached_bytes = None
            if cached_bytes is not None:
                new_cached = f"{new_image_path}.cached.jpg"
                images.save_at(new_cached, cached_bytes)

        # Patch the row with the new paths now that storage writes are done.
        update_values: dict[str, Any] = {}
        if new_image_path is not None:
            update_values["image_path"] = new_image_path
        if new_warped_path is not None:
            update_values["warped_image_path"] = new_warped_path
        if update_values:
            s.execute(
                results.update()
                .where(results.c.id == new_rid)
                .values(**update_values)
            )
    return id_map


def _copy_palette_entries_pass_1(
    s, src: int, dst: int,
    tests_map: dict[int, int],
    materials_map: dict[int, int],
    results_map: dict[int, int],
) -> dict[int, int]:
    """Insert palette entries with all foreign keys remapped EXCEPT
    ``derived_from_entry_id`` — that's a self-FK and is nulled here,
    patched in pass 2."""
    rows = s.execute(
        select(palette_entries).where(palette_entries.c.owner_id == src)
    ).all()
    id_map: dict[int, int] = {}
    now = _now()
    for row in rows:
        d = _row_to_dict(row)
        old_id = d["id"]
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["material_id"] = materials_map[d["material_id"]]
        new_row["test_id"] = (
            tests_map[d["test_id"]] if d["test_id"] is not None else None
        )
        new_row["source_result_id"] = (
            results_map[d["source_result_id"]]
            if d["source_result_id"] is not None
            else None
        )
        new_row["validated_test_id"] = (
            tests_map[d["validated_test_id"]]
            if d["validated_test_id"] is not None
            else None
        )
        new_row["derived_from_entry_id"] = None  # patched in pass 2
        new_row["created_at"] = now
        res = s.execute(insert(palette_entries).values(**new_row))
        id_map[old_id] = int(res.inserted_primary_key[0])
    return id_map


def _copy_saved_spectrums_with_children(
    s, src: int, dst: int,
    tests_map: dict[int, int], materials_map: dict[int, int],
) -> int:
    """Saved spectrums + the two cascade-delete child tables. Each
    parent row gets a fresh id; we then fetch the source's children
    keyed by the old parent id and re-insert under the new parent id."""
    parent_rows = s.execute(
        select(saved_spectrums).where(saved_spectrums.c.owner_id == src)
    ).all()
    count = 0
    now = _now()
    for row in parent_rows:
        d = _row_to_dict(row)
        old_id = d["id"]
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["source_test_id"] = (
            tests_map[d["source_test_id"]]
            if d["source_test_id"] is not None
            else None
        )
        new_row["material_id"] = (
            materials_map[d["material_id"]]
            if d["material_id"] is not None
            else None
        )
        new_row["created_at"] = now
        res = s.execute(insert(saved_spectrums).values(**new_row))
        new_parent_id = int(res.inserted_primary_key[0])

        # Swatches.
        sw_rows = s.execute(
            select(saved_spectrum_swatches).where(
                saved_spectrum_swatches.c.saved_spectrum_id == old_id,
            )
        ).all()
        for sw in sw_rows:
            sw_d = _strip(_row_to_dict(sw), "id")
            sw_d["saved_spectrum_id"] = new_parent_id
            s.execute(insert(saved_spectrum_swatches).values(**sw_d))

        # Fit coefficients.
        co_rows = s.execute(
            select(saved_spectrum_fit_coefficients).where(
                saved_spectrum_fit_coefficients.c.saved_spectrum_id == old_id,
            )
        ).all()
        for co in co_rows:
            co_d = _strip(_row_to_dict(co), "id")
            co_d["saved_spectrum_id"] = new_parent_id
            s.execute(insert(saved_spectrum_fit_coefficients).values(**co_d))

        count += 1
    return count


def _copy_text_reg_machine(s, src: int, dst: int) -> int:
    rows = s.execute(
        select(text_reg_defaults_machine).where(
            text_reg_defaults_machine.c.owner_id == src,
        )
    ).all()
    now = _now()
    for row in rows:
        d = _row_to_dict(row)
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["created_at"] = now
        new_row["updated_at"] = now
        s.execute(insert(text_reg_defaults_machine).values(**new_row))
    return len(rows)


def _copy_text_reg_material(
    s, src: int, dst: int, materials_map: dict[int, int],
) -> int:
    rows = s.execute(
        select(text_reg_defaults_material).where(
            text_reg_defaults_material.c.owner_id == src,
        )
    ).all()
    now = _now()
    for row in rows:
        d = _row_to_dict(row)
        new_row = _strip(d, "id")
        new_row["owner_id"] = dst
        new_row["import_source"] = SEED_IMPORT_SOURCE
        new_row["material_id"] = materials_map[d["material_id"]]
        new_row["created_at"] = now
        new_row["updated_at"] = now
        s.execute(insert(text_reg_defaults_material).values(**new_row))
    return len(rows)


# ── Pass-2 patchers ──────────────────────────────────────────────────────────


def _patch_tests_self_refs(
    s, src: int, tests_map: dict[int, int],
) -> None:
    """Re-read the source tests, map their self-FK columns through the
    id map, and UPDATE the corresponding new rows."""
    if not tests_map:
        return
    rows = s.execute(
        select(
            tests.c.id,
            tests.c.source_test_id,
            tests.c.parent_test_id,
        ).where(tests.c.owner_id == src)
    ).all()
    for r in rows:
        old_id = int(r.id)
        new_id = tests_map[old_id]
        new_source = (
            tests_map[r.source_test_id]
            if r.source_test_id is not None and r.source_test_id in tests_map
            else None
        )
        new_parent = (
            tests_map[r.parent_test_id]
            if r.parent_test_id is not None and r.parent_test_id in tests_map
            else None
        )
        if new_source is None and new_parent is None:
            continue
        s.execute(
            tests.update()
            .where(tests.c.id == new_id)
            .values(
                source_test_id=new_source,
                parent_test_id=new_parent,
            )
        )


def _patch_palette_self_refs(
    s, src: int, palette_map: dict[int, int],
) -> None:
    if not palette_map:
        return
    rows = s.execute(
        select(
            palette_entries.c.id,
            palette_entries.c.derived_from_entry_id,
        ).where(palette_entries.c.owner_id == src)
    ).all()
    for r in rows:
        if r.derived_from_entry_id is None:
            continue
        new_id = palette_map[int(r.id)]
        new_derived = palette_map.get(int(r.derived_from_entry_id))
        if new_derived is None:
            continue
        s.execute(
            palette_entries.update()
            .where(palette_entries.c.id == new_id)
            .values(derived_from_entry_id=new_derived)
        )


def _patch_validation_cells_palette_fk(
    s,
    src: int,
    tests_map: dict[int, int],
    palette_map: dict[int, int],
) -> None:
    """validation_cells.palette_entry_id was nulled in pass 1 because
    palette_entries hadn't been copied yet. Walk the source cells, map
    their (test_id, cell_index) onto the destination side (test_id is
    remapped via ``tests_map``; cell_index is preserved verbatim), and
    UPDATE the dst row with the remapped palette_entry_id.
    """
    if not palette_map or not tests_map:
        return
    rows = s.execute(
        select(
            validation_cells.c.test_id,
            validation_cells.c.cell_index,
            validation_cells.c.palette_entry_id,
        )
        .join(tests, tests.c.id == validation_cells.c.test_id)
        .where(tests.c.owner_id == src)
    ).all()
    for r in rows:
        if r.palette_entry_id is None:
            continue
        new_palette_id = palette_map.get(int(r.palette_entry_id))
        if new_palette_id is None:
            continue
        new_test_id = tests_map.get(int(r.test_id))
        if new_test_id is None:
            continue
        s.execute(
            validation_cells.update()
            .where(
                and_(
                    validation_cells.c.test_id == new_test_id,
                    validation_cells.c.cell_index == int(r.cell_index),
                )
            )
            .values(palette_entry_id=new_palette_id)
        )
