"""Add warped_image_path column to results.

Caches the rectified burn-space image so the debug modal's per-row
strips and warped+grid overlay endpoints don't each re-run the full
ArUco/QR/perspective capture pipeline. The column is populated
lazily on first debug fetch; reingest + delete null it back out so
the cached file (and its sidecar on disk / S3) stays consistent
with the canonical photo.

Revision ID: 0014
Revises: 0013
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.add_column(sa.Column("warped_image_path", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.drop_column("warped_image_path")
