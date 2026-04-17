"""Pydantic models for the web API. Mirror the TypeScript types in web/src/types.ts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class BaseParams(BaseModel):
    """Fixed processing parameters for a param test."""

    power: float = Field(ge=0, le=100)
    speed: int = Field(ge=1)
    frequency: int = Field(ge=1)
    density: int = Field(ge=1)
    passes: int = Field(ge=1)
    pulse_width: int = Field(ge=1)
    laser: Literal["red", "blue"]


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

    # Crosshatch: stacks N passes with different scanAngles on each element.
    # First pass uses the base scan angle (currently 90° for vertical scan);
    # each subsequent pass adds crosshatch_step_deg.
    crosshatch_enabled: bool = False
    crosshatch_passes: int = Field(default=2, ge=2, le=10)
    crosshatch_step_deg: float = Field(default=90.0, gt=0.0, le=360.0)

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
    subtract_overlaps: bool = False


# Color layer pattern - lowercase hex, "none" sentinel allowed for stroke-only shapes
_COLOR_PATTERN = r"^(#[0-9a-f]{6}|none)$"


class HatchRamp(BaseModel):
    """One linear ramp interpolating a parameter across the shape."""

    param: Literal["power", "speed", "frequency", "density",
                   "passes", "pulse_width", "spacing"]
    axis: Literal["perp", "parallel", "x", "y"]
    min: float
    max: float


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

    # Per-layer crosshatch (same semantics as ParamTest crosshatch). Ignored
    # when processing_type == "HATCHED_LINES" (which carries its own multi-pass).
    crosshatch_enabled: bool = False
    crosshatch_passes: int = Field(default=2, ge=2, le=10)
    crosshatch_step_deg: float = Field(default=90.0, gt=0.0, le=360.0)

    # v2 hatched render mode: required non-empty when processing_type ==
    # "HATCHED_LINES", ignored otherwise.
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

    layers: list[LayerSpec] = Field(min_length=1)
    subtract_overlaps: bool = False


class SvgDetectRequest(BaseModel):
    """Request to detect the unique colors present in an SVG."""

    svg_content: str = Field(min_length=1, max_length=10_000_000)
    width_mm: float = Field(default=100.0, gt=0, le=500)


class DetectedLayer(BaseModel):
    """One color detected in an SVG with a usage count."""

    color: str
    shape_count: int
    is_fill: bool  # True = appears as a fill, False = appears only as stroke


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


class RasterToSvgRequest(BaseModel):
    """Request to vectorize a PNG/JPG via vtracer.

    Image is sent as base64 (or data URL). Response is an SVG string that
    can be fed into the existing SVG-layers endpoints.
    """

    image_data: str = Field(min_length=1, max_length=20_000_000)  # ~15 MB PNG
    color_precision: int = Field(default=4, ge=1, le=8)
    layer_difference: int = Field(default=32, ge=0, le=255)
    filter_speckle: int = Field(default=8, ge=0, le=100)
    # 0 = no PIL pre-quantization, 2-256 = cap palette before vtracer
    max_colors: int = Field(default=0, ge=0, le=256)


class RasterToSvgResponse(BaseModel):
    svg: str
