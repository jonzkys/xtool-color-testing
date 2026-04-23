"""users.mobile_id and results.via

Adds the ``mobile_id`` column to ``users`` (nullable, unique-indexed —
populated lazily on first request) so the QR-paired mobile upload page
has a per-user bearer token that is independent from the api_key.

Adds a ``via`` column to ``results`` ('desktop' | 'mobile', default
'desktop') so the desktop polling endpoint can filter to only the
mobile-arrived rows when surfacing them under the QR.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-23
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("mobile_id", sa.String(length=32), nullable=True),
        )
    op.create_index(
        "ix_users_mobile_id", "users", ["mobile_id"], unique=True,
    )

    with op.batch_alter_table("results") as batch:
        batch.add_column(
            sa.Column(
                "via", sa.String(length=16),  # 'desktop'|'mobile'; max 16
                nullable=False, server_default="desktop",
            ),
        )
    with op.batch_alter_table("results") as batch:
        batch.create_check_constraint(
            "results_via_chk", "via IN ('desktop','mobile')",
        )


def downgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.drop_constraint("results_via_chk", type_="check")
    with op.batch_alter_table("results") as batch:
        batch.drop_column("via")
    op.drop_index("ix_users_mobile_id", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("mobile_id")
