"""Capture-side axis values for ``pulse_width`` sweeps.

The F2 Ultra only burns a fixed pulse-width preset list, so the
generator steps a ``pulse_width`` axis through the presets inside
``[min, max]`` (``xcs_gen.generators._axis_values``) — and caps the
step count to how many presets fit. Everything that maps a captured
cell back to its params has to use the same values, or the inspector
and the palette recipes carry pulse widths that were never burned.
"""

from __future__ import annotations

import numpy as np

from xcs_gen_web.services import capture as capture_service
from xcs_gen_web.services.xcs import effective_spec_for_layout

_SPEC = {
    "x_param": "frequency", "x_min": 80, "x_max": 900, "x_steps": 13,
    "y_param": "pulse_width", "y_min": 2, "y_max": 500, "y_steps": 16,
    "rows": 1, "width_mm": 65, "height_mm": 80, "gap_mm": 0,
    "cell_shape": "rect", "angle_mode": "fixed",
    "unidirectional": False, "hide_axis_labels": False,
    "base_params": {
        "power": 22, "speed": 4000, "frequency": 60,
        "density": 250, "passes": 1, "pulse_width": 200, "laser": "red",
    },
    "registration": {"mode": "on"},
}


def _blank_warped(spec: dict) -> np.ndarray:
    layout = capture_service.grid_layout_payload(spec)
    return np.full(
        (layout["image_height_px"], layout["image_width_px"], 3), 128,
        dtype=np.uint8,
    )


def test_inspect_cell_reports_the_burned_pulse_width():
    """Row 8 of a 2–500 ns / 16-row sweep burned at 60 ns, not 268."""
    payload = capture_service.inspect_cell(_blank_warped(_SPEC), _SPEC, 8, 0)
    assert payload["y_value"] == 60
    assert payload["x_value"] == 80


def test_inspect_cell_pulse_width_x_axis_wrapped_1d():
    spec = {
        **_SPEC,
        "x_param": "pulse_width", "x_min": 13, "x_max": 500, "x_steps": 12,
        "y_param": None, "y_min": None, "y_max": None, "y_steps": None,
        "rows": 3, "height_mm": 5,
    }
    payload = capture_service.inspect_cell(_blank_warped(spec), spec, 1, 2)
    # Flat index 1*4 + 2 = 6 → the seventh preset from 13 ns.
    assert payload["x_value"] == 100


def test_effective_spec_caps_pulse_width_steps_to_the_burn():
    """A spec that asks for more pulse-width steps than presets exist in
    range (the editor shows "Capped to N" but keeps the stored count)
    burns only N rows — the capture grid must be laid out for N too."""
    spec = {**_SPEC, "y_max": 60, "y_steps": 16}  # 2..60 holds 9 presets
    eff = effective_spec_for_layout(spec=spec, kind="sweep")
    assert eff["y_steps"] == 9
    assert eff["x_steps"] == 13
    assert spec["y_steps"] == 16, "the caller's spec must not be mutated"


def test_effective_spec_leaves_a_fitting_sweep_untouched():
    eff = effective_spec_for_layout(spec=_SPEC, kind="sweep")
    assert eff is _SPEC
