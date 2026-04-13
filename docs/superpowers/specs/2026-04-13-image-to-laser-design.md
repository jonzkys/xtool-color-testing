# Image-to-Laser Parameter Mapping (Use Case A) Design

## Goal

Convert a raster image (PNG/JPG) into an XCS file where pixel brightness maps to a user-selected laser parameter. Enables photo-style engraving via parameter variation across a grid of small elements.

## Pipeline

```
Image file (PNG/JPG) → Source → Mapping → Output
```

### Stage 1: Source (`image_source.py`)

Load an image, convert to grayscale, resample to the output grid dimensions, and produce a 2D array of brightness values (0.0 = black, 1.0 = white).

```python
def image_to_grid(
    path: str,
    cols: int,
    rows: int,
) -> list[list[float]]:
```

- Uses Pillow for image loading, grayscale conversion, and resampling.
- Resampling method: `Image.LANCZOS` for downscaling (averages pixel neighborhoods naturally).
- A 1000x600 image mapped to 500x300 grid bins ~2x2 pixels per cell.
- Returns row-major grid: `grid[row][col]` where row 0 is the top of the image.

### Stage 2: Mapping

Convert each cell's 0.0-1.0 brightness to laser parameters.

User specifies:
- `param`: which parameter brightness controls (default: `"speed"`).
- `param_min`, `param_max`: the range of that parameter.
- `skip_threshold`: brightness above which cells are skipped entirely (default: 1.0, meaning pure white is skipped).

Linear mapping formula:
```
param_value = param_max - brightness * (param_max - param_min)
```

- Black (0.0) → `param_max` (e.g., slowest speed = most energy = darkest mark)
- White (1.0) → `param_min` (lightest mark, or skipped if at threshold)

The mapping is applied per-cell. Cells above `skip_threshold` produce no element.

`base_params` provides all fixed parameter values. The mapped parameter overrides its corresponding field.

### Stage 3: Output

Feed the parameter grid into the existing builder. Each non-skipped cell becomes a `Rect` with its mapped `ProcessingParams`.

- Same shared-layer strategy (`isProcessByLayer: false`, one gradient layer).
- Annotations: optional summary text at top showing image filename and parameter mapping.
- No axis labels (the image is spatial, not a parameter sweep).

## Grid Sizing

User provides:
- `total_width`, `total_height`: output physical size in mm (e.g., 50mm x 30mm).
- `cols` and/or `rows`: grid resolution.

Resolution logic:
- If both `cols` and `rows` provided: use directly.
- If only `cols` provided: compute `rows` to preserve image aspect ratio.
- If only `rows` provided: compute `cols` to preserve aspect ratio.
- If neither provided: auto-compute from `total_width / beam_width` (max resolution).

Cell size: `cell_w = total_width / cols`, `cell_h = total_height / rows`.

Beam-width validation applies: warn if cell size < beam width.

## Files to Create/Modify

### New: `src/xcs_gen/image_source.py`

Single responsibility: image loading and grid conversion. ~30 lines.

### Modify: `src/xcs_gen/generators.py`

Add `generate_from_image()`:

```python
def generate_from_image(
    *,
    image_path: str,
    param: str = "speed",
    param_min: float,
    param_max: float,
    cols: int | None = None,
    rows: int | None = None,
    total_width: float = 50.0,
    total_height: float = 30.0,
    gap: float = 0.0,
    skip_threshold: float = 1.0,
    start_x: float = 10.0,
    start_y: float = 10.0,
    base_params: ProcessingParams | None = None,
    processing_type: str = "COLOR_FILL_ENGRAVE",
    annotation_params: ProcessingParams | None = None,
) -> XCSProject:
```

Uses `image_to_grid()` as Source, applies linear Mapping, builds Output via existing `Rect`/builder infrastructure.

### Modify: `src/xcs_gen/cli.py`

Add `image` subcommand:

```
xcs-gen image \
  --input photo.png \
  --param speed --param-min 500 --param-max 2000 \
  --width 50 --height 30 \
  [--cols 500] [--rows 300] \
  [--skip-threshold 0.95] \
  [--power 14.6] [--frequency 125] [--density 5000] [...] \
  -o photo_engrave.xcs
```

### Modify: `pyproject.toml`

Add `Pillow` to dependencies.

### New: `tests/test_image.py`

- Test `image_to_grid()` with a synthetic test image (create programmatically with Pillow, no test fixture files needed).
- Test `generate_from_image()` produces correct element count and parameter mapping.
- Test skip_threshold excludes white cells.
- Test aspect ratio preservation.

## Dependency

Adds `Pillow` as the only new dependency.

## Edge Cases

- **All-white image**: produces zero elements (everything skipped). Print a warning.
- **All-black image**: every cell at param_max. Valid but worth noting in output.
- **Non-square pixels**: Pillow's resize handles aspect ratio; the grid dimensions define the output shape regardless of the input image's aspect ratio.
- **Very large images**: Pillow handles the downscaling; the grid resolution caps the output complexity.
- **Transparency**: PNG alpha channel. Treat transparent pixels as white (skip). Convert RGBA → grayscale by compositing onto white background first.
