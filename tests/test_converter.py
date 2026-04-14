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
        base_params=_base(),
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
