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
    Boolean,
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
    UniqueConstraint,
)

metadata = MetaData()

# Shared constraint sql — applied per-table so the value stays consistent
# across inserts regardless of which writer populated the row.
_VISIBILITY_CHECK = "visibility IN ('private','public')"
_VIA_CHECK = "via IN ('desktop','mobile')"

# Standard column sizes. Kept here (not magic numbers scattered through
# the file) so future widening is a single edit.
_API_KEY_LEN = 32        # current keys are 16 chars; 32 gives headroom.
_NAME_LEN = 64
_ISO_TS_LEN = 40         # ISO 8601 w/ timezone offset fits in well under 40
_CHANGE_ID_LEN = 80      # changelog entry ids are "YYYY-MM-DD-slug" — 80 fits generous slugs
_VISIBILITY_LEN = 16
_COLOR_HEX_LEN = 16      # "#rrggbb" + headroom
_STATUS_LEN = 16
_MACHINE_ID_LEN = 32     # registry ids are short ASCII (e.g. "F2Ultra"); 32 = headroom


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
    Column("mobile_id", String(_API_KEY_LEN), nullable=True),
    # ID of the most recent changelog entry this user has dismissed.
    # NULL means "never viewed the changelog" — frontend treats all
    # current entries as unseen.
    Column("last_seen_change_id", String(_CHANGE_ID_LEN), nullable=True),
    Index("ix_users_api_key", "api_key", unique=True),
    Index("ix_users_mobile_id", "mobile_id", unique=True),
)


materials = Table(
    "materials", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(_NAME_LEN), nullable=False),
    Column("notes", Text),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    Column("owner_id", Integer, nullable=False),
    Column("visibility", String(_VISIBILITY_LEN), nullable=False, server_default="private"),
    # Optional physical-shape metadata. Drives the new Tests-page
    # auto-fit feature: when set, generators size a test to fit the
    # material's footprint (minus user buffer) without the user having
    # to type the dimensions. ``shape`` discriminates which dimension
    # column is meaningful — circle uses diameter_mm, rect uses width_mm
    # + height_mm. All four columns are nullable so existing materials
    # require no backfill.
    Column("shape", String(8), nullable=True),
    Column("diameter_mm", Float, nullable=True),
    Column("width_mm", Float, nullable=True),
    Column("height_mm", Float, nullable=True),
    # Per-owner "preferred" material — pre-fills the picker on the new
    # test page. At most one material per owner has ``is_default=1``;
    # promoting a material clears the flag on the previous one.
    Column("is_default", Integer, nullable=False, server_default="0"),
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
    Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
    CheckConstraint(_VISIBILITY_CHECK, name="presets_visibility_chk"),
    Index("ix_presets_material_id", "material_id"),
    Index("ix_presets_owner", "owner_id"),
    Index("ix_presets_owner_machine", "owner_id", "machine_id"),
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
    # Monotonic counter incremented by POST /api/tests/{id}/retest. The
    # current value is stamped into the generated XCS's QR payload so
    # each burn carries a label; ingest copies it onto the result row.
    Column("retest_index", Integer, nullable=False, server_default="0"),
    Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
    CheckConstraint("status IN ('created','tested','deleted')", name="tests_status_chk"),
    CheckConstraint(_VISIBILITY_CHECK, name="tests_visibility_chk"),
    Index("ix_tests_material_id", "material_id"),
    Index("ix_tests_status", "status"),
    Index("ix_tests_owner", "owner_id"),
    Index("ix_tests_owner_machine", "owner_id", "machine_id"),
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
    Column("via", String(_STATUS_LEN), nullable=False, server_default="desktop"),
    # Copied from the QR payload at ingest. Older burns without a
    # retest_index field in their QR surface as 0 (the implicit "first
    # burn"). Grouped with ``test_id`` only in indexing — there's no
    # uniqueness constraint because the same retest can legitimately
    # appear multiple times (two photos of the same run, say).
    Column("retest_index", Integer, nullable=False, server_default="0"),
    # No server_default — MySQL can't have a literal default on TEXT.
    # The application always writes a JSON value via repositories/results.py
    # (defaults to "[]" there), so the column is reliably populated.
    Column("missing_markers_json", Text, nullable=False),
    # Cached path to the rectified burn-space image, populated lazily
    # on first debug-modal request and used to skip the full capture
    # pipeline (ArUco/QR/perspective warp) on subsequent reads.
    # Cleared by reingest + delete. Pure cache — losing it just means
    # the next read re-computes once.
    Column("warped_image_path", Text, nullable=True),
    CheckConstraint(_VISIBILITY_CHECK, name="results_visibility_chk"),
    CheckConstraint(_VIA_CHECK, name="results_via_chk"),
    Index("ix_results_test_id", "test_id"),
    Index("ix_results_owner", "owner_id"),
)

palette_entries = Table(
    "palette_entries", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("test_id", Integer, ForeignKey("tests.id"), nullable=True),
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
    Column("favorited", Boolean, nullable=False, server_default="0"),
    Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
    CheckConstraint(
        "source IN ('averaged','single_result','manual')",
        name="palette_entries_source_chk",
    ),
    CheckConstraint(_VISIBILITY_CHECK, name="palette_entries_visibility_chk"),
    Index("ix_palette_entries_material_id", "material_id"),
    Index("ix_palette_entries_test_id", "test_id"),
    Index("ix_palette_entries_owner", "owner_id"),
    Index("ix_palette_entries_owner_machine", "owner_id", "machine_id"),
)

saved_spectrums = Table(
    "saved_spectrums", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(_NAME_LEN), nullable=False),
    # source_test_id NULLs out via ON DELETE SET NULL when the source
    # test is deleted — saved spectrums are self-contained predictors;
    # losing the test reference is acceptable, losing the data isn't.
    Column(
        "source_test_id", Integer,
        ForeignKey("tests.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
    Column(
        "material_id", Integer,
        ForeignKey("materials.id", ondelete="SET NULL"),
        nullable=True,
    ),
    Column("owner_id", Integer, nullable=False),
    Column("axis_param", String(32), nullable=False),
    Column("axis_min", Float, nullable=False),
    Column("axis_max", Float, nullable=False),
    Column("fit_form", String(32), nullable=False, server_default="polynomial"),
    Column("fit_degree", Integer, nullable=False),
    Column("fit_l_r2", Float, nullable=False),
    Column("fit_a_r2", Float, nullable=False),
    Column("fit_b_r2", Float, nullable=False),
    Column("fit_r2_min", Float, nullable=False),
    Column("displayed_projection", String(32), nullable=False),
    Column("lab_l_min", Float, nullable=False),
    Column("lab_l_max", Float, nullable=False),
    Column("lab_a_min", Float, nullable=False),
    Column("lab_a_max", Float, nullable=False),
    Column("lab_b_min", Float, nullable=False),
    Column("lab_b_max", Float, nullable=False),
    Column("lab_l_centroid", Float, nullable=False),
    Column("lab_a_centroid", Float, nullable=False),
    Column("lab_b_centroid", Float, nullable=False),
    Column("created_at", String(_ISO_TS_LEN), nullable=False),
    CheckConstraint(
        "fit_degree BETWEEN 1 AND 3",
        name="saved_spectrums_fit_degree_chk",
    ),
    Index(
        "ix_saved_spectrums_owner_machine_created",
        "owner_id", "machine_id", "created_at",
    ),
    Index(
        "ix_saved_spectrums_material_lab_l",
        "material_id", "lab_l_min", "lab_l_max",
    ),
    Index(
        "ix_saved_spectrums_material_lab_a",
        "material_id", "lab_a_min", "lab_a_max",
    ),
    Index(
        "ix_saved_spectrums_material_lab_b",
        "material_id", "lab_b_min", "lab_b_max",
    ),
    Index("ix_saved_spectrums_fit_r2_min", "fit_r2_min"),
)

saved_spectrum_swatches = Table(
    "saved_spectrum_swatches", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "saved_spectrum_id", Integer,
        ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("swatch_row", Integer, nullable=False),
    Column("swatch_col", Integer, nullable=False),
    Column("x_value", Float, nullable=False),
    Column("hex", String(_COLOR_HEX_LEN), nullable=False),
    Column("lab_l", Float, nullable=False),
    Column("lab_a", Float, nullable=False),
    Column("lab_b", Float, nullable=False),
    UniqueConstraint(
        "saved_spectrum_id", "swatch_row", "swatch_col",
        name="uq_saved_spectrum_swatch_cell",
    ),
    Index("ix_saved_spectrum_swatches_parent", "saved_spectrum_id"),
)

saved_spectrum_fit_coefficients = Table(
    "saved_spectrum_fit_coefficients", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column(
        "saved_spectrum_id", Integer,
        ForeignKey("saved_spectrums.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("channel", String(1), nullable=False),
    Column("degree", Integer, nullable=False),
    Column("coeff", Float, nullable=False),
    CheckConstraint(
        "channel IN ('l','a','b')",
        name="saved_spectrum_fit_coefficients_channel_chk",
    ),
    UniqueConstraint(
        "saved_spectrum_id", "channel", "degree",
        name="uq_saved_spectrum_fit_coeff_cell",
    ),
    Index("ix_saved_spectrum_fit_coefficients_parent", "saved_spectrum_id"),
)
