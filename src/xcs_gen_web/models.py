"""SQLAlchemy Core table definitions.

Storing spec/params/swatches as TEXT (opaque JSON) — they're consumed whole
by the app; no query filters on their internals. First-class columns are
reserved for fields that do appear in WHERE clauses.
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
)

metadata = MetaData()

materials = Table(
    "materials", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("notes", Text),
    Column("created_at", Text, nullable=False),
)

presets = Table(
    "presets", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("color", Text),
    Column("is_default", Integer, nullable=False, server_default="0"),
    Column("base_params_json", Text, nullable=False),
    Column("created_at", Text, nullable=False),
    Column("updated_at", Text, nullable=False),
    Index("ix_presets_material_id", "material_id"),
)

tests = Table(
    "tests", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("status", Text, nullable=False, server_default="created"),
    Column("spec_json", Text, nullable=False),
    Column("notes", Text, nullable=False, server_default=""),
    Column("created_at", Text, nullable=False),
    Column("updated_at", Text, nullable=False),
    Column("locked", Integer, nullable=False, server_default="0"),
    CheckConstraint("status IN ('created','tested','deleted')", name="tests_status_chk"),
    Index("ix_tests_material_id", "material_id"),
    Index("ix_tests_status", "status"),
)

results = Table(
    "results", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("uploaded_at", Text, nullable=False),
    Column("image_path", Text, nullable=False),
    Column("image_sha256", Text, nullable=False),
    Column("excluded", Integer, nullable=False, server_default="0"),
    Column("notes", Text, nullable=False, server_default=""),
    Column("swatches_json", Text, nullable=False),
    Index("ix_results_test_id", "test_id"),
)

palette_entries = Table(
    "palette_entries", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("x_value", Float),
    Column("y_value", Float),
    Column("hex", Text, nullable=False),
    Column("lab_l", Float, nullable=False),
    Column("lab_a", Float, nullable=False),
    Column("lab_b", Float, nullable=False),
    Column("params_json", Text, nullable=False),
    Column("sigma", Float, nullable=False),
    Column("source", Text, nullable=False),
    Column("source_result_id", Integer, ForeignKey("results.id")),
    Column("notes", Text, nullable=False, server_default=""),
    Column("created_at", Text, nullable=False),
    CheckConstraint(
        "source IN ('averaged','single_result')",
        name="palette_entries_source_chk",
    ),
    Index("ix_palette_entries_material_id", "material_id"),
    Index("ix_palette_entries_test_id", "test_id"),
)
