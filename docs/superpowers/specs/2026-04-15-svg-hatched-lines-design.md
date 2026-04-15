# SVG Hatched Lines (v2 — Render Mode D) Design

## Goal

Add a fourth render mode, `hatched`, to the existing `xcs-gen svg` pipeline. A hatched layer fills each shape with explicit `LINE` segments clipped to the shape geometry. Each pass through a shape declares a hatch angle, a line spacing, base laser params, and any number of linear ramps that vary parameters spatially across the shape. Multiple passes per layer compose into cross-hatching and other multi-direction effects.

Primary motivator: artistic / functional output (shading, fades, cross-hatched textures, density-driven tonal effects). Secondary: parameter test patterns within shape outlines.

## Scope

In scope:

- New render mode `hatched` plumbed end-to-end (parser → resolver → generator → builder → CLI).
- Multi-pass per layer (cross-hatching, multi-direction texture).
- Per-pass linear ramps along one of four axes: `perp` (perpendicular to hatch direction), `parallel` (along hatch direction), `x`, `y` (shape bbox axes).
- Spacing rampable via the same `HatchRamp` mechanism (`param="spacing"`).
- Polygon clipping via `shapely`. Compound paths (holes) handled via SVG `fillRule`.
- Output: each clipped hatch segment becomes one XCS `LINE` display with its own `ProcessingParams` and `processingType="VECTOR_ENGRAVING"`.
- YAML config file (`--config layers.yaml`) as primary UX; `--hatch` CLI flag for quick one-pass cases; both compile to the same dataclasses.

Out of scope (deferred):

- Radial / image-mapped ramps.
- Per-segment hatching beyond linear-along-axis (e.g. arbitrary curve-following or cubic interpolation).
- Kerf compensation / line offsetting.
- Web UI integration.
- Anti-aliasing or sub-pixel start/end positioning of hatch lines.
- Stroke-layer hatching (validation rejects `hatched` on stroke layers).

## Pipeline

```
SVG file → Parser (v1) → Layer grouping (v1) → Param assignment (resolver, extended)
                                                        ↓
                                  per (shape, layer) pair:
                                  if hatched: hatch generator → many Lines
                                  else (v1): one Path per layer
                                                        ↓
                                            Builder → XCS JSON
```

The v1 parser, color detection, and layer grouping are unchanged. The resolver is extended to validate hatched-mode configs. A new hatch generator produces clipped `LINE` segments with per-segment params. The builder already handles per-element params in `extra_displays` / `extra_device_entries`, so no format change.

## Data Model

Extend `src/xcs_gen/svg_source.py`:

```python
RenderMode = Literal["fill_engrave", "vector_engrave", "vector_cut", "hatched"]

_RENDER_MODE_TO_PROCESSING = {
    "fill_engrave":   "COLOR_FILL_ENGRAVE",
    "vector_engrave": "VECTOR_ENGRAVING",
    "vector_cut":     "VECTOR_CUTTING",
    "hatched":        "VECTOR_ENGRAVING",   # per-segment LINE displays
}

RampAxis = Literal["perp", "parallel", "x", "y"]
# perp     — perpendicular to the hatch angle (most common: top-to-bottom fade for 0°)
# parallel — along the hatch angle (segments along a line vary)
# x, y     — shape bbox axes, ignoring hatch angle

@dataclass
class HatchRamp:
    """Linearly interpolate one ProcessingParams field (or 'spacing') across the shape."""
    param: str            # "power" | "speed" | "frequency" | "density" |
                          # "passes" | "pulse_width" | "spacing"
    axis: RampAxis
    min_value: float      # value at axis min (e.g. left/top of shape bbox)
    max_value: float      # value at axis max

@dataclass
class HatchPass:
    """One sweep of parallel hatch lines through the shape."""
    angle: float = 0.0                              # degrees, 0 = horizontal
    spacing: float = 0.5                            # mm between adjacent lines
    base_params: ProcessingParams | None = None     # falls back to LayerConfig.params
    ramps: list[HatchRamp] = field(default_factory=list)

@dataclass
class LayerConfig:
    """Existing v1 type, extended."""
    params: ProcessingParams
    render_mode: RenderMode = "fill_engrave"
    hatch_passes: list[HatchPass] = field(default_factory=list)
    # When render_mode == "hatched": hatch_passes must be non-empty.
    # Otherwise: hatch_passes is ignored (and validated empty by the resolver).
```

`AutoRamp` is unchanged. It produces per-color baseline params; a hatched layer's pass ramps can further vary those params spatially within each shape.

`model.Line` (existing dataclass — currently used only for axis-tick annotations at fixed params) gains two optional fields:

```python
@dataclass
class Line:
    x: float
    y: float
    length: float
    angle: float = 0.0
    layer_color: str = ""
    id: str = field(default_factory=_uuid)
    # New for v2:
    params: ProcessingParams | None = None             # None → annotation defaults
    processing_type: str = "VECTOR_ENGRAVING"
```

The builder already routes `params` through `build_device_entry()` for the device-processing map; adding the optional field keeps backward compat with existing annotation usage (which uses fixed annotation params).

### Resolver validation

`resolve_layer_params` adds:

- `render_mode == "hatched"` requires `hatch_passes` non-empty → `ValueError(f"hatched layer {color!r} has no hatch_passes")`.
- `render_mode != "hatched"` with non-empty `hatch_passes` → `ValueError(f"layer {color!r} has hatch_passes but render_mode={render_mode!r}")`.
- Each `HatchRamp.param` validated against the existing `_RAMP_FIELD_MAP` plus the new key `"spacing"`. Invalid → `ValueError` listing valid params.
- Stroke-layer with `render_mode == "hatched"` → `ValueError` pointing at `vector_engrave` or `vector_cut`. This check lives in the generator, not the resolver, because color-role information (fill vs stroke) is only available when iterating shapes — the resolver sees just the deduplicated color list.

## Hatch Generation

New module `src/xcs_gen/hatch.py`:

```python
def svg_d_to_polygon(d: str, fill_rule: str) -> shapely.Polygon | shapely.MultiPolygon:
    """Convert an SVG path d-string (in bed-mm) to a shapely Polygon.

    Splits subpaths on 'M' commands. fill_rule="evenodd" → alternating subpaths
    become holes; fill_rule="nonzero" → uses winding direction. Calls
    shapely.make_valid() before returning to repair self-intersections.
    """

def generate_hatch_segments(
    polygon: shapely.Polygon | shapely.MultiPolygon,
    hatch_pass: HatchPass,
    layer_color: str,
    fallback_params: ProcessingParams,
) -> list[Line]:
    """Produce clipped Line segments for one pass through one polygon."""
```

For each shape on a hatched layer:

1. Build the polygon via `svg_d_to_polygon`.
2. For each `HatchPass`:
   a. Rotate the polygon by `-pass.angle` so hatching reduces to horizontal lines.
   b. Walk `y` from `bbox.miny` to `bbox.maxy` stepping by `pass.spacing` (or by the spacing-ramp's value at the current `y`). For each `y`, build an infinite horizontal line.
   c. `polygon.intersection(line)` → 0..N `LineString` segments. (A donut shape produces 2 segments per crossing line.)
   d. Rotate each segment back by `+pass.angle` to recover bed-mm coords.
   e. Compute per-segment params:
      - Start with `pass.base_params` or `LayerConfig.params`.
      - For each `HatchRamp`: project the segment's midpoint onto the ramp axis, normalize 0..1 against the polygon's extent on that axis, linearly interpolate `min_value`→`max_value`, write into the field.
   f. Emit one `model.Line(x, y, length, angle, params, processing_type="VECTOR_ENGRAVING", layer_color)` per segment.
3. Append all `Line` instances to `XCSProject.extra_displays` (as already-built dicts via `build_line_display`) and matching entries to `XCSProject.extra_device_entries` via `build_device_entry`.

### Spacing-ramp semantics

A `HatchRamp(param="spacing", axis=..., min, max)` is consumed during step (b), not per-segment. Effectively: the spacing for line `i` is determined by interpolating the ramp at line `i`'s position. For `axis=perp` (the natural one), spacing varies smoothly from one side of the shape to the other. For other axes, spacing is read in the rotated frame for simplicity.

### Output element type

Each segment is one `model.Line` → one `LINE` display in XCS. The builder's existing `build_line_display(line)` and `build_device_entry(...)` handle this with no changes other than passing `line.params` and `line.processing_type` through (fields newly populated).

`extra_displays` / `extra_device_entries` are the right home for hatched output: they already accept arbitrary per-element params, and the builder folds new layer colors into `layerData` automatically.

## Configuration

### YAML config file (primary UX)

```yaml
# layers.yaml — passed via xcs-gen svg generate --config layers.yaml
defaults:
  laser: red
  power: 50
  speed: 1000
  frequency: 65

layers:
  "#000000":
    render_mode: vector_cut
    speed: 500
    power: 80
    passes: 2

  "#ffd73e":
    render_mode: hatched
    hatch_passes:
      - angle: 0
        spacing: 0.4
        ramps:
          - { param: power, axis: perp, min: 30, max: 70 }
      - angle: 90
        spacing: 0.4
        ramps:
          - { param: power, axis: perp, min: 30, max: 70 }

  "#e44a1a":
    render_mode: hatched
    hatch_passes:
      - angle: 45
        spacing: 0.3
        power: 60
        ramps:
          - { param: spacing, axis: y, min: 0.2, max: 0.5 }

# Optional auto-ramp for any color not listed above:
auto_ramp:
  param: power
  min: 20
  max: 80
  sort_by: luminance
  default_render_mode: fill_engrave
```

Top-level keys:
- `defaults` — base ProcessingParams applied to layers/passes that don't override.
- `layers` — dict keyed by lowercase hex. Each entry has `render_mode` plus mode-specific fields.
- A layer's flat keys (`speed`, `power`, etc.) become its `ProcessingParams`.
- A `hatched` layer adds `hatch_passes`, each pass having `angle`, `spacing`, optional flat param overrides, and `ramps`.
- `auto_ramp` (optional, top level) — applied to colors not in `layers`.

Loader: new module `src/xcs_gen/svg_config.py`. Adds `pyyaml` dependency.

### `--hatch` CLI flag (quick-experiment path)

Repeatable, one pass per flag:

```
--hatch '<hex>:<key=val,key=val,...>:<ramp1>:<ramp2>...'
```

- Pass-level keys: `angle`, `spacing`, plus any `ProcessingParams` field (`power`, `speed`, etc.).
- Each `ramp` is `<param>=<axis>:<min>:<max>`.
- Multiple `--hatch` flags with the same color = multiple passes.

Example:

```
--hatch '#ffd73e:angle=0,spacing=0.4,power=50:power=perp:30:70'
--hatch '#ffd73e:angle=90,spacing=0.4:power=perp:30:70'
```

### Configuration precedence

Highest wins:

1. CLI flag (`--hatch`, `--color`, `--ramp-*`).
2. `--config` YAML file.
3. Auto-ramp (CLI or YAML).
4. Otherwise → `ValueError` listing the uncovered colors.

### CLI invocation

```bash
# Quick one-pass hatched fill:
xcs-gen svg generate samples/Pikachu.svg -o out.xcs --width 80 \
  --hatch '#ffd73e:angle=0,spacing=0.4:power=perp:30:70' \
  --color '#000000:vector_cut:500,80,65,100,1,200'

# Real artistic workflow:
xcs-gen svg generate samples/Pikachu.svg -o out.xcs --width 80 \
  --config pikachu-layers.yaml
```

## Performance & Edge Cases

### Element count

Hatched output is element-heavy. Pikachu yellow (~30mm × 40mm visible content area) at 0.4mm spacing × 2 passes × ~3 segments per line ≈ 750 LINEs per shape. ~10 yellow paths → ~7500 LINEs for the yellow layer alone. XCS Studio's practical element-count limits are unknown.

Mitigations:

- Print a stderr warning at generation if total elements exceed 10000.
- `--max-segments N` CLI flag (default 50000) — hard cap. Exceeded → `ValueError` naming the offending color and suggesting "increase spacing or reduce passes".
- The generator tracks per-color counts so the error is actionable.
- No silent fallback (e.g. spacing-doubling). User fixes their config.

### Edge cases

- **Shape too small for hatching** (bbox smaller than spacing in any direction): emit zero segments, log warning to stderr.
- **Self-intersecting / invalid polygons**: shapely's `make_valid()` is called inside `svg_d_to_polygon`. Empty result → log and skip.
- **Compound paths with holes**: `Polygon(shell, holes=...)` handles even-odd correctly when subpaths are split and assigned by `fillRule`.
- **Sub-millimeter spacing**: allowed but warned if `< --beam-width` (default 0.03mm), reusing existing beam-width validation pattern.
- **Spacing ramp going to zero or negative**: clamped to `--min-spacing` (default 0.01mm) with a once-per-pass warning.
- **`render_mode="hatched"` with empty `hatch_passes`**: caught by resolver, `ValueError`.
- **Ramp on a non-existent param**: caught by resolver, `ValueError` listing valid params.
- **Empty intersection on a hatch line** (line tangent to a vertex or hits hole-only region): zero segments contributed; continue silently.
- **Stroke layer with `hatched`**: rejected at the generator boundary, `ValueError` directing the user to `vector_engrave` / `vector_cut`.

## Testing

`tests/test_hatch.py` (new):

- `svg_d_to_polygon` on a simple square, a compound path with one hole, a multipolygon (two disjoint shapes in one path).
- `generate_hatch_segments` for a 10mm × 10mm square at angle=0 / 45 / 90 with various spacings — assert segment count equals expected ceil((bbox/spacing)).
- Per-segment param ramp computed by midpoint position matches the linear interpolation formula.
- Spacing ramp produces variable-spaced lines.

`tests/test_svg_config.py` (new):

- YAML loader round-trip for all four render modes.
- Schema validation: bad `render_mode`, missing required field, invalid `axis`, unknown `param`.
- Config + CLI override interaction (CLI wins).

`tests/test_svg_generator.py` (extend):

- `test_generate_from_svg_hatched_layer`: TWO_COLOR fixture with one color set to hatched, verify `Line` elements appear in `project.extra_displays`.
- `test_pikachu_hatched_round_trip` (skipif Pikachu missing): hatched yellow + cut black, verify line counts under `--max-segments`, full `build_xcs` round-trip.

`tests/test_svg_cli.py` (extend):

- `--hatch` flag parsing (one pass and multi-pass).
- `--config` end-to-end with a small inline YAML.
- `--max-segments` honored — error message names the over-budget color.

## Dependencies

- `shapely` (new) — polygon-line clipping. ~6MB binary install with GEOS.
- `pyyaml` (new) — config file loader.

## Files Touched

New:
- `src/xcs_gen/hatch.py` — polygon construction + segment generation.
- `src/xcs_gen/svg_config.py` — YAML loader for the `--config` flag.
- `tests/test_hatch.py`
- `tests/test_svg_config.py`

Modified:
- `src/xcs_gen/svg_source.py` — add `HatchRamp`, `HatchPass`; extend `RenderMode`, `LayerConfig`; extend resolver validation.
- `src/xcs_gen/model.py` — add `params` and `processing_type` optional fields on `Line`.
- `src/xcs_gen/builder.py` — `build_line_display` already takes a `Line` and builds the dict; route `line.params` and `line.processing_type` through `build_device_entry` when present (instead of falling back to annotation defaults).
- `src/xcs_gen/generators.py` — `generate_from_svg` dispatches: `hatched` shapes go through the hatch generator; others go through the v1 Path emitter.
- `src/xcs_gen/cli.py` — add `--hatch`, `--config`, `--max-segments`, `--min-spacing` flags. Parse `--hatch` into `LayerConfig(render_mode="hatched", hatch_passes=[...])`. Wire `--config` through `svg_config` loader.
- `pyproject.toml` — add `shapely` and `pyyaml`.

## Success Criteria

- `xcs-gen svg generate samples/Pikachu.svg -o out.xcs --width 80 --hatch '#ffd73e:angle=0,spacing=0.4:power=perp:30:70'` produces a file that opens in XCS Studio with the yellow Pikachu body filled by horizontal lines whose power fades top to bottom.
- A two-pass cross-hatch on the yellow layer renders as visible cross-hatching in XCS Studio's preview.
- A YAML config covering all four render modes (`vector_cut`, `fill_engrave`, `vector_engrave`, `hatched` with multiple passes) generates a complete `.xcs` and opens cleanly.
- `--max-segments 1000` against a high-density Pikachu config produces a clear error naming the over-budget color and suggesting a fix, not a silent broken file.
