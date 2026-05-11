"""Derived exposure indices for laser parameters.

These are HEURISTIC INDICES, not calibrated physical quantities for
power. ``density`` is treated as lines per cm — confirmed by the
controller stepped-value tables in ``xcs_gen.machines`` — so
``line_spacing_mm`` IS a real physical quantity (10 / density mm/line).
``power_model`` stays opaque pending wall-plug-watts calibration.

Formula change vs. v4 (this revision):
- ``total_exposure_index`` now factors ``mopa_frequency`` linearly:
  ``power * freq * density * effective_repeat / speed``. On a MOPA
  fiber laser at fixed controller-% the per-pulse energy stays
  roughly constant and the average optical power scales with the
  pulse repetition rate, so total-energy-delivered to each cell
  scales linearly with freq. Without this, pure frequency sweeps
  (everything else constant) collapsed to a single TEi value, which
  made the exposure-page scatter unreadable for those tests.
- ``ablation_aggression_index`` and ``delivery_smoothness_index``
  inherit the change because they're derived from TEi × PIi and
  TEi ÷ PIi respectively. Per-pulse indices (``PEi``, ``PIi``,
  ``PSm``, ``LSm``) are unchanged — those describe per-pulse
  energy/intensity and pulse geometry, which are by construction
  freq-independent at the per-pulse level.

Formula change vs. v3 (PR #88 lineage):
- ``compute_indices`` accepts a ``crosshatch: bool = False`` kwarg.
  When True, the function uses an effective repeat of ``2 * repeat``
  in the three pass-dependent indices so the delivered-energy
  accounting matches what XCS actually burns (crosshatch adds a
  perpendicular stroke per pass, doubling the strokes-of-energy per
  cell).

``mopa_frequency`` is in kHz; ``speed`` is mm/s; ``pulse_width`` is ns;
``power`` is the controller % setting.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import ProcessingParams

INDICES_FORMULA_VERSION = 5


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
    crosshatch: bool = False,
) -> LaserIndices:
    """Compute derived exposure indices from raw `ProcessingParams`.

    Pass ``crosshatch=True`` when the burn used the test's
    ``crosshatch`` flag. v4 multiplies ``repeat`` by 2 in that case so
    ``total_exposure_index``, ``ablation_aggression_index``, and
    ``delivery_smoothness_index`` reflect the actual delivered energy
    (crosshatch adds a perpendicular stroke per pass, doubling the
    strokes per cell). Per-pulse indices are unaffected.

    Raises `ValueError` (naming the offending field) if any input that
    appears in a denominator is zero, or if either model string is not
    the supported value for the current formula version.
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

    effective_repeat = repeat * 2 if crosshatch else repeat

    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_mm = 10 / density  # 1 cm = 10 mm; lines/cm → mm/line
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    total_exposure_index = power * freq * density * effective_repeat / speed
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
