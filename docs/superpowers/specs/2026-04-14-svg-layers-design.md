# SVG → Per-Layer Laser Parameters (v1) Design

## Goal

Convert an arbitrary SVG into an `.xcs` file where each unique fill color and each unique stroke color becomes a separately-parameterized layer. Each color layer gets its own `ProcessingParams` and its own render mode (fill engrave / vector engrave / vector cut).

## Scope

In scope:

- Input: any SVG (Inkscape, Illustrator, Figma, hand-written, auto-traced). The parser does not require Inkscape metadata.
- Output: `.xcs` file using native XCS `PATH` / `CIRCLE` / `LINE` / `RECT` display types. Native `PATH` support was confirmed by inspecting a file saved from XCS Studio (`samples/shape.xcs`) — XCS stores SVG-style path strings in a `dPath` field and supports `isCompoundPath` and `fillRule`.
- Render modes per layer: `COLOR_FILL_ENGRAVE`, `VECTOR_ENGRAVING`, `VECTOR_CUTTING`.
- Parameter assignment: explicit per-color config, plus an auto-ramp helper that sorts detected colors (by luminance / hue / order-of-appearance) and interpolates one parameter across them.
- Delivery: new library function `generate_from_svg()` and new `xcs-gen svg` CLI subcommand (detect + generate). No web UI in this pass — mirrors the image-to-laser pattern.

Out of scope (deferred):

- Explicit hatched-line fills with parameter ramps across each shape. This is a follow-up spec; the parser and layer model from this spec are reused directly when it lands.
- SVG features not listed above: gradients, filters, text, text-on-path, embedded raster images, patterns, masks, clip-paths, `<style>` CSS blocks. These elements are logged and skipped.
- Web UI integration.
- Preset libraries / named `ProcessingParams` reusable across projects. Add when the pain is felt.

## Pipeline

```
SVG file → Parser → Layer grouping → Param assignment → Emitter → XCS JSON
```

1. **Parser** — resolve `<use>`, flatten all transforms, normalize styles, convert shapes to SVG path `d` strings. Uses the `svgelements` library.
2. **Layer grouping** — bucket each shape into a fill layer (keyed by its fill color) and/or a stroke layer (keyed by its stroke color). A shape with both contributes to two layers and will emit two XCS displays sharing the same geometry.
3. **Param assignment** — explicit `layer_config` wins; auto-ramp fills in colors without explicit config; `base_params` fills in fields the user didn't vary.
4. **Emitter** — produce an XCS display per (shape, layer) pair, each with its own `ProcessingParams` and processing type.

## Library API

New module `src/xcs_gen/svg_source.py`:

```python
RenderMode = Literal["fill_engrave", "vector_engrave", "vector_cut"]
# Maps to XCS processingType:
#   fill_engrave   → COLOR_FILL_ENGRAVE
#   vector_engrave → VECTOR_ENGRAVING
#   vector_cut     → VECTOR_CUTTING

@dataclass
class LayerConfig:
    params: ProcessingParams
    render_mode: RenderMode = "fill_engrave"

@dataclass
class AutoRamp:
    param: str                        # "speed" | "power" | "frequency" | ...
    min_value: float
    max_value: float
    sort_by: Literal["luminance", "hue", "order_of_appearance"] = "luminance"
    default_render_mode: RenderMode = "fill_engrave"

@dataclass
class DetectedColor:
    hex: str                          # lowercase "#ffd73e"
    source: Literal["fill", "stroke", "both"]
    shape_count: int

def detect_svg_colors(svg_path: str) -> list[DetectedColor]: ...
```

New entrypoint in `src/xcs_gen/generators.py`:

```python
def generate_from_svg(
    *,
    svg_path: str,
    layer_config: dict[str, LayerConfig] | None = None,
    auto_ramp: AutoRamp | None = None,
    total_width: float = 100.0,
    total_height: float | None = None,
    start_x: float = 10.0,
    start_y: float = 10.0,
    base_params: ProcessingParams | None = None,
) -> XCSProject
```

Resolution order for each detected color:
1. `layer_config[color]` if present.
2. Auto-ramp if provided: colors not in `layer_config` are sorted by `sort_by`, then each is assigned a value by linearly interpolating `auto_ramp.param` between `min_value` (assigned to the first color in the sorted list) and `max_value` (assigned to the last). All other fields come from `base_params`. Render mode is `auto_ramp.default_render_mode`.
3. If neither path covers a color, raise `ValueError` listing detected colors.

Ramp direction per sort mode:
- `luminance`: sorted **descending** (lightest first, darkest last), using the formula `0.299*R + 0.587*G + 0.114*B`. Darkest color therefore gets `max_value`. This matches the image-to-laser convention where `max_value` is the "at-black" end and `min_value` is the "at-white" end — for speed, the user sets `min=fast, max=slow`; for power, `min=low, max=high`.
- `hue`: sorted by HSL hue ascending (0°–360°). Reds come first, purples last.
- `order_of_appearance`: first-seen in the SVG traversal gets `min_value`; last-seen gets `max_value`.

Single-color edge case: only one color detected → that color gets `min_value`; a warning is logged.

## Data Model Additions

New display types in `src/xcs_gen/model.py`:

```python
@dataclass
class Path:
    d: str                            # absolute-coord SVG path d string
    x: float                          # bounding box top-left (mm)
    y: float
    width: float
    height: float
    is_close_path: bool
    is_compound_path: bool = False
    fill_rule: Literal["evenodd", "nonzero"] = "evenodd"
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "COLOR_FILL_ENGRAVE"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""

@dataclass
class Circle:
    x: float                          # bounding box top-left (not center)
    y: float
    width: float                      # diameter
    height: float
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "VECTOR_ENGRAVING"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""
```

`XCSProject` gains two parallel lists `paths: list[Path]` and `circles: list[Circle]` (kept separate from `elements: list[Rect]` to avoid touching existing call sites). The builder iterates all three.

## Parser Details

Library: `svgelements` (pure-Python, handles transforms, `<use>`, CSS styles, path normalization). Added to `pyproject.toml`.

Per-shape walk for each leaf SVG element:

- **Transforms baked in** — `svgelements` composes nested `<g transform="...">` matrices. Emitted `d` strings are in absolute document coordinates; no `transform` attribute is emitted on the XCS element.
- **Style resolution** — effective fill/stroke from inline `style=""`, presentation attributes (`fill=`, `stroke=`), and parent `<g>` inheritance. Normalized to lowercase hex. CSS color names (`"red"`) and shorthand (`#f00`) expanded to full hex. `"none"` and `"transparent"` mean no layer on that axis.
- **Shape conversion** — `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>` are converted to equivalent `d` strings. `<circle>` also emits a native XCS `CIRCLE` display (cleaner output than a 4-Bezier path for circles). `<path>` passes through with its `d` attribute. Bounding box computed from the final geometry.
- **Unsupported elements** logged to stderr and skipped: `<text>`, `<image>`, `<linearGradient>`, `<radialGradient>`, `<pattern>`, `<mask>`, `<clipPath>`, `<filter>`, `<symbol>` (except via `<use>` which is resolved), `<style>` CSS blocks.
- **Viewport and scaling** — read `viewBox` (fall back to `width`/`height`). Compute a uniform scale so output is `total_width` mm wide; `total_height` defaults to preserving aspect ratio. Apply the scale plus `start_x` / `start_y` offset to all coordinates when emitting.
- **Degenerate shapes** — zero-area paths, NaN coords, empty `d` strings after transform: log and skip.
- **Curve commands** — C/Q/A survive if XCS accepts them (likely, since `dPath` is SVG-native). Implementation verifies on a curved test SVG early; if XCS flattens curves internally, we flatten at parse time using `svgelements`' path-interpolation helpers.

## Builder Changes

`src/xcs_gen/builder.py` adds two builders mirroring `_build_rect_display` / `build_line_display`:

- `_build_path_display(path: Path) -> dict` — emits `type: "PATH"` with `dPath`, `isClosePath`, `isCompoundPath`, `fillRule`, `width`, `height`, `x`, `y`, and `graphicX` / `graphicY`. The exact convention for `graphicX` / `graphicY` is copied from `samples/shape.xcs`; the implementation verifies behavior by round-tripping a generated file through XCS Studio.
- `_build_circle_display(circle: Circle) -> dict` — emits `type: "CIRCLE"` with position and size, matching `samples/shape.xcs`.

`build_xcs()` iterates `project.elements`, `project.paths`, `project.circles`, and `project.extra_displays` in turn. Layer-color collection already walks every display list, so no change there. `build_device_entry()` is generic over display type and unchanged.

All existing gradient / image / text functionality is untouched. The multi-layer machinery (per-display `ProcessingParams`, `isProcessByLayer: false`) already supports per-color parameters without format changes.

## CLI

New `xcs-gen svg` subcommand with two modes.

**Detect (diagnostic, no output file):**

```
xcs-gen svg detect <input.svg>
```

Prints a table of detected colors, role (fill/stroke/both), and shape count.

**Generate:**

```
xcs-gen svg generate <input.svg> -o <output.xcs> [options]
```

Options:

- `--width <mm>` — output width (default 100).
- `--height <mm>` — output height (default: preserve aspect).
- `--start-x <mm>`, `--start-y <mm>` — offset on the bed (defaults 10, 10).
- Auto-ramp shorthand:
  - `--ramp-param <name>` (e.g. `speed`)
  - `--ramp-min <value>`, `--ramp-max <value>`
  - `--ramp-sort <luminance|hue|order_of_appearance>` (default `luminance`)
  - `--ramp-mode <fill_engrave|vector_engrave|vector_cut>` (default `fill_engrave`)
- Per-color explicit (repeatable):
  - `--color <hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>`
  - Blank fields inherit from the base-param flags below. Example: `--color "#000000::,80,,,,,"` keeps defaults everywhere except power.
  - The `mode` field is required. If blank, defaults to `fill_engrave`.
- Explicit `--color` overrides take priority over `--ramp-*`. If both are set, ramp applies only to colors not listed in any `--color` flag.
- Base-param flags (shared with existing subcommands): `--power`, `--speed`, `--frequency`, `--density`, `--pulse-width`, `--passes`, `--laser red|blue`.

Representative invocations:

```bash
# Inspect what colors exist before generating.
xcs-gen svg detect samples/Pikachu.svg

# Zero-config auto-ramp: power sweep across all colors.
xcs-gen svg generate samples/Pikachu.svg -o out.xcs \
  --width 80 \
  --ramp-param power --ramp-min 20 --ramp-max 80

# Explicit per-color control.
xcs-gen svg generate samples/Pikachu.svg -o out.xcs --width 80 \
  --color "#000000:vector_engrave:1500,80,65,100,1,200" \
  --color "#ffd73e:fill_engrave:2000,40,65,100,1,200" \
  --color "#e44a1a:fill_engrave:2000,55,65,100,1,200"
```

## Error Handling & Edge Cases

- **Unsupported SVG features** — logged to stderr with element type and id; skipped; generation continues. A summary line at end reports counts. Rationale: a partially-unsupported SVG should still produce a partial result instead of a hard failure.
- **No detected colors** — SVG contained only unsupported elements, or every shape had `fill="none"` and `stroke="none"`. Raise `ValueError`; CLI exits 1.
- **Colors detected but no `layer_config` nor `auto_ramp`** — `ValueError` listing the colors and pointing at `--ramp-param` or `detect`.
- **Auto-ramp on a single color** — single color gets `min_value` (covered in the Library API section); warn but proceed.
- **Invalid color in `layer_config`** (typo or unknown hex) — `ValueError` listing valid detected colors.
- **SVG with no `viewBox` and no `width`/`height`** — `ValueError`. User must add dimensions to the source.
- **Large SVGs** — no element-count cap in v1. Final shape count is printed so the user has visibility.
- **Skew / non-uniform scale transforms** — handled by `svgelements` matrix composition. Resulting `d` carries the distortion, which is the user's intent if they authored a skew.
- **`<style>` CSS blocks** — `svgelements` may not resolve them; warn once per file if one is present.
- **Non-mm units (px, pt, in)** — `svgelements` normalizes to document units; our mm scaling applies after. The user never sees SVG units.
- **Zero-area bounding box** — skip with warning.
- **Empty `d` string after transform** — skip with warning.

## Testing

New `tests/test_svg.py`:

- `detect_svg_colors()` on a hand-crafted SVG with known fills and strokes returns the expected hex values, roles, and counts.
- `generate_from_svg()` produces one XCS display per shape-layer pairing; shapes with both fill and stroke produce two displays.
- Auto-ramp produces ascending parameter values by luminance across detected colors.
- Transform bake-in: a translated rect lands at the expected absolute coords in the emitted `dPath`.
- Unsupported elements are logged but don't raise.
- Generated XCS round-trips through `json.loads` and contains valid `PATH` / `CIRCLE` displays.

Existing tests continue to pass (`tests/test_roundtrip.py`, `tests/test_schemas.py`, `tests/test_image.py`).

## Dependencies

- `svgelements` added to `pyproject.toml`. Pure Python, no binary deps.

## Files Touched

New:
- `src/xcs_gen/svg_source.py` — parser + detect + layer grouping.
- `tests/test_svg.py` — unit tests.

Modified:
- `src/xcs_gen/model.py` — add `Path`, `Circle`; extend `XCSProject` with `paths`, `circles`.
- `src/xcs_gen/builder.py` — add `_build_path_display`, `_build_circle_display`; extend `build_xcs()` to iterate new lists.
- `src/xcs_gen/generators.py` — add `generate_from_svg()`.
- `src/xcs_gen/cli.py` — add `svg detect` and `svg generate` subcommands.
- `pyproject.toml` — add `svgelements`.

## Success Criteria

- `xcs-gen svg detect samples/Pikachu.svg` lists each fill color with accurate shape counts.
- `xcs-gen svg generate samples/Pikachu.svg -o pika.xcs --ramp-param power --ramp-min 20 --ramp-max 80` produces an `.xcs` that opens in XCS Studio with Pikachu's shapes laid out correctly, one color layer per unique fill, and power ramped by luminance.
- A round-trip test: import `samples/Pikachu.svg` into XCS Studio manually, save, diff against our generated file — any systematic differences in the `dPath` or processing block format get documented and reconciled.
- Per-color override works: invoking with `--color "#000000:vector_cut:..."` produces that color's shapes with `VECTOR_CUTTING` processing at the specified params, leaving the rest on auto-ramp.
