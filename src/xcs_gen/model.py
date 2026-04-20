"""Data model for XCS file format."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal


def _uuid() -> str:
    return str(uuid.uuid4())


@dataclass
class ProcessingParams:
    """Laser processing parameters for a single element."""

    speed: int = 1000
    power: float = 50.0
    repeat: int = 1
    density: int = 100
    pulse_width: int = 200
    mopa_frequency: int = 65
    dpi: int = 500
    dot_duration: int = 100
    processing_light_source: str = "red"  # "red" = MOPA fiber, "blue" = diode
    scan_angle: float = 90  # 90 = vertical scan (efficient for narrow elements)
    angle_type: int = 2
    cross_angle: bool = False
    # "zMode" = bi-directional (zigzag, default — laser burns on both
    # traversals). "oneWay" = uni-directional (burns one way, returns dry).
    # Uni-directional is slower but avoids backlash artefacts when chasing
    # fine detail.
    bitmap_scan_mode: str = "zMode"


@dataclass
class Rect:
    """A rectangle display element."""

    x: float
    y: float
    width: float
    height: float
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "COLOR_FILL_ENGRAVE"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""  # assigned during build


@dataclass
class Line:
    """A line display element.

    When a line carries its own `params` / `processing_type`, those are used
    verbatim by the caller when building device entries (typical for hatched
    output). When `params is None`, the caller supplies params externally (as
    annotation ticks do with fixed annotation params).
    """

    x: float
    y: float
    length: float
    angle: float = 0.0  # 0 = horizontal, 90 = vertical
    layer_color: str = ""
    id: str = field(default_factory=_uuid)
    params: ProcessingParams | None = None
    processing_type: str = "VECTOR_ENGRAVING"


@dataclass
class Path:
    """An SVG path display element."""

    d: str  # absolute-coord SVG path d string
    x: float  # bounding box top-left in bed mm
    y: float
    width: float
    height: float
    is_close_path: bool
    is_compound_path: bool = False
    fill_rule: Literal["evenodd", "nonzero"] = "evenodd"
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "COLOR_FILL_ENGRAVE"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""


@dataclass
class Circle:
    """A circle display element."""

    x: float  # bounding box top-left (not center), bed mm
    y: float
    width: float  # diameter
    height: float
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "VECTOR_ENGRAVING"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""


@dataclass
class Bitmap:
    """A raster BITMAP display element.

    Carries a PNG payload (raw bytes) that gets base64-encoded into the
    XCS file. Used for QR / ArUco markers where emitting one RECT per
    module bloats the file and risks hitting XCS's per-project display
    limit (~750 elements).
    """

    x: float
    y: float
    width: float  # physical size in mm
    height: float
    png_bytes: bytes  # raw PNG bytes (not base64)
    origin_width: int  # source PNG pixel width
    origin_height: int  # source PNG pixel height
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "COLOR_ENGRAVE"  # NB: bitmap variant, not COLOR_FILL_ENGRAVE
    id: str = field(default_factory=_uuid)
    layer_color: str = ""


# Default layer colors for gradient and annotation layers.
GRADIENT_LAYER_COLOR = "#00befe"
ANNOTATION_LAYER_COLOR = "#aaaaaa"


@dataclass
class Device:
    """Laser device identity."""

    ext_id: str = "GS004-CLASS-4"
    ext_name: str = "F2 Ultra"
    power: list[int] = field(default_factory=lambda: [60, 40])


@dataclass
class XCSProject:
    """Top-level XCS file model."""

    device: Device = field(default_factory=Device)
    elements: list[Rect] = field(default_factory=list)
    paths: list[Path] = field(default_factory=list)
    circles: list[Circle] = field(default_factory=list)
    extra_displays: list[dict[str, Any]] = field(default_factory=list)
    extra_device_entries: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    bitmaps: list[Bitmap] = field(default_factory=list)
    canvas_id: str = field(default_factory=_uuid)
    # Material thickness in mm — emitted as LASER_PLANE.thickness. XCS Studio
    # uses this to auto-focus the head before burning. None = leave unset
    # (user has to focus manually in XCS).
    thickness_mm: float | None = None
