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
        "material_id": "mat-test",
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


def test_paramtest_material_id_required():
    """Empty/missing material_id must be rejected — palette queries are scoped by material."""
    data = _valid_test()
    data["material_id"] = ""
    with pytest.raises(ValidationError):
        Project(**{"name": "T", "grid_gap_mm": 1.0,
                   "tests": [{"test": data, "row": 0, "col": 0, "col_span": 1}]})


def test_paramtest_material_id_rejects_non_string():
    with pytest.raises(ValidationError):
        Project(**_project_payload(material_id=42))


def _svg_stack_payload(**overrides) -> dict:
    base = {
        "name": "stack",
        "svg_content": "<svg/>",
        "width_mm": 50.0,
        "base_params": _valid_base_params(),
        "material_id": "mat-test",
    }
    base.update(overrides)
    return base


def test_svg_stack_material_id_round_trips_string():
    req = SvgStackRequest(**_svg_stack_payload(material_id="mat-abc"))
    assert req.material_id == "mat-abc"


def test_svg_stack_material_id_required():
    body = _svg_stack_payload()
    del body["material_id"]
    with pytest.raises(ValidationError):
        SvgStackRequest(**body)


def test_svg_stack_material_id_rejects_non_string():
    with pytest.raises(ValidationError):
        SvgStackRequest(**_svg_stack_payload(material_id=123))


def _svg_layers_payload(**request_overrides) -> dict:
    layer = {
        "color": "#ff0000",
        "name": "red",
        "enabled": True,
        "processing_type": "COLOR_FILL_ENGRAVE",
        "scan_angle": 90.0,
        "base_params": _valid_base_params(),
    }
    body = {
        "name": "layers",
        "svg_content": "<svg/>",
        "width_mm": 50.0,
        "material_id": "mat-test",
        "layers": [layer],
    }
    body.update(request_overrides)
    return body


def test_svg_layers_material_id_round_trips_string():
    req = SvgLayersRequest(**_svg_layers_payload(material_id="mat-xyz"))
    assert req.material_id == "mat-xyz"


def test_svg_layers_material_id_required():
    body = _svg_layers_payload()
    del body["material_id"]
    with pytest.raises(ValidationError):
        SvgLayersRequest(**body)


def test_svg_layers_material_id_rejects_non_string():
    with pytest.raises(ValidationError):
        SvgLayersRequest(**_svg_layers_payload(material_id=1))


def test_palette_entry_response_includes_indices() -> None:
    from xcs_gen_web.schemas import LaserIndicesResponse, PaletteEntryResponse

    payload = {
        "id": 1,
        "test_id": None,
        "material_id": 1,
        "source": "averaged",
        "hex": "#aabbcc",
        "lab": [50.0, 0.0, 0.0],
        "params": {"speed": 1000},
        "sigma": 0.1,
        "notes": "",
        "created_at": "2026-05-08T00:00:00+00:00",
        "owner_id": 1,
        "visibility": "private",
        "machine_id": "F2Ultra",
        "indices": {
            "pulse_spacing_mm": 0.0154,
            "line_spacing_index": 0.01,
            "line_spacing_mm": None,
            "pulse_energy_index": 0.769,
            "pulse_intensity_index": 0.00385,
            "total_exposure_index": 5.0,
            "ablation_aggression_index": 0.01923,
            "delivery_smoothness_index": 1300.0,
            "formula_version": 2,
            "density_model": "opaque",
            "power_model": "controller_percent",
        },
    }
    resp = PaletteEntryResponse.model_validate(payload)
    assert isinstance(resp.indices, LaserIndicesResponse)
    assert resp.indices.total_exposure_index == 5.0
    assert resp.indices.surface_exposure_index == 5.0  # deprecated alias
    assert resp.indices.line_spacing_mm is None


def test_laser_indices_response_serialises_both_total_and_alias() -> None:
    from xcs_gen_web.schemas import LaserIndicesResponse

    resp = LaserIndicesResponse(
        pulse_spacing_mm=0.0154,
        line_spacing_index=0.01,
        line_spacing_mm=None,
        pulse_energy_index=0.7692,
        pulse_intensity_index=0.003846,
        total_exposure_index=5.0,
        ablation_aggression_index=0.01923,
        delivery_smoothness_index=1300.0,
        formula_version=2,
        density_model="opaque",
        power_model="controller_percent",
    )
    j = resp.model_dump()
    assert j["total_exposure_index"] == 5.0
    assert j["surface_exposure_index"] == 5.0  # deprecated alias
    assert j["ablation_aggression_index"] == 0.01923
    assert j["delivery_smoothness_index"] == 1300.0
