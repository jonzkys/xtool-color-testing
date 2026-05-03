"""Backfill palette_entries.params_json with angle_mode + crosshatch.

PR #38 added these fields to the ingest path so a palette entry could
faithfully reproduce its source burn (a "fixed x2" colour is not the
same colour as a "crosshatch x2" — twice the strokes, alternating
orientations). Pre-#38 entries don't carry the fields; their owners
can't reliably reburn them and validation tests can't reproduce them
without falling back to the test-level defaults.

This migration walks every palette_entry whose params_json is missing
either field, looks up its source test (via test_id), and copies
spec.angle_mode + spec.crosshatch into the entry's params blob.

Manual entries (test_id IS NULL) are left untouched — there's no
source test to read from. Their owners can fill the fields in via the
PaletteEntryDialog now that ingest persists them too.

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def _backfill_params(
    params: dict, spec_angle_mode: str, spec_crosshatch: bool,
) -> tuple[dict, bool]:
    """Add angle_mode/crosshatch to ``params`` if absent. Returns the
    (possibly mutated) dict and a flag indicating whether the row needs
    to be written back. Idempotent: a second pass over an already-
    backfilled row does nothing.

    Legacy ``angle_mode="crosshatch"`` is also snapped to the modern
    pair (``angle_mode="fixed"``, ``crosshatch=True``) — same shape the
    ingest endpoint writes today, so the reader code can drop the
    legacy branch.
    """
    changed = False

    # Snap legacy crosshatch sentinel.
    if params.get("angle_mode") == "crosshatch":
        params["angle_mode"] = "fixed"
        params["crosshatch"] = True
        changed = True

    if "angle_mode" not in params:
        params["angle_mode"] = spec_angle_mode
        changed = True
    if "crosshatch" not in params:
        params["crosshatch"] = bool(spec_crosshatch)
        changed = True
    return params, changed


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            "SELECT pe.id, pe.params_json, t.spec_json "
            "FROM palette_entries AS pe "
            "JOIN tests AS t ON t.id = pe.test_id "
            "WHERE pe.test_id IS NOT NULL"
        )
    ).fetchall()

    for row in rows:
        try:
            params = json.loads(row.params_json)
            spec = json.loads(row.spec_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(params, dict) or not isinstance(spec, dict):
            continue
        spec_angle_mode = spec.get("angle_mode") or "fixed"
        spec_crosshatch = bool(spec.get("crosshatch", False))
        # The ingest endpoint also snaps legacy angle_mode="crosshatch"
        # to (fixed, True) before writing; mirror that so the source
        # spec can't pollute the backfill with an obsolete sentinel.
        if spec_angle_mode == "crosshatch":
            spec_angle_mode = "fixed"
            spec_crosshatch = True
        params, changed = _backfill_params(params, spec_angle_mode, spec_crosshatch)
        if changed:
            conn.execute(
                sa.text(
                    "UPDATE palette_entries SET params_json = :v WHERE id = :id"
                ).bindparams(
                    v=json.dumps(params, separators=(",", ":")),
                    id=row.id,
                )
            )


def downgrade() -> None:
    """Strip the two fields out of every palette_entries.params_json.

    Mirrors upgrade — pulls the keys out so the schema is back to the
    pre-#38 shape. Manual entries that always had them filled in (added
    after the upgrade) lose them too: the downgrade can't tell them
    apart, and that's an acceptable cost for a development migration."""
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, params_json FROM palette_entries")
    ).fetchall()
    for row in rows:
        try:
            params = json.loads(row.params_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(params, dict):
            continue
        changed = False
        if "angle_mode" in params:
            params.pop("angle_mode")
            changed = True
        if "crosshatch" in params:
            params.pop("crosshatch")
            changed = True
        if changed:
            conn.execute(
                sa.text(
                    "UPDATE palette_entries SET params_json = :v WHERE id = :id"
                ).bindparams(
                    v=json.dumps(params, separators=(",", ":")),
                    id=row.id,
                )
            )
