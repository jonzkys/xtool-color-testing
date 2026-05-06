"""Per-substrate default clean-pass + calibration patch profiles.

These are starter values; the calibration ceremony measures the actual
canonical RGB each patch produces under the user's lighting and writes
that to the materials table. Burn params just need to produce
*distinct* and *repeatable* colours — exact targets are user-measured.
"""

from __future__ import annotations

from typing import TypedDict

DEFAULT_PATCH_COUNT = 3


class _BaseParams(TypedDict):
    power: float
    speed: int
    frequency: int
    density: int
    passes: int
    pulse_width: int
    laser: str


class _CalibrationPatch(TypedDict):
    label: str
    params: _BaseParams
    canonical_rgb: list[float] | None


_STAINLESS_CLEAN: _BaseParams = {
    "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
    "passes": 2, "pulse_width": 200, "laser": "red",
}

_STAINLESS_PATCHES: list[_CalibrationPatch] = [
    {
        "label": "light",
        "params": {
            "power": 8.0, "speed": 1500, "frequency": 30, "density": 800,
            "passes": 1, "pulse_width": 120, "laser": "red",
        },
        "canonical_rgb": None,
    },
    {
        "label": "mid",
        "params": {
            "power": 18.0, "speed": 1000, "frequency": 80, "density": 1000,
            "passes": 1, "pulse_width": 160, "laser": "red",
        },
        "canonical_rgb": None,
    },
    {
        "label": "dark",
        "params": {
            "power": 40.0, "speed": 400, "frequency": 120, "density": 1200,
            "passes": 2, "pulse_width": 240, "laser": "red",
        },
        "canonical_rgb": None,
    },
]


_REGISTRY: dict[str, tuple[_BaseParams, list[_CalibrationPatch]]] = {
    "stainless-steel": (_STAINLESS_CLEAN, _STAINLESS_PATCHES),
}


def default_clean_pass(substrate: str) -> _BaseParams | None:
    """Returns a copy of the default clean-pass params for ``substrate``,
    or ``None`` if the substrate isn't in the registry."""
    pair = _REGISTRY.get(substrate)
    if pair is None:
        return None
    return dict(pair[0])  # type: ignore[return-value]


def default_calibration_patches(substrate: str) -> list[_CalibrationPatch] | None:
    """Returns a deep-copied list of default calibration patches, or
    ``None`` if the substrate isn't in the registry."""
    pair = _REGISTRY.get(substrate)
    if pair is None:
        return None
    return [{
        "label": p["label"],
        "params": dict(p["params"]),  # type: ignore[arg-type]
        "canonical_rgb": list(p["canonical_rgb"]) if p["canonical_rgb"] is not None else None,
    } for p in pair[1]]
