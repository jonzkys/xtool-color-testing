"""Machine registry — supported xTool machines, lasers, modes, and validation
profiles.

This module is the single source of truth for which machines exist, their
laser hardware, what processing modes they support, and which validation
profile each (machine, mode) pair uses. New machines are added by editing
this file; nothing is read from the database.

The registry is also serialised to the frontend via ``GET /api/machines``;
keep the public dataclasses JSON-friendly (no callables, no Enums).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

LaserKind = Literal["fiber", "blue"]
LaserName = Literal["red", "blue"]   # the wire-format name used inside .xcs files
ModeId = Literal["engrave", "score", "cut", "color_engrave"]
ProfileId = Literal["STANDARD", "COLOR_ENGRAVE"]

# .xcs's per-element ``processingLightSource`` uses "red" for the fiber
# (MOPA / IR) laser and "blue" for the diode laser. Map them once here so
# the rest of the codebase can talk in laser names.
_LASER_NAME_TO_KIND: dict[LaserName, LaserKind] = {"red": "fiber", "blue": "blue"}


@dataclass(frozen=True)
class LaserSpec:
    """One laser source on a machine."""

    kind: LaserKind
    wattage: int
    spot_mm: tuple[float, float]   # (width, height) — blue is rectangular


@dataclass(frozen=True)
class ModeSpec:
    """One processing mode supported by a machine, mapped to a validation profile."""

    id: ModeId
    profile: ProfileId


@dataclass(frozen=True)
class MachineSpec:
    """Top-level machine definition."""

    id: str                          # canonical id, e.g. "F2Ultra"
    display_name: str                # user-facing, e.g. "F2 Ultra"
    ext_id: str                      # written to .xcs `extId` and `device.id`
    ext_name: str                    # written to .xcs `extName`
    image: str                       # filename under web/public/machines/
    lasers: tuple[LaserSpec, ...]
    modes: tuple[ModeSpec, ...]


_MACHINES: dict[str, MachineSpec] = {
    "F2Ultra": MachineSpec(
        id="F2Ultra",
        display_name="F2 Ultra",
        ext_id="GS004-CLASS-4",
        ext_name="F2 Ultra",
        image="f2ultra.png",
        lasers=(
            LaserSpec("fiber", 60, (0.03, 0.03)),
            LaserSpec("blue",  40, (0.08, 0.10)),
        ),
        modes=(
            ModeSpec("engrave",       "STANDARD"),
            ModeSpec("score",         "STANDARD"),
            ModeSpec("cut",           "STANDARD"),
            ModeSpec("color_engrave", "COLOR_ENGRAVE"),
        ),
    ),
    "F1Ultra": MachineSpec(
        id="F1Ultra",
        display_name="F1 Ultra",
        ext_id="F1Ultra",
        ext_name="F1 Ultra",
        image="f1ultra.png",
        lasers=(
            LaserSpec("fiber", 20, (0.03, 0.03)),
            LaserSpec("blue",  20, (0.08, 0.10)),
        ),
        modes=(
            ModeSpec("engrave", "STANDARD"),
            ModeSpec("score",   "STANDARD"),
            ModeSpec("cut",     "STANDARD"),
        ),
    ),
}


def get(machine_id: str) -> MachineSpec:
    """Return the registry entry for ``machine_id`` or raise KeyError."""
    try:
        return _MACHINES[machine_id]
    except KeyError as exc:
        raise KeyError(f"unknown machine_id: {machine_id!r}") from exc


def all_machines() -> tuple[MachineSpec, ...]:
    """All built-in machines, in registry order."""
    return tuple(_MACHINES.values())


def known_ids() -> tuple[str, ...]:
    return tuple(_MACHINES.keys())


def profile_for(machine_id: str, mode: str) -> ProfileId:
    """Profile id for the given (machine, mode) — raises KeyError on unsupported."""
    machine = get(machine_id)
    for m in machine.modes:
        if m.id == mode:
            return m.profile
    raise KeyError(
        f"machine {machine_id!r} does not support mode {mode!r}",
    )


def laser_for(machine: MachineSpec, laser_name: LaserName) -> LaserSpec:
    """Resolve the LaserSpec referenced by an .xcs ``processingLightSource`` value."""
    kind = _LASER_NAME_TO_KIND[laser_name]
    for laser in machine.lasers:
        if laser.kind == kind:
            return laser
    raise KeyError(f"machine {machine.id!r} has no {kind!r} laser")


def device_power(machine_id: str) -> list[int]:
    """``device.power`` list as written to .xcs files: [fiber_w, blue_w]."""
    m = get(machine_id)
    fiber = next(laser for laser in m.lasers if laser.kind == "fiber")
    blue  = next(laser for laser in m.lasers if laser.kind == "blue")
    return [fiber.wattage, blue.wattage]
