"""Tests for image-to-laser feature."""

import json
import tempfile
from pathlib import Path

from PIL import Image

from xcs_gen.builder import build_xcs
from xcs_gen.generators import generate_from_image
from xcs_gen.image_source import image_aspect_ratio, image_to_grid
from xcs_gen.model import ProcessingParams


def _make_test_image(width: int, height: int, color: int = 128) -> str:
    """Create a temporary grayscale image and return its path."""
    img = Image.new("L", (width, height), color)
    path = tempfile.mktemp(suffix=".png")
    img.save(path)
    return path


def _make_gradient_image(width: int, height: int) -> str:
    """Create a horizontal gradient: black on left, white on right."""
    img = Image.new("L", (width, height))
    for x in range(width):
        val = int(255 * x / (width - 1))
        for y in range(height):
            img.putpixel((x, y), val)
    path = tempfile.mktemp(suffix=".png")
    img.save(path)
    return path


def test_image_to_grid_uniform():
    """Uniform gray image produces uniform grid values."""
    path = _make_test_image(100, 100, color=128)
    grid = image_to_grid(path, cols=10, rows=10)

    assert len(grid) == 10
    assert len(grid[0]) == 10

    for row in grid:
        for val in row:
            assert abs(val - 128 / 255) < 0.02


def test_image_to_grid_black_white():
    """Black image → 0.0, white image → 1.0."""
    black_path = _make_test_image(50, 50, color=0)
    white_path = _make_test_image(50, 50, color=255)

    black_grid = image_to_grid(black_path, cols=5, rows=5)
    white_grid = image_to_grid(white_path, cols=5, rows=5)

    assert all(val < 0.01 for row in black_grid for val in row)
    assert all(val > 0.99 for row in white_grid for val in row)


def test_image_to_grid_gradient():
    """Horizontal gradient produces increasing values left to right."""
    path = _make_gradient_image(100, 10)
    grid = image_to_grid(path, cols=10, rows=1)

    values = grid[0]
    assert values[0] < 0.05  # left = black
    assert values[-1] > 0.95  # right = white
    # Monotonically increasing
    for i in range(len(values) - 1):
        assert values[i] < values[i + 1]


def test_image_aspect_ratio():
    """Aspect ratio is width/height."""
    path = _make_test_image(200, 100)
    assert abs(image_aspect_ratio(path) - 2.0) < 0.01


def test_image_rgba_transparency():
    """Transparent pixels become white (1.0)."""
    img = Image.new("RGBA", (10, 10), (0, 0, 0, 0))  # fully transparent
    path = tempfile.mktemp(suffix=".png")
    img.save(path)

    grid = image_to_grid(path, cols=5, rows=5)
    assert all(val > 0.99 for row in grid for val in row)


def test_image_la_transparency():
    """LA (grayscale+alpha): fully-transparent dark pixels composite to white,
    not full-burn black."""
    img = Image.new("LA", (10, 10), (0, 0))  # black, fully transparent
    path = tempfile.mktemp(suffix=".png")
    img.save(path)

    grid = image_to_grid(path, cols=5, rows=5)
    assert all(val > 0.99 for row in grid for val in row)


def test_resolve_grid_dims_caps_rows_for_tall_image():
    """Auto-resolution must cap BOTH axes — a tall, narrow image can't explode
    rows into a billion-cell project."""
    from xcs_gen.generators import _resolve_grid_dims

    cols, rows = _resolve_grid_dims(aspect=0.0001, cols=None, rows=None, total_width=50.0)
    assert cols <= 1000
    assert rows <= 1000


def test_resolve_grid_dims_preserves_aspect_when_one_axis_given():
    """Explicit cols + auto rows keeps the existing derivation (no behaviour change)."""
    from xcs_gen.generators import _resolve_grid_dims

    assert _resolve_grid_dims(aspect=2.0, cols=20, rows=None, total_width=40.0) == (20, 10)
    assert _resolve_grid_dims(aspect=2.0, cols=None, rows=10, total_width=40.0) == (20, 10)


def test_generate_from_image_element_count():
    """Black image with no skip produces cols*rows elements."""
    path = _make_test_image(50, 50, color=0)  # all black

    project = generate_from_image(
        image_path=path,
        param="speed",
        param_min=500,
        param_max=2000,
        cols=10,
        rows=10,
        total_width=20.0,
        total_height=20.0,
    )

    assert len(project.elements) == 100


def test_generate_from_image_skip_white():
    """White image with default threshold produces zero elements."""
    path = _make_test_image(50, 50, color=255)  # all white

    project = generate_from_image(
        image_path=path,
        param="speed",
        param_min=500,
        param_max=2000,
        cols=10,
        rows=10,
    )

    assert len(project.elements) == 0


def test_generate_from_image_parameter_mapping():
    """Black pixels map to param_max, gray to proportional value."""
    path = _make_test_image(10, 10, color=0)  # all black

    project = generate_from_image(
        image_path=path,
        param="speed",
        param_min=500,
        param_max=2000,
        cols=5,
        rows=5,
    )

    result = build_xcs(project)
    dev_entries = result["device"]["data"]["value"][0][1]["displays"]["value"]

    # All black → all at param_max (2000)
    for entry_id, entry in dev_entries:
        if entry["type"] == "RECT":
            speed = entry["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["speed"]
            assert speed == 2000


def test_generate_from_image_auto_resolution():
    """Auto-resolution computes rows from cols and aspect ratio."""
    path = _make_test_image(200, 100, color=128)  # 2:1 aspect

    project = generate_from_image(
        image_path=path,
        param="speed",
        param_min=500,
        param_max=2000,
        cols=20,
        # rows auto-computed
        total_width=40.0,
        total_height=20.0,
        skip_threshold=1.1,  # don't skip anything
    )

    # 20 cols, 2:1 aspect → 10 rows → 200 elements
    assert len(project.elements) == 200


def test_generate_from_image_gradient_mapping():
    """Horizontal gradient produces increasing speed values left to right."""
    path = _make_gradient_image(100, 10)

    project = generate_from_image(
        image_path=path,
        param="speed",
        param_min=500,
        param_max=2000,
        cols=10,
        rows=1,
        total_width=20.0,
        total_height=5.0,
        skip_threshold=1.1,  # don't skip white end
    )

    result = build_xcs(project)
    dev_entries = result["device"]["data"]["value"][0][1]["displays"]["value"]

    speeds = []
    for entry_id, entry in dev_entries:
        if entry["type"] == "RECT":
            speeds.append(entry["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["speed"])

    # Black (left) → near param_max (2000), white (right) → near param_min (500)
    assert speeds[0] > 1800  # near black
    assert speeds[-1] < 700  # near white
    # Monotonically decreasing (more brightness → lower speed)
    for i in range(len(speeds) - 1):
        assert speeds[i] >= speeds[i + 1]
