"""Data model for XCS file format."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field


def _uuid() -> str:
    return str(uuid.uuid4())


@dataclass
class ProcessingParams:
    """Laser processing parameters for a single element."""

    speed: float = 1000
    power: float = 50.0
    repeat: int = 1
    density: int = 100
    pulse_width: int = 200
    mopa_frequency: int = 65
    dpi: int = 500
    dot_duration: int = 100
    processing_light_source: str = "blue"
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


# Predefined layer colors - XCS uses hex color strings as layer keys.
# We pre-generate enough for large grids. Each unique parameter set
# needs its own layer if we want per-element control.
LAYER_COLORS = [
    "#00befe", "#fe0000", "#00fe00", "#fefe00", "#fe00fe", "#00fefe",
    "#800000", "#008000", "#000080", "#808000", "#800080", "#008080",
    "#fe8000", "#8000fe", "#00fe80", "#fe0080", "#80fe00", "#0080fe",
]


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
    canvas_id: str = field(default_factory=_uuid)
