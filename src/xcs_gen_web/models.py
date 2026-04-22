"""SQLAlchemy Core table definitions.

Storing spec/params/swatches as TEXT (opaque JSON) — they're consumed whole
by the app; no query filters on their internals. First-class columns are
reserved for fields that do appear in WHERE clauses.

Multi-user scoping: every row carries ``owner_id`` (integer primary key
of the owning user in ``users.id``) and ``visibility``. Standalone
deployments use the reserved sentinel ``0``; multi-user deployments
resolve the id from the api_key on each request.

Portability: column lengths are explicit (``String(N)`` not ``Text``)
wherever the column is indexed, primary-keyed, or otherwise needs a
fixed width for MySQL — InnoDB refuses to index TEXT without a prefix,
and fixed-width keys are much cheaper to compare under B-tree lookups.
Payload columns that are read whole stay as ``Text`` (effectively
unlimited on both dialects).
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
    String,
    Table,
    Text,
)

metadata = MetaData()

# Shared constraint sql — applied per-table so the value stays consistent
# across inserts regardless of which writer populated the row.
_VISIBILITY_CHECK = "visibility IN ('private','public')"

# Standard column sizes. Kept here (not magic numbers scattered through
# the file) so future widening is a single edit.
_API_KEY_LEN = 32        # current keys are 16 chars; 32 gives headroom.
_NAME_LEN = 64
_ISO_TS_LEN = 40         # ISO 8601 w/ timezone offset fits in well under 40
_VISIBILITY_LEN = 16
_COLOR_HEX_LEN = 16      # "#rrggbb" + headroom
_STATUS_LEN = 16


# Users table. Alpha-level "bearer-token is the identity" auth.
#
# ``id`` is the canonical user id, referenced by ``owner_id`` on every
# other table. ``api_key`` is the credential shown to the user and sent
# in the X-User-Id header; it's indexed for fast header→user lookups
# but can be rotated without touching any data rows because the data
# tables reference ``id`` (never the api_key).
#
# NOTE on key storage: api_key is stored in plaintext by design —
# indexed exact-match lookup is required on every authenticated
# request. A future auth upgrade (Cognito / properly-hashed secrets)
# will replace the key comparison with an out-of-band verifier and
# this column becomes either empty or a Cognito sub.
users = Table(
    "users", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("api_key", String(_API_KEY_LEN), nullable=False, unique=True),
    Column("first_name", String(_NAME_LEN), nullable=False, server_default=""),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("last_seen_at", String(_ISO_TS_LEN), nullable=False),
    Index("ix_users_api_key", "api_key", unique=True),
)


materials = Table(
    "materials", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(_NAME_LEN), nullable=False),
    Column("notes", Text),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    CheckConstraint(_VISIBILITY_CHECK, name="materials_visibility_chk"),
    Index("ix_materials_owner", "owner_id"),
)

presets = Table(
    "presets", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("name", String(_NAME_LEN), nullable=False),
    Column("color", String(_COLOR_HEX_LEN)),
    Column("is_default", Integer, nullable=False, server_default="0"),
    Column("base_params_json", Text, nullable=False),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("updated_at", String(_ISO_TS_LEN), nullable=False),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    CheckConstraint(_VISIBILITY_CHECK, name="presets_visibility_chk"),
    Index("ix_presets_material_id", "material_id"),
    Index("ix_presets_owner", "owner_id"),
)

tests = Table(
    "tests", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(_NAME_LEN), nullable=False),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("status", String(_STATUS_LEN), nullable=False, server_default="created"),
    Column("spec_json", Text, nullable=False),
    Column("notes", Text, nullable=False, server_default=""),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("updated_at", String(_ISO_TS_LEN), nullable=False),
    Column("locked", Integer, nullable=False, server_default="0"),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    CheckConstraint("status IN ('created','tested','deleted')", name="tests_status_chk"),
    CheckConstraint(_VISIBILITY_CHECK, name="tests_visibility_chk"),
    Index("ix_tests_material_id", "material_id"),
    Index("ix_tests_status", "status"),
    Index("ix_tests_owner", "owner_id"),
)

results = Table(
    "results", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("uploaded_at", String(_ISO_TS_LEN), nullable=False),
    Column("image_path", Text, nullable=False),
    Column("image_sha256", String(64), nullable=False),
    Column("excluded", Integer, nullable=False, server_default="0"),
    Column("notes", Text, nullable=False, server_default=""),
    Column("swatches_json", Text, nullable=False),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    CheckConstraint(_VISIBILITY_CHECK, name="results_visibility_chk"),
    Index("ix_results_test_id", "test_id"),
    Index("ix_results_owner", "owner_id"),
)

palette_entries = Table(
    "palette_entries", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=False),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=False),
    Column("x_value", Float),
    Column("y_value", Float),
    Column("hex", String(_COLOR_HEX_LEN), nullable=False),
    Column("lab_l", Float, nullable=False),
    Column("lab_a", Float, nullable=False),
    Column("lab_b", Float, nullable=False),
    Column("params_json", Text, nullable=False),
    Column("sigma", Float, nullable=False),
    Column("source", String(_STATUS_LEN), nullable=False),
    Column("source_result_id", Integer, ForeignKey("results.id")),
    Column("notes", Text, nullable=False, server_default=""),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    CheckConstraint(
        "source IN ('averaged','single_result')",
        name="palette_entries_source_chk",
    ),
    CheckConstraint(_VISIBILITY_CHECK, name="palette_entries_visibility_chk"),
    Index("ix_palette_entries_material_id", "material_id"),
    Index("ix_palette_entries_test_id", "test_id"),
    Index("ix_palette_entries_owner", "owner_id"),
)
