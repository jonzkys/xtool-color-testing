"""Add results.missing_markers_json column.

Tracks which ArUco fiducials (subset of IDs 1/2/3) were not detected at
ingest time. Empty list means all three were detected — the homography
is well-constrained on every corner. A non-empty list means some
quadrant of the burn was extrapolated rather than measured; the UI
surfaces this so users know the affected colours may be inaccurate.

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.add_column(
            sa.Column(
                "missing_markers_json",
                sa.Text,
                nullable=False,
                server_default="[]",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("results") as batch:
        batch.drop_column("missing_markers_json")
