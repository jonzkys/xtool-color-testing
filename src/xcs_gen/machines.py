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

from dataclasses import dataclass, field
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


# ── Validation profiles ──────────────────────────────────────────────────────

from .pulse_width import ALLOWED_PULSE_WIDTHS, snap_pulse_width  # noqa: E402

# Stepped LPC values for the STANDARD profile (lines per cm).
# 10..100 step 10, then 100..200 step 20. The duplicated 100 is kept
# only on the lower segment.
_STANDARD_DENSITY = tuple(
    list(range(10, 101, 10)) + list(range(120, 201, 20))
)

# Per-profile constraint dicts. Shape mirrors what /api/machines returns.
PROFILES: dict[str, dict[str, dict]] = {
    "STANDARD": {
        "power":       {"kind": "range",   "min": 1,  "max": 100, "step": 1},
        "density":     {"kind": "stepped", "values": list(_STANDARD_DENSITY)},
        "frequency":   {"kind": "range",   "min": 30, "max": 60},
        "speed":       {"kind": "range",   "min": 2,  "max": 10000},
        "passes":      {"kind": "range",   "min": 1,  "max": 99},
        "pulse_width": {"kind": "not_applicable"},
        "laser":       {"kind": "enum",    "values": ["red", "blue"]},
    },
    "COLOR_ENGRAVE": {
        "power":       {"kind": "range",   "min": 1,  "max": 100, "step": 1},
        "density":     {"kind": "range",   "min": 1,  "max": 5000},
        "frequency":   {"kind": "range",   "min": 60, "max": 500},
        "speed":       {"kind": "range",   "min": 2,  "max": 15000},
        "passes":      {"kind": "range",   "min": 1,  "max": 99},
        "pulse_width": {"kind": "stepped", "values": list(ALLOWED_PULSE_WIDTHS)},
        "laser":       {"kind": "enum",    "values": ["red", "blue"]},
    },
}


class ValidationError(ValueError):
    """Raised when a parameter fails its profile constraint.

    ``field`` is the offending field name; ``message`` carries the human
    explanation. The web layer maps these to HTTP 422.
    """

    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message


@dataclass
class ValidationResult:
    """Result of running params through a profile.

    ``values`` is the post-snap dict (callers should persist this, not
    the original input). ``snapped`` records ``field -> (original, new)``
    for any field that was coerced; useful for log-warning the user.
    """

    values: dict
    snapped: dict[str, tuple[float, float]] = field(default_factory=dict)


def _nearest_in(values: list, v: float) -> float:
    return min(values, key=lambda x: abs(x - v))


def validate_against_profile(
    profile_id: str, params: dict,
) -> ValidationResult:
    """Validate ``params`` against the profile.

    - ``stepped``: snap to nearest legal value (record the swap).
    - ``range``: reject if out of bounds (raises ValidationError).
    - ``not_applicable``: reject if the field is present in ``params``.
    - ``enum``: reject if the value isn't in the allowed set.

    Fields the profile doesn't mention are passed through untouched.
    """
    if profile_id not in PROFILES:
        raise KeyError(f"unknown profile_id: {profile_id!r}")
    profile = PROFILES[profile_id]
    out = dict(params)
    snapped: dict[str, tuple[float, float]] = {}

    for field_name, constraint in profile.items():
        kind = constraint["kind"]
        if kind == "not_applicable":
            if field_name in params:
                raise ValidationError(
                    field_name,
                    f"not applicable on this machine/mode (got {params[field_name]!r})",
                )
            continue
        if field_name not in params:
            raise ValidationError(
                field_name, "required field is missing",
            )
        v = params[field_name]
        if kind == "range":
            lo, hi = constraint["min"], constraint["max"]
            if not (lo <= v <= hi):
                raise ValidationError(
                    field_name,
                    f"value {v!r} out of range [{lo}, {hi}]",
                )
        elif kind == "stepped":
            allowed = constraint["values"]
            if v not in allowed:
                # Reuse the existing pulse_width snapper for that one
                # field (it's the only one with a non-uniform step) so
                # behaviour is bit-identical to the legacy validator.
                if field_name == "pulse_width":
                    new = snap_pulse_width(float(v))
                else:
                    new = _nearest_in(allowed, float(v))
                snapped[field_name] = (v, new)
                out[field_name] = new
        elif kind == "enum":
            if v not in constraint["values"]:
                raise ValidationError(
                    field_name,
                    f"value {v!r} not one of {constraint['values']!r}",
                )
        else:
            raise RuntimeError(f"unknown constraint kind: {kind!r}")

    return ValidationResult(values=out, snapped=snapped)
