"""Regenerate web/src/laser/__fixtures__/laser-indices-v3.json from the
Python compute_indices source of truth. Run after any change to the
formulas. The TS port test reads this file and asserts byte-identical
floats (within 1e-6) for each entry.
"""

from __future__ import annotations

import json
from pathlib import Path

from xcs_gen.laser_indices import compute_indices
from xcs_gen.model import ProcessingParams


_INPUT_GRID: list[dict[str, float]] = [
    {"power": 14.6, "speed": 1152, "frequency": 100, "density": 5000,
     "pulse_width": 200, "passes": 1},
    {"power": 30.0, "speed": 800,  "frequency": 60,  "density": 1000,
     "pulse_width": 200, "passes": 2},
    {"power": 50.0, "speed": 4000, "frequency": 200, "density": 3000,
     "pulse_width": 100, "passes": 1},
    {"power": 1.0,  "speed": 100,  "frequency": 60,  "density": 100,
     "pulse_width": 100, "passes": 1},
    {"power": 100.0,"speed": 15000,"frequency": 500, "density": 5000,
     "pulse_width": 200, "passes": 99},
    {"power": 25.5, "speed": 1500, "frequency": 150, "density": 2000,
     "pulse_width": 50,  "passes": 3},
    {"power": 75.0, "speed": 6000, "frequency": 300, "density": 800,
     "pulse_width": 80,  "passes": 5},
    {"power": 12.0, "speed": 250,  "frequency": 80,  "density": 4500,
     "pulse_width": 200, "passes": 1},
    {"power": 60.0, "speed": 2400, "frequency": 250, "density": 1500,
     "pulse_width": 30,  "passes": 4},
    {"power": 8.5,  "speed": 600,  "frequency": 70,  "density": 3500,
     "pulse_width": 200, "passes": 2},
    {"power": 1.0,  "speed": 2,    "frequency": 60,  "density": 1,
     "pulse_width": 30,  "passes": 1},
    {"power": 100.0,"speed": 15000,"frequency": 500, "density": 5000,
     "pulse_width": 200, "passes": 1},
]


def _row(params: dict) -> dict:
    pp = ProcessingParams(
        power=params["power"],
        speed=int(params["speed"]),
        mopa_frequency=int(params["frequency"]),
        density=int(params["density"]),
        pulse_width=int(params["pulse_width"]),
        repeat=int(params["passes"]),
    )
    indices = compute_indices(pp)
    return {
        "input": params,
        "expected": {
            "pulse_spacing_mm": indices.pulse_spacing_mm,
            "line_spacing_mm": indices.line_spacing_mm,
            "pulse_energy_index": indices.pulse_energy_index,
            "pulse_intensity_index": indices.pulse_intensity_index,
            "total_exposure_index": indices.total_exposure_index,
            "ablation_aggression_index": indices.ablation_aggression_index,
            "delivery_smoothness_index": indices.delivery_smoothness_index,
            "formula_version": indices.formula_version,
        },
    }


def main() -> None:
    out_path = Path("web/src/laser/__fixtures__/laser-indices-v3.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [_row(p) for p in _INPUT_GRID]
    out_path.write_text(json.dumps(rows, indent=2))
    print(f"wrote {len(rows)} fixtures to {out_path}")


if __name__ == "__main__":
    main()
