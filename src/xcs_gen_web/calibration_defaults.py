"""Per-substrate default clean-pass parameters.

The clean pass produces a known matte finish on the substrate so the
perimeter strip's measured RGB is repeatable across plates. Values
just need to produce a uniform, broadband-neutral surface — exact
target colour doesn't matter.
"""

from __future__ import annotations

from typing import TypedDict


class _BaseParams(TypedDict):
    power: float
    speed: int
    frequency: int
    density: int
    passes: int
    pulse_width: int
    laser: str


_STAINLESS_CLEAN: _BaseParams = {
    "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
    "passes": 2, "pulse_width": 200, "laser": "red",
}


_REGISTRY: dict[str, _BaseParams] = {
    "stainless-steel": _STAINLESS_CLEAN,
}


def default_clean_pass(substrate: str) -> _BaseParams | None:
    """Returns a copy of the default clean-pass params for ``substrate``,
    or ``None`` if the substrate isn't in the registry."""
    cp = _REGISTRY.get(substrate)
    if cp is None:
        return None
    return dict(cp)  # type: ignore[return-value]
