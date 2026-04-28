"""Add is_default flag to materials.

Powers the new "preferred material" pill on the Library page — the
flagged material pre-fills the picker on the new-test page so users
who mostly burn one substrate don't reselect on every test. At most
one material per owner has ``is_default=1``; the repository's
``set_default`` clears the flag on the previous holder before
promoting.

Revision ID: 0013
Revises: 0012
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("materials") as batch:
        batch.add_column(
            sa.Column(
                "is_default", sa.Integer(),
                nullable=False, server_default="0",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("materials") as batch:
        batch.drop_column("is_default")
