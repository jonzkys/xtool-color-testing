"""Derived exposure indices for laser parameters.

These are HEURISTIC INDICES, not calibrated physical quantities.
xTool's `power` and `density` parameters are controller settings whose
mapping to wall-plug watts and physical line spacing isn't guaranteed,
so we frame everything as opaque dimensionless products under explicit
`density_model` / `power_model` strings. When calibration arrives,
this module gains alternative formula branches keyed off those strings
and `INDICES_FORMULA_VERSION` is bumped — callers stamp every row with
the version so a recompute pass can flush stale values.

Formulas (see docs/superpowers/specs/2026-05-07-laser-exposure-indices-design.md):

    pulse_spacing_mm        = speed / (mopa_frequency * 1000)        # honest mm
    line_spacing_index      = 1 / density                             # opaque
    line_spacing_mm         = NULL while density_model == "opaque"
    pulse_energy_index      = power / mopa_frequency
    pulse_intensity_index   = power / (mopa_frequency * pulse_width)
    surface_exposure_index  = power * density * repeat / speed

`mopa_frequency` is in kHz; `speed` is mm/s; `pulse_width` is ns;
`power` is the controller % setting.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import ProcessingParams

INDICES_FORMULA_VERSION = 1


@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    surface_exposure_index: float
    formula_version: int
    density_model: str
    power_model: str


def compute_indices(
    params: ProcessingParams,
    *,
    density_model: str = "opaque",
    power_model: str = "controller_percent",
) -> LaserIndices:
    """Compute derived exposure indices from raw `ProcessingParams`.

    Raises `ValueError` (naming the offending field) if any input that
    appears in a denominator is zero. Callers handle the error —
    palette entries with non-physical params shouldn't have silent NaN
    indices.
    """
    speed = params.speed
    power = params.power
    density = params.density
    freq = params.mopa_frequency
    pw = params.pulse_width
    repeat = params.repeat

    if speed == 0:
        raise ValueError("speed must be non-zero to compute laser indices")
    if freq == 0:
        raise ValueError("mopa_frequency must be non-zero to compute laser indices")
    if density == 0:
        raise ValueError("density must be non-zero to compute laser indices")
    if pw == 0:
        raise ValueError("pulse_width must be non-zero to compute laser indices")

    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_index = 1 / density
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    surface_exposure_index = power * density * repeat / speed

    line_spacing_mm: float | None = None
    if density_model != "opaque":
        raise ValueError(
            f"density_model={density_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    if power_model != "controller_percent":
        raise ValueError(
            f"power_model={power_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    return LaserIndices(
        pulse_spacing_mm=pulse_spacing_mm,
        line_spacing_index=line_spacing_index,
        line_spacing_mm=line_spacing_mm,
        pulse_energy_index=pulse_energy_index,
        pulse_intensity_index=pulse_intensity_index,
        surface_exposure_index=surface_exposure_index,
        formula_version=INDICES_FORMULA_VERSION,
        density_model=density_model,
        power_model=power_model,
    )
