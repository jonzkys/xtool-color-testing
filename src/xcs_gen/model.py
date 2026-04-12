"""Data model for XCS file format."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any


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
    scan_angle: float = 0
    angle_type: int = 2
    cross_angle: bool = False


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
    """A line display element."""

    x: float
    y: float
    length: float
    angle: float = 0.0  # 0 = horizontal, 90 = vertical
    layer_color: str = ""
    id: str = field(default_factory=_uuid)


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
    extra_displays: list[dict[str, Any]] = field(default_factory=list)
    extra_device_entries: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    canvas_id: str = field(default_factory=_uuid)
