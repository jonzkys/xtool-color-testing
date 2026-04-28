"""Pydantic models for the web API. Mirror the TypeScript types in web/src/types.ts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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
    laser: Literal["red", "blue"]

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
    mode: Literal["engrave", "score", "cut", "color_engrave"] | None = None


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
    # we don't duplicate rects client-side). angle_mode picks how the scan
    # angle varies per pass:
    #
    #   "fixed"       — every pass at the same scan angle.
    #   "crosshatch"  — alternates scan_angle and scan_angle + 90°.
    #   "incremental" — XCS rotates the angle between passes (e.g. 360°/n).
    #
    # Only meaningful when passes > 1.
    angle_mode: Literal["fixed", "crosshatch", "incremental"] = "fixed"
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

    # Multi-pass angle behaviour (same semantics as ParamTest.angle_mode).
    # Ignored when processing_type == "HATCHED_LINES" which has its own
    # per-pass model.
    angle_mode: Literal["fixed", "crosshatch", "incremental"] = "fixed"

    # v2 hatched render mode: required non-empty when processing_type ==
    # "HATCHED_LINES", ignored otherwise.
    material_id: str | None = None
    hatch_passes: list[HatchPass] = Field(default_factory=list)

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
    visibility: str
    machine_id: str


class PaletteQueryResult(BaseModel):
    entry: PaletteEntryResponse
    delta_e: float


class PaletteEntryPatch(BaseModel):
    """All fields optional. Backend rejects hex/material_id/params changes
    on non-manual rows with 409 Conflict (see app.py:palette_patch)."""

    hex: str | None = None
    material_id: int | None = None
    params: dict | None = None
    notes: str | None = None
    favorited: bool | None = None


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
    visibility: str
    shape: MaterialShape | None = None
    diameter_mm: float | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    is_default: bool = False


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
    angle_mode: str = "fixed"             # "fixed" | "crosshatch" | "incremental"
    unidirectional: bool = False
    # When true, per-row tick + axis-label elements are suppressed on the
    # generated test so multi-row layouts pack tighter. Summary header stays.
    hide_axis_labels: bool = False
    base_params: BaseParams
    registration: RegistrationConfig = Field(default_factory=RegistrationConfig)


class TestCreate(BaseModel):
    name: str
    material_id: int
    spec: TestSpec
    notes: str = ""
    machine_id: str = Field(default="F2Ultra", min_length=1, max_length=32)

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
    visibility: str
    machine_id: str
    # Monotonic counter — each POST /api/tests/{id}/retest bumps by 1.
    retest_index: int = 0


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
    visibility: str
    # Copied from the QR at ingest. 0 for burns from pre-retest-era
    # XCS files (the implicit "first burn").
    retest_index: int = 0
    # ArUco IDs (subset of {1, 2, 3}) that detection did not find.
    # Empty when the homography was fully constrained.
    missing_markers: list[int] = []


class ResultPatch(BaseModel):
    excluded: bool | None = None
    notes: str | None = None


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
