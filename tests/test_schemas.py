"""Tests for Pydantic schemas matching the frontend data model."""

import pytest
from pydantic import ValidationError

from xcs_gen_web.schemas import (
    BaseParams,
    ParamTest,
    Project,
    SvgLayersRequest,
    SvgStackRequest,
    TestPlacement,
)


def _valid_base_params() -> dict:
    return {
        "power": 14.6,
        "speed": 1000,
        "frequency": 125,
        "density": 5000,
        "passes": 1,
        "pulse_width": 200,
        "laser": "red",
    }


def _valid_test() -> dict:
    return {
        "id": "test-1",
        "name": "Speed sweep",
        "x_param": "speed",
        "x_min": 500.0,
        "x_max": 2000.0,
        "x_steps": 100,
        "rows": 1,
        "width_mm": 30.0,
        "height_mm": 5.0,
        "gap_mm": 0.0,
        "base_params": _valid_base_params(),
    }


def test_base_params_valid():
    bp = BaseParams(**_valid_base_params())
    assert bp.power == 14.6
    assert bp.laser == "red"


def test_base_params_laser_must_be_red_or_blue():
    data = _valid_base_params()
    data["laser"] = "green"
    with pytest.raises(ValidationError):
        BaseParams(**data)


def test_param_test_single_axis():
    t = ParamTest(**_valid_test())
    assert t.x_param == "speed"
    assert t.y_param is None


def test_param_test_dual_axis():
    data = _valid_test()
    data["y_param"] = "power"
    data["y_min"] = 10
    data["y_max"] = 50
    data["y_steps"] = 5
    t = ParamTest(**data)
    assert t.y_param == "power"
    assert t.y_steps == 5


def test_param_test_x_min_must_differ_from_x_max():
    data = _valid_test()
    data["x_max"] = data["x_min"]
    with pytest.raises(ValidationError):
        ParamTest(**data)


def test_param_test_x_steps_minimum():
    data = _valid_test()
    data["x_steps"] = 1
    with pytest.raises(ValidationError):
        ParamTest(**data)


def test_project_empty_tests():
    p = Project(name="Empty", grid_gap_mm=1.0, tests=[])
    assert p.tests == []


def test_project_with_placement():
    placement = TestPlacement(
        test=ParamTest(**_valid_test()),
        row=0, col=0, col_span=1,
    )
    p = Project(name="Test", grid_gap_mm=1.0, tests=[placement])
    assert len(p.tests) == 1
    assert p.tests[0].row == 0


# ---------------------------------------------------------------------------
# material_id round-trip and rejection tests
# ---------------------------------------------------------------------------

def _project_payload(**test_overrides) -> dict:
    """Build a minimal Project payload, applying overrides to the inner ParamTest."""
    test_data = _valid_test()
    test_data.update(test_overrides)
    return {
        "name": "Test",
        "grid_gap_mm": 1.0,
        "tests": [{"test": test_data, "row": 0, "col": 0, "col_span": 1}],
    }


def test_paramtest_material_id_round_trips_string():
    project = Project(**_project_payload(material_id="mat-abc123"))
    assert project.tests[0].test.material_id == "mat-abc123"


def test_paramtest_material_id_defaults_to_none():
    project = Project(**_project_payload())
    assert project.tests[0].test.material_id is None


def test_paramtest_material_id_rejects_non_string():
    with pytest.raises(ValidationError):
        Project(**_project_payload(material_id=42))


def _svg_stack_payload(**overrides) -> dict:
    base = {
        "name": "stack",
        "svg_content": "<svg/>",
        "width_mm": 50.0,
        "base_params": _valid_base_params(),
    }
    base.update(overrides)
    return base


def test_svg_stack_material_id_round_trips_string():
    req = SvgStackRequest(**_svg_stack_payload(material_id="mat-abc"))
    assert req.material_id == "mat-abc"


def test_svg_stack_material_id_rejects_non_string():
    with pytest.raises(ValidationError):
        SvgStackRequest(**_svg_stack_payload(material_id=123))


def _svg_layers_payload(**layer_overrides) -> dict:
    layer = {
        "color": "#ff0000",
        "name": "red",
        "enabled": True,
        "processing_type": "COLOR_FILL_ENGRAVE",
        "scan_angle": 90.0,
        "base_params": _valid_base_params(),
    }
    layer.update(layer_overrides)
    return {
        "name": "layers",
        "svg_content": "<svg/>",
        "width_mm": 50.0,
        "layers": [layer],
    }


def test_svg_layers_material_id_round_trips_string():
    req = SvgLayersRequest(**_svg_layers_payload(material_id="mat-xyz"))
    assert req.layers[0].material_id == "mat-xyz"


def test_svg_layers_material_id_rejects_non_string():
    with pytest.raises(ValidationError):
        SvgLayersRequest(**_svg_layers_payload(material_id=1))
