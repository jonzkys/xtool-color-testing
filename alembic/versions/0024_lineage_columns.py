"""lineage columns: tests + palette_entries

Revision ID: 0024
Revises: 0023
Create Date: 2026-05-09

tests gains source_test_id, parent_test_id, tag (nullable, FK self-referential).
palette_entries gains derived_from_entry_id and drops line_spacing_index.
"""
from alembic import op
import sqlalchemy as sa


revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('palette_entries', schema=None) as batch_op:
        batch_op.add_column(sa.Column('derived_from_entry_id', sa.Integer(), nullable=True))
        batch_op.create_index('ix_palette_entries_derived_from', ['derived_from_entry_id'], unique=False)
        batch_op.drop_column('line_spacing_index')

    with op.batch_alter_table('tests', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source_test_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('parent_test_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('tag', sa.String(length=64), nullable=True))
        batch_op.create_index('ix_tests_source_test_id', ['source_test_id'], unique=False)
        batch_op.create_index('ix_tests_parent_test_id', ['parent_test_id'], unique=False)
        batch_op.create_index('ix_tests_tag', ['tag'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('tests', schema=None) as batch_op:
        batch_op.drop_index('ix_tests_tag')
        batch_op.drop_index('ix_tests_parent_test_id')
        batch_op.drop_index('ix_tests_source_test_id')
        batch_op.drop_column('tag')
        batch_op.drop_column('parent_test_id')
        batch_op.drop_column('source_test_id')

    with op.batch_alter_table('palette_entries', schema=None) as batch_op:
        batch_op.add_column(sa.Column('line_spacing_index', sa.FLOAT(), nullable=True))
        batch_op.drop_index('ix_palette_entries_derived_from')
        batch_op.drop_column('derived_from_entry_id')
