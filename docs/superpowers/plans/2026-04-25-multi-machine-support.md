# Multi-machine support (F1 Ultra + F2 Ultra) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workbench machine-aware so we can support more than the F2 Ultra Dual. Add F1 Ultra as a second supported machine with per-(machine × mode) parameter validation, machine-scoped tests/palette/presets, and a TopBar machine switcher.

**Architecture:** Code-level machine registry in `src/xcs_gen/machines.py` (no DB-backed machines table). String `machine_id` column on `tests`, `palette_entries`, `presets`. Two named validation profiles (`STANDARD`, `COLOR_ENGRAVE`) addressed via `(machine, mode) → profile`. Frontend reads the registry once via `GET /api/machines`, persists current machine in localStorage, and re-renders forms from the validation profile.

**Tech Stack:** Python 3.12 + FastAPI + SQLAlchemy + Alembic + Pydantic v2 (backend); React 19 + Vite + TypeScript + Tailwind v4 + Radix UI + CVA (frontend); pytest + vitest + Playwright MCP (testing).

**Spec:** `docs/superpowers/specs/2026-04-25-multi-machine-support-design.md`

**Branch:** `feat/multi-machine-support`

---

## Pre-flight

- [ ] **Step 0.1:** Confirm working tree is on `feat/multi-machine-support`.

```bash
git branch --show-current
```

Expected: `feat/multi-machine-support`. If not, `git checkout feat/multi-machine-support`.

- [ ] **Step 0.2:** Confirm tests pass on a clean baseline so we have a green starting point.

```bash
uv run --active pytest tests/ -q
```

Expected: all tests pass. If a test is already failing on this branch, stop and surface it before starting.

- [ ] **Step 0.3:** Confirm the F1 Ultra sample file exists; we'll use it as round-trip ground truth.

```bash
ls samples/f1ultra.xcs
```

Expected: file present.

---

## Task 1: Machine registry — pure dataclasses + lookup

**Files:**
- Create: `src/xcs_gen/machines.py`
- Test: `tests/test_machines.py`

The registry is the single source of truth for machine identity, lasers, supported modes, and which validation profile each (machine, mode) uses. No I/O — pure data + small lookup helpers.

- [ ] **Step 1.1: Write the failing tests.**

Create `tests/test_machines.py`:

```python
"""Machine registry — built-in machines, mode→profile mapping, lookup helpers."""

from __future__ import annotations

import pytest

from xcs_gen import machines


def test_builtin_machines_present():
    ids = {m.id for m in machines.all_machines()}
    assert {"F2Ultra", "F1Ultra"} <= ids


def test_f2_ultra_identity():
    m = machines.get("F2Ultra")
    assert m.ext_id == "GS004-CLASS-4"
    assert m.ext_name == "F2 Ultra"
    assert [l.wattage for l in m.lasers] == [60, 40]
    assert {l.kind for l in m.lasers} == {"fiber", "blue"}


def test_f1_ultra_identity():
    m = machines.get("F1Ultra")
    assert m.ext_id == "F1Ultra"
    assert m.ext_name == "F1 Ultra"
    assert [l.wattage for l in m.lasers] == [20, 20]
    assert {l.kind for l in m.lasers} == {"fiber", "blue"}


def test_f1_does_not_have_color_engrave():
    m = machines.get("F1Ultra")
    mode_ids = {mode.id for mode in m.modes}
    assert "color_engrave" not in mode_ids
    assert {"engrave", "score", "cut"} <= mode_ids


def test_f2_has_color_engrave():
    m = machines.get("F2Ultra")
    mode_ids = {mode.id for mode in m.modes}
    assert "color_engrave" in mode_ids


def test_unknown_machine_id_raises():
    with pytest.raises(KeyError, match="ZUltra"):
        machines.get("ZUltra")


def test_profile_for_known_pair():
    assert machines.profile_for("F1Ultra", "engrave") == "STANDARD"
    assert machines.profile_for("F2Ultra", "color_engrave") == "COLOR_ENGRAVE"
    assert machines.profile_for("F2Ultra", "engrave") == "STANDARD"


def test_profile_for_unsupported_pair_raises():
    with pytest.raises(KeyError, match="color_engrave"):
        machines.profile_for("F1Ultra", "color_engrave")


def test_blue_laser_is_rectangular_on_both():
    for mid in ("F1Ultra", "F2Ultra"):
        blue = next(l for l in machines.get(mid).lasers if l.kind == "blue")
        assert blue.spot_mm == (0.08, 0.10)


def test_fiber_laser_is_square_on_both():
    for mid in ("F1Ultra", "F2Ultra"):
        fiber = next(l for l in machines.get(mid).lasers if l.kind == "fiber")
        assert fiber.spot_mm == (0.03, 0.03)


def test_laser_for_returns_named_laser():
    m = machines.get("F2Ultra")
    fiber = machines.laser_for(m, "red")   # red == fiber, blue == diode
    assert fiber.kind == "fiber"
    blue = machines.laser_for(m, "blue")
    assert blue.kind == "blue"


def test_device_power_list_for_xcs():
    """The .xcs `device.power` field is a [w_fiber, w_blue] list."""
    assert machines.device_power("F1Ultra") == [20, 20]
    assert machines.device_power("F2Ultra") == [60, 40]
```

- [ ] **Step 1.2: Run tests to verify they fail.**

```bash
uv run --active pytest tests/test_machines.py -v
```

Expected: ImportError or ModuleNotFoundError (`xcs_gen.machines` does not exist yet).

- [ ] **Step 1.3: Implement the registry.**

Create `src/xcs_gen/machines.py`:

```python
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
    for l in machine.lasers:
        if l.kind == kind:
            return l
    raise KeyError(f"machine {machine.id!r} has no {kind!r} laser")


def device_power(machine_id: str) -> list[int]:
    """``device.power`` list as written to .xcs files: [fiber_w, blue_w]."""
    m = get(machine_id)
    fiber = next(l for l in m.lasers if l.kind == "fiber")
    blue  = next(l for l in m.lasers if l.kind == "blue")
    return [fiber.wattage, blue.wattage]
```

- [ ] **Step 1.4: Run tests to verify they pass.**

```bash
uv run --active pytest tests/test_machines.py -v
```

Expected: all 11 tests pass.

- [ ] **Step 1.5: Commit.**

```bash
git add src/xcs_gen/machines.py tests/test_machines.py
git commit -m "feat: machine registry with F1 Ultra + F2 Ultra entries"
```

---

## Task 2: Validation profiles — pure constraint evaluator

**Files:**
- Modify: `src/xcs_gen/machines.py` (append `PROFILES` + `validate_against_profile()`)
- Test: `tests/test_validation_profiles.py`

The evaluator is a pure function: `(profile_id, params_dict) → ValidationResult`. It's the engine that powers both server-side validation (Pydantic validators in `schemas.py`) and the frontend's form constraints (via `/api/machines`).

- [ ] **Step 2.1: Write the failing tests.**

Create `tests/test_validation_profiles.py`:

```python
"""Validation profile evaluator — snap stepped fields, reject out-of-range."""

from __future__ import annotations

import pytest

from xcs_gen import machines
from xcs_gen.machines import (
    PROFILES,
    ValidationError,
    validate_against_profile,
)


# -- Profile shape ------------------------------------------------------------

def test_both_profiles_defined():
    assert "STANDARD" in PROFILES
    assert "COLOR_ENGRAVE" in PROFILES


def test_standard_profile_field_set():
    assert set(PROFILES["STANDARD"].keys()) == {
        "power", "speed", "frequency", "density",
        "passes", "pulse_width", "laser",
    }


def test_color_engrave_profile_field_set():
    assert set(PROFILES["COLOR_ENGRAVE"].keys()) == {
        "power", "speed", "frequency", "density",
        "passes", "pulse_width", "laser",
    }


def test_standard_pulse_width_is_not_applicable():
    assert PROFILES["STANDARD"]["pulse_width"]["kind"] == "not_applicable"


def test_color_engrave_pulse_width_is_stepped():
    pw = PROFILES["COLOR_ENGRAVE"]["pulse_width"]
    assert pw["kind"] == "stepped"
    assert pw["values"][0] == 2 and pw["values"][-1] == 500


def test_standard_density_is_stepped():
    density = PROFILES["STANDARD"]["density"]
    assert density["kind"] == "stepped"
    assert density["values"][0] == 10
    assert density["values"][-1] == 200
    assert 200 in density["values"]
    assert 100 in density["values"]


def test_color_engrave_density_is_continuous_range():
    density = PROFILES["COLOR_ENGRAVE"]["density"]
    assert density["kind"] == "range"
    assert density["min"] == 1 and density["max"] == 5000


# -- Evaluator: stepped snapping ---------------------------------------------

def test_stepped_density_snaps_to_nearest():
    res = validate_against_profile("STANDARD", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 113,                    # nearest legal: 120
        "passes": 1, "laser": "red",
    })
    assert res.snapped["density"] == (113, 120)
    assert res.values["density"] == 120


def test_stepped_density_passes_through_legal_value():
    res = validate_against_profile("STANDARD", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100, "passes": 1, "laser": "red",
    })
    assert "density" not in res.snapped
    assert res.values["density"] == 100


def test_stepped_density_clamps_above_max():
    res = validate_against_profile("STANDARD", {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 9999, "passes": 1, "laser": "red",
    })
    # Snaps to the largest legal value (200).
    assert res.values["density"] == 200


# -- Evaluator: range rejection ----------------------------------------------

def test_range_frequency_rejects_above_max():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 999,    # over 60
            "density": 100, "passes": 1, "laser": "red",
        })
    assert exc.value.field == "frequency"


def test_range_frequency_rejects_below_min():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 5,     # below 30
            "density": 100, "passes": 1, "laser": "red",
        })
    assert exc.value.field == "frequency"


def test_range_speed_accepts_boundaries():
    for v in (2, 10000):
        res = validate_against_profile("STANDARD", {
            "power": 50, "speed": v, "frequency": 45,
            "density": 100, "passes": 1, "laser": "red",
        })
        assert res.values["speed"] == v


# -- Evaluator: not_applicable rejection -------------------------------------

def test_pulse_width_rejected_on_standard_when_present():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 45,
            "density": 100, "passes": 1, "laser": "red",
            "pulse_width": 200,
        })
    assert exc.value.field == "pulse_width"


def test_pulse_width_accepted_on_color_engrave_after_snap():
    res = validate_against_profile("COLOR_ENGRAVE", {
        "power": 50, "speed": 1000, "frequency": 200,
        "density": 100, "passes": 1, "laser": "red",
        "pulse_width": 47,                 # nearest legal: 45
    })
    assert res.snapped["pulse_width"] == (47, 45)
    assert res.values["pulse_width"] == 45


# -- Evaluator: enum rejection -----------------------------------------------

def test_unknown_laser_rejected():
    with pytest.raises(ValidationError) as exc:
        validate_against_profile("STANDARD", {
            "power": 50, "speed": 1000, "frequency": 45,
            "density": 100, "passes": 1, "laser": "green",
        })
    assert exc.value.field == "laser"


# -- Evaluator: integration with the registry --------------------------------

def test_profile_for_machine_round_trip():
    profile_id = machines.profile_for("F1Ultra", "engrave")
    res = validate_against_profile(profile_id, {
        "power": 50, "speed": 1000, "frequency": 45,
        "density": 100, "passes": 1, "laser": "red",
    })
    assert res.values["frequency"] == 45
```

- [ ] **Step 2.2: Run tests to verify they fail.**

```bash
uv run --active pytest tests/test_validation_profiles.py -v
```

Expected: ImportError on `PROFILES`, `ValidationError`, `validate_against_profile`.

- [ ] **Step 2.3: Implement profiles + evaluator.**

Append to `src/xcs_gen/machines.py`:

```python
# ── Validation profiles ──────────────────────────────────────────────────────

from .pulse_width import ALLOWED_PULSE_WIDTHS, snap_pulse_width

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
            # Range/stepped/enum fields are required; absence is the
            # caller's bug (Pydantic will catch it before we run, but be
            # explicit here for direct callers).
            continue
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
```

- [ ] **Step 2.4: Run tests to verify they pass.**

```bash
uv run --active pytest tests/test_validation_profiles.py tests/test_machines.py -v
```

Expected: all profile + registry tests pass.

- [ ] **Step 2.5: Commit.**

```bash
git add src/xcs_gen/machines.py tests/test_validation_profiles.py
git commit -m "feat: STANDARD + COLOR_ENGRAVE validation profiles + evaluator"
```

---

## Task 3: `Device` reads from registry — `.xcs` builder accepts `machine_id`

**Files:**
- Modify: `src/xcs_gen/model.py:139-145` (`Device` dataclass — drop hardcoded F2 defaults; require fields)
- Modify: `src/xcs_gen/builder.py:679-682` (already references `project.device.ext_id` etc — verify still works)
- Test: `tests/test_machine_device.py` (new)

The `.xcs` builder already reads `project.device.ext_id` / `ext_name` / `power` (see `src/xcs_gen/builder.py:679-682`). What changes is the `Device` defaults: instead of "always F2", it's "constructed from a registry entry". Code paths that currently rely on `Device()` with no args become `Device.from_machine("F2Ultra")` (or whatever the caller has).

- [ ] **Step 3.1: Write the failing tests.**

Create `tests/test_machine_device.py`:

```python
"""Device dataclass — constructed from the machine registry."""

from __future__ import annotations

import pytest

from xcs_gen.model import Device


def test_device_from_machine_f2():
    d = Device.from_machine("F2Ultra")
    assert d.ext_id == "GS004-CLASS-4"
    assert d.ext_name == "F2 Ultra"
    assert d.power == [60, 40]


def test_device_from_machine_f1():
    d = Device.from_machine("F1Ultra")
    assert d.ext_id == "F1Ultra"
    assert d.ext_name == "F1 Ultra"
    assert d.power == [20, 20]


def test_device_from_unknown_machine_raises():
    with pytest.raises(KeyError):
        Device.from_machine("ZUltra")
```

- [ ] **Step 3.2: Run tests to verify they fail.**

```bash
uv run --active pytest tests/test_machine_device.py -v
```

Expected: AttributeError (`Device.from_machine` doesn't exist).

- [ ] **Step 3.3: Add `from_machine()` to `Device`.**

Modify `src/xcs_gen/model.py:139-145`. Replace:

```python
@dataclass
class Device:
    """Laser device identity."""

    ext_id: str = "GS004-CLASS-4"
    ext_name: str = "F2 Ultra"
    power: list[int] = field(default_factory=lambda: [60, 40])
```

with:

```python
@dataclass
class Device:
    """Laser device identity. Constructed from the machine registry —
    see ``Device.from_machine``. The default constructor still produces
    F2 Ultra because plenty of legacy callers (tests, scripts) build a
    bare ``Device()`` and the F2 was the only supported machine before
    multi-machine landed; we keep that fallback so those callers don't
    break, but the canonical constructor is ``from_machine``."""

    ext_id: str = "GS004-CLASS-4"
    ext_name: str = "F2 Ultra"
    power: list[int] = field(default_factory=lambda: [60, 40])

    @classmethod
    def from_machine(cls, machine_id: str) -> "Device":
        # Imported lazily to avoid a model→machines→model import cycle.
        from .machines import device_power, get
        m = get(machine_id)
        return cls(
            ext_id=m.ext_id, ext_name=m.ext_name,
            power=device_power(machine_id),
        )
```

- [ ] **Step 3.4: Run tests to verify they pass.**

```bash
uv run --active pytest tests/test_machine_device.py -v
```

Expected: 3 tests pass.

- [ ] **Step 3.5: Commit.**

```bash
git add src/xcs_gen/model.py tests/test_machine_device.py
git commit -m "feat: Device.from_machine() reads identity from registry"
```

---

## Task 4: Builder + `.xcs` round-trip for F1 Ultra

**Files:**
- Modify: `src/xcs_gen/builder.py:31` (move `_STAINLESS_STEEL_XCS_MATERIAL_ID` confirmation comment — value stays)
- Test: `tests/test_xcs_builder_machines.py` (new)

The builder already uses `project.device.ext_id` etc. The end-to-end test we want is: give a project a device built from each machine, dump bytes, parse back, assert the identity fields are correct.

- [ ] **Step 4.1: Write the failing test.**

Create `tests/test_xcs_builder_machines.py`:

```python
"""End-to-end: build .xcs bytes for both machines, parse back, check identity."""

from __future__ import annotations

import json

from xcs_gen.builder import build_xcs_json
from xcs_gen.model import Device, Rect, XCSProject


def _project_for(machine_id: str) -> XCSProject:
    return XCSProject(
        device=Device.from_machine(machine_id),
        elements=[
            Rect(
                x=10, y=10, width=10, height=10,
                power=50, speed=1000, frequency=45, density=100,
                passes=1, pulse_width=200, laser="red",
                processing_type="VECTOR_ENGRAVING",
            ),
        ],
    )


def test_f2_ultra_roundtrip_identity():
    raw = build_xcs_json(_project_for("F2Ultra"))
    j = json.loads(raw)
    assert j["extId"] == "GS004-CLASS-4"
    assert j["extName"] == "F2 Ultra"
    assert j["device"]["id"] == "GS004-CLASS-4"
    assert j["device"]["power"] == [60, 40]


def test_f1_ultra_roundtrip_identity():
    raw = build_xcs_json(_project_for("F1Ultra"))
    j = json.loads(raw)
    assert j["extId"] == "F1Ultra"
    assert j["extName"] == "F1 Ultra"
    assert j["device"]["id"] == "F1Ultra"
    assert j["device"]["power"] == [20, 20]
```

- [ ] **Step 4.2: Inspect `build_xcs_json` signature** (it's the function that returns the `.xcs` JSON string — check it exists with that name).

```bash
grep -n "def build_xcs_json\|def build_xcs\|^def " src/xcs_gen/builder.py | head -10
```

Expected: `build_xcs_json` exists. If the function has a different name, adjust the import in the test to match (e.g. `build_xcs_bytes`, `to_xcs_json`).

- [ ] **Step 4.3: Run the test to verify it passes (no implementation needed — Task 3 already wired Device).**

```bash
uv run --active pytest tests/test_xcs_builder_machines.py -v
```

Expected: both tests pass. If the builder's import path is different from `build_xcs_json`, adjust the test import.

- [ ] **Step 4.4: Commit.**

```bash
git add tests/test_xcs_builder_machines.py
git commit -m "test: builder round-trips F1 Ultra + F2 Ultra identity"
```

---

## Task 5: Wire `bytes_for_test` to use the test's `machine_id`

**Files:**
- Modify: `src/xcs_gen_web/services/xcs.py:17-45` — accept `machine_id`; pass it into the converter so the resulting Project carries the right `Device`.
- Modify: `src/xcs_gen_web/converter.py` — accept and propagate `machine_id` to the constructed `XCSProject` (currently constructs an `XCSProject()` with default Device).
- Modify: `src/xcs_gen_web/app.py:903-920` — `tests_generate` reads `machine_id` from the test row and passes it through.

The test row will gain a `machine_id` column in Task 7. Until then, `bytes_for_test` will accept the parameter and we'll thread it through; default to `"F2Ultra"` only at the very edge so existing call sites keep compiling.

- [ ] **Step 5.1: Find where `XCSProject` is constructed in `converter.py`.**

```bash
grep -n "XCSProject(" src/xcs_gen_web/converter.py
```

- [ ] **Step 5.2: Modify `converter.project_to_xcs_bytes` to accept `machine_id`.**

The current signature is roughly `def project_to_xcs_bytes(project: Project) -> bytes`. Add a `machine_id: str` keyword argument. Where the function constructs `XCSProject(...)` (search for the constructor call), build it with `device=Device.from_machine(machine_id)`. Add the `Device` import at the top.

Concrete edits depend on the file's current shape; inspect first:

```bash
sed -n '1,30p' src/xcs_gen_web/converter.py
grep -n "XCSProject\|return XCSProject\|^def " src/xcs_gen_web/converter.py | head -20
```

Then:
- Add `from xcs_gen.model import Device` to the imports if not present.
- Change `def project_to_xcs_bytes(project: Project) -> bytes:` to
  `def project_to_xcs_bytes(project: Project, *, machine_id: str = "F2Ultra") -> bytes:`
- Where the `XCSProject(...)` is constructed inside, pass `device=Device.from_machine(machine_id)`.

- [ ] **Step 5.3: Modify `bytes_for_test` to accept and forward `machine_id`.**

In `src/xcs_gen_web/services/xcs.py:17`, change:

```python
def bytes_for_test(*, test_id: int, name: str, material_id: int,
                   spec: dict[str, Any], retest_index: int = 0) -> bytes:
```

to:

```python
def bytes_for_test(*, test_id: int, name: str, material_id: int,
                   spec: dict[str, Any], retest_index: int = 0,
                   machine_id: str = "F2Ultra") -> bytes:
```

And replace the final return with:

```python
return converter.project_to_xcs_bytes(
    Project.model_validate(project), machine_id=machine_id,
)
```

- [ ] **Step 5.4: Modify `tests_generate` in `app.py` to read `machine_id` from the row and forward it.**

In `src/xcs_gen_web/app.py:903-920`, the handler currently calls:

```python
body = xcs_service.bytes_for_test(
    test_id=t["id"], name=t["name"],
    material_id=t["material_id"], spec=t["spec"],
    retest_index=t.get("retest_index", 0),
)
```

Change to:

```python
body = xcs_service.bytes_for_test(
    test_id=t["id"], name=t["name"],
    material_id=t["material_id"], spec=t["spec"],
    retest_index=t.get("retest_index", 0),
    machine_id=t.get("machine_id", "F2Ultra"),
)
```

- [ ] **Step 5.5: Run the existing test suite — nothing should regress.**

```bash
uv run --active pytest tests/ -q
```

Expected: all tests pass (the default `"F2Ultra"` keeps existing behaviour).

- [ ] **Step 5.6: Commit.**

```bash
git add src/xcs_gen_web/services/xcs.py src/xcs_gen_web/converter.py src/xcs_gen_web/app.py
git commit -m "feat: bytes_for_test threads machine_id through to .xcs builder"
```

---

## Task 6: Per-laser beam spec in `converter.py`

**Files:**
- Modify: `src/xcs_gen_web/converter.py:15-16` (drop the hardcoded `BEAM_WIDTH_MM` constant; read from machine registry per laser)
- Modify: `src/xcs_gen_web/converter.py:115-119` (the size-vs-spot warning loop)
- Modify: `src/xcs_gen/cli.py:13` (drop the F2-specific comment)
- Test: `tests/test_beam_width.py` (new)

The current code uses a single `BEAM_WIDTH_MM = 0.03` for the spot size when warning the user about elements too small to engrave. With multi-machine, the spot is `(width, height)` per laser per machine. Pass the active machine's fiber spot in (color engrave is fiber-laser-only on F2; F1 elements use whichever laser the element specifies).

- [ ] **Step 6.1: Inspect the current usage to understand context.**

```bash
sed -n '10,30p' src/xcs_gen_web/converter.py
sed -n '110,125p' src/xcs_gen_web/converter.py
```

- [ ] **Step 6.2: Write the failing test.**

Create `tests/test_beam_width.py`:

```python
"""Beam-spot warning: derives from the machine's fiber laser by default."""

from __future__ import annotations

from xcs_gen_web import converter


def test_default_beam_width_matches_f2_fiber():
    # Backwards-compat default — F2 fiber is 0.03mm.
    assert converter.beam_width_for_machine("F2Ultra") == 0.03


def test_beam_width_for_f1_fiber():
    assert converter.beam_width_for_machine("F1Ultra") == 0.03


def test_beam_width_uses_min_spot_dimension():
    # Blue laser is rectangular (0.08, 0.10); the warning uses the
    # smaller dimension because that's what bounds adjacent-element
    # collisions on the narrow axis.
    assert converter.beam_width_for_machine("F2Ultra", laser="blue") == 0.08
```

- [ ] **Step 6.3: Replace the hardcoded constant with a registry lookup.**

In `src/xcs_gen_web/converter.py`, replace lines 14-16:

```python
# F2 Ultra MOPA beam spot size. Mirrors web/src/validation.ts BEAM_WIDTH_MM.
BEAM_WIDTH_MM = 0.03
```

with:

```python
def beam_width_for_machine(machine_id: str, *, laser: str = "red") -> float:
    """Smallest spot dimension of the named laser on ``machine_id``.

    Used to warn when an element is narrower than what the laser can
    resolve — adjacent thin elements would merge in the burn. Defaults
    to the fiber laser ("red") because that's what color engraving uses
    and what the legacy single-machine code assumed.
    """
    from xcs_gen.machines import get, laser_for
    spec = laser_for(get(machine_id), laser)  # type: ignore[arg-type]
    return min(spec.spot_mm)
```

For the warning loop at lines 115-119, the cleanest fix is to change the function that emits the warning to take a `machine_id` parameter and call `beam_width_for_machine`. Find the function (search outward from the warning):

```bash
grep -n "BEAM_WIDTH_MM\|elem_w" src/xcs_gen_web/converter.py
```

For each call site of the warning function, thread `machine_id` through. If the warning lives inside `project_to_xcs_bytes`, pull the value once at the top:

```python
beam_w = beam_width_for_machine(machine_id)
# ... and replace BEAM_WIDTH_MM with beam_w in the warning lines.
```

- [ ] **Step 6.4: Run the new test.**

```bash
uv run --active pytest tests/test_beam_width.py -v
```

Expected: 3 tests pass.

- [ ] **Step 6.5: Run the full backend suite — nothing should regress.**

```bash
uv run --active pytest tests/ -q
```

Expected: green.

- [ ] **Step 6.6: Drop the F2-specific comment from `cli.py`.**

In `src/xcs_gen/cli.py:13`, replace:

```python
# F2 Ultra MOPA spot size: 0.03mm (30 microns)
```

with:

```python
# Default beam spot — F2/F1 fiber lasers are both 30µm. Per-machine
# values live in xcs_gen.machines.
```

- [ ] **Step 6.7: Commit.**

```bash
git add src/xcs_gen_web/converter.py src/xcs_gen/cli.py tests/test_beam_width.py
git commit -m "feat: per-machine/per-laser beam spot, replacing F2 constant"
```

---

## Task 7: Alembic migration `0009_machine_id`

**Files:**
- Create: `alembic/versions/0009_machine_id.py`
- Modify: `src/xcs_gen_web/models.py:96-190` — add `machine_id` columns to `presets`, `tests`, `palette_entries`
- Modify: `.github/workflows/ci.yml:144` — bump assertion to `0009`
- Test: existing `tests/test_db_models.py` exercises migration via `fresh_db` fixture

Adds `machine_id VARCHAR(32) NOT NULL` to three tables, backfills all existing rows to `'F2Ultra'`, adds a `(owner_id, machine_id)` index. Idempotent on re-run via batch_alter.

- [ ] **Step 7.1: Add columns to the SQLAlchemy table definitions.**

In `src/xcs_gen_web/models.py`, add a constant near the other length constants (around line 51):

```python
_MACHINE_ID_LEN = 32     # registry ids are short ASCII (e.g. "F2Ultra"); 32 = headroom
```

Add the `machine_id` column to `presets` (after `material_id` column near line 100):

```python
Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
```

Add the same column to `tests` (after `material_id` near line 117):

```python
Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
```

Add the same column to `palette_entries` (after `material_id` near line 166):

```python
Column("machine_id", String(_MACHINE_ID_LEN), nullable=False, server_default="F2Ultra"),
```

For each of the three tables, add an index next to the existing `ix_*_owner` index:

```python
Index("ix_presets_owner_machine", "owner_id", "machine_id"),
Index("ix_tests_owner_machine", "owner_id", "machine_id"),
Index("ix_palette_entries_owner_machine", "owner_id", "machine_id"),
```

The `server_default="F2Ultra"` keeps existing tests/code that insert rows without specifying `machine_id` working during the transition; we'll drop the default in a later refactor only if it ever causes confusion.

- [ ] **Step 7.2: Create the migration.**

Create `alembic/versions/0009_machine_id.py`:

```python
"""Add machine_id to tests / palette_entries / presets

Adds machine_id VARCHAR(32) NOT NULL to each of the three tables and
backfills all existing rows to 'F2Ultra' (the only machine supported
before this migration). Adds a composite (owner_id, machine_id) index
on each since list endpoints filter by both columns.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


_MACHINE_ID_LEN = 32
_DEFAULT = "F2Ultra"


def _add_machine_column(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.add_column(
            sa.Column(
                "machine_id",
                sa.String(_MACHINE_ID_LEN),
                nullable=False,
                server_default=_DEFAULT,
            ),
        )
    # Belt-and-braces backfill — server_default handles new rows during
    # the ALTER on most engines, but explicitly setting it covers any
    # backend where the default isn't applied to pre-existing rows.
    op.execute(sa.text(f"UPDATE {table_name} SET machine_id = :v WHERE machine_id IS NULL OR machine_id = ''").bindparams(v=_DEFAULT))


def _drop_machine_column(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.drop_column("machine_id")


def upgrade() -> None:
    for t in ("presets", "tests", "palette_entries"):
        _add_machine_column(t)
    op.create_index("ix_presets_owner_machine", "presets", ["owner_id", "machine_id"])
    op.create_index("ix_tests_owner_machine", "tests", ["owner_id", "machine_id"])
    op.create_index("ix_palette_entries_owner_machine", "palette_entries", ["owner_id", "machine_id"])


def downgrade() -> None:
    op.drop_index("ix_palette_entries_owner_machine", table_name="palette_entries")
    op.drop_index("ix_tests_owner_machine", table_name="tests")
    op.drop_index("ix_presets_owner_machine", table_name="presets")
    for t in ("palette_entries", "tests", "presets"):
        _drop_machine_column(t)
```

- [ ] **Step 7.3: Bump the CI revision assertion.**

In `.github/workflows/ci.yml:144`, change:

```yaml
          test "$VER" = "0008"
```

to:

```yaml
          test "$VER" = "0009"
```

- [ ] **Step 7.4: Verify the migration applies cleanly to a fresh SQLite DB.**

```bash
rm -f /tmp/xcs-mig-test.db
XCS_GEN_DB_URL="sqlite:////tmp/xcs-mig-test.db" uv run --active alembic upgrade head
XCS_GEN_DB_URL="sqlite:////tmp/xcs-mig-test.db" uv run --active alembic current
```

Expected: `current` reports `0009 (head)`.

- [ ] **Step 7.5: Run the full backend suite to verify the model + migration is consistent.**

```bash
uv run --active pytest tests/ -q
```

Expected: green. The `fresh_db` fixture in `tests/conftest.py:34-44` runs `alembic upgrade head` for each test, so this exercises the migration on every test that uses it.

- [ ] **Step 7.6: Commit.**

```bash
git add alembic/versions/0009_machine_id.py src/xcs_gen_web/models.py .github/workflows/ci.yml
git commit -m "feat: migration 0009 — machine_id on tests/palette/presets"
```

---

## Task 8: Repositories accept and persist `machine_id`

**Files:**
- Modify: `src/xcs_gen_web/repositories/tests.py`
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Modify: `src/xcs_gen_web/repositories/presets.py`
- Test: `tests/test_repo_machines.py` (new)

Each `create()` now accepts `machine_id` and persists it. `_row(...)` / `_row_to_dict(...)` includes it in the returned dict. `list_*` accepts an optional `machine_id` filter. `update()` rejects `machine_id` changes (immutable). Cross-table consistency: a palette entry whose `test_id` references a test with a different `machine_id` is rejected at insert.

- [ ] **Step 8.1: Write the failing tests.**

Create `tests/test_repo_machines.py`:

```python
"""Repository changes for machine_id — persistence, filtering, immutability."""

from __future__ import annotations

import pytest

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import presets as p_repo
from xcs_gen_web.repositories import tests as t_repo


BASE_PARAMS = {
    "power": 50, "speed": 1000, "frequency": 45,
    "density": 100, "passes": 1, "pulse_width": 200, "laser": "red",
}
SPEC = {"x_param": "power", "x_min": 10, "x_max": 90, "x_steps": 5,
        "rows": 1, "width_mm": 50, "height_mm": 50, "gap_mm": 1,
        "base_params": BASE_PARAMS}


def test_test_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    assert t["machine_id"] == "F1Ultra"
    assert t_repo.get(t["id"])["machine_id"] == "F1Ultra"


def test_test_machine_id_defaults_to_f2(fresh_db):
    """Backwards-compat: callers that omit machine_id get the default."""
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC)
    assert t["machine_id"] == "F2Ultra"


def test_test_machine_id_immutable(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    with pytest.raises(t_repo.MachineImmutableError):
        t_repo.update(t["id"], machine_id="F2Ultra")


def test_list_tests_filters_by_machine(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    f1 = t_repo.create(name="f1", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    f2 = t_repo.create(name="f2", material_id=mid, spec=SPEC, machine_id="F2Ultra")
    only_f1 = t_repo.list_all(machine_id="F1Ultra")
    only_f2 = t_repo.list_all(machine_id="F2Ultra")
    assert {t["id"] for t in only_f1} == {f1["id"]}
    assert {t["id"] for t in only_f2} == {f2["id"]}


def test_preset_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p = p_repo.create(material_id=mid, name="default", color=None,
                      base_params=BASE_PARAMS, machine_id="F1Ultra")
    assert p["machine_id"] == "F1Ultra"
    assert p_repo.get(p["id"])["machine_id"] == "F1Ultra"


def test_preset_machine_id_immutable(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p = p_repo.create(material_id=mid, name="d", color=None,
                      base_params=BASE_PARAMS, machine_id="F1Ultra")
    with pytest.raises(p_repo.MachineImmutableError):
        p_repo.update(p["id"], machine_id="F2Ultra")


def test_palette_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    entry = {
        "test_id": None, "material_id": mid,
        "hex": "#aa00bb", "params": {}, "sigma": 0.0, "source": "manual",
        "machine_id": "F1Ultra",
    }
    [pid] = pal_repo.insert_bulk([entry])
    rows = pal_repo.list_all(machine_id="F1Ultra")
    assert any(r["id"] == pid for r in rows)
    assert all(r["machine_id"] == "F1Ultra" for r in rows)


def test_palette_machine_must_match_test(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F2Ultra")
    bad = {
        "test_id": t["id"], "material_id": mid,
        "hex": "#ff0000", "params": {}, "sigma": 0.0, "source": "averaged",
        "machine_id": "F1Ultra",     # mismatch
    }
    with pytest.raises(pal_repo.MachineMismatchError):
        pal_repo.insert_bulk([bad])
```

- [ ] **Step 8.2: Run tests to verify they fail.**

```bash
uv run --active pytest tests/test_repo_machines.py -v
```

Expected: ImportError on `MachineImmutableError` / `MachineMismatchError`, or `TypeError` on the new kwargs.

- [ ] **Step 8.3: Update `tests` repository.**

Edit `src/xcs_gen_web/repositories/tests.py`:

In `_row()` (around line 29), add to the returned dict:

```python
"machine_id": getattr(r, "machine_id", "F2Ultra"),
```

Add the new error class near `LockedError`:

```python
class MachineImmutableError(Exception):
    """machine_id changes attempted post-creation."""
```

Change `create()` (around line 49):

```python
def create(
    *, name: str, material_id: int, spec: dict[str, Any],
    notes: str = "", owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
    machine_id: str = "F2Ultra",
) -> dict[str, Any]:
    ts = _now()
    with session_scope() as s:
        res = s.execute(tests.insert().values(
            name=name, material_id=material_id,
            machine_id=machine_id,
            status="created",
            spec_json=json.dumps(spec, separators=(",", ":")),
            notes=notes, created_at=ts, updated_at=ts, locked=0,
            owner_id=owner_id, visibility=visibility,
        ))
        tid = res.inserted_primary_key[0]
    return get(tid, owner_id=owner_id)  # type: ignore[return-value]
```

Change `list_all()` (around line 77):

```python
def list_all(
    *, owner_id: int = STANDALONE_USER_ID,
    material_id: int | None = None,
    status: str | None = None,
    machine_id: str | None = None,
) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(tests).where(tests.c.owner_id == owner_id)
        if material_id is not None:
            q = q.where(tests.c.material_id == material_id)
        if machine_id is not None:
            q = q.where(tests.c.machine_id == machine_id)
        if status is not None:
            q = q.where(tests.c.status == status)
        else:
            q = q.where(tests.c.status != "deleted")
        q = q.order_by(tests.c.id.desc())
        return [_row(r) for r in s.execute(q).all()]
```

Change `update()` (around line 94) to reject `machine_id` changes:

```python
def update(
    tid: int, *, owner_id: int = STANDALONE_USER_ID,
    name: str | None = None, notes: str | None = None,
    spec: dict[str, Any] | None = None,
    material_id: int | None = None,
    visibility: str | None = None,
    machine_id: str | None = None,
) -> dict[str, Any] | None:
    cur = get(tid, owner_id=owner_id)
    if cur is None:
        return None
    if machine_id is not None and machine_id != cur["machine_id"]:
        raise MachineImmutableError(
            f"test {tid}: machine_id is immutable "
            f"(current {cur['machine_id']!r}, requested {machine_id!r})",
        )
    # ...rest of the function unchanged
```

- [ ] **Step 8.4: Update `presets` repository.**

Edit `src/xcs_gen_web/repositories/presets.py`. Same pattern:

Add a `MachineImmutableError` exception class.

In `_row_to_dict()` (around line 21), include `"machine_id"`.

`create()` accepts `machine_id: str = "F2Ultra"` and inserts it.

`update()` rejects `machine_id` changes with `MachineImmutableError`.

`list_all()` and `list_by_material()` accept `machine_id: str | None = None` and add a `where` clause when set.

- [ ] **Step 8.5: Update `palette` repository.**

Edit `src/xcs_gen_web/repositories/palette.py`:

Add the new error class near `NotMutableError`:

```python
class MachineMismatchError(Exception):
    """A palette entry's machine_id doesn't match its referenced test."""
```

In `_row_to_entry()` (around line 31), add `"machine_id": r.machine_id`.

In `_build_row()` (around line 52), add to the returned dict:

```python
"machine_id": e["machine_id"],
```

In `insert_bulk()` (around line 75), before the loop, validate cross-table consistency:

```python
def _check_machine_matches_test(s, e: dict[str, Any]) -> None:
    if e.get("test_id") is None:
        return
    from ..models import tests as tests_table
    row = s.execute(
        select(tests_table.c.machine_id).where(tests_table.c.id == e["test_id"])
    ).one_or_none()
    if row is None:
        return  # test deletion is allowed; the FK handles dangling refs
    test_machine = row.machine_id
    entry_machine = e["machine_id"]
    if test_machine != entry_machine:
        raise MachineMismatchError(
            f"palette entry machine_id {entry_machine!r} does not match "
            f"test {e['test_id']} machine_id {test_machine!r}",
        )
```

Then call it inside `insert_bulk` before the actual insert:

```python
def insert_bulk(
    entries: Iterable[dict[str, Any]], *, owner_id: int = STANDALONE_USER_ID,
    visibility: str = DEFAULT_VISIBILITY,
) -> list[int]:
    now = _now()
    rows = [_build_row(e, now, owner_id, visibility) for e in entries]
    if not rows:
        return []
    with session_scope() as s:
        for e in entries:
            _check_machine_matches_test(s, e)
        ids: list[int] = []
        for row in rows:
            res = s.execute(palette_entries.insert().values(**row))
            ids.append(res.inserted_primary_key[0])
        return ids
```

(Same check in `replace_for_test` if it has the same shape.)

`list_all()` accepts `machine_id: str | None = None` and adds the `where` clause when set.

The default for `machine_id` in `_build_row` should be `"F2Ultra"` if absent (backwards compat with old callers):

```python
"machine_id": e.get("machine_id", "F2Ultra"),
```

- [ ] **Step 8.6: Run the new repo tests.**

```bash
uv run --active pytest tests/test_repo_machines.py -v
```

Expected: 8 tests pass.

- [ ] **Step 8.7: Run the full backend suite — nothing should regress.**

```bash
uv run --active pytest tests/ -q
```

Expected: green. The `STANDALONE_USER_ID` and `DEFAULT_VISIBILITY` defaults plus the `"F2Ultra"` machine_id default mean existing tests don't have to change.

- [ ] **Step 8.8: Commit.**

```bash
git add src/xcs_gen_web/repositories/tests.py src/xcs_gen_web/repositories/presets.py src/xcs_gen_web/repositories/palette.py tests/test_repo_machines.py
git commit -m "feat: repositories persist + scope by machine_id"
```

---

## Task 9: `GET /api/machines` endpoint + `/api/health` enrichment

**Files:**
- Modify: `src/xcs_gen_web/app.py:306-310` (extend `/api/health` payload)
- Modify: `src/xcs_gen_web/app.py` (add `/api/machines` near other read-only endpoints)
- Test: `tests/test_machines_endpoint.py` (new)

The endpoint serializes the registry to JSON. Everything is static for the app's lifetime; cache headers can be added later if measurement shows it matters.

- [ ] **Step 9.1: Write the failing test.**

Create `tests/test_machines_endpoint.py`:

```python
"""GET /api/machines — full registry payload + /api/health enrichment."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _client(fresh_db) -> TestClient:
    return TestClient(create_app())


def test_health_returns_available_machines(fresh_db):
    r = _client(fresh_db).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert "available_machines" in body
    assert {"F2Ultra", "F1Ultra"} <= set(body["available_machines"])


def test_machines_endpoint_shape(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    assert r.status_code == 200
    body = r.json()
    assert "machines" in body and "profiles" in body
    ids = {m["id"] for m in body["machines"]}
    assert {"F1Ultra", "F2Ultra"} <= ids
    assert "STANDARD" in body["profiles"]
    assert "COLOR_ENGRAVE" in body["profiles"]


def test_machines_endpoint_includes_image_url(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    f1 = next(m for m in body["machines"] if m["id"] == "F1Ultra")
    assert f1["image"].startswith("/static/machines/")
    assert f1["image"].endswith(".png")


def test_machines_endpoint_lasers_have_spot_dimensions(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    f2 = next(m for m in body["machines"] if m["id"] == "F2Ultra")
    fiber = next(l for l in f2["lasers"] if l["kind"] == "fiber")
    assert fiber["wattage"] == 60
    assert fiber["spot_mm"] == [0.03, 0.03]


def test_machines_endpoint_modes_carry_profile(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    f2 = next(m for m in body["machines"] if m["id"] == "F2Ultra")
    color = next(m for m in f2["modes"] if m["id"] == "color_engrave")
    assert color["profile"] == "COLOR_ENGRAVE"


def test_profiles_payload_matches_registry(fresh_db):
    """Spot-check the profile payload survives JSON round-trip."""
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    standard = body["profiles"]["STANDARD"]
    assert standard["pulse_width"]["kind"] == "not_applicable"
    assert standard["density"]["kind"] == "stepped"
    assert 200 in standard["density"]["values"]
    assert standard["frequency"] == {"kind": "range", "min": 30, "max": 60}
```

- [ ] **Step 9.2: Run tests to verify they fail.**

```bash
uv run --active pytest tests/test_machines_endpoint.py -v
```

Expected: 404 on `/api/machines`; `/api/health` test fails on `available_machines`.

- [ ] **Step 9.3: Add the `/api/health` enrichment.**

In `src/xcs_gen_web/app.py:306-310`, change:

```python
    @app.get("/api/health")
    def health() -> dict[str, str]:
        # Exposes mode so the frontend can adapt its UI (e.g. show a
        # user-id header prompt) without a separate discovery endpoint.
        return {"status": "ok", "mode": settings.mode}
```

to:

```python
    @app.get("/api/health")
    def health() -> dict[str, object]:
        # Exposes mode so the frontend can adapt its UI (e.g. show a
        # user-id header prompt) without a separate discovery endpoint.
        # ``available_machines`` is the cheap-to-fetch list of registry
        # ids so the bootstrap can render the machine switcher without
        # a second round-trip; the full registry comes from /api/machines.
        from xcs_gen.machines import known_ids
        return {
            "status": "ok",
            "mode": settings.mode,
            "available_machines": list(known_ids()),
        }
```

- [ ] **Step 9.4: Add the `/api/machines` endpoint.**

In `src/xcs_gen_web/app.py`, add a new endpoint near `/api/health` (right after it):

```python
    @app.get("/api/machines")
    def machines_list() -> dict:
        """Static registry payload — machines + validation profiles.

        Cacheable indefinitely from the frontend's perspective; add an
        ETag header here later if the payload size or request volume
        warrants it. For now, just serialise.
        """
        from dataclasses import asdict
        from xcs_gen.machines import all_machines, PROFILES
        machines_out: list[dict] = []
        for m in all_machines():
            d = asdict(m)
            d["image"] = f"/static/machines/{d['image']}"
            machines_out.append(d)
        return {"machines": machines_out, "profiles": PROFILES}
```

- [ ] **Step 9.5: Mount the static directory for machine images.**

The plan ships PNGs under `web/public/machines/`; the build copies `web/public/` into `web/dist/` which is already served as the SPA root. Confirm the existing static mount behaviour by inspecting how `web/dist/` is mounted:

```bash
grep -n "StaticFiles\|app.mount" src/xcs_gen_web/app.py
```

The `web/dist/` mount at `/` already serves `/machines/<file>.png` if files land in `web/public/machines/`. To match the `/static/machines/` URL the registry exposes, add an explicit mount before the `web/dist/` mount in `create_app()`. Find the existing `web/dist/` mount line (search for `app.mount("/", StaticFiles` or similar) and add this right before it:

```python
# Per-machine product images. Mounted at /static/machines so the
# /api/machines payload can return absolute, cache-friendly URLs that
# don't collide with the SPA root mount.
import os
machines_dir = os.path.join(os.path.dirname(__file__), "..", "..", "web", "public", "machines")
machines_dir = os.path.abspath(machines_dir)
if os.path.isdir(machines_dir):
    app.mount(
        "/static/machines",
        StaticFiles(directory=machines_dir),
        name="machine-images",
    )
```

(If the plan-time `web/public/machines/` directory doesn't exist yet, the mount is skipped — the directory is created in Task 12 when images are added.)

- [ ] **Step 9.6: Run the endpoint tests to verify they pass.**

```bash
uv run --active pytest tests/test_machines_endpoint.py -v
```

Expected: 6 tests pass. (The "image starts with /static/machines/" test will pass because the URL prefix is hardcoded; the actual image file existence is checked in Task 12.)

- [ ] **Step 9.7: Run the full backend suite.**

```bash
uv run --active pytest tests/ -q
```

Expected: green.

- [ ] **Step 9.8: Commit.**

```bash
git add src/xcs_gen_web/app.py tests/test_machines_endpoint.py
git commit -m "feat: GET /api/machines + /api/health lists available machines"
```

---

## Task 10: Schemas + endpoints accept `machine_id` on writes

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `machine_id` to `TestCreate`, `PresetCreate`, `PaletteEntryCreateManual`, and the corresponding response models)
- Modify: `src/xcs_gen_web/app.py` (read query params + body fields; validate against profile)

The API contract change: `machine_id` becomes a required field in create bodies and a required query param on list endpoints. Validation runs at the boundary using `validate_against_profile`.

- [ ] **Step 10.1: Add `machine_id` to schemas.**

In `src/xcs_gen_web/schemas.py`:

`TestCreate` (around line 461) gains `machine_id: str = Field(min_length=1, max_length=32)`.

`TestResponse` (around line 478) gains `machine_id: str`.

`TestUpdate` does **not** gain `machine_id` (immutable; reject any attempt at the API layer with 422 below).

`PresetCreate` (around line 411) gains `machine_id: str = Field(min_length=1, max_length=32)`.

`PresetResponse` (around line 424) gains `machine_id: str`.

`PaletteEntryCreateManual` (around line 359) gains `machine_id: str = Field(min_length=1, max_length=32)`.

`PaletteEntryResponse` (around line 324) gains `machine_id: str`.

Add a small validator on each new field that 422s an unknown machine id:

```python
@field_validator("machine_id")
@classmethod
def _machine_id_known(cls, v: str) -> str:
    from xcs_gen.machines import known_ids
    if v not in known_ids():
        raise ValueError(f"unknown machine_id: {v!r}")
    return v
```

(The existing `from xcs_gen.pulse_width import ...` import already establishes that `xcs_gen` is importable from `xcs_gen_web`; add this import at the top of the relevant `BaseModel` classes or once at module scope.)

- [ ] **Step 10.2: Wire `machine_id` through the test endpoints.**

In `src/xcs_gen_web/app.py:836-857`:

`tests_create` becomes:

```python
    @app.post("/api/tests", response_model=TestResponse, status_code=201)
    def tests_create(
        body: TestCreate, user_id: int = Depends(get_current_user),
    ) -> TestResponse:
        if m_repo.get(body.material_id, owner_id=user_id) is None:
            raise HTTPException(status_code=400, detail="unknown material_id")
        # Validate the test's params against the profile selected by
        # (machine_id, mode). Mode lookup falls back to STANDARD if the
        # spec doesn't carry one — pre-multi-machine specs predate the
        # mode concept and behave like STANDARD on F2.
        from xcs_gen.machines import profile_for, ValidationError as ProfileError
        spec_dict = body.spec.model_dump()
        mode = spec_dict.get("base_params", {}).get("mode", "engrave")
        try:
            profile_id = profile_for(body.machine_id, mode)
        except KeyError as e:
            raise HTTPException(status_code=422, detail=str(e))
        try:
            from xcs_gen.machines import validate_against_profile
            validate_against_profile(profile_id, spec_dict["base_params"])
        except ProfileError as e:
            raise HTTPException(status_code=422, detail={"field": e.field, "message": e.message})
        t = t_repo.create(
            name=body.name, material_id=body.material_id,
            spec=spec_dict, notes=body.notes,
            owner_id=user_id,
            machine_id=body.machine_id,
        )
        return TestResponse(**t)
```

`tests_list` accepts the new query param:

```python
    @app.get("/api/tests", response_model=list[TestResponse])
    def tests_list(
        material_id: int | None = None,
        status: str | None = None,
        machine_id: str | None = None,
        user_id: int = Depends(get_current_user),
    ) -> list[TestResponse]:
        return [TestResponse(**t) for t in t_repo.list_all(
            owner_id=user_id, material_id=material_id, status=status,
            machine_id=machine_id,
        )]
```

`tests_patch` rejects machine_id mutation if any client tries to inject one. Since `TestUpdate` doesn't define the field, Pydantic already drops it — no change needed unless we want to surface a 422 explicitly. We don't.

- [ ] **Step 10.3: Wire `machine_id` through the presets endpoints.**

In `src/xcs_gen_web/app.py:771-792`:

`presets_create` adds `machine_id=body.machine_id` to the `p_repo.create(...)` call.

`presets_list` adds `machine_id: str | None = None` query param and passes it to the repo (you may also need to add the `machine_id` filter to `list_by_material` in `presets.py`).

- [ ] **Step 10.4: Wire `machine_id` through the palette endpoints.**

In `src/xcs_gen_web/app.py:627-687`:

`/api/palette/manual` POST: pass `machine_id` from body into the entry dict before insert.

`/api/palette` GET, `/api/palette/query` GET: accept `machine_id: str | None = None` query param and pass to the repo.

- [ ] **Step 10.5: Run the full backend suite.**

```bash
uv run --active pytest tests/ -q
```

Expected: green. The new fields default to omitted on existing tests; validators are additive.

- [ ] **Step 10.6: Commit.**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py src/xcs_gen_web/repositories/presets.py
git commit -m "feat: API endpoints accept machine_id on writes + as list filter"
```

---

## Task 11: Frontend types + machine context hook

**Files:**
- Modify: `web/src/types.ts` (add `Machine`, `LaserSpec`, `ModeSpec`, `ValidationProfile`, `FieldConstraint`; add `machine_id` to `TestRecord`, `PaletteEntry`, `Preset` types)
- Create: `web/src/api/machines.ts`
- Create: `web/src/state/machine.ts`
- Test: `web/src/state/machine.test.ts` (vitest)

The hook is the entry point for everything else on the frontend. Persists current machine choice in localStorage with `F2Ultra` cold-start fallback.

- [ ] **Step 11.1: Add the new TypeScript types.**

In `web/src/types.ts`, append (at the bottom, near the existing exports):

```typescript
// ── Machine registry (mirrors xcs_gen.machines.MACHINES + PROFILES) ──────────

export type LaserKind = "fiber" | "blue";
export type LaserName = "red" | "blue";   // wire format used inside .xcs files
export type ModeId = "engrave" | "score" | "cut" | "color_engrave";
export type ProfileId = "STANDARD" | "COLOR_ENGRAVE";

export interface MachineLaser {
  kind: LaserKind;
  wattage: number;
  spot_mm: [number, number];   // [width, height]
}

export interface MachineMode {
  id: ModeId;
  profile: ProfileId;
}

export interface Machine {
  id: string;                  // e.g. "F2Ultra"
  display_name: string;
  ext_id: string;
  ext_name: string;
  image: string;               // absolute URL beginning /static/machines/
  lasers: MachineLaser[];
  modes: MachineMode[];
}

export type FieldConstraint =
  | { kind: "range"; min: number; max: number; step?: number }
  | { kind: "stepped"; values: (number | string)[] }
  | { kind: "not_applicable" }
  | { kind: "enum"; values: (number | string)[] };

export type ValidationProfile = Record<string, FieldConstraint>;

export interface MachinesPayload {
  machines: Machine[];
  profiles: Record<ProfileId, ValidationProfile>;
}
```

Add `machine_id: string;` to `TestRecord`, `PaletteEntry`, and (if it exists) the `Preset` interface. Search for them:

```bash
grep -n "interface TestRecord\|interface PaletteEntry\|interface Preset\|interface PresetRecord" web/src/types.ts
```

For each, add `machine_id: string;` near the top of the interface body.

- [ ] **Step 11.2: Add the API client.**

Create `web/src/api/machines.ts`:

```typescript
import type { MachinesPayload } from "../types";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

let _cache: MachinesPayload | null = null;

/** Fetches the machine registry once per session. The payload is static
 *  for the app's lifetime, so we cache in module scope. */
export async function getMachines(): Promise<MachinesPayload> {
  if (_cache) return _cache;
  _cache = await j<MachinesPayload>(await fetch("/api/machines"));
  return _cache;
}

/** Test seam — clears the in-memory cache so vitest can re-fetch. */
export function _resetMachinesCache(): void {
  _cache = null;
}
```

- [ ] **Step 11.3: Add the machine state hook.**

Create `web/src/state/machine.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import type { Machine, MachinesPayload, ProfileId, ValidationProfile } from "../types";
import { getMachines } from "../api/machines";

const LS_KEY = "xcs.currentMachineId";
const DEFAULT_MACHINE_ID = "F2Ultra";

export function getCurrentMachineId(): string {
  try {
    return localStorage.getItem(LS_KEY) || DEFAULT_MACHINE_ID;
  } catch {
    return DEFAULT_MACHINE_ID;
  }
}

/** React hook: returns the registry payload + the current machine + a setter
 *  that persists to localStorage and reloads the page. The page reload is
 *  intentional — switching machines changes the entire data scope, so a
 *  hard refresh is the simplest way to invalidate every cached query. */
export function useCurrentMachine() {
  const [registry, setRegistry] = useState<MachinesPayload | null>(null);
  const [machineId, setMachineIdState] = useState<string>(getCurrentMachineId());

  useEffect(() => {
    let cancelled = false;
    getMachines().then((p) => { if (!cancelled) setRegistry(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const machine: Machine | null = registry
    ? registry.machines.find((m) => m.id === machineId) ?? registry.machines[0]
    : null;

  const setMachineId = useCallback((id: string) => {
    try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
    setMachineIdState(id);
    // Hard refresh: data scope changes wholesale.
    window.location.reload();
  }, []);

  return { registry, machineId, machine, setMachineId };
}

/** Pure derivation — given a registry, machine id, and mode, return the
 *  constraint dict. Returns null if the machine doesn't support that mode. */
export function getValidationProfile(
  registry: MachinesPayload | null, machineId: string, mode: string,
): ValidationProfile | null {
  if (!registry) return null;
  const machine = registry.machines.find((m) => m.id === machineId);
  if (!machine) return null;
  const modeSpec = machine.modes.find((m) => m.id === mode);
  if (!modeSpec) return null;
  return registry.profiles[modeSpec.profile as ProfileId] ?? null;
}
```

- [ ] **Step 11.4: Write the unit test.**

Create `web/src/state/machine.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import type { MachinesPayload } from "../types";
import { getValidationProfile } from "./machine";

const REGISTRY: MachinesPayload = {
  machines: [
    {
      id: "F1Ultra", display_name: "F1 Ultra", ext_id: "F1Ultra", ext_name: "F1 Ultra",
      image: "/static/machines/f1ultra.png",
      lasers: [
        { kind: "fiber", wattage: 20, spot_mm: [0.03, 0.03] },
        { kind: "blue",  wattage: 20, spot_mm: [0.08, 0.10] },
      ],
      modes: [
        { id: "engrave", profile: "STANDARD" },
        { id: "score",   profile: "STANDARD" },
        { id: "cut",     profile: "STANDARD" },
      ],
    },
    {
      id: "F2Ultra", display_name: "F2 Ultra", ext_id: "GS004-CLASS-4", ext_name: "F2 Ultra",
      image: "/static/machines/f2ultra.png",
      lasers: [
        { kind: "fiber", wattage: 60, spot_mm: [0.03, 0.03] },
        { kind: "blue",  wattage: 40, spot_mm: [0.08, 0.10] },
      ],
      modes: [
        { id: "engrave",       profile: "STANDARD" },
        { id: "score",         profile: "STANDARD" },
        { id: "cut",           profile: "STANDARD" },
        { id: "color_engrave", profile: "COLOR_ENGRAVE" },
      ],
    },
  ],
  profiles: {
    STANDARD: {
      power: { kind: "range", min: 1, max: 100, step: 1 },
      density: { kind: "stepped", values: [10, 20, 30] },
      pulse_width: { kind: "not_applicable" },
    },
    COLOR_ENGRAVE: {
      power: { kind: "range", min: 1, max: 100, step: 1 },
      density: { kind: "range", min: 1, max: 5000 },
      pulse_width: { kind: "stepped", values: [2, 4, 6] },
    },
  } as never,
};

describe("getValidationProfile", () => {
  it("returns STANDARD for F1Ultra engrave", () => {
    const p = getValidationProfile(REGISTRY, "F1Ultra", "engrave");
    expect(p?.pulse_width.kind).toBe("not_applicable");
  });
  it("returns COLOR_ENGRAVE for F2Ultra color_engrave", () => {
    const p = getValidationProfile(REGISTRY, "F2Ultra", "color_engrave");
    expect(p?.pulse_width.kind).toBe("stepped");
  });
  it("returns null for unsupported (machine, mode)", () => {
    expect(getValidationProfile(REGISTRY, "F1Ultra", "color_engrave")).toBeNull();
  });
  it("returns null when registry hasn't loaded yet", () => {
    expect(getValidationProfile(null, "F1Ultra", "engrave")).toBeNull();
  });
});
```

- [ ] **Step 11.5: Run the frontend test + typecheck.**

```bash
cd web && npx tsc --noEmit && npm test -- --run src/state/machine.test.ts
```

Expected: typecheck green; 4 tests pass.

- [ ] **Step 11.6: Commit.**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/types.ts web/src/api/machines.ts web/src/state/machine.ts web/src/state/machine.test.ts
git commit -m "feat: web — machine registry types + useCurrentMachine hook"
```

---

## Task 12: Machine images + frontend-design pass for `<MachineSwitcher>`

**Files:**
- Create: `web/public/machines/f2ultra.png` (product photo or placeholder)
- Create: `web/public/machines/f1ultra.png` (product photo or placeholder)
- Create: `web/src/components/MachineSwitcher.tsx`
- Modify: `web/src/components/TopBar.tsx` (mount the switcher)

Images: source product photos from xtool's product pages and crop them to a uniform aspect ratio (square preferred). If sourcing is friction during this task, drop in a placeholder PNG (a colored tile with the machine ID) and open a follow-up to swap in the real photos. Either is acceptable — the URL contract is what matters.

The switcher itself is a frontend-design pass — invoke the `frontend-design` agent with the brief in step 12.3 below.

- [ ] **Step 12.1: Add the image files.**

```bash
mkdir -p web/public/machines
```

Drop `f2ultra.png` and `f1ultra.png` into the directory. If product photos aren't sourced yet, generate placeholders:

```bash
# macOS sips can produce a flat-colored PNG; quick stand-in.
# Replace with real product photos before merging if possible.
sips -s format png --resampleHeightWidth 200 200 \
  /System/Library/Desktop\ Pictures/Solid\ Colors/Stone.png \
  --out web/public/machines/f2ultra.png 2>/dev/null \
  || echo "sips unavailable — drop a real PNG into web/public/machines/f2ultra.png"
```

- [ ] **Step 12.2: Confirm the static mount is reachable.**

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 2
curl -sI http://127.0.0.1:8017/static/machines/f2ultra.png | head -2
kill %1 2>/dev/null
```

Expected: `200 OK` (or `404` if you didn't drop a real PNG in — fix that first).

- [ ] **Step 12.3: Generate `<MachineSwitcher>` via the frontend-design agent.**

Invoke the agent with the following brief (copy verbatim):

> Build `web/src/components/MachineSwitcher.tsx`. It's a TopBar control that lets the user switch the active xTool machine. The active selection comes from `useCurrentMachine()` (in `web/src/state/machine.ts`); calling its `setMachineId(id)` setter persists + reloads the page.
>
> **Closed state:** a compact button (matches the height + tone of the "Guide" / "Upload" buttons in `web/src/components/TopBar.tsx`) showing the current machine's product photo thumbnail (24px square, rounded) on the left and the `display_name` on the right, in JetBrains Mono uppercase tracking-wide (matching the existing buttons).
>
> **Open state:** A Radix `<Popover.Root>` (Radix is already installed and used in `PaletteEntryDialog` etc) anchored to the button. Inside, render one card per machine from `registry.machines`. Each card shows: a larger product photo (~64px square, rounded), the `display_name` in Inter 14px medium, the lasers as small monospaced labels (`fiber 60W · blue 40W`), and the supported modes as pill-style badges (`engrave · score · cut · color engrave`). Selected machine gets a primary-color accent border (matches the metallic-bar / active-tab aesthetic in TopBar). Cards are clickable; hover-highlight in the same primary tint as the existing nav. Clicking calls `setMachineId(id)` then closes the popover (the page reload happens inside the setter).
>
> **Aesthetic guardrails:** Workshop Instrument language. Don't introduce any new icon library — use lucide-react (already imported in TopBar) if you need an arrow indicator. No emoji. JetBrains Mono for any numeric/laser-spec text, Inter for the machine name. Stick to existing CSS variables (`--color-primary`, `--color-ink`, `--color-surface-elevated`, `--color-border`, etc — see TopBar for the palette).
>
> Skip the test file; the unit test for `useCurrentMachine` is in Task 11. The Playwright walkthrough (Task 17) exercises this component end-to-end.

- [ ] **Step 12.4: Mount the switcher in the TopBar.**

In `web/src/components/TopBar.tsx`, add an import:

```typescript
import { MachineSwitcher } from "./MachineSwitcher";
```

Insert `<MachineSwitcher />` inside the right-side flex container (around line 88–90, between the title `<span>` and the optional `<AccountMenu />`):

```tsx
<div className="ml-auto flex items-center gap-3">
  <span className="text-[12.5px] text-[color:var(--color-ink-muted)]">{title}</span>
  <MachineSwitcher />
  {mode === "multi_user" && <AccountMenu />}
  ...
```

- [ ] **Step 12.5: Build and visually verify.**

```bash
cd web && npm run build
```

Expected: build succeeds. Then start the server and load the app:

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 2
open http://127.0.0.1:8017/
```

Click the machine switcher; verify it renders both machines with images, names, lasers, and modes. Click each — page reloads with the new machine in localStorage.

```bash
kill %1 2>/dev/null
```

- [ ] **Step 12.6: Commit.**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/public/machines/ web/src/components/MachineSwitcher.tsx web/src/components/TopBar.tsx web/dist/
git commit -m "feat: web — MachineSwitcher in TopBar with product photos"
```

---

## Task 13: Thread `machine_id` through API clients

**Files:**
- Modify: `web/src/api/tests.ts` — accept `machine_id` on `listTests`, `createTest`
- Modify: `web/src/api/palette.ts` — accept `machine_id` on `listPaletteEntries`, `queryPalette`, `createManualPaletteEntry`
- Modify: `web/src/api/library.ts` (or wherever presets live) — accept `machine_id` on `listPresets`, `createPreset`

Each list call adds the query param; each create body adds the field. Always read from `getCurrentMachineId()` at the call site (not inside the API module — keep modules pure).

- [ ] **Step 13.1: Update `tests.ts`.**

In `web/src/api/tests.ts`:

```typescript
export async function listTests(params: {
  material_id?: number; status?: string; machine_id?: string;
} = {}): Promise<TestRecord[]> {
  const qs = new URLSearchParams();
  if (params.material_id) qs.set("material_id", String(params.material_id));
  if (params.status) qs.set("status", params.status);
  if (params.machine_id) qs.set("machine_id", params.machine_id);
  return j(await fetch(`/api/tests?${qs.toString()}`));
}

export async function createTest(body: {
  name: string; material_id: number; spec: TestSpec; notes?: string;
  machine_id: string;
}): Promise<TestRecord> {
  return j(await fetch("/api/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
```

- [ ] **Step 13.2: Update `palette.ts`.**

In `web/src/api/palette.ts`:

```typescript
export interface ListPaletteOptions {
  material_id?: number;
  favorites_only?: boolean;
  source?: "averaged" | "single_result" | "manual";
  machine_id?: string;
}
```

In `listPaletteEntries`, add to the URLSearchParams build:

```typescript
if (opts.machine_id) qs.set("machine_id", opts.machine_id);
```

In `queryPalette`:

```typescript
export async function queryPalette(
  hex: string,
  opts: { limit?: number; material_id?: number; machine_id?: string } = {},
): Promise<PaletteQueryResult[]> {
  const qs = new URLSearchParams({ hex });
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.material_id) qs.set("material_id", String(opts.material_id));
  if (opts.machine_id) qs.set("machine_id", opts.machine_id);
  return j(await fetch(`/api/palette/query?${qs}`));
}
```

In `CreateManualBody`, add `machine_id: string;`.

- [ ] **Step 13.3: Update presets API client.**

Find the presets client:

```bash
grep -rn "presets" web/src/api/
```

Apply the same pattern: optional `machine_id` query param on lists; required `machine_id` on creates.

- [ ] **Step 13.4: Run frontend typecheck.**

```bash
cd web && npx tsc --noEmit
```

Expected: green.

- [ ] **Step 13.5: Commit.**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/api/
git commit -m "feat: web — API clients accept machine_id (filter + create field)"
```

---

## Task 14: Per-page scoping (TestsPage, PalettePage, LibraryPage, etc.)

**Files:**
- Modify: `web/src/components/TopBar.tsx` (already done in Task 12)
- Modify: `web/src/components/PalettePage.tsx`
- Modify: `web/src/components/LibraryPage.tsx`
- Modify: `web/src/components/SvgLayersPage.tsx` (palette query)
- Modify: page(s) for Tests, Spectrum (find via `grep -l "listTests\|listPaletteEntries\|listPresets" web/src/components/`)
- Modify: `web/src/components/LoomPage.tsx` (or wherever loom lives) — add cross-machine guard

For each call to `listTests`, `listPaletteEntries`, `queryPalette`, `listPresets`, add `machine_id: getCurrentMachineId()` to the options. For each create form, populate `machine_id: getCurrentMachineId()` in the body.

- [ ] **Step 14.1: Find every call site that needs updating.**

```bash
cd web && grep -rln "listTests\|listPaletteEntries\|queryPalette\|listPresets\|createTest\|createManualPaletteEntry\|createPreset" src/
```

Make a list and address each.

- [ ] **Step 14.2: For each list-call site, import the helper and pass the param.**

At the top of each file:

```typescript
import { getCurrentMachineId } from "../state/machine";
```

At each call:

```typescript
const entries = await listPaletteEntries({ ...existingOpts, machine_id: getCurrentMachineId() });
```

For create call sites:

```typescript
const result = await createTest({ ...existingFields, machine_id: getCurrentMachineId() });
```

- [ ] **Step 14.3: Add the Loom cross-machine guard.**

Find where Loom composes layers from selected tests:

```bash
grep -rn "loom\|Loom" web/src/components/ | grep -v "\.test\." | head
```

In the composer (the function that turns selected layer ids into the project to send), add an assertion after collecting tests:

```typescript
const machineIds = new Set(tests.map((t) => t.machine_id));
if (machineIds.size > 1) {
  toast.error(
    `Cross-machine mix detected (${[...machineIds].join(", ")}). ` +
    `Switch to a single machine in the TopBar before composing.`,
  );
  return;
}
```

(Use the existing toast library — search for `toast.error` patterns to match call style.)

- [ ] **Step 14.4: Build + visual smoke-test.**

```bash
cd web && npm run build
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 2
open http://127.0.0.1:8017/
```

Manual checks (per CLAUDE.md UI-testing rule):
1. Land on Tests; default machine = F2 Ultra; existing tests visible.
2. Switch to F1 Ultra in the TopBar. Page reloads. Tests list is empty.
3. Switch back to F2 Ultra. Existing tests reappear.
4. Same checks on Palette and Library.

```bash
kill %1 2>/dev/null
```

- [ ] **Step 14.5: Commit.**

```bash
git add web/src/
git commit -m "feat: web — pages scope queries to current machine"
```

---

## Task 15: Dynamic param form driven by validation profile

**Files:**
- Create: `web/src/components/dynamic-form/DynamicParamForm.tsx`
- Create: `web/src/components/dynamic-form/RangeField.tsx`
- Create: `web/src/components/dynamic-form/SteppedField.tsx`
- Modify: the test-create form (find via `grep -rn "BaseParams\|base_params" web/src/components/ | grep -i form`) to use `<DynamicParamForm>` instead of hand-coded fields.

The form reads a `ValidationProfile` (from `useCurrentMachine()` + the selected mode) and renders one control per field. `not_applicable` fields are hidden entirely; this is what makes `pulse_width` disappear when you switch to F1 Ultra.

- [ ] **Step 15.1: Generate the dynamic form via the frontend-design agent.**

Invoke `frontend-design` with the following brief:

> Build `web/src/components/dynamic-form/DynamicParamForm.tsx` plus its child `RangeField.tsx` and `SteppedField.tsx`.
>
> **DynamicParamForm props:**
> ```typescript
> interface Props {
>   profile: ValidationProfile;          // imported from "../../types"
>   value: Record<string, number | string>;
>   onChange: (next: Record<string, number | string>) => void;
> }
> ```
>
> Iterate over the profile entries in this fixed order: `power`, `density`, `frequency`, `speed`, `passes`, `pulse_width`, `laser`. For each:
> - `kind === "range"` → `<RangeField>` with continuous slider + numeric input (clamps to min/max; honours optional `step`)
> - `kind === "stepped"` → `<SteppedField>` (if `values.length <= 16`, render as a `<select>`; otherwise as a discrete slider snapping to allowed values)
> - `kind === "enum"` → small `<select>` with the allowed values
> - `kind === "not_applicable"` → render nothing (the field is hidden entirely)
>
> Field labels use the existing label style on `ParamTestEditor.tsx` (it has hand-rolled `BaseParams` controls — match its visual treatment exactly so the form feels native to the page). Keep existing helper components if they fit (`PulseWidthSelect.tsx` is a stepped-select that could be reused for the pulse_width case).
>
> No state inside `DynamicParamForm` — fully controlled. `onChange` is called with the full `value` dict each time any field changes. Also no async; this is pure rendering.
>
> **Aesthetic:** match `ParamTestEditor.tsx`. Workshop Instrument vibe. JetBrains Mono for numeric values + units, Inter for labels.
>
> Tests: write a vitest unit test in `web/src/components/dynamic-form/DynamicParamForm.test.tsx` that covers (a) `not_applicable` hides the field, (b) `range` renders a slider+number input, (c) `stepped` short list renders a select, (d) onChange propagates the changed field while preserving others.

- [ ] **Step 15.2: Replace the hand-coded test-create form with `<DynamicParamForm>`.**

Find the form:

```bash
grep -rn "ParamTestEditor\|TestCreateForm\|create.*test" web/src/components/ | head -10
```

In whichever component renders the BaseParams fields by hand, swap them for:

```typescript
const { registry, machineId } = useCurrentMachine();
const profile = getValidationProfile(registry, machineId, currentMode);
// ...
{profile && (
  <DynamicParamForm
    profile={profile}
    value={formValue.base_params}
    onChange={(bp) => setFormValue({ ...formValue, base_params: bp })}
  />
)}
```

`currentMode` comes from a mode selector in the same form — add a `<select>` populated from `machine.modes` if one doesn't exist.

- [ ] **Step 15.3: Run frontend tests + typecheck.**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: typecheck green; all vitest tests (including the new DynamicParamForm test) pass.

- [ ] **Step 15.4: Build + visual smoke-test.**

```bash
cd web && npm run build
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 2
open http://127.0.0.1:8017/
```

Manual check:
1. Switch to F1 Ultra. Open the test-create form. Verify `pulse_width` is hidden, `density` is a stepped slider/select, `frequency` rejects > 60.
2. Switch to F2 Ultra, mode = color_engrave. Verify `pulse_width` is back as a stepped select, `density` is a continuous slider 1–5000.

```bash
kill %1 2>/dev/null
```

- [ ] **Step 15.5: Commit.**

```bash
git add web/src/components/dynamic-form/ web/src/components/  # the page that swapped to DynamicParamForm
git commit -m "feat: web — DynamicParamForm renders per validation profile"
```

---

## Task 16: Backfill existing tests' base_params to validate against the right profile

**Files:** none new. This is a verification step.

Existing tests that were created on F2 with stepped LPC values that *aren't* in the new STANDARD list (e.g. density=150) still need to load. Two angles to verify:

- The repository read path: `_row(...)` returns `machine_id` from the DB column (defaulted to `F2Ultra` by the migration). No validation runs on read, so old rows load fine.
- The frontend rendering: `<DynamicParamForm>` for an F2 test in color-engrave mode uses the COLOR_ENGRAVE profile (continuous density 1–5000) — no problem.

The risk is: an F2 test whose `mode` ends up as `engrave` (STANDARD profile) but whose persisted density is, say, 150. STANDARD's stepped values are `[..., 100, 120, 140, 160, ...]` — 150 is illegal. The slider would snap on the next save, but the form should display the as-stored value initially.

- [ ] **Step 16.1: Verify `<SteppedField>` displays the as-stored value even when not in the allowed list.**

Open the `SteppedField.tsx` from Task 15. Confirm the rendering: when `value` isn't in `values`, the control should still display the raw number (e.g. as the slider position, snapped visually to the nearest legal mark). If it doesn't, fix it: the control's display is decoupled from the constraint; only `onChange` snaps.

If a fix is needed, write the case as a vitest test in `DynamicParamForm.test.tsx` first (TDD), then patch the field.

- [ ] **Step 16.2: Backend behavior on test PATCH with off-list density.**

In `tests/test_repo_machines.py`, add:

```python
def test_legacy_off_list_density_passes_through_repo(fresh_db):
    """Existing rows with off-list density values still load — validation
    only runs at the API boundary, not on read."""
    mid = m_repo.create(name="Stainless")["id"]
    spec = {**SPEC, "base_params": {**BASE_PARAMS, "density": 150}}
    t = t_repo.create(name="legacy", material_id=mid, spec=spec, machine_id="F2Ultra")
    assert t["spec"]["base_params"]["density"] == 150
```

Run:

```bash
uv run --active pytest tests/test_repo_machines.py -v
```

Expected: passes (the repo doesn't validate; it just stores).

- [ ] **Step 16.3: Commit.**

```bash
git add tests/test_repo_machines.py web/src/components/dynamic-form/  # if the field needed a fix
git commit -m "test: legacy off-list density values still load through repos"
```

---

## Task 17: Playwright walkthrough — golden path

**Files:** none committed. Browser-driven verification per CLAUDE.md.

Use the `mcp__plugin_playwright_playwright__*` tools to drive a real browser through the multi-machine flow. The bar is end-to-end: switch machine, see scope change, generate a file, confirm bytes are F1.

- [ ] **Step 17.1: Start the dev server.**

```bash
cd web && npm run build > /dev/null 2>&1
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 2
```

- [ ] **Step 17.2: Drive the walkthrough.**

Using Playwright MCP:

1. `browser_navigate` → `http://127.0.0.1:8017/`
2. `browser_snapshot` — confirm machine switcher shows "F2 Ultra" + thumbnail.
3. `browser_click` on the machine switcher button → snapshot shows both machine cards.
4. `browser_click` on the F1 Ultra card → page reloads.
5. After reload, `browser_snapshot` — switcher now shows "F1 Ultra"; Tests list is empty.
6. `browser_navigate` → Tests page; create a test:
   - Mode dropdown shows `engrave / score / cut` only (no `color_engrave`).
   - Open the create form; confirm `pulse_width` field is **not** rendered.
   - Set frequency = 100, attempt to save → expect a 422 toast/error.
   - Set frequency = 45, save → success.
7. Click Generate; download the resulting `.xcs`. Save the blob and inspect:
   ```bash
   curl -sO http://127.0.0.1:8017/api/tests/<id>/generate -o /tmp/f1-test.xcs
   python3 -c "import json; print(json.load(open('/tmp/f1-test.xcs'))['extId'])"
   ```
   Expected: `F1Ultra`.
8. Switch back to F2 Ultra in the switcher. Confirm pre-existing palette entries reappear in the Palette tab.

- [ ] **Step 17.3: Stop the server.**

```bash
kill %1 2>/dev/null
```

- [ ] **Step 17.4: If anything from the walkthrough failed, fix in place and re-run before continuing.** Don't proceed to commit until the walkthrough is clean.

---

## Task 18: Changelog entry

**Files:**
- Create: `changelog/2026-04-25-multi-machine.md`
- Create: `changelog/images/multi-machine-switcher.png` (screenshot from Task 17)

Major-level entry per CLAUDE.md: title, summary, body, screenshot. Workshop Instrument voice.

- [ ] **Step 18.1: Take a screenshot of the open machine switcher.**

During the walkthrough, use `browser_take_screenshot` after step 17.3 (with the popover open) and save the result to `changelog/images/multi-machine-switcher.png`.

- [ ] **Step 18.2: Write the entry.**

Create `changelog/2026-04-25-multi-machine.md`:

```markdown
---
id: 2026-04-25-multi-machine
date: 2026-04-25
level: major
title: Multi-machine support — F1 Ultra joins the workbench
summary: Pick a machine in the TopBar; tests, palette, and library scope to it.
images:
  - src: multi-machine-switcher.png
    caption: Machine switcher in the TopBar — pick the machine you're driving today.
---

The workbench used to assume one machine — the F2 Ultra Dual. Today it
learns about the F1 Ultra too, with the scaffolding to add more from a
single registry edit.

**Pick a machine.** A new control in the top bar shows the machine you're
on. Click it to see the alternatives, with their lasers and supported
modes called out. Switch and the entire workbench reloads onto that
machine's data — its tests, its palette, its presets. Selections persist
across reloads.

**Per-machine parameter ranges.** The form fields adapt to the machine
and mode you've picked. F1 Ultra hides `pulse_width` (no color-engrave
mode), the LPC slider snaps to the F1's stepped values (10, 20, …, 100,
120, 140, …, 200), and out-of-range frequency or speed inputs are
rejected at save instead of being silently accepted.

**Existing data stays put.** Everything you've created until now was on
the F2 Ultra; the migration backfills that label so nothing is lost.
The F1 starts with an empty workspace — yours to populate.

Adding more machines later is a single registry entry in
`src/xcs_gen/machines.py`.
```

- [ ] **Step 18.3: Verify the changelog renders.**

Restart the server, navigate to `/#/changelog`, confirm the new entry shows up with the image.

- [ ] **Step 18.4: Commit.**

```bash
git add changelog/2026-04-25-multi-machine.md changelog/images/multi-machine-switcher.png
git commit -m "changelog: multi-machine support"
```

---

## Task 19: Final verification

- [ ] **Step 19.1: Full backend suite.**

```bash
uv run --active pytest tests/ -q
```

Expected: all tests pass.

- [ ] **Step 19.2: Frontend typecheck + unit tests.**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: green.

- [ ] **Step 19.3: Frontend production build.**

```bash
cd web && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 19.4: Migration smoke test against MySQL** (matches CI's `mysql-migration-test`).

If you have Docker available locally:

```bash
docker run --rm -d --name xcs-mig-mysql \
  -e MYSQL_ROOT_PASSWORD=rootpass \
  -e MYSQL_DATABASE=xcsgen \
  -p 3307:3306 \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_bin
sleep 30   # wait for MySQL to initialise
XCS_GEN_DB_URL="mysql+pymysql://root:rootpass@127.0.0.1:3307/xcsgen?charset=utf8mb4" \
  uv run --active alembic upgrade head
docker stop xcs-mig-mysql
```

Expected: alembic reports `0009 (head)`. If Docker isn't available locally, skip — CI will catch it.

- [ ] **Step 19.5: Push the branch and open a PR.**

```bash
git push -u origin feat/multi-machine-support
gh pr create --draft --title "Multi-machine support — F1 Ultra + per-machine validation" --body "$(cat <<'EOF'
## Summary
- Adds F1 Ultra alongside F2 Ultra via a code-level machine registry (`src/xcs_gen/machines.py`).
- Per-`(machine, mode)` validation profiles (`STANDARD`, `COLOR_ENGRAVE`) — snaps stepped fields, rejects out-of-range, hides not-applicable fields (e.g. `pulse_width` on F1).
- `tests` / `palette_entries` / `presets` gain a `machine_id` column; existing rows backfilled to `F2Ultra` (Alembic `0009`).
- TopBar machine switcher built with frontend-design — product photos, lasers, modes, click-to-switch.
- Pages scope all queries to the current machine; Loom guards against cross-machine compositions.

See `docs/superpowers/specs/2026-04-25-multi-machine-support-design.md` for the full design.

## Test plan
- [x] `uv run --active pytest tests/ -q` — green
- [x] `cd web && npx tsc --noEmit && npm test -- --run` — green
- [x] `cd web && npm run build` — green
- [x] Playwright walkthrough: switch machines, create F1 test, generate `.xcs`, verify `extId == "F1Ultra"`
- [ ] CI mysql-migration-test confirms `alembic_version == "0009"`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr ready
```

Expected: PR opened, marked ready for review.

- [ ] **Step 19.6: Watch CI.**

```bash
gh pr checks --watch
```

Expected: `backend-test`, `frontend-build`, `mysql-migration-test`, `docker-build` all green.

If CI fails:
- `mysql-migration-test`: confirm `.github/workflows/ci.yml:144` says `test "$VER" = "0009"`.
- `backend-test`: re-run locally with the same env (`XCS_GEN_AUTO_MIGRATE=false pytest tests/ -x -q`) and fix.
- `frontend-build`: run `cd web && npm run build` locally; surface any TypeScript errors.
- `docker-build`: usually environment-related; check the build log.

Iterate until green.

---

## Self-review checklist (already applied during plan-writing)

- ✅ Spec coverage: every section in `2026-04-25-multi-machine-support-design.md` maps to one or more tasks here (registry → Tasks 1-3; profiles → Task 2; migration → Task 7; API → Tasks 9-10; frontend context → Task 11; switcher → Task 12; per-page scoping → Task 14; dynamic form → Task 15; changelog → Task 18; testing → throughout).
- ✅ No placeholders: every step contains the actual code or command. The two areas that defer to runtime exploration — `XCSProject(...)` constructor location in `converter.py` (Task 5.1) and the existing `web/dist/` static mount (Task 9.5) — are scoped to grep commands that pin down the line before editing, not abstract "TODO" notes.
- ✅ Type consistency: `Machine`, `MachinesPayload`, `ValidationProfile`, `FieldConstraint` defined once in Task 11 and referenced by name in Tasks 13–15. `MachineImmutableError` and `MachineMismatchError` defined in Task 8 and referenced in Task 8's tests.
- ✅ TDD: every backend task except 5/6/7/19 leads with a failing test. (Task 5 wires existing-tested machinery; Task 6 has its own new test; Task 7 is a migration that's exercised by `fresh_db`; Task 19 is final verification.)
- ✅ Single-PR rollout (per user preference) — the plan still uses commit-per-task discipline so the reviewer can step through.
