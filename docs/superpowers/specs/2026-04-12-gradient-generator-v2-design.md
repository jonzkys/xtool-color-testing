# Gradient Generator v2 Design

## Goal

Replace the current PoC generators (`single_axis_sweep`, `gradient_grid`) with a size-aware gradient generator that supports up to 1000+ elements, auto-computed element sizing, axis labels, and tick marks.

## Layout Model

The user specifies a **total content area** (default 100mm wide x 50mm high) and element count. Element dimensions are derived:

- **Single axis (1D)**: One row of `x_steps` elements. `element_width = (total_width - (x_steps - 1) * gap) / x_steps`. `element_height = total_height`.
- **Dual axis (2D)**: Grid of `x_steps * y_steps`. `element_width = (total_width - (x_steps - 1) * gap) / x_steps`. `element_height = (total_height - (y_steps - 1) * gap) / y_steps`.

Gap defaults to 0. For 1000 elements in 100mm with zero gap, each element is 0.1mm wide.

The gradient area starts at a configurable origin (`start_x`, `start_y`), defaulting to (10, 10) to leave room from the canvas edge.

## Axis Annotations

Labels and tick marks sit **outside** the gradient area:

- **Bottom (X axis)**: Always present. Tick marks extend downward from the bottom edge of the gradient. TEXT labels below the ticks showing parameter values.
- **Left (Y axis)**: Only in dual-axis mode. Tick marks extend leftward from the left edge. TEXT labels to the left of the ticks.

### Tick marks

- LINE display elements, vertical for X axis, horizontal for Y axis.
- Length: ~2mm (configurable).
- Auto-interval: aim for 5-10 labels. For N elements, label every `ceil(N / 10)` elements, plus always label the first and last.

### Text labels

- TEXT display elements using the embedded Bigshot One font.
- Font size: 3pt default (compact enough for dense grids).
- Show the parameter value rounded to a sensible precision (integers for speed/density/frequency, 1 decimal for power).
- X-axis labels are centered below their tick mark.
- Y-axis labels are right-aligned to the left of their tick mark.

### Annotation processing

All annotations (ticks + labels) share a dedicated layer (`#aaaaaa`). Processing type: `VECTOR_ENGRAVING` with low power defaults (power=10, speed=1000). Overridable via `annotation_params`.

## Layer Strategy

- **One layer** for all gradient elements (e.g., `#00befe`). Per-element processing params work because `isProcessByLayer: false`.
- **One layer** for all annotations (`#aaaaaa`).
- Total: 2 layers in XCS Studio's panel regardless of element count.

## Model Changes

Current `XCSProject` only holds `list[Rect]`. Annotations (LINE, TEXT) need to be part of the project too.

Add to `XCSProject`:
- `extra_displays: list[dict]` — raw display dicts (LINE, TEXT) built by the generator.
- `extra_device_entries: list[tuple[str, dict]]` — corresponding device processing entries.

The builder (`build_xcs`) merges these into the canvas displays and device data alongside the Rect elements.

Also add a `Line` dataclass to `model.py`:
- `x`, `y`, `length`, `angle` (90 for vertical, 0 for horizontal), `layer_color`, `id`.

## Generator API

Single function `generate_gradient()` replaces both `single_axis_sweep` and `gradient_grid`:

```python
def generate_gradient(
    *,
    x_param: str,
    x_min: float,
    x_max: float,
    x_steps: int = 100,
    y_param: str | None = None,   # None = single axis mode
    y_min: float = 0,
    y_max: float = 0,
    y_steps: int = 1,
    total_width: float = 100.0,   # mm
    total_height: float = 50.0,   # mm
    gap: float = 0.0,             # mm between elements
    start_x: float = 10.0,       # mm from canvas left
    start_y: float = 10.0,       # mm from canvas top
    base_params: ProcessingParams | None = None,
    processing_type: str = "COLOR_FILL_ENGRAVE",
    label_font_size: float = 3.0,
    tick_length: float = 2.0,
    annotation_params: ProcessingParams | None = None,
) -> XCSProject:
```

## CLI

Replace `sweep` and `grid` subcommands with a single `generate` command:

```
xcs-gen generate \
  --x-param speed --x-min 100 --x-max 5000 \
  [--y-param power --y-min 10 --y-max 100] \
  [--x-steps 1000] [--y-steps 10] \
  [--width 100] [--height 50] \
  [--gap 0] \
  [--font-size 3] \
  -o output.xcs
```

- `--y-param` is optional. Omit for single-axis mode.
- `--x-steps` defaults to 100. `--y-steps` defaults to 10 (only used with `--y-param`).

## Files to Modify

1. **`model.py`** — Add `Line` dataclass. Add `extra_displays` and `extra_device_entries` to `XCSProject`.
2. **`builder.py`** — Merge extra displays/device entries. Add `_build_line_display()`. Add `_build_text_processing_data()` for annotation processing. Support shared layers (multiple elements on same layer color).
3. **`generators.py`** — Replace `single_axis_sweep` and `gradient_grid` with `generate_gradient()`. Add axis annotation logic (tick marks + text labels).
4. **`cli.py`** — Replace `sweep`/`grid` subcommands with `generate`.
5. **`tests/test_roundtrip.py`** — Update tests for new API. Add tests for annotation generation and 1000-element scaling.

## Edge Cases

- **Zero gap, 1000 elements in 100mm**: element_width = 0.1mm. Valid for laser but very narrow. No special handling needed.
- **Label overlap**: With very dense grids, auto-interval prevents label overcrowding by spacing labels at `ceil(N / 10)` intervals.
- **Value formatting**: Integers for speed/density/frequency/passes/pulse_width/dpi. One decimal for power. No trailing zeros.
