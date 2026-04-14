"""Tests for LayerConfig / AutoRamp / resolve_layer_params."""

from xcs_gen.model import ProcessingParams
from xcs_gen.svg_source import (
    AutoRamp,
    LayerAssignment,
    LayerConfig,
    resolve_layer_params,
)


def _base() -> ProcessingParams:
    return ProcessingParams(power=50, speed=1000)


def test_resolve_uses_explicit_layer_config():
    explicit = {
        "#ff0000": LayerConfig(
            params=ProcessingParams(power=77, speed=500),
            render_mode="vector_cut",
        ),
    }
    assignment = resolve_layer_params(
        detected_colors=["#ff0000"],
        layer_config=explicit,
        auto_ramp=None,
        base_params=_base(),
    )
    assert assignment["#ff0000"].params.power == 77
    assert assignment["#ff0000"].render_mode == "vector_cut"


def test_resolve_auto_ramp_luminance_sort():
    # Black darker than white → black gets max_value, white gets min_value.
    ramp = AutoRamp(
        param="power", min_value=20, max_value=80,
        sort_by="luminance", default_render_mode="fill_engrave",
    )
    assignment = resolve_layer_params(
        detected_colors=["#ffffff", "#000000"],
        layer_config=None,
        auto_ramp=ramp,
        base_params=_base(),
    )
    assert assignment["#000000"].params.power == 80
    assert assignment["#ffffff"].params.power == 20


def test_resolve_auto_ramp_order_of_appearance():
    ramp = AutoRamp(
        param="speed", min_value=500, max_value=2000,
        sort_by="order_of_appearance", default_render_mode="fill_engrave",
    )
    assignment = resolve_layer_params(
        detected_colors=["#111111", "#222222", "#333333"],
        layer_config=None,
        auto_ramp=ramp,
        base_params=_base(),
    )
    # First→min, last→max, middle linearly interpolated.
    assert assignment["#111111"].params.speed == 500
    assert assignment["#222222"].params.speed == 1250
    assert assignment["#333333"].params.speed == 2000


def test_resolve_explicit_wins_over_ramp():
    explicit = {
        "#000000": LayerConfig(
            params=ProcessingParams(power=99),
            render_mode="vector_cut",
        ),
    }
    ramp = AutoRamp(
        param="power", min_value=20, max_value=80,
        sort_by="luminance", default_render_mode="fill_engrave",
    )
    assignment = resolve_layer_params(
        detected_colors=["#000000", "#ffffff"],
        layer_config=explicit,
        auto_ramp=ramp,
        base_params=_base(),
    )
    # Black is explicit — power=99, render=cut. White uses ramp.
    assert assignment["#000000"].params.power == 99
    assert assignment["#000000"].render_mode == "vector_cut"
    # Ramp runs only on #ffffff (the sole remaining colour) → gets min_value.
    assert assignment["#ffffff"].params.power == 20


def test_resolve_raises_when_no_config_covers_color():
    import pytest
    with pytest.raises(ValueError, match="#ff0000"):
        resolve_layer_params(
            detected_colors=["#ff0000", "#00ff00"],
            layer_config=None,
            auto_ramp=None,
            base_params=_base(),
        )


def test_layer_assignment_carries_processing_type():
    """The render_mode → XCS processingType mapping is surfaced on the assignment."""
    explicit = {
        "#000000": LayerConfig(
            params=ProcessingParams(), render_mode="vector_cut",
        ),
    }
    assignment = resolve_layer_params(
        detected_colors=["#000000"],
        layer_config=explicit,
        auto_ramp=None,
        base_params=_base(),
    )
    assert assignment["#000000"].processing_type == "VECTOR_CUTTING"
