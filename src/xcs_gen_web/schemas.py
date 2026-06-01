"""Pydantic models for the web API. Mirror the TypeScript types in web/src/types.ts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

from xcs_gen.pulse_width import ALLOWED_PULSE_WIDTHS, snap_pulse_width


class BaseParams(BaseModel):
    """Fixed processing parameters for a param test."""

    power: float = Field(ge=0, le=100)
    speed: int = Field(ge=1)
    frequency: int = Field(ge=1)
    density: int = Field(ge=1)
    passes: int = Field(ge=1)
    # F2 Ultra MOPA accepts only a fixed preset list of pulse widths —
    # see ``xcs_gen.pulse_width``. We coerce out-of-list values to the
    # nearest allowed one so legacy DB rows and forgiving API callers
    # don't 422; the machine would reject a non-preset value anyway.
    pulse_width: int = Field(ge=1)
    laser: Literal["red", "blue", "uv"]

    @field_validator("pulse_width", mode="before")
    @classmethod
    def _snap_pulse_width(cls, v: object) -> int:
        if isinstance(v, (int, float)) and int(v) in ALLOWED_PULSE_WIDTHS:
            return int(v)
        try:
            return snap_pulse_width(float(v))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ValueError(
                f"pulse_width must be one of {ALLOWED_PULSE_WIDTHS}, got {v!r}"
            )
    # Starting scan angle in degrees. 90 = vertical scan (default, efficient
    # for narrow elements); 0 = horizontal. For angle_mode="incremental" XCS
    # rotates from this angle between passes; for "crosshatch" it alternates
    # this angle and this+90°.
    scan_angle: float = Field(default=90, ge=0, le=360)

    # Mode the user picked when creating this test. Determines which
    # validation profile applies. Optional for backwards compat — pre-
    # multi-machine rows lack the field; the API handler infers a
    # sensible default from machine_id when it's missing.
    mode: Literal["engrave", "score", "cut", "color_engrave", "intaglio", "relief"] | None = None


class RegistrationConfig(BaseModel):
    """Photo-ingest registration: QR top-left + 3 ArUcos at other corners."""

    mode: Literal["on", "off"] = "off"
    qr_size_mm: float | None = Field(default=None, gt=0, le=50)
    aruco_size_mm: float | None = Field(default=None, gt=0, le=50)


class ParamTest(BaseModel):
    """A single param test (one band/grid in the composition)."""

    id: str
    name: str
    x_param: str
    x_min: float
    x_max: float
    x_steps: int = Field(ge=2)
    y_param: str | None = None
    y_min: float | None = None
    y_max: float | None = None
    y_steps: int | None = Field(default=None, ge=2)
    rows: int = Field(default=1, ge=1)
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    gap_mm: float = Field(default=0.0, ge=0)
    base_params: BaseParams

    # UI-convenience flag: when true, the web UI auto-computes height_mm to
    # keep cells square. Server ignores the value (it just trusts height_mm
    # as sent), but persisting it keeps the checkbox sticky across reloads.
    square_cells: bool = False
    # "rect" (default) emits Rect elements; "circle" emits Circle elements
    # of diameter = min(cell_w, cell_h). Circles pair best with
    # square_cells=True so the inscribed circle fills its bounding box.
    cell_shape: Literal["rect", "circle"] = "rect"

    # Multi-pass angle behaviour. ``base_params.passes`` is the pass count
    # (emitted as XCS's native ``repeat``, so XCS handles the stacking —
    # we don't duplicate rects client-side). ``angle_mode`` and
    # ``crosshatch`` are independent:
    #
    #   angle_mode = "fixed"       → every pass at the same scan angle.
    #   angle_mode = "incremental" → XCS rotates the angle between passes.
    #   crosshatch = true          → for every pass, also burn one stroke
    #                                at scan_angle + 90°. So passes=N +
    #                                crosshatch produces 2N total strokes.
    #
    # Both can stack — incremental + crosshatch rotates the angle between
    # passes AND adds the perpendicular companion to each one.
    angle_mode: Literal["fixed", "incremental"] = "fixed"
    crosshatch: bool = False
    registration: RegistrationConfig = Field(default_factory=RegistrationConfig)
    material_id: str = Field(min_length=1)
    # True → emit bitmapScanMode="oneWay" on the gradient cells + annotation;
    # False (default) → "zMode" (bi-directional zigzag, faster).
    unidirectional: bool = False
    # When true, suppresses per-row tick + axis-label elements on generated
    # test patterns. Reclaims ~1.75 mm per row gap (at the 3 pt default font).
    # QR payload's row_stride_mm is recomputed accordingly so capture
    # sampling still hits the right cells.
    hide_axis_labels: bool = False

    # Server-filled. ``services/xcs.bytes_for_test`` stamps the current
    # value in before the converter runs so the generator can embed it
    # in the QR payload. Clients never set this explicitly — accepted
    # on the wire only so the Pydantic round-trip inside the service
    # layer keeps working.
    retest_index: int = Field(default=0, ge=0)

    # Test variety. ``"sweep"`` (default) is the legacy axis-sweep test;
    # ``"validation"`` renders one cell per ``validation_cells`` entry,
    # each with its own frozen processing params. The schema fields
    # ``x_param``/``x_min``/``x_max``/``x_steps`` are still required for
    # validation tests because the layout math (cell width, etc.) reuses
    # the same wrapped-1D code path — ``services/xcs.bytes_for_test``
    # synthesises sensible defaults at conversion time.
    kind: Literal["sweep", "validation"] = "sweep"
    # Per-cell snapshots for kind=validation tests. Each entry overlays
    # its ``params`` dict onto ``base_params`` and emits one cell. None
    # for sweep tests; required for validation tests at converter time
    # (the converter raises if absent).
    validation_cells: list[dict[str, Any]] | None = None
    # Wrap-1D layout knob — only meaningful for kind=validation. Caller
    # can leave this None and let bytes_for_test compute it from
    # ``rows`` / cell count, but the frontend persists an explicit
    # value so the editor's preview reflects what the user picked.
    cells_per_row: int | None = None
    # Optional override telling the validation-test palette picker
    # *which material's* palette to seed cells from. Defaults to the
    # test's own ``material_id`` (the burned material). Use case: pick
    # known-good colours from material A's palette and run the burn on
    # material B to see how close the colours land — the typical flow
    # for "metals usually burn similarly, but each one varies a bit".
    # Null/omitted = same as test material. Sweep tests ignore this.
    source_material_id: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _snap_legacy_crosshatch(cls, data: Any) -> Any:
        """Old rows stored ``angle_mode="crosshatch"`` before crosshatch
        became an orthogonal flag. Snap them on read: angle_mode="fixed"
        + crosshatch=True. Pattern matches the rest of this file's
        legacy-tolerant validation (CLAUDE.md "Pydantic validators snap
        legacy values rather than rejecting")."""
        if isinstance(data, dict) and data.get("angle_mode") == "crosshatch":
            data = {**data, "angle_mode": "fixed", "crosshatch": True}
        return data

    @model_validator(mode="after")
    def validate_ranges(self) -> "ParamTest":
        if self.x_min == self.x_max:
            raise ValueError("x_min must differ from x_max")
        if self.y_param is not None:
            if self.y_min is None or self.y_max is None or self.y_steps is None:
                raise ValueError("y_min, y_max, y_steps required when y_param is set")
            if self.y_min == self.y_max:
                raise ValueError("y_min must differ from y_max")
        return self


class TestPlacement(BaseModel):
    """A test with its grid position in the project."""

    test: ParamTest
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    col_span: int = Field(default=1, ge=1)


class Project(BaseModel):
    """Top-level project: a collection of placed param tests."""

    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._\- ]+$")
    grid_gap_mm: float = Field(default=1.0, ge=0)
    # Material thickness (mm) written to LASER_PLANE.thickness so XCS
    # Studio pre-focuses the head. Usually rechecked after import anyway.
    focus_mm: float = Field(default=1.5, ge=0, le=50)
    tests: list[TestPlacement]


class SvgStackRequest(BaseModel):
    """Request to convert an SVG into a stacked XCS file.

    All shapes in the SVG get the same processing params; the file is built
    once, then duplicated N-1 more times with each pass's scan_angle rotated
    by stack_step_deg. Output is the XCS file bytes.
    """

    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._\- ]+$")
    svg_content: str = Field(min_length=1, max_length=10_000_000)  # 10MB cap
    width_mm: float = Field(gt=0, le=500)
    height_mm: float | None = Field(default=None, gt=0, le=500)
    start_x: float = Field(default=10.0, ge=0)
    start_y: float = Field(default=10.0, ge=0)

    base_params: BaseParams
    processing_type: Literal[
        "COLOR_FILL_ENGRAVE", "FILL_VECTOR_ENGRAVING",
        "VECTOR_ENGRAVING", "VECTOR_CUTTING",
    ] = "COLOR_FILL_ENGRAVE"
    scan_angle: float = Field(default=90.0, ge=0.0, le=360.0)

    stack_passes: int = Field(default=1, ge=1, le=10)
    stack_step_deg: float = Field(default=90.0, gt=0.0, le=360.0)

    # When true, filled shapes are Boolean-subtracted by all higher-z shapes,
    # so adjacent layers don't engrave the same pixel twice.
    material_id: str = Field(min_length=1)
    subtract_overlaps: bool = False


# Color layer pattern - lowercase hex, "none" sentinel allowed for stroke-only shapes
_COLOR_PATTERN = r"^(#[0-9a-f]{6}|none)$"


class HatchRampStop(BaseModel):
    """One stop in a multi-stop ramp. ``position`` ∈ [0, 1] along the
    ramp axis; ``value`` is the parameter value at that position."""

    position: float = Field(ge=0.0, le=1.0)
    value: float


class HatchRamp(BaseModel):
    """A ramp interpolating a parameter across the shape along an axis.

    Backward-compatible shape:

    - Legacy clients send ``{param, axis, min, max}`` → interpreted as
      two stops at positions 0 and 1. This is still the supported
      wire format when ``stops`` is omitted.
    - New clients can send ``{param, axis, stops: [{position, value}, ...]}``
      to express multi-stop / piecewise-linear gradients. ``min`` /
      ``max`` fields are ignored when ``stops`` is present.

    Stops are sorted by position before interpolation; the first stop
    clamps values below its position, the last stop clamps above.
    """

    param: Literal["power", "speed", "frequency", "density",
                   "passes", "pulse_width", "spacing"]
    axis: Literal["perp", "parallel", "x", "y"]
    # Legacy two-point ramp. Kept required for backward compat so
    # existing persisted LayerSpec rows keep validating; new clients
    # that use ``stops`` can pass the first / last stop's values here
    # for the equivalent round-trip.
    min: float
    max: float
    stops: list[HatchRampStop] | None = None

    @model_validator(mode="after")
    def _check_stops(self) -> "HatchRamp":
        if self.stops is not None:
            if len(self.stops) < 2:
                raise ValueError("stops must have at least two entries")
            # Positions must be sorted and span the full [0, 1] range —
            # otherwise the interpolation is ambiguous. We sort on the
            # fly here so a client emitting them out-of-order still gets
            # through; the invariant is that the span is complete.
            ordered = sorted(self.stops, key=lambda s: s.position)
            if ordered[0].position > 0.001 or ordered[-1].position < 0.999:
                raise ValueError("stops must span position 0..1 inclusive")
            object.__setattr__(self, "stops", ordered)
        return self


class HatchPass(BaseModel):
    """One sweep of parallel hatch lines through a shape."""

    angle: float = 0.0
    spacing: float = Field(default=0.1, gt=0.0)
    # Line thickness in mm. Each hatched segment is emitted as a thin filled RECT
    # of this height, rotated to the hatch angle. Default = spacing for a
    # continuous (gap-free) fill; set spacing > thickness for visible gaps.
    thickness: float = Field(default=0.1, gt=0.0)
    ramps: list[HatchRamp] = Field(default_factory=list)


class LayerSpec(BaseModel):
    """Per-color processing config for the SVG Layers tab."""

    color: str = Field(pattern=_COLOR_PATTERN)
    name: str = Field(min_length=1, max_length=64)
    enabled: bool = True

    processing_type: Literal[
        "COLOR_FILL_ENGRAVE", "FILL_VECTOR_ENGRAVING",
        "VECTOR_ENGRAVING", "VECTOR_CUTTING",
        "HATCHED_LINES",
    ] = "COLOR_FILL_ENGRAVE"
    scan_angle: float = Field(default=90.0, ge=0.0, le=360.0)
    base_params: BaseParams

    # Multi-pass angle behaviour (same semantics as ParamTest). Ignored
    # when processing_type == "HATCHED_LINES" which has its own per-pass
    # model.
    angle_mode: Literal["fixed", "incremental"] = "fixed"
    crosshatch: bool = False

    # v2 hatched render mode: required non-empty when processing_type ==
    # "HATCHED_LINES", ignored otherwise.
    material_id: str | None = None
    hatch_passes: list[HatchPass] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _snap_legacy_crosshatch(cls, data: Any) -> Any:
        """Snap legacy ``angle_mode="crosshatch"`` to the new orthogonal
        shape (angle_mode="fixed", crosshatch=True). See ParamTest's
        identical validator for the full rationale."""
        if isinstance(data, dict) and data.get("angle_mode") == "crosshatch":
            data = {**data, "angle_mode": "fixed", "crosshatch": True}
        return data

    @model_validator(mode="after")
    def _validate_hatched(self):
        if self.processing_type == "HATCHED_LINES" and not self.hatch_passes:
            raise ValueError(
                f"layer {self.color!r}: HATCHED_LINES requires at least one hatch pass"
            )
        return self


class SvgLayersRequest(BaseModel):
    """Request to convert an SVG with per-color processing params to an XCS file.

    Each unique SVG fill (and optionally stroke) color is configurable via a
    LayerSpec. Disabled layers are skipped. subtract_overlaps only considers
    enabled layers when computing the z-stack.
    """

    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._\- ]+$")
    svg_content: str = Field(min_length=1, max_length=10_000_000)
    width_mm: float = Field(gt=0, le=500)
    height_mm: float | None = Field(default=None, gt=0, le=500)
    start_x: float = Field(default=10.0, ge=0)
    start_y: float = Field(default=10.0, ge=0)

    material_id: str = Field(min_length=1)
    layers: list[LayerSpec] = Field(min_length=1)
    subtract_overlaps: bool = False


# SvgDetectRequest + DetectedLayer used to live here. Layer colour
# detection now runs client-side (web/src/svg/detectLayers.ts); the
# TypeScript ``DetectedLayer`` type in web/src/types.ts is the sole
# source of truth for the shape.


class SvgPreviewRequest(BaseModel):
    """Request a preview SVG matching what the backend would actually engrave.

    Applies layer enabling + optional boolean subtraction, returning a flat SVG
    string the UI can display. Response shape: {"svg": "<svg ..."}.
    """

    svg_content: str = Field(min_length=1, max_length=10_000_000)
    width_mm: float = Field(default=100.0, gt=0, le=500)
    enabled_colors: list[str] | None = None  # None = keep all colors
    subtract_overlaps: bool = False


class SvgPreviewResponse(BaseModel):
    """Transformed SVG ready for client-side rendering."""

    svg: str


# Raster-to-SVG schemas were removed when tracing moved to the
# browser (web/src/tracer/vtracer.ts). Nothing on the backend now
# consumes or produces raster-trace options.


class LaserIndicesResponse(BaseModel):
    """Heuristic exposure indices derived from raw laser params.

    Formula version 3: ``density_model='lpc'`` is the canonical state.
    The ``"opaque"`` literal is retained for legacy rows where the
    backfill couldn't recompute (formula_version=0).
    """

    pulse_spacing_mm: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float
    ablation_aggression_index: float
    delivery_smoothness_index: float
    duty_cycle_index: float | None
    formula_version: int
    density_model: Literal["lpc", "opaque"] = "lpc"
    power_model: str

    @computed_field  # type: ignore[misc]
    @property
    def surface_exposure_index(self) -> float:
        """Deprecated read-side alias for `total_exposure_index`.
        Kept for any external consumer that hard-coded the old name.
        Will be removed in a future formula-version bump."""
        return self.total_exposure_index


class PaletteEntryResponse(BaseModel):
    id: int
    test_id: int | None = None
    material_id: int
    source: str
    hex: str
    lab: list[float]
    params: dict
    sigma: float
    notes: str
    created_at: str
    favorited: bool = False
    x_value: float | None = None
    y_value: float | None = None
    source_result_id: int | None = None
    owner_id: int
    import_source: str | None = None
    visibility: str
    machine_id: str
    # Validated state. ``is_validated`` defaults to ``False`` so
    # pre-migration entries deserialise cleanly without a backfill.
    # When set, ``validated_lab`` carries the burn-mean Lab measured
    # by the validation test (a more reliable colour than the
    # ingestion-time ``lab`` if the original was photographed under
    # poor light); ``validated_residual_de`` reports the ΔE76
    # between the original and validated Lab so the UI can flag
    # entries that moved a lot.
    is_validated: bool = False
    validated_at: str | None = None
    validated_test_id: int | None = None
    # Cell index inside ``validated_test_id`` that the entry came
    # from. Lets the palette UI link "this entry → that cell" without
    # comparing burn parameters by hand.
    validated_cell_index: int | None = None
    validated_lab: list[float] | None = None
    validated_run_count: int | None = None
    validated_residual_de: float | None = None
    # Derived: this entry has been used as a target in a validation
    # test that has at least one non-excluded result. Distinct from
    # ``is_validated`` — that flag means the user explicitly ran the
    # batch validate flow; ``original_validated`` just means "I've
    # tried this colour at least once". Used by the test creator's
    # autopick to skip colours the user has already burned, so
    # subsequent validation tests cover new ground.
    original_validated: bool = False
    derived_from_entry_id: int | None = None
    indices: LaserIndicesResponse


class PaletteQueryResult(BaseModel):
    entry: PaletteEntryResponse
    delta_e: float


class PaletteValidationStatus(BaseModel):
    """One row per palette entry from
    GET /api/palette/validation-status. ``validated`` is the canonical
    flag the UI badges off; ``best_de`` and ``last_validated_at`` are
    surfaced for tooltips and ordering."""

    entry_id: int
    best_de: float | None = None
    last_validated_at: str | None = None
    validated: bool


class PaletteEntryPatch(BaseModel):
    """All fields optional. Backend rejects hex/material_id/params changes
    on non-manual rows with 409 Conflict (see app.py:palette_patch)."""

    hex: str | None = None
    material_id: int | None = None
    params: dict | None = None
    notes: str | None = None
    favorited: bool | None = None


class PaletteEntryValidateRequest(BaseModel):
    """Per-entry validate request body. ``validated_lab`` is the
    burn-mean Lab the caller has decided is the authoritative
    colour for this entry — typically computed client-side from a
    validation test's results, but the route accepts any 3-vector
    so manual overrides ("I trust this measurement, just use it")
    work too. ``validated_test_id`` and ``run_count`` are
    provenance hints; both are optional but recommended."""

    validated_lab: list[float]
    validated_test_id: int | None = None
    run_count: int | None = None


class ValidateBatchAcceptOverride(BaseModel):
    """Per-cell override carried in a batch validate request. The UI
    flips individual cells between accept (create entry) and skip
    (don't) regardless of the stable/drifted bucket. Accepting a
    drifted cell is the user saying "yes, save this colour even
    though it wandered between runs"; skipping a stable cell is "I
    don't want this colour in the palette right now"."""

    cell_index: int
    accept: bool


class ValidateBatchRequest(BaseModel):
    """POST /api/tests/{tid}/validate body.

    ``tolerance_de`` seeds the stable/drifted bucketing — cells whose
    *cross-run stability* (max ΔE76 between any single run's per-cell
    mean and the across-run consensus) is within tolerance go into
    ``stable``, larger spread goes into ``drifted`` for user review.
    ``result_ids`` restricts which results contribute (defaults to
    all non-excluded). ``overrides`` lets the UI flip per-cell
    bucketing before commit. ``dry_run=true`` returns the bucketing
    without persisting — drives the preview pane."""

    tolerance_de: float = 8.0
    result_ids: list[int] | None = None
    overrides: list[ValidateBatchAcceptOverride] = []
    dry_run: bool = False


class ValidateBatchEntry(BaseModel):
    cell_index: int
    # Existing palette entry the cell is linked to, if any. Carried as
    # provenance only — save always *creates* a new entry rather than
    # mutating this one.
    palette_entry_id: int | None = None
    burn_mean_lab: list[float]
    expected_lab: list[float]
    # Stability gate: max cross-run ΔE between any single run's mean
    # and the consensus. ≤ tolerance → "stable" bucket.
    stability_de: float
    # Informational: ΔE between consensus and the cell's original
    # expected Lab. Never a gate (the original might be wrong) but
    # useful for the user to see how much the validated colour drifts
    # from what they thought.
    de_vs_expected: float
    run_count: int
    n_inputs: int
    # Response-side: was this cell actually persisted on save?
    persisted: bool = False
    # Response-side: id of the freshly-created palette entry when
    # ``persisted=true``; ``None`` for dry-run or skipped saves.
    new_entry_id: int | None = None


class ValidateBatchSkipped(BaseModel):
    cell_index: int
    palette_entry_id: int | None = None
    # Allowed values: "insufficient_runs", "no_measurements". The
    # ``no_palette_link`` skip reason is gone — unlinked cells are
    # first-class citizens that just create new entries.
    reason: str
    run_count: int | None = None


class ValidateBatchResponse(BaseModel):
    """Bucketed result of a batch validate, with provenance."""

    test_id: int
    test_name: str
    tolerance_de: float
    result_count: int
    dry_run: bool
    stable: list[ValidateBatchEntry]
    drifted: list[ValidateBatchEntry]
    skipped: list[ValidateBatchSkipped]


class IngestBatchAcceptOverride(BaseModel):
    """Per-cell override carried in a batch sweep-ingest request.
    Mirrors ``ValidateBatchAcceptOverride`` — flips a cell between
    accept (create entry) and skip regardless of the stable/unstable
    bucket. Accepting an unstable cell = "save this colour even
    though it drifted between runs"; skipping a stable cell =
    "don't add this one to the palette right now"."""

    cell_index: int
    accept: bool


class IngestBatchRequest(BaseModel):
    """POST /api/tests/{tid}/ingest body.

    Sister to ``ValidateBatchRequest`` — the sweep-test variant that
    has no authored expected colour, so the only gate is intra-cell
    cross-run stability. ``max_sigma_de`` seeds the bucket: cells
    whose max kept-run ΔE76 from the consensus is within this
    threshold are ``stable``, larger spread goes to ``unstable``.
    ``result_ids`` restricts which results contribute (defaults to
    all non-excluded). ``overrides`` lets the UI flip per-cell
    decisions before commit. ``dry_run=true`` returns the bucketing
    without persisting — drives the preview pane."""

    max_sigma_de: float = 3.0
    result_ids: list[int] | None = None
    overrides: list[IngestBatchAcceptOverride] = []
    dry_run: bool = False


class IngestBatchEntry(BaseModel):
    cell_index: int
    row: int
    col: int
    burn_mean_lab: list[float]
    # Stability gate — max cross-run ΔE between any kept run's mean
    # and the consensus. ≤ ``max_sigma_de`` → stable bucket.
    stability_de: float
    run_count: int
    n_inputs: int
    # First-run swatch (x, y) — used by the route to project per-cell
    # ``params`` and surfaced to the UI for the recipe column.
    x_value: float | None = None
    y_value: float | None = None
    # Response-side: was this cell actually persisted on save?
    persisted: bool = False
    # Response-side: id of the freshly-created palette entry when
    # ``persisted=true``; ``None`` for dry-run or skipped saves.
    new_entry_id: int | None = None


class IngestBatchSkipped(BaseModel):
    cell_index: int
    # Allowed values: "insufficient_runs", "no_measurements".
    reason: str
    run_count: int | None = None


class IngestBatchResponse(BaseModel):
    """Bucketed result of a batch sweep ingest, with provenance."""

    test_id: int
    test_name: str
    max_sigma_de: float
    result_count: int
    dry_run: bool
    stable: list[IngestBatchEntry]
    unstable: list[IngestBatchEntry]
    skipped: list[IngestBatchSkipped]


class PaletteEntryCreateManual(BaseModel):
    material_id: int
    hex: str
    params: dict
    notes: str = ""
    machine_id: str = Field(default="F2Ultra", min_length=1, max_length=32)

    @field_validator("hex")
    @classmethod
    def _hex_must_match(cls, v: str) -> str:
        import re as _re
        if not _re.fullmatch(r"#[0-9a-fA-F]{6}", v):
            raise ValueError("hex must match #RRGGBB")
        return v.lower()

    @field_validator("machine_id")
    @classmethod
    def _machine_id_known(cls, v: str) -> str:
        from xcs_gen.machines import known_ids
        if v not in known_ids():
            raise ValueError(f"unknown machine_id: {v!r}")
        return v


MaterialShape = Literal["circle", "rect"]


class _MaterialShapeMixin(BaseModel):
    """Shared shape/size validation for create + update."""

    shape: MaterialShape | None = None
    diameter_mm: float | None = Field(default=None, gt=0, le=1000)
    width_mm: float | None = Field(default=None, gt=0, le=1000)
    height_mm: float | None = Field(default=None, gt=0, le=1000)

    @model_validator(mode="after")
    def _shape_dimensions_consistent(self) -> "_MaterialShapeMixin":
        # Empty shape → all dimension fields must be empty too. We'd
        # otherwise allow orphaned diameters / widths that the UI can't
        # interpret.
        if self.shape is None:
            for name in ("diameter_mm", "width_mm", "height_mm"):
                if getattr(self, name) is not None:
                    raise ValueError(
                        f"{name} requires shape to be set",
                    )
            return self
        if self.shape == "circle":
            if self.diameter_mm is None:
                raise ValueError("circle shape requires diameter_mm")
            if self.width_mm is not None or self.height_mm is not None:
                raise ValueError(
                    "circle shape uses diameter_mm; width_mm/height_mm must be null",
                )
        elif self.shape == "rect":
            if self.width_mm is None or self.height_mm is None:
                raise ValueError("rect shape requires width_mm and height_mm")
            if self.diameter_mm is not None:
                raise ValueError(
                    "rect shape uses width_mm/height_mm; diameter_mm must be null",
                )
        return self


class MaterialCreate(_MaterialShapeMixin):
    name: str
    notes: str | None = None


class MaterialUpdate(_MaterialShapeMixin):
    name: str | None = None
    notes: str | None = None


class MaterialResponse(BaseModel):
    id: int
    name: str
    notes: str
    created_at: str
    owner_id: int
    # Provenance tag — ``None`` for normal user rows, ``"seed"`` for
    # rows created by the demo-import flow. Read-only on the API; the
    # seed-import service is the only writer.
    import_source: str | None = None
    visibility: str
    shape: MaterialShape | None = None
    diameter_mm: float | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    is_default: bool = False
    calibration: MaterialCalibrationConfig | None = None

    @model_validator(mode="before")
    @classmethod
    def _pack_calibration_from_flat_fields(cls, data: Any) -> Any:
        # Repository row dicts surface the WB calibration as flat
        # ``wb_supported`` / ``clean_pass_params`` keys; the response
        # exposes them under a nested ``calibration`` block. Pack them
        # here so callers don't have to remember.
        if not isinstance(data, dict):
            return data
        if data.get("calibration") is not None:
            return data
        wb = data.get("wb_supported")
        cp = data.get("clean_pass_params")
        if wb is None and cp is None:
            return data
        return {
            **data,
            "calibration": {
                "wb_supported": True if wb is None else bool(wb),
                "clean_pass_params": cp,
            },
        }


class UserRegisterRequest(BaseModel):
    # Enforced more strictly on the backend via the regex in repositories.users.
    api_key: str = Field(min_length=16, max_length=16)
    first_name: str = Field(default="", max_length=40)


class UserMePatch(BaseModel):
    first_name: str | None = Field(default=None, max_length=40)


class UserResponse(BaseModel):
    id: int
    api_key: str
    first_name: str
    created_at: str
    last_seen_at: str
    # Cleanly lets the FE branch on "is the current user the seed
    # account?" without leaking the configured demo_target_user_id —
    # the TopBar uses this to hide the "Load demo" pill for the seed
    # user itself. Always false in standalone mode (no multi-user
    # concept).
    is_seed_user: bool = False


class PresetCreate(BaseModel):
    material_id: int
    name: str
    color: str | None = None
    base_params: BaseParams
    machine_id: str = Field(default="F2Ultra", min_length=1, max_length=32)

    @field_validator("machine_id")
    @classmethod
    def _machine_id_known(cls, v: str) -> str:
        from xcs_gen.machines import known_ids
        if v not in known_ids():
            raise ValueError(f"unknown machine_id: {v!r}")
        return v


class PresetUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    base_params: BaseParams | None = None


class PresetResponse(BaseModel):
    id: int
    material_id: int
    name: str
    color: str | None
    is_default: bool
    base_params: BaseParams
    created_at: str
    updated_at: str
    owner_id: int
    import_source: str | None = None
    visibility: str
    machine_id: str


class TestSpec(BaseModel):
    x_param: str
    x_min: float
    x_max: float
    x_steps: int
    y_param: str | None = None
    y_min: float | None = None
    y_max: float | None = None
    y_steps: int | None = None
    rows: int = 1
    width_mm: float
    height_mm: float
    gap_mm: float = 0.5
    cell_shape: str = "rect"              # "rect" | "circle"
    # Aggregator name from xcs_gen.sampling_aggregators.LEGAL_AGGREGATORS.
    # When None or absent, capture uses "saturation_median" for back-compat
    # with tests created before this field existed.
    sample_aggregator: str | None = None
    square_cells: bool = False
    # Crosshatch is now an orthogonal flag — see ParamTest above for the
    # rationale. Legacy ``angle_mode="crosshatch"`` is snapped on read
    # via the model_validator below.
    angle_mode: str = "fixed"             # "fixed" | "incremental"
    crosshatch: bool = False
    unidirectional: bool = False
    # When true, per-row tick + axis-label elements are suppressed on the
    # generated test so multi-row layouts pack tighter. Summary header stays.
    hide_axis_labels: bool = False
    # Validation tests only — how many cells per physical row. ``rows``
    # is derived (ceil(cell_count / cells_per_row)) at xcs-build time,
    # and the frontend's square-cells logic + preview both honour it.
    # Sweep tests ignore this field. Persists across the API round-trip.
    cells_per_row: int | None = None
    # Validation tests only — material to seed the palette picker from
    # (defaults to the test's own ``material_id`` when None). See
    # ``ParamTest.source_material_id`` for the why.
    source_material_id: int | None = None
    base_params: BaseParams
    registration: RegistrationConfig = Field(default_factory=RegistrationConfig)

    @model_validator(mode="before")
    @classmethod
    def _snap_legacy_crosshatch(cls, data: Any) -> Any:
        if isinstance(data, dict) and data.get("angle_mode") == "crosshatch":
            data = {**data, "angle_mode": "fixed", "crosshatch": True}
        return data


class TestCreate(BaseModel):
    name: str
    material_id: int
    spec: TestSpec
    notes: str = ""
    machine_id: str = Field(default="F2Ultra", min_length=1, max_length=32)
    # ``"validation"`` flags the test as a per-cell palette validation
    # render — the cells themselves arrive via PATCH /validation-cells.
    # Default keeps existing API consumers unchanged.
    kind: Literal["sweep", "validation"] = "sweep"

    @field_validator("machine_id")
    @classmethod
    def _machine_id_known(cls, v: str) -> str:
        from xcs_gen.machines import known_ids
        if v not in known_ids():
            raise ValueError(f"unknown machine_id: {v!r}")
        return v


class TestUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    spec: TestSpec | None = None
    # material_id is editable even on locked tests: tests are commonly
    # created against the wrong substrate and need relabelling. Any
    # palette entries already harvested from the test cascade to the
    # new material in the same transaction.
    material_id: int | None = None
    parent_test_id: int | None = None
    tag: str | None = None


class TestResponse(BaseModel):
    id: int
    name: str
    material_id: int
    status: str
    spec: TestSpec
    notes: str
    created_at: str
    updated_at: str
    locked: bool
    owner_id: int
    import_source: str | None = None
    visibility: str
    machine_id: str
    # Monotonic counter — each POST /api/tests/{id}/retest bumps by 1.
    retest_index: int = 0
    # Derived — true when the test has at least one palette entry
    # sourced from it. Drives the "ingested" badge on the test list.
    ingested: bool = False
    # Test variety — "sweep" (legacy axis-sweep) or "validation"
    # (per-cell palette validation). Defaults to sweep for legacy rows.
    kind: Literal["sweep", "validation"] = "sweep"
    # Lineage: the original test this was retested from (immutable after
    # creation), the immediate predecessor in the retest chain (if
    # branched from a specific test), and a user-defined campaign tag.
    source_test_id: int | None = None
    parent_test_id: int | None = None
    tag: str | None = None
    # Frozen per-cell snapshots for kind=validation tests; empty list
    # for sweep tests. Read-only on this schema — clients mutate the
    # cell list via ``PATCH /api/tests/{id}/validation-cells``.
    validation_cells: list[dict[str, Any]] = Field(default_factory=list)


class ResultSwatch(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None = None
    hex: str
    lab: list[float]
    sigma: float


class ResultResponse(BaseModel):
    id: int
    test_id: int
    uploaded_at: str
    image_url: str
    image_sha256: str
    excluded: bool
    notes: str
    swatches: list[ResultSwatch]
    owner_id: int
    import_source: str | None = None
    visibility: str
    # Copied from the QR at ingest. 0 for burns from pre-retest-era
    # XCS files (the implicit "first burn").
    retest_index: int = 0
    # ArUco IDs (subset of {1, 2, 3}) that detection did not find.
    # Empty when the homography was fully constrained.
    missing_markers: list[int] = []
    wb: ResultWBState | None = None


class ResultPatch(BaseModel):
    excluded: bool | None = None
    notes: str | None = None


class GridLayout(BaseModel):
    """Pixel-space geometry of the warped image's cell grid.

    Pure function of the result's :class:`TestSpec`; the cell-inspector
    overlay uses these numbers both for forward (cell → highlight rect)
    and reverse (mouse → cell) mapping. The forward formula here
    matches the sampler's per-cell bounds exactly so a hover lands on
    the cell that was sampled, not its neighbour.
    """

    image_width_px: int
    image_height_px: int
    grid_origin_x_px: float
    grid_origin_y_px: float
    cell_width_px: float
    cell_height_px: float
    # Distance between consecutive physical-row tops in pixels —
    # equals cell_height_px for 2D tests, larger for wrapped 1D when
    # axis-label gaps push rows apart.
    row_stride_px: float
    # Always populated; equals ``x_steps`` for 2D and single-row 1D,
    # equals ``ceil(x_steps / rows)`` for wrapped 1D.
    cells_per_physical_row: int
    physical_rows: int
    # ``True`` when the test has both x_param and y_param (the grid's
    # rows carry y_value). ``False`` for 1D tests (single-row or
    # wrapped). The frontend uses this to decide how to map the
    # physical cell back to a swatch index.
    is_2d: bool
    # Constant 10.0 today; surfaced so a future architectural change
    # to the capture pipeline doesn't silently break the inspector.
    px_per_mm: float


class SwatchPreviewResponse(BaseModel):
    aggregator: str
    swatches: list[ResultSwatch]


class InspectCellResponse(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None
    sigma: float
    cell_image_b64: str
    sampling_region: dict[str, Any]
    aggregator_results: dict[str, str]


class AveragedSwatch(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None = None
    hex: str
    lab: list[float]
    sigma: float
    sample_count: int
    per_result: list[dict]


class IngestToPaletteRequest(BaseModel):
    swatch_indices: list[int] = Field(min_length=1)
    mode: Literal["averaged", "single_result"]
    result_id: int | None = None     # required when mode == "single_result"
    replace_existing: bool = False


class MobileIdResponse(BaseModel):
    mobile_id: str


class MobileCheckResponse(BaseModel):
    ok: bool
    display_name: str


class MobileUploadResponse(BaseModel):
    result_id: int
    test_id: int
    test_name: str


class RecentMobileUpload(BaseModel):
    result_id: int
    test_id: int
    test_name: str
    uploaded_at: str   # ISO 8601


# Saved Spectrums (stage 1) ------------------------------------------------

class SavedSpectrumSwatchInput(BaseModel):
    """One data point inside a saved sub-spectrum's crop."""
    swatch_row: int = Field(ge=0)
    swatch_col: int = Field(ge=0)
    x_value: float
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    lab: tuple[float, float, float]


class SavedSpectrumCreate(BaseModel):
    """Body of POST /api/spectrums."""
    name: str = Field(min_length=1, max_length=128)
    source_test_id: int = Field(ge=1)
    axis_param: str = Field(min_length=1, max_length=32)
    axis_min: float
    axis_max: float
    fit_form: Literal["polynomial"] = "polynomial"
    fit_degree: int = Field(ge=1, le=3)
    # One coefficient list per channel; length must equal fit_degree + 1.
    fit_coefficients: dict[Literal["l", "a", "b"], list[float]]
    # Per-channel R²; length is always 3.
    fit_r2: dict[Literal["l", "a", "b"], float]
    displayed_projection: str = Field(min_length=1, max_length=32)
    swatches: list[SavedSpectrumSwatchInput] = Field(min_length=2)


class SavedSpectrumPatch(BaseModel):
    """Body of PATCH /api/spectrums/{id}. Only ``name`` is mutable in stage 1."""
    name: str | None = Field(default=None, min_length=1, max_length=128)


class SavedSpectrumSwatchResponse(BaseModel):
    swatch_row: int
    swatch_col: int
    x_value: float
    hex: str
    lab: tuple[float, float, float]


class SavedSpectrumResponse(BaseModel):
    id: int
    name: str
    source_test_id: int | None
    machine_id: str
    material_id: int | None
    owner_id: int
    import_source: str | None = None
    axis_param: str
    axis_min: float
    axis_max: float
    fit_form: str
    fit_degree: int
    fit_coefficients: dict[Literal["l", "a", "b"], list[float]]
    fit_r2: dict[Literal["l", "a", "b"], float]
    fit_r2_min: float
    displayed_projection: str
    lab_l_min: float; lab_l_max: float
    lab_a_min: float; lab_a_max: float
    lab_b_min: float; lab_b_max: float
    lab_l_centroid: float
    lab_a_centroid: float
    lab_b_centroid: float
    swatches: list[SavedSpectrumSwatchResponse]
    created_at: str


# ── Validation cells (kind=validation tests) ─────────────────────────────────

class ValidationCellIn(BaseModel):
    """Single per-cell snapshot for a kind=validation test.

    The frontend posts these as a list after the user finalises picks
    (or after an auto-pick run). Cells are stored in the order received
    and replayed by the builder in ``cell_index`` order — so the
    frontend is responsible for L*-sorting before posting.
    """
    cell_index: int
    palette_entry_id: int | None = None
    expected_hex: str
    expected_lab: list[float]   # [L*, a*, b*]
    # ``None`` is permitted because palette entries occasionally carry
    # legacy fields (e.g. ``mode``) that round-trip from the database
    # as ``null``. The renderer's per-cell overlay filters to the keys
    # ``_PARAM_MAP`` recognises, so unknown or null values get dropped
    # before they hit ``_set_param``. Matches the project's tolerant
    # input-validator convention (CLAUDE.md "Pydantic validators snap
    # legacy values rather than rejecting").
    params: dict[str, float | int | bool | str | None]


class ValidationCellsPatch(BaseModel):
    cells: list[ValidationCellIn]


class TestLockBody(BaseModel):
    """``POST /api/tests/{id}/lock`` payload — toggle the manual lock
    flag. Unlocking a test that already has results uploaded returns
    a 409: that auto-lock is permanent (re-engraving the same QR
    needs the same spec), and the user duplicates the test instead."""

    locked: bool


# ── Text/registration default ProcessingParams ───────────────────────────────


class TextRegParamsBody(BaseModel):
    """Inbound shape for `PUT /api/text-registration-defaults/...`.

    Mirrors the seven `ProcessingParams` fields the renderer reads for
    fiducials + axis labels + summary text. Stored as first-class
    columns; this schema is the public-facing wrapper."""
    speed: int = Field(ge=1)
    power: float = Field(ge=0, le=100)
    density: int = Field(ge=1)
    repeat: int = Field(ge=1, le=99)
    pulse_width: int = Field(ge=2, le=350)
    mopa_frequency: int = Field(ge=1)
    processing_light_source: str = Field(min_length=1, max_length=16)


class TextRegMachineDefault(TextRegParamsBody):
    """Persisted machine-level defaults row (`text_reg_defaults_machine`)."""
    id: int
    machine_id: str
    created_at: str
    updated_at: str
    import_source: str | None = None


class TextRegMaterialDefault(TextRegParamsBody):
    """Persisted material-level defaults row (`text_reg_defaults_material`)."""
    id: int
    machine_id: str
    material_id: int
    created_at: str
    updated_at: str
    import_source: str | None = None


class TextRegResolveResponse(BaseModel):
    """Effective params for a `(machine, material)` pair plus a tag
    describing where they came from. The frontend uses the tag to label
    the field block ("from material default", "from machine default",
    "built-in fallback") and to enable/disable the relevant Save buttons."""
    speed: int
    power: float
    density: int
    repeat: int
    pulse_width: int
    mopa_frequency: int
    processing_light_source: str
    source: Literal["material", "machine", "fallback"]


# ---------------------------------------------------------------------------
# Pixel Art (raster → grid of rects engraving page).
# Spec: docs/superpowers/specs/2026-05-03-pixel-art-design.md
# ---------------------------------------------------------------------------


class PixelArtLayerSpec(BaseModel):
    """Per-quantised-colour processing config for the Pixel Art page.

    Pixel rects are always emitted as ``COLOR_FILL_ENGRAVE`` — no
    processing-type picker, no hatch passes, no scan angle override
    (see spec § Decisions taken / Q4)."""

    color: str = Field(pattern=_COLOR_PATTERN)
    enabled: bool = True
    base_params: BaseParams
    material_id: str | None = None
    palette_entry_id: int | None = None  # audit/debug only


class PixelArtRectSpec(BaseModel):
    """One output rectangle in mm-space, relative to the crop origin.

    The browser pipeline produces these by greedy max-rectangle covering
    over same-label cells; the backend treats them as opaque.  ``color``
    references a layer in the request's ``layers`` list by hex."""

    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    color: str = Field(pattern=_COLOR_PATTERN)


class PixelArtRequest(BaseModel):
    """Request to convert a pixelated raster into an .xcs / .svg.

    Mm-space wire format — the backend has no cell-grid context, ``cell_mm``
    is informational only (debug logs / audit)."""

    name: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._\- ]+$")
    material_id: str = Field(min_length=1)
    width_mm: float = Field(gt=0, le=500)
    height_mm: float = Field(gt=0, le=500)
    start_x: float = Field(default=10.0, ge=0)
    start_y: float = Field(default=10.0, ge=0)
    cell_mm: float = Field(gt=0)
    # One rect per non-skip cell — the backend groups by colour and
    # emits one compound Path per layer. 50000 covers a ~225×225 grid,
    # well past anything practical for engraving.
    rects: list[PixelArtRectSpec] = Field(min_length=1, max_length=50_000)
    layers: list[PixelArtLayerSpec] = Field(min_length=1, max_length=64)


# ---------------------------------------------------------------------------
# WB flat-field calibration.
# Spec: docs/superpowers/specs/2026-05-07-wb-flatfield-design.md
# ---------------------------------------------------------------------------


class MaterialCalibrationConfig(BaseModel):
    """The WB-related fields of a material."""

    wb_supported: bool = True
    clean_pass_params: BaseParams | None = None


class MaterialCalibrationPatch(BaseModel):
    """Wire-format for PATCH /api/materials/{id}/calibration."""

    wb_supported: bool | None = None
    clean_pass_params: BaseParams | None = None


class ResultWBState(BaseModel):
    """Embedded into ResultResponse so the UI can render the badge."""

    mode: str | None = None
    # flat-field: list of 4 [R, G, B] (top, right, bottom, left).
    # chromaticity: single [R, G, B].
    anchor_rgb: list[float] | list[list[float]] | None = None
    # flat-field: list of 4 {x_mm, y_mm, R, G, B}.
    # chromaticity: per-channel [sR, sG, sB] flat list.
    correction: list[dict] | list[float] | None = None
    canonical_id: str | None = None


# Seed-import — one-click copy of a curated seed account's catalogue
# into the empty workbench of a freshly-registered user. The routes are
# only meaningful in multi_user mode; standalone returns 404.
class SeedPreviewResponse(BaseModel):
    """Read-only counts + idempotency flags shown in the import modal
    before the user confirms the deep-copy."""

    src_owner_id: int
    src_has_data: bool
    already_imported: bool
    materials: int
    presets: int
    tests: int
    results: int
    palette_entries: int
    saved_spectrums: int


class SeedImportResponse(BaseModel):
    """Row counts written by the actual import. ``image_warnings``
    surfaces source-side missing image bytes — the row was copied but
    the bytes couldn't be located on disk (storage drift)."""

    materials: int
    presets: int
    tests: int
    results: int
    palette_entries: int
    saved_spectrums: int
    validation_cells: int
    text_reg_machine: int
    text_reg_material: int
    image_warnings: list[str]
