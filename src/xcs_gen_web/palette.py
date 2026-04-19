"""JSON-file palette store with CIEDE2000 color-distance query.

Entries are persisted to a single JSON file (default ``~/.xcs-gen/palette.json``).
At ingest time, each hex is converted to Lab once and cached on the entry so
queries avoid re-converting every entry on every lookup.

Lab conversion uses D65 sRGB (the webby default); if we ever need device-ICC
accuracy that's a per-capture concern, not a per-query one.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

_SCHEMA_VERSION = 1


@dataclass
class PaletteEntry:
    """One entry in the palette — a burned color tagged with the params that produced it."""

    id: str
    test_id: str
    source: str  # "upload" | "manual"
    timestamp: str
    hex: str
    lab: list[float]  # [L, a, b]
    params: dict[str, Any]
    sigma: float
    notes: str = ""


@dataclass
class QueryResult:
    """One result of query_by_hex: the entry plus its ΔE2000 distance from the target."""

    entry: PaletteEntry
    delta_e: float


def _hex_to_srgb(hex_: str) -> tuple[float, float, float]:
    h = hex_.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def _srgb_to_linear(c: float) -> float:
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def _linear_srgb_to_xyz(r: float, g: float, b: float) -> tuple[float, float, float]:
    # sRGB → XYZ (D65)
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    return x, y, z


def _xyz_to_lab(x: float, y: float, z: float) -> tuple[float, float, float]:
    xn, yn, zn = 0.95047, 1.00000, 1.08883  # D65 reference white
    x /= xn
    y /= yn
    z /= zn

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def hex_to_lab(hex_: str) -> tuple[float, float, float]:
    """Convert ``#rrggbb`` to CIE Lab (D65)."""
    r, g, b = _hex_to_srgb(hex_)
    lr, lg, lb = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)
    return _xyz_to_lab(*_linear_srgb_to_xyz(lr, lg, lb))


def delta_e_2000(
    lab1: tuple[float, float, float] | list[float],
    lab2: tuple[float, float, float] | list[float],
) -> float:
    """CIEDE2000 color difference (Sharma et al. 2005)."""
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2

    avg_L = (L1 + L2) / 2
    C1 = math.sqrt(a1 * a1 + b1 * b1)
    C2 = math.sqrt(a2 * a2 + b2 * b2)
    avg_C = (C1 + C2) / 2

    G = 0.5 * (1 - math.sqrt(avg_C ** 7 / (avg_C ** 7 + 25 ** 7)))
    a1p = (1 + G) * a1
    a2p = (1 + G) * a2

    C1p = math.sqrt(a1p * a1p + b1 * b1)
    C2p = math.sqrt(a2p * a2p + b2 * b2)
    avg_Cp = (C1p + C2p) / 2

    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360

    if abs(h1p - h2p) > 180:
        avg_Hp = (h1p + h2p + 360) / 2
    else:
        avg_Hp = (h1p + h2p) / 2

    T = (1 - 0.17 * math.cos(math.radians(avg_Hp - 30))
         + 0.24 * math.cos(math.radians(2 * avg_Hp))
         + 0.32 * math.cos(math.radians(3 * avg_Hp + 6))
         - 0.20 * math.cos(math.radians(4 * avg_Hp - 63)))

    dhp = h2p - h1p
    if abs(dhp) > 180:
        dhp -= 360 if dhp > 0 else -360

    dLp = L2 - L1
    dCp = C2p - C1p
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))

    SL = 1 + (0.015 * (avg_L - 50) ** 2) / math.sqrt(20 + (avg_L - 50) ** 2)
    SC = 1 + 0.045 * avg_Cp
    SH = 1 + 0.015 * avg_Cp * T

    dTheta = 30 * math.exp(-(((avg_Hp - 275) / 25) ** 2))
    RC = 2 * math.sqrt(avg_Cp ** 7 / (avg_Cp ** 7 + 25 ** 7))
    RT = -RC * math.sin(math.radians(2 * dTheta))

    return math.sqrt(
        (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2
        + RT * (dCp / SC) * (dHp / SH)
    )


def default_palette_path() -> Path:
    return Path.home() / ".xcs-gen" / "palette.json"


def load_palette(path: Path | str) -> list[PaletteEntry]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open() as f:
        data = json.load(f)
    return [PaletteEntry(**entry) for entry in data.get("entries", [])]


def save_palette(path: Path | str, entries: list[PaletteEntry]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    body = {"version": _SCHEMA_VERSION, "entries": [asdict(e) for e in entries]}
    with p.open("w") as f:
        json.dump(body, f, indent=2)


def append_entries(path: Path | str, new_entries: list[PaletteEntry]) -> None:
    existing = load_palette(path)
    save_palette(path, existing + new_entries)


def query_by_hex(path: Path | str, hex_: str, *, limit: int = 5) -> list[QueryResult]:
    """Return up to `limit` entries sorted by ascending ΔE2000 from `hex_`."""
    target = hex_to_lab(hex_)
    entries = load_palette(path)
    scored = [
        QueryResult(entry=e, delta_e=delta_e_2000(target, tuple(e.lab)))
        for e in entries
    ]
    scored.sort(key=lambda r: r.delta_e)
    return scored[:limit]
