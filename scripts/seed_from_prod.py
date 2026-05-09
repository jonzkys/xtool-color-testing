#!/usr/bin/env python3
"""Seed a local xcs-gen SQLite DB from the production API.

Pulls materials, tests (including embedded validation cells), and
palette entries from a remote xcs-gen server and INSERTs them into the
local DB at ``XCS_GEN_DB_URL`` (default ``~/.xcs-gen/app.db``). Indices
are recomputed under the local code's current formula version, and
two lineage backfill passes are run identically to migration 0024:

- ``tests.source_test_id`` <- modal ``palette_entries.test_id`` of each
  validation test's cells.
- ``palette_entries.derived_from_entry_id`` <- the source cell's
  ``palette_entry_id`` resolved by ``(validated_test_id,
  validated_cell_index)``.

Defaults are tuned for the canonical dev workflow:

- Server: ``https://api.engraving.media`` (override with ``--api-url``).
- Auth: ``X-User-Id`` header carrying an API key (the local server
  runs in standalone mode by default and consumes any ``owner_id`` as
  ``STANDALONE_USER_ID = 0``, so this script rewrites every
  ``owner_id`` to 0 on insert).

Run it after a fresh ``alembic upgrade head`` against an EMPTY local DB
(or pass ``--wipe`` to truncate the four target tables first). Existing
rows on those tables will collide on PK and the script will abort.

Usage:

    XCS_GEN_API_KEY=fsp9KYfD7zRUL507 \\
      uv run --active python scripts/seed_from_prod.py

    # or with overrides:
    uv run --active python scripts/seed_from_prod.py \\
        --api-url https://api.engraving.media \\
        --api-key fsp9KYfD7zRUL507 \\
        --db ~/.xcs-gen/app.db \\
        --wipe

The script is idempotent IF you pass --wipe (it'll DELETE FROM the
target tables before inserting). Otherwise it's a one-shot fresh-DB
seeder.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import Counter
from typing import Any

# Make the local source tree importable so we can call compute_indices.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
sys.path.insert(0, os.path.join(_REPO_ROOT, "src"))

from xcs_gen.laser_indices import INDICES_FORMULA_VERSION, compute_indices  # noqa: E402
from xcs_gen.model import ProcessingParams  # noqa: E402

DEFAULT_API_URL = "https://api.engraving.media"
DEFAULT_DB_PATH = os.path.expanduser("~/.xcs-gen/app.db")
STANDALONE_USER_ID = 0


def _http_get(url: str, api_key: str) -> Any:
    req = urllib.request.Request(url, headers={"X-User-Id": api_key})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"GET {url} failed: HTTP {e.code} {msg}") from e


def fetch_prod(api_url: str, api_key: str) -> dict[str, Any]:
    print(f"  fetching materials from {api_url}/api/materials")
    materials = _http_get(f"{api_url}/api/materials", api_key)
    print(f"  fetching tests from {api_url}/api/tests")
    tests = _http_get(f"{api_url}/api/tests", api_key)
    print(f"  fetching palette from {api_url}/api/palette")
    palette = _http_get(f"{api_url}/api/palette", api_key)
    return {"materials": materials, "tests": tests, "palette": palette}


def wipe_target_tables(conn: sqlite3.Connection) -> None:
    # Order matters: child tables first to avoid FK violations under the
    # default `PRAGMA foreign_keys = ON` setting.
    for table in ("validation_cells", "palette_entries", "tests", "materials"):
        conn.execute(f"DELETE FROM {table}")
    conn.commit()


def insert_materials(conn: sqlite3.Connection, materials: list[dict[str, Any]]) -> int:
    for m in materials:
        conn.execute(
            "INSERT INTO materials (id, name, notes, created_at, owner_id, "
            "visibility, shape, diameter_mm, width_mm, height_mm, is_default) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                m["id"], m["name"], m.get("notes") or "", m["created_at"],
                STANDALONE_USER_ID, m.get("visibility") or "private",
                m.get("shape"), m.get("diameter_mm"), m.get("width_mm"),
                m.get("height_mm"),
                1 if m.get("is_default") else 0,
            ),
        )
    conn.commit()
    return len(materials)


def insert_tests(conn: sqlite3.Connection, tests: list[dict[str, Any]]) -> int:
    for t in tests:
        conn.execute(
            "INSERT INTO tests (id, name, material_id, status, kind, "
            "spec_json, notes, created_at, updated_at, locked, owner_id, "
            "visibility, retest_index, machine_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                t["id"], t["name"], t["material_id"], t["status"],
                t.get("kind") or "sweep",
                json.dumps(t["spec"], separators=(",", ":")),
                t.get("notes") or "", t["created_at"], t["updated_at"],
                1 if t.get("locked") else 0,
                STANDALONE_USER_ID, t.get("visibility") or "private",
                int(t.get("retest_index") or 0),
                t.get("machine_id") or "F2Ultra",
            ),
        )
    conn.commit()
    return len(tests)


def insert_validation_cells(conn: sqlite3.Connection, tests: list[dict[str, Any]]) -> int:
    inserted = 0
    for t in tests:
        if (t.get("kind") or "sweep") != "validation":
            continue
        for c in (t.get("validation_cells") or []):
            lab = c.get("expected_lab") or [0.0, 0.0, 0.0]
            conn.execute(
                "INSERT INTO validation_cells (id, test_id, cell_index, "
                "palette_entry_id, expected_hex, expected_lab_l, "
                "expected_lab_a, expected_lab_b, params_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    c["id"], c["test_id"], c["cell_index"],
                    c.get("palette_entry_id"), c["expected_hex"],
                    lab[0], lab[1], lab[2],
                    json.dumps(c.get("params") or {}, separators=(",", ":")),
                ),
            )
            inserted += 1
    conn.commit()
    return inserted


def insert_palette_entries(conn: sqlite3.Connection, palette: list[dict[str, Any]]) -> tuple[int, list[tuple[int, str]]]:
    defaults = ProcessingParams()
    inserted = 0
    skipped: list[tuple[int, str]] = []
    for e in palette:
        p = e.get("params") or {}
        try:
            params = ProcessingParams(
                speed=p.get("speed", defaults.speed),
                power=p.get("power", defaults.power),
                density=p.get("density", defaults.density),
                mopa_frequency=p.get(
                    "mopa_frequency",
                    p.get("frequency", defaults.mopa_frequency),
                ),
                pulse_width=p.get("pulse_width", defaults.pulse_width),
                repeat=p.get("repeat", p.get("passes", defaults.repeat)),
            )
            idx = compute_indices(params)
            idx_vals = (
                idx.pulse_spacing_mm, idx.line_spacing_mm,
                idx.pulse_energy_index, idx.pulse_intensity_index,
                idx.total_exposure_index, idx.ablation_aggression_index,
                idx.delivery_smoothness_index,
                INDICES_FORMULA_VERSION, idx.density_model, idx.power_model,
            )
        except Exception as exc:  # noqa: BLE001 - best-effort recompute
            skipped.append((e["id"], str(exc)))
            idx_vals = (
                None, None, None, None, None, None, None,
                0, "opaque", "controller_percent",
            )

        lab = e.get("lab") or [0.0, 0.0, 0.0]
        vlab = e.get("validated_lab") or [None, None, None]
        conn.execute(
            "INSERT INTO palette_entries ("
            "id, test_id, material_id, x_value, y_value, hex, lab_l, lab_a, "
            "lab_b, params_json, sigma, source, source_result_id, notes, "
            "created_at, owner_id, visibility, favorited, machine_id, "
            "is_validated, validated_at, validated_test_id, "
            "validated_lab_l, validated_lab_a, validated_lab_b, "
            "validated_run_count, validated_residual_de, "
            "validated_cell_index, derived_from_entry_id, "
            "pulse_spacing_mm, line_spacing_mm, pulse_energy_index, "
            "pulse_intensity_index, total_exposure_index, "
            "ablation_aggression_index, delivery_smoothness_index, "
            "indices_formula_version, density_model, power_model"
            ") VALUES ("
            "?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?"
            ")",
            (
                e["id"], e.get("test_id"), e["material_id"],
                e.get("x_value"), e.get("y_value"),
                e["hex"], lab[0], lab[1], lab[2],
                json.dumps(p, separators=(",", ":")),
                e.get("sigma") or 0.0, e.get("source") or "manual",
                e.get("source_result_id"),
                e.get("notes") or "", e["created_at"],
                STANDALONE_USER_ID, e.get("visibility") or "private",
                1 if e.get("favorited") else 0,
                e.get("machine_id") or "F2Ultra",
                1 if e.get("is_validated") else 0,
                e.get("validated_at"), e.get("validated_test_id"),
                vlab[0], vlab[1], vlab[2],
                e.get("validated_run_count"),
                e.get("validated_residual_de"),
                e.get("validated_cell_index"),
                None,  # derived_from_entry_id — backfilled in a second pass
                *idx_vals,
            ),
        )
        inserted += 1
    conn.commit()
    return inserted, skipped


def backfill_source_test_id(conn: sqlite3.Connection) -> int:
    """Same logic as migration 0024 phase 2."""
    val_ids = [
        r[0]
        for r in conn.execute("SELECT id FROM tests WHERE kind='validation'")
    ]
    set_count = 0
    for tid in val_ids:
        rows = conn.execute(
            "SELECT pe.test_id FROM validation_cells vc "
            "JOIN palette_entries pe ON pe.id = vc.palette_entry_id "
            "WHERE vc.test_id = ? AND vc.palette_entry_id IS NOT NULL",
            (tid,),
        ).fetchall()
        counts = Counter(r[0] for r in rows if r[0] is not None)
        if counts:
            modal = counts.most_common(1)[0][0]
            conn.execute(
                "UPDATE tests SET source_test_id = ? WHERE id = ?",
                (modal, tid),
            )
            set_count += 1
    conn.commit()
    return set_count


def backfill_derived_from_entry_id(conn: sqlite3.Connection) -> int:
    """Same logic as migration 0024 phase 3."""
    rows = conn.execute(
        "SELECT pe.id, pe.validated_test_id, pe.validated_cell_index "
        "FROM palette_entries pe "
        "WHERE pe.validated_test_id IS NOT NULL "
        "AND pe.validated_cell_index IS NOT NULL",
    ).fetchall()
    set_count = 0
    for pid, vt, vci in rows:
        cell = conn.execute(
            "SELECT palette_entry_id FROM validation_cells "
            "WHERE test_id = ? AND cell_index = ?",
            (vt, vci),
        ).fetchone()
        if cell and cell[0] is not None:
            conn.execute(
                "UPDATE palette_entries SET derived_from_entry_id = ? "
                "WHERE id = ?",
                (cell[0], pid),
            )
            set_count += 1
    conn.commit()
    return set_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--api-url", default=DEFAULT_API_URL,
                        help=f"Production API URL (default {DEFAULT_API_URL})")
    parser.add_argument("--api-key",
                        default=os.environ.get("XCS_GEN_API_KEY"),
                        help="API key (or env XCS_GEN_API_KEY). Sent as X-User-Id.")
    parser.add_argument("--db", default=DEFAULT_DB_PATH,
                        help=f"Local SQLite DB path (default {DEFAULT_DB_PATH})")
    parser.add_argument("--wipe", action="store_true",
                        help="DELETE FROM materials/tests/palette_entries/"
                        "validation_cells before seeding (idempotent reuse).")
    args = parser.parse_args()

    if not args.api_key:
        parser.error("--api-key (or XCS_GEN_API_KEY env) is required")

    print(f"Pulling from {args.api_url} → {args.db}")
    data = fetch_prod(args.api_url, args.api_key)
    print(f"  fetched: materials={len(data['materials'])} "
          f"tests={len(data['tests'])} palette={len(data['palette'])}")

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")

    if args.wipe:
        print("Wiping existing rows on materials/tests/palette_entries/validation_cells")
        wipe_target_tables(conn)

    print("Inserting materials")
    n_mats = insert_materials(conn, data["materials"])
    print(f"  inserted {n_mats} materials")

    print("Inserting tests")
    n_tests = insert_tests(conn, data["tests"])
    print(f"  inserted {n_tests} tests")

    # Palette entries must land before validation cells: cells carry
    # an FK to palette_entries.id.
    print("Inserting palette entries (recomputing indices via "
          f"compute_indices, formula v{INDICES_FORMULA_VERSION})")
    n_pal, skipped = insert_palette_entries(conn, data["palette"])
    print(f"  inserted {n_pal} palette entries "
          f"({len(skipped)} skipped → formula_version=0)")

    print("Inserting validation cells")
    n_cells = insert_validation_cells(conn, data["tests"])
    print(f"  inserted {n_cells} cells")

    print("Backfilling tests.source_test_id")
    n_src = backfill_source_test_id(conn)
    print(f"  set on {n_src} validation tests")

    print("Backfilling palette_entries.derived_from_entry_id")
    n_derived = backfill_derived_from_entry_id(conn)
    print(f"  set on {n_derived} palette entries")

    conn.close()
    print()
    print("Done. The local server should now show prod data with the "
          "current schema applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
