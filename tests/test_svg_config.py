"""Tests for the YAML config loader."""

import tempfile

import pytest
import yaml

from xcs_gen.model import ProcessingParams
from xcs_gen.svg_config import LoadedConfig, load_svg_config
from xcs_gen.svg_source import HatchPass, HatchRamp, LayerConfig


def _write_yaml(data) -> str:
    path = tempfile.mktemp(suffix=".yaml")
    with open(path, "w") as f:
        yaml.safe_dump(data, f)
    return path


def test_load_svg_config_simple_non_hatched():
    cfg_path = _write_yaml({
        "defaults": {"power": 60, "speed": 800},
        "layers": {
            "#000000": {"render_mode": "vector_cut", "speed": 500, "power": 80},
        },
    })
    result = load_svg_config(cfg_path)
    assert isinstance(result, LoadedConfig)
    assert result.defaults.power == 60
    assert result.defaults.speed == 800
    black = result.layer_config["#000000"]
    assert black.render_mode == "vector_cut"
    assert black.params.speed == 500
    assert black.params.power == 80
    assert black.hatch_passes == []


def test_load_svg_config_hatched_with_multi_pass_ramps():
    cfg_path = _write_yaml({
        "layers": {
            "#ffd73e": {
                "render_mode": "hatched",
                "hatch_passes": [
                    {
                        "angle": 0,
                        "spacing": 0.4,
                        "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}],
                    },
                    {
                        "angle": 90,
                        "spacing": 0.4,
                        "power": 55,
                        "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}],
                    },
                ],
            },
        },
    })
    result = load_svg_config(cfg_path)
    yellow = result.layer_config["#ffd73e"]
    assert yellow.render_mode == "hatched"
    assert len(yellow.hatch_passes) == 2
    p0 = yellow.hatch_passes[0]
    assert p0.angle == 0
    assert p0.spacing == 0.4
    assert len(p0.ramps) == 1
    assert p0.ramps[0].param == "power"
    assert p0.ramps[0].axis == "perp"
    assert p0.ramps[0].min_value == 30
    assert p0.ramps[0].max_value == 70
    # Second pass has a per-pass override for power.
    p1 = yellow.hatch_passes[1]
    assert p1.base_params is not None
    assert p1.base_params.power == 55


def test_load_svg_config_with_auto_ramp():
    cfg_path = _write_yaml({
        "auto_ramp": {
            "param": "power", "min": 20, "max": 80,
            "sort_by": "luminance", "default_render_mode": "fill_engrave",
        },
    })
    result = load_svg_config(cfg_path)
    assert result.auto_ramp is not None
    assert result.auto_ramp.param == "power"
    assert result.auto_ramp.min_value == 20
    assert result.auto_ramp.max_value == 80
    assert result.auto_ramp.sort_by == "luminance"


def test_load_svg_config_rejects_bad_render_mode():
    cfg_path = _write_yaml({
        "layers": {"#000000": {"render_mode": "lightsaber"}},
    })
    with pytest.raises(ValueError, match="render_mode"):
        load_svg_config(cfg_path)


def test_load_svg_config_rejects_bad_axis():
    cfg_path = _write_yaml({
        "layers": {
            "#000000": {
                "render_mode": "hatched",
                "hatch_passes": [
                    {"angle": 0, "spacing": 0.4,
                     "ramps": [{"param": "power", "axis": "sideways", "min": 0, "max": 1}]},
                ],
            },
        },
    })
    with pytest.raises(ValueError, match="axis"):
        load_svg_config(cfg_path)


def test_load_svg_config_normalizes_hex_case():
    cfg_path = _write_yaml({
        "layers": {"#FFD73E": {"render_mode": "fill_engrave"}},
    })
    result = load_svg_config(cfg_path)
    assert "#ffd73e" in result.layer_config
    assert "#FFD73E" not in result.layer_config
