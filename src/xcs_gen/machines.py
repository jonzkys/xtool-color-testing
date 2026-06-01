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

LaserKind = Literal["fiber", "blue", "uv"]
LaserName = Literal["red", "blue", "uv"]   # the wire-format name used inside .xcs files
ModeId = Literal["engrave", "score", "cut", "color_engrave", "intaglio", "relief"]
ProfileId = str   # per-machine "<machineId>:<mode>"; validated by profiles_loader

# .xcs's per-element ``processingLightSource`` uses "red" for the fiber
# (MOPA / IR) laser and "blue" for the diode laser. Map them once here so
# the rest of the codebase can talk in laser names.
_LASER_NAME_TO_KIND: dict[LaserName, LaserKind] = {"red": "fiber", "blue": "blue", "uv": "uv"}


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


def _modes(machine_id: str, mode_ids: tuple[str, ...]) -> tuple[ModeSpec, ...]:
    return tuple(ModeSpec(m, f"{machine_id}:{m}") for m in mode_ids)


_MACHINES: dict[str, MachineSpec] = {
    "F2Ultra": MachineSpec(
        id="F2Ultra", display_name="F2 Ultra",
        ext_id="GS004-CLASS-4", ext_name="F2 Ultra", image="f2ultra.png",
        lasers=(LaserSpec("fiber", 60, (0.03, 0.03)), LaserSpec("blue", 40, (0.08, 0.10))),
        modes=_modes("F2Ultra", ("engrave", "score", "cut", "color_engrave", "intaglio", "relief")),
    ),
    "F2UltraSingle": MachineSpec(
        id="F2UltraSingle", display_name="F2 Ultra (Single)",
        ext_id="GS007-CLASS-4", ext_name="F2 Ultra", image="f2ultrasingle.png",
        lasers=(LaserSpec("fiber", 60, (0.03, 0.03)),),
        modes=_modes("F2UltraSingle", ("engrave", "score", "cut", "color_engrave", "intaglio", "relief")),
    ),
    "F2UltraUV": MachineSpec(
        id="F2UltraUV", display_name="F2 Ultra UV",
        ext_id="GS009-CLASS-4", ext_name="F2 Ultra UV", image="f2ultrauv.png",
        lasers=(LaserSpec("uv", 5, (0.02, 0.02)),),
        modes=_modes("F2UltraUV", ("engrave", "score", "cut", "intaglio", "relief")),
    ),
    "F1Ultra": MachineSpec(
        id="F1Ultra", display_name="F1 Ultra",
        ext_id="F1Ultra", ext_name="F1 Ultra", image="f1ultra.png",
        lasers=(LaserSpec("fiber", 20, (0.03, 0.03)), LaserSpec("blue", 20, (0.08, 0.10))),
        modes=_modes("F1Ultra", ("engrave", "score", "cut", "intaglio", "relief")),
    ),
    "F1Lite": MachineSpec(
        id="F1Lite", display_name="F1 Lite",
        ext_id="GS005", ext_name="F1 Lite", image="f1lite.png",
        lasers=(LaserSpec("blue", 10, (0.08, 0.10)),),
        modes=_modes("F1Lite", ("engrave", "score", "cut")),
    ),
    "F1": MachineSpec(
        id="F1", display_name="F1",
        ext_id="F1", ext_name="F1", image="f1.png",
        lasers=(LaserSpec("blue", 10, (0.08, 0.10)), LaserSpec("fiber", 2, (0.03, 0.03))),
        modes=_modes("F1", ("engrave", "score", "cut")),
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
    """``device.power`` list as written to .xcs files, ordered fiber, blue, uv."""
    m = get(machine_id)
    order = {"fiber": 0, "blue": 1, "uv": 2}
    return [laser.wattage for laser in sorted(m.lasers, key=lambda x: order.get(x.kind, 9))]


# ── Validation profiles ──────────────────────────────────────────────────────

from .pulse_width import snap_pulse_width  # noqa: E402  (used by validate_against_profile)
from .profiles_loader import load_profiles  # noqa: E402

# Loaded from data/machine_profiles.json (extracted from xTool Studio).
PROFILES: dict[str, dict[str, dict]] = load_profiles()


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
