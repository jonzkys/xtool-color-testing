"""Derived exposure indices for laser parameters.

These are HEURISTIC INDICES, not calibrated physical quantities for
power. ``density`` is treated as lines per cm — confirmed by the
controller stepped-value tables in ``xcs_gen.machines`` — so
``line_spacing_mm`` IS a real physical quantity (10 / density mm/line).
``power_model`` stays opaque pending wall-plug-watts calibration.

Formula change vs. v2 (PR #80 lineage):
- ``density_model`` default + only legal value is now ``"lpc"``;
  ``"opaque"`` is no longer accepted (legacy rows still deserialise via
  the response schema, they're just not recomputed without an explicit
  pass).
- ``line_spacing_index`` is removed from the dataclass and from any
  downstream consumer. ``line_spacing_mm`` carries the same information
  in a meaningful unit.

``mopa_frequency`` is in kHz; ``speed`` is mm/s; ``pulse_width`` is ns;
``power`` is the controller % setting.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import ProcessingParams

INDICES_FORMULA_VERSION = 3


@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_mm: float
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float
    ablation_aggression_index: float
    delivery_smoothness_index: float
    formula_version: int
    density_model: str
    power_model: str


def compute_indices(
    params: ProcessingParams,
    *,
    density_model: str = "lpc",
    power_model: str = "controller_percent",
) -> LaserIndices:
    """Compute derived exposure indices from raw `ProcessingParams`.

    Raises `ValueError` (naming the offending field) if any input that
    appears in a denominator is zero, or if either model string is not
    the supported value for formula version 3.
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

    if density_model != "lpc":
        raise ValueError(
            f"density_model={density_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION} (only 'lpc' is accepted)",
        )

    if power_model != "controller_percent":
        raise ValueError(
            f"power_model={power_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_mm = 10 / density  # 1 cm = 10 mm; lines/cm → mm/line
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    total_exposure_index = power * density * repeat / speed
    ablation_aggression_index = total_exposure_index * pulse_intensity_index
    delivery_smoothness_index = total_exposure_index / pulse_intensity_index

    return LaserIndices(
        pulse_spacing_mm=pulse_spacing_mm,
        line_spacing_mm=line_spacing_mm,
        pulse_energy_index=pulse_energy_index,
        pulse_intensity_index=pulse_intensity_index,
        total_exposure_index=total_exposure_index,
        ablation_aggression_index=ablation_aggression_index,
        delivery_smoothness_index=delivery_smoothness_index,
        formula_version=INDICES_FORMULA_VERSION,
        density_model=density_model,
        power_model=power_model,
    )
