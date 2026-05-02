"""Tests for Project → XCSProject conversion."""

import pytest

from xcs_gen_web.converter import project_to_xcs, validate_placements
from xcs_gen_web.schemas import BaseParams, ParamTest, Project, TestPlacement


def _base() -> BaseParams:
    return BaseParams(
        power=14.6, speed=1000, frequency=125, density=5000,
        passes=1, pulse_width=200, laser="red",
    )


def _test(id_: str = "t1", width: float = 30.0, height: float = 5.0) -> ParamTest:
    return ParamTest(
        id=id_, name=f"Test {id_}",
        x_param="speed", x_min=500, x_max=2000, x_steps=10,
        rows=1, width_mm=width, height_mm=height, gap_mm=0.0,
        base_params=_base(), material_id="mat-test",
    )


def test_single_test_project_element_count():
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[TestPlacement(test=_test(), row=0, col=0, col_span=1)],
    )
    xcs = project_to_xcs(project)
    assert len(xcs.elements) == 10


def test_multiple_tests_combined():
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=1),
            TestPlacement(test=_test("t2"), row=1, col=0, col_span=1),
            TestPlacement(test=_test("t3"), row=2, col=0, col_span=1),
        ],
    )
    xcs = project_to_xcs(project)
    # 3 tests × 10 elements each = 30
    assert len(xcs.elements) == 30


def test_shared_canvas_id():
    """All tests merged under one canvas_id."""
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=1),
            TestPlacement(test=_test("t2"), row=1, col=0, col_span=1),
        ],
    )
    xcs = project_to_xcs(project)
    # The canvas_id field is set once at the project level
    assert xcs.canvas_id
    # All extra_displays and elements live under this single canvas
    assert len(xcs.elements) > 0


def test_horizontal_placement_offsets():
    """Two tests side-by-side: second test starts to the right of first."""
    project = Project(
        name="Test", grid_gap_mm=2.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=1),
            TestPlacement(test=_test("t2"), row=0, col=1, col_span=1),
        ],
    )
    xcs = project_to_xcs(project)
    # Gather x positions of the two test groups
    xs = sorted({round(e.x, 2) for e in xcs.elements})
    # First test starts at start_x (10.0), its elements go from 10 to 40.
    # Second test starts at 10 + 30 (first width) + 2 (grid gap) = 42.
    # Its elements go from 42 to 72.
    min_t1 = min(e.x for e in xcs.elements if e.x < 42)
    min_t2 = min(e.x for e in xcs.elements if e.x >= 42)
    assert abs(min_t1 - 10.0) < 0.1
    assert abs(min_t2 - 42.0) < 0.5


def test_vertical_placement_offsets():
    """Two tests stacked: second test starts below first."""
    project = Project(
        name="Test", grid_gap_mm=2.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=1),
            TestPlacement(test=_test("t2"), row=1, col=0, col_span=1),
        ],
    )
    xcs = project_to_xcs(project)

    # Single-axis tests place all their elements at the same y (one row).
    # With 2 stacked tests we should see 2 distinct y values.
    distinct_ys = sorted({round(e.y, 2) for e in xcs.elements})
    assert len(distinct_ys) == 2
    assert distinct_ys[1] > distinct_ys[0]  # second test is below first

    # The vertical separation should be at least the first test's height
    # (5mm) - actually more because of summary text space. Just check > 0.
    separation = distinct_ys[1] - distinct_ys[0]
    assert separation >= 5.0  # first test is 5mm tall, minimum separation


def test_overlap_detection():
    """Two tests in the same cell should fail validation."""
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=1),
            TestPlacement(test=_test("t2"), row=0, col=0, col_span=1),
        ],
    )
    with pytest.raises(ValueError, match="overlap"):
        validate_placements(project)


def test_colspan_overlap_detected():
    """Test with col_span=2 blocks the adjacent column."""
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=2),
            TestPlacement(test=_test("t2"), row=0, col=1, col_span=1),
        ],
    )
    with pytest.raises(ValueError, match="overlap"):
        validate_placements(project)


def test_non_overlapping_valid():
    """Tests on different rows don't overlap even at same col."""
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[
            TestPlacement(test=_test("t1"), row=0, col=0, col_span=1),
            TestPlacement(test=_test("t2"), row=1, col=0, col_span=1),
        ],
    )
    validate_placements(project)  # Should not raise


def test_beam_width_validation_rejects_sub_beam_elements():
    """Elements narrower than the beam spot cause a ValueError."""
    # 100 steps over 2mm = 0.02mm/element, below 0.03mm beam
    t = ParamTest(
        id="t1", name="Narrow", x_param="speed", x_min=500, x_max=2000, x_steps=100,
        rows=1, width_mm=2.0, height_mm=5.0, gap_mm=0.0, base_params=_base(),
        material_id="mat-test",
    )
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[TestPlacement(test=t, row=0, col=0, col_span=1)],
    )
    with pytest.raises(ValueError, match="beam"):
        project_to_xcs(project)


def test_crosshatch_mode_sets_cross_angle_flag_and_preserves_passes():
    """angle_mode='crosshatch' → XCS-native ``cross_angle`` + ``repeat=passes``
    (1:1, NOT halved). xTool Studio executes ``repeat`` literally:
    each repeat is one stroke. ``cross_angle`` alternates the scan
    angle between strokes — it does not double the burn count. The
    earlier divide-by-2 was a guess that didn't match the device's
    actual behaviour and produced under-burned tests."""
    t = _test().model_copy(update={"angle_mode": "crosshatch"})
    t = t.model_copy(update={"base_params": t.base_params.model_copy(update={"passes": 4})})
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[TestPlacement(test=t, row=0, col=0, col_span=1)],
    )
    xcs = project_to_xcs(project)

    # 10 steps, ZERO duplication — XCS handles the passes.
    assert len(xcs.elements) == 10
    assert all(e.params.cross_angle for e in xcs.elements)
    # 4 passes → 4 strokes, alternating 0° and 90° via cross_angle.
    assert all(e.params.repeat == 4 for e in xcs.elements)


def test_incremental_mode_sets_angle_type_2():
    t = _test().model_copy(update={"angle_mode": "incremental"})
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[TestPlacement(test=t, row=0, col=0, col_span=1)],
    )
    xcs = project_to_xcs(project)
    assert all(e.params.angle_type == 2 for e in xcs.elements)
    assert all(not e.params.cross_angle for e in xcs.elements)


def test_fixed_mode_is_default_and_emits_angle_type_1():
    """Default angle_mode='fixed' → angleType=1, crossAngle=false, no duplication."""
    project = Project(
        name="Test", grid_gap_mm=1.0,
        tests=[TestPlacement(test=_test(), row=0, col=0, col_span=1)],
    )
    xcs = project_to_xcs(project)
    assert len(xcs.elements) == 10
    assert all(e.params.angle_type == 1 for e in xcs.elements)
    assert all(not e.params.cross_angle for e in xcs.elements)


def test_param_test_hide_axis_labels_defaults_false():
    """Omitting hide_axis_labels gives False (backwards compat for stored tests)."""
    t = _test("t1")
    assert t.hide_axis_labels is False


def test_param_test_hide_axis_labels_round_trips():
    """Explicitly-set True survives model_validate (JSON → object)."""
    payload = {
        "id": "t1", "name": "t", "x_param": "speed",
        "x_min": 500, "x_max": 2000, "x_steps": 10,
        "rows": 1, "width_mm": 30, "height_mm": 5, "gap_mm": 0,
        "base_params": _base().model_dump(),
        "material_id": "mat-test",
        "hide_axis_labels": True,
    }
    t = ParamTest.model_validate(payload)
    assert t.hide_axis_labels is True


def test_hide_axis_labels_shrinks_vertical_footprint():
    """Stacked tests with hide_axis_labels=True should pack tighter than the
    default (the inter-test gap shrinks because the bottom-strip annotation
    allowance disappears)."""
    def _stacked(hide: bool):
        return Project(
            name="Test", grid_gap_mm=0.0,
            tests=[
                TestPlacement(
                    test=_test("t1").model_copy(update={"hide_axis_labels": hide}),
                    row=0, col=0, col_span=1,
                ),
                TestPlacement(
                    test=_test("t2").model_copy(update={"hide_axis_labels": hide}),
                    row=1, col=0, col_span=1,
                ),
            ],
        )

    default_xcs = project_to_xcs(_stacked(hide=False))
    hidden_xcs = project_to_xcs(_stacked(hide=True))

    def _distinct_y(xcs):
        return sorted({round(e.y, 3) for e in xcs.elements})

    d_ys = _distinct_y(default_xcs)
    h_ys = _distinct_y(hidden_xcs)
    assert len(d_ys) == 2 and len(h_ys) == 2
    assert (h_ys[1] - h_ys[0]) < (d_ys[1] - d_ys[0])


def test_hide_axis_labels_generator_sees_no_labels():
    """project_to_xcs must forward hide_axis_labels to generate_gradient.

    extra_displays stores dicts built by build_line_display/make_text_display,
    so we assert on the "type" field: no LINE (tick) dicts, and exactly one
    TEXT dict (the summary — axis-label TEXTs are suppressed).
    """
    def _displays_for(hide: bool):
        project = Project(
            name="Test", grid_gap_mm=0.0,
            tests=[
                TestPlacement(
                    test=_test("t1").model_copy(update={"hide_axis_labels": hide}),
                    row=0, col=0, col_span=1,
                ),
            ],
        )
        xcs = project_to_xcs(project)
        return [d["type"] for d in xcs.extra_displays]

    hidden = _displays_for(True)
    assert hidden.count("LINE") == 0
    assert hidden.count("TEXT") == 1  # summary header only

    visible = _displays_for(False)
    assert visible.count("LINE") > 0
    assert visible.count("TEXT") > 1  # summary + axis labels


def test_converter_constants_match_generator_defaults():
    """_LABEL_FONT_SIZE / _TICK_LENGTH must match generate_gradient's defaults.

    project_to_xcs calls generate_gradient without passing these, so if they
    drift the footprint math in _test_vertical_footprint will over- or
    under-reserve space on the canvas.
    """
    import inspect

    from xcs_gen.generators import generate_gradient
    from xcs_gen_web.converter import _LABEL_FONT_SIZE, _TICK_LENGTH

    sig = inspect.signature(generate_gradient)
    assert sig.parameters["label_font_size"].default == _LABEL_FONT_SIZE
    assert sig.parameters["tick_length"].default == _TICK_LENGTH
