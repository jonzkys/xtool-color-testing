"""Tests for perimeter-strip plumbing through generate_gradient."""

from __future__ import annotations

from xcs_gen.generators import generate_gradient


def test_no_strip_when_kwarg_omitted():
    project = generate_gradient(
        x_param="power", x_min=10, x_max=100, x_steps=5,
        total_width=80, total_height=20,
        registration_mode="on", test_id=42,
    )
    # Only the gradient cells (5 of them, plus annotation/markers).
    # No strip-named layer colours present.
    layer_colours = {el.layer_color for el in project.elements}
    assert not any(c.startswith("#wb_") for c in layer_colours)


def test_strip_emitted_when_params_provided():
    clean_params = {
        "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
        "passes": 2, "pulse_width": 200, "laser": "red",
    }
    project = generate_gradient(
        x_param="power", x_min=10, x_max=100, x_steps=5,
        total_width=80, total_height=20,
        registration_mode="on", test_id=42,
        perimeter_strip_params=clean_params,
    )
    layer_colours = {el.layer_color for el in project.elements}
    assert any(c == "#wb_top" for c in layer_colours)
    assert any(c == "#wb_right" for c in layer_colours)
    assert any(c == "#wb_bottom" for c in layer_colours)
    assert any(c == "#wb_left" for c in layer_colours)
