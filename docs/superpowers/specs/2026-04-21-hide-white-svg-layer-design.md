# Hide White Layer in SVG Detection

**Date:** 2026-04-21
**Status:** Accepted (pending plan)

## Summary

When the app detects layers from an uploaded SVG (or a PNG that's been
traced to SVG), near-white colours are filtered out of the default layer
list. PNG tracer output routinely includes the white page background as
a layer, which is never something the user wants to engrave. A checkbox
in the layer picker lets the user override and include white if needed.

## Motivation

- PNGs with a white background, run through the `png_to_svg` tracer,
  produce an SVG where the background becomes a full-canvas white fill.
  This gets detected as a layer and auto-assigned parameters unless the
  user manually unticks it.
- Human-authored SVGs occasionally include a white background rect for
  the same reason.
- Engraving white on metal isn't a thing. Defaulting white to "excluded"
  matches expected behaviour and eliminates a repeated manual step.

## Non-goals

- **Configurable threshold slider.** Fixed constant `245` (any RGB
  channel below this disqualifies the colour from "near white"). If
  tuning turns out to be necessary in practice, add the slider later.
- **Detecting "background" by position or area** rather than by colour.
  Colour-only is sufficient for the described use case.
- **Auto-skipping any other colour** (black, neon, brand colours).
  Only white is in scope.
- **Changing the existing per-layer `enabled` checkbox.** Users who want
  to remove a non-white layer keep doing that via the same UI as today.
- **PNG tracer changes.** The filter sits downstream of the tracer so
  both SVG-upload and PNG→SVG paths share the same logic.

## Architecture overview

The SVG layer pipeline has one natural filter seam: detection. PNGs
enter the pipeline via `png_to_svg` and then go through the exact same
detection path as uploaded SVGs, so filtering at detection covers both
inputs with one change.

- **Backend** annotates each detected layer with an `is_near_white: bool`
  flag. No filtering is done server-side — the response is unchanged in
  structure and contains every detected colour as before. This keeps the
  API non-breaking.
- **Frontend** filters the detected-layers list client-side based on a
  new `includeNearWhite: boolean` state (default `false`). Toggling the
  checkbox is instant; no refetch.

## Components

### Backend

#### `src/xcs_gen/svg_source.py`

Add a module-level constant and helper:

```python
# RGB channel threshold above which a colour counts as "near white".
# All three channels must be >= this value. 245 catches pure #ffffff and
# vtracer quantization artefacts like #fdfdfd / #fefefe.
NEAR_WHITE_THRESHOLD = 245


def is_near_white(hex_color: str) -> bool:
    """Return True if every RGB channel of a #rrggbb hex colour is >= 245."""
    if not hex_color or not hex_color.startswith("#") or len(hex_color) != 7:
        return False
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return r >= NEAR_WHITE_THRESHOLD and g >= NEAR_WHITE_THRESHOLD and b >= NEAR_WHITE_THRESHOLD
```

`detect_svg_colors()` signature stays the same — it returns the existing
`list[DetectedColor]`. The new `is_near_white` flag lives on the
web-facing `DetectedLayer` Pydantic model, not the internal dataclass,
because only the UI consumer needs it.

#### `src/xcs_gen_web/schemas.py`

Add the flag to `DetectedLayer`:

```python
class DetectedLayer(BaseModel):
    color: str
    shape_count: int
    is_fill: bool
    is_near_white: bool = False
```

Default `False` keeps the field optional on the wire so older clients
that don't send it (and older tests) still validate.

#### `src/xcs_gen_web/svg_layers_converter.py`

`detect_svg_layers()` populates `is_near_white` by calling
`is_near_white()` from `svg_source` on each colour.

#### `src/xcs_gen_web/app.py`

No changes. `/api/svg-detect-layers` returns the augmented layer list.

### Frontend

#### `web/src/components/SvgLayersPage.tsx`

- New piece of state: `const [includeNearWhite, setIncludeNearWhite] = useState(false);`
- The detected-layers list, wherever it's iterated to render the
  checkbox grid or fed into `defaultLayerFromDetected()`, is pre-filtered:
  ```ts
  const visibleLayers = detected.filter(l => includeNearWhite || !l.is_near_white);
  ```
- Auto-creation of `LayerSpec` entries in `applyDetectedSvg()` skips
  `is_near_white=true` layers unless the toggle is on, matching what the
  user sees.
- A small checkbox above the layer list: **"Include white"** plus a
  hint like *"(1 near-white layer hidden)"* when `detected.some(l => l.is_near_white)` is true. Hint count comes from
  `detected.filter(l => l.is_near_white).length`.
- If the user ticks the toggle *after* layers have already been
  materialized, the newly-visible white layer needs to appear as a
  `LayerSpec`. Simplest: re-run the same auto-create logic with the
  filtered list when `includeNearWhite` flips.

#### `web/src/types.ts`

Add `is_near_white?: boolean` to the `DetectedLayer` interface
(optional for wire compatibility; treated as `false` when absent).

## Data flow

```
SVG or PNG uploaded
  ↓ (PNG goes through raster_to_svg first; same path downstream)
POST /api/svg-detect-layers
  ↓
detect_svg_layers() annotates each layer with is_near_white
  ↓
UI receives full list
  ↓
visibleLayers = detected.filter(l => includeNearWhite || !l.is_near_white)
  ↓
defaultLayerFromDetected() runs on visibleLayers only
  ↓
user sees layer-picker without white by default;
ticking "Include white" instantly reveals it
```

## Testing

### Backend

- **`tests/test_svg_source.py`:**
  - `is_near_white("#ffffff")` → True
  - `is_near_white("#fdfdfd")` → True
  - `is_near_white("#f5f5f5")` (245,245,245) → True (boundary)
  - `is_near_white("#f4f4f4")` (244,244,244) → False (just-below)
  - `is_near_white("#ffff00")` → False (one channel is 0)
  - `is_near_white("#ff00ff")` → False
  - `is_near_white("none")` / `""` / `None` → False

- **`tests/test_svg_layers.py`** (or nearest equivalent):
  - SVG with a red + white + transparent shape: detection returns both
    the red and white entries. Red has `is_near_white=False`, white
    has `is_near_white=True`.
  - SVG with only white shapes: detection returns the white layer with
    `is_near_white=True`; backend does not filter it (UI's job).

### Frontend

- **`web/src/components/SvgLayersPage` Vitest:**
  - Mock `detectSvgLayers` returning one red + one white layer. By
    default, only red is in the rendered list; the "Include white (1
    near-white layer hidden)" checkbox is present.
  - Ticking the checkbox makes the white layer appear in the list.
  - With a detection response that has no near-white layers, the
    checkbox does not render (to avoid visual noise).

## Open questions

None.

## Rollout

1. Backend: helper + schema field + converter (Python).
2. Frontend: checkbox + filtering (TS).
3. Ship. No migration — default is `is_near_white=false` so layers
   without the field (persisted from older sessions or alt clients)
   behave identically to today.
