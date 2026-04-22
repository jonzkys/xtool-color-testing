"""integer user ids

Turns the users table into a proper relational surface:

* ``users.id`` becomes the autoincrement primary key.
* ``users.api_key`` becomes a unique-indexed column (was PK).
* ``materials/presets/tests/results/palette_entries.owner_id`` becomes
  ``INTEGER`` (was TEXT, storing the api_key verbatim). Rows are
  rewritten to reference ``users.id`` wherever the old owner_id
  matched a user; the standalone sentinel maps to 0; orphan rows
  (owner_id referenced a non-existent key — shouldn't happen in a
  consistent DB) map to 0.

All data-touching SQL is parameterized; no string-formatting of
user-derived content. Designed to work on both SQLite (via batch
mode, which alembic invokes automatically when ``render_as_batch`` is
on) and MySQL (via native ALTER TABLE). The alembic env.py picks the
right rendering based on dialect.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-22
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


_DATA_TABLES = ("materials", "presets", "tests", "results", "palette_entries")
_STANDALONE_LEGACY = "_standalone"
_STANDALONE_NEW = 0


def _snapshot_users(conn) -> list[dict]:
    """Grab all existing users.rows before we rebuild the table."""
    rows = conn.execute(
        sa.text(
            "SELECT api_key, first_name, created_at, last_seen_at FROM users"
        )
    ).fetchall()
    return [
        {
            "api_key": r.api_key,
            "first_name": r.first_name,
            "created_at": r.created_at,
            "last_seen_at": r.last_seen_at,
        }
        for r in rows
    ]


def upgrade() -> None:
    conn = op.get_bind()

    # --- 1. Snapshot existing users so we can re-insert them with new ids.
    old_users = _snapshot_users(conn)

    # --- 2. Recreate the users table with id as the PK.
    # Both dialects are happy to drop and recreate here — batch_alter_table
    # can't handle "demote the PK to a unique index" as a single in-place
    # op, so a clean rebuild is the portable answer.
    op.drop_table("users")
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("api_key", sa.String(length=32), nullable=False),
        sa.Column(
            "first_name", sa.String(length=64),
            nullable=False, server_default="",
        ),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("last_seen_at", sa.String(length=40), nullable=False),
    )
    op.create_index(
        "ix_users_api_key", "users", ["api_key"], unique=True,
    )

    # --- 3. Re-insert users. Build api_key -> new integer id map as we go.
    key_to_id: dict[str, int] = {}
    for u in old_users:
        result = conn.execute(
            sa.text(
                "INSERT INTO users (api_key, first_name, created_at, last_seen_at) "
                "VALUES (:api_key, :first_name, :created_at, :last_seen_at)"
            ),
            u,
        )
        new_id = result.lastrowid  # type: ignore[attr-defined]
        if new_id is None:
            # Fallback — some drivers don't fill lastrowid for Core inserts.
            row = conn.execute(
                sa.text("SELECT id FROM users WHERE api_key = :k"),
                {"k": u["api_key"]},
            ).one()
            new_id = row.id
        key_to_id[u["api_key"]] = int(new_id)

    # --- 4. For each data table: add INTEGER owner_id_new, backfill, swap.
    for table in _DATA_TABLES:
        # 4a. Drop the existing ix_<table>_owner index (it indexes a TEXT
        # column we're about to rebuild).
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f"ix_{table}_owner")

        # 4b. Add the new integer column (nullable while we backfill).
        with op.batch_alter_table(table) as batch:
            batch.add_column(
                sa.Column("owner_id_new", sa.Integer(), nullable=True),
            )

        # 4c. Backfill in three scoped UPDATEs — each uses parameterized
        #     bindings, no string interpolation of DB values.
        # Standalone rows → reserved sentinel 0.
        conn.execute(
            sa.text(
                f"UPDATE {table} SET owner_id_new = :new "
                "WHERE owner_id = :old"
            ),
            {"new": _STANDALONE_NEW, "old": _STANDALONE_LEGACY},
        )
        # Per-user rows — one update per known api_key. Cheap even for
        # hundreds of users because we scope each update by the key.
        for api_key, new_id in key_to_id.items():
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET owner_id_new = :new "
                    "WHERE owner_id = :old"
                ),
                {"new": new_id, "old": api_key},
            )
        # Orphan rows (owner_id referenced a non-existent key). Route to
        # the standalone sentinel so nothing is silently lost and the
        # column becomes NOT-NULL-safe in the next step.
        conn.execute(
            sa.text(
                f"UPDATE {table} SET owner_id_new = :new "
                "WHERE owner_id_new IS NULL"
            ),
            {"new": _STANDALONE_NEW},
        )

        # 4d. Make owner_id_new NOT NULL and drop the legacy column.
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "owner_id_new",
                existing_type=sa.Integer(),
                nullable=False,
            )
            batch.drop_column("owner_id")

        # 4e. Rename owner_id_new -> owner_id (separate batch because
        #     mixing rename with drop in the same batch is flaky on
        #     dialects that use different rewrite strategies).
        #     existing_type is mandatory on MySQL — CHANGE COLUMN is a
        #     full redefine, not a delta, so we must re-state the type.
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "owner_id_new",
                new_column_name="owner_id",
                existing_type=sa.Integer(),
                existing_nullable=False,
            )

        # 4f. Recreate the index on the new column.
        op.create_index(
            f"ix_{table}_owner", table, ["owner_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()

    # Pull current users to reconstruct the TEXT owner_id values on data tables.
    id_to_key: dict[int, str] = {}
    for r in conn.execute(sa.text("SELECT id, api_key FROM users")).fetchall():
        id_to_key[int(r.id)] = r.api_key

    # Reverse the data-table changes: owner_id INT -> TEXT.
    for table in reversed(_DATA_TABLES):
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f"ix_{table}_owner")
        with op.batch_alter_table(table) as batch:
            batch.add_column(
                sa.Column("owner_id_text", sa.Text(), nullable=True),
            )

        conn.execute(
            sa.text(
                f"UPDATE {table} SET owner_id_text = :old "
                "WHERE owner_id = :new"
            ),
            {"old": _STANDALONE_LEGACY, "new": _STANDALONE_NEW},
        )
        for uid, api_key in id_to_key.items():
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET owner_id_text = :old "
                    "WHERE owner_id = :new"
                ),
                {"old": api_key, "new": uid},
            )

        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "owner_id_text", existing_type=sa.Text(), nullable=False,
            )
            batch.drop_column("owner_id")
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "owner_id_text",
                new_column_name="owner_id",
                existing_type=sa.Text(),
                existing_nullable=False,
            )
        op.create_index(f"ix_{table}_owner", table, ["owner_id"])

    # Restore the old users schema (api_key as PK).
    old_rows = conn.execute(
        sa.text(
            "SELECT api_key, first_name, created_at, last_seen_at FROM users"
        )
    ).fetchall()
    op.drop_index("ix_users_api_key", table_name="users")
    op.drop_table("users")
    op.create_table(
        "users",
        sa.Column("api_key", sa.Text(), nullable=False),
        sa.Column(
            "first_name", sa.Text(),
            nullable=False, server_default="",
        ),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("api_key"),
    )
    for r in old_rows:
        conn.execute(
            sa.text(
                "INSERT INTO users (api_key, first_name, created_at, last_seen_at) "
                "VALUES (:api_key, :first_name, :created_at, :last_seen_at)"
            ),
            {
                "api_key": r.api_key,
                "first_name": r.first_name,
                "created_at": r.created_at,
                "last_seen_at": r.last_seen_at,
            },
        )
