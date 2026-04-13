"""Image loading and grid conversion for image-to-laser mapping."""

from __future__ import annotations

from PIL import Image


def image_to_grid(path: str, cols: int, rows: int) -> list[list[float]]:
    """Load an image, convert to grayscale, resample to a grid of brightness values.

    Args:
        path: Path to image file (PNG, JPG, etc.).
        cols: Number of columns in the output grid.
        rows: Number of rows in the output grid.

    Returns:
        Row-major 2D list of floats in [0.0, 1.0].
        0.0 = black, 1.0 = white.
        grid[row][col], row 0 = top of image.
    """
    img = Image.open(path)

    # Composite RGBA onto white background so transparency → white (skip)
    if img.mode == "RGBA":
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg

    # Convert to grayscale and resize to grid dimensions
    img = img.convert("L")
    img = img.resize((cols, rows), Image.LANCZOS)

    pixels = list(img.getdata())
    grid = []
    for r in range(rows):
        row_start = r * cols
        grid.append([pixels[row_start + c] / 255.0 for c in range(cols)])

    return grid


def image_aspect_ratio(path: str) -> float:
    """Return width/height aspect ratio of an image."""
    with Image.open(path) as img:
        return img.width / img.height
