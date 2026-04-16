# SVG Hatched Lines Web UI Design

## Goal

Expose the v2 hatched-lines render mode inside the existing **SVG Layers** tab of the web UI. A new `"HATCHED_LINES"` processing-type option joins the four existing types; when selected, the layer card shows a nested form for the full hatch config (multiple passes, multiple ramps per pass). The existing `crosshatch_enabled` toggle stays for the four path-based modes and is hidden when `HATCHED_LINES` is selected.

## Scope

In scope:

- `SvgProcessingType` TS union and backend Pydantic `Literal` extended with `"HATCHED_LINES"`.
- New dataclasses / types: `HatchPassSpec` (angle, spacing, ramps), `HatchRampSpec` (param, axis, min, max).
- `LayerSpec` gains `hatch_passes: HatchPassSpec[]` (required non-empty when `processing_type === "HATCHED_LINES"`, empty / ignored otherwise).
- New frontend component `<HatchPassesEditor>`: repeatable pass editor with nested ramp editor, inline add / remove / reorder.
- Backend `svg_layers_converter.py` routes hatched layers through the library's `hatch.svg_d_to_polygon` + `hatch.generate_hatch_segments`, emitting `LINE` elements instead of path stacks.
- Validation: non-empty `hatch_passes` when hatched selected, spacing > 0, ramp min != max (warning).
- LocalStorage migration: existing layers default `hatch_passes` to `[]` on load — zero-friction.

Out of scope (deferred):

- Rendering the actual hatched LINE segments in the client-side SVG preview. Preview continues to show per-color shape outlines regardless of processing type.
- Exposing `--max-segments` / `--min-spacing` in the UI. Backend uses sensible defaults (50000 / 0.01mm).
- YAML config file upload on the Layers tab (duplicates existing fine-grained per-color editing).
- Cross-hatching helper buttons beyond the "new pass defaults to prev angle + 90°" convenience.
- React component-level tests for the new editor (matches existing web-UI test minimalism).

## Architecture

```
Browser (SvgLayersPage.tsx)
        │
        │  POST /api/svg-layers — Pydantic-validated SvgLayersRequest
        ▼
FastAPI (app.py → svg_layers_converter.py)
        │
        │  per layer: dispatch on processing_type
        ├─ HATCHED_LINES → hatch.svg_d_to_polygon + hatch.generate_hatch_segments
        │                  → Line elements in XCSProject.extra_displays / extra_device_entries
        └─ all others    → existing Path stacking (unchanged)
        ▼
XCSProject → build_xcs → JSON response (attachment)
```

The hatched path reuses the v2 library end-to-end (`svg_source` resolver is NOT involved — the web converter has its own dispatch). One new file on the frontend; small edits to 4 existing files (3 backend, 1 frontend) plus types.

## Data Model

### Frontend (`web/src/types.ts`)

```typescript
export type SvgProcessingType =
  | "COLOR_FILL_ENGRAVE"
  | "FILL_VECTOR_ENGRAVING"
  | "VECTOR_ENGRAVING"
  | "VECTOR_CUTTING"
  | "HATCHED_LINES";                      // new

export type HatchRampParam =
  | "power" | "speed" | "frequency" | "density"
  | "passes" | "pulse_width" | "spacing";

export type HatchRampAxis = "perp" | "parallel" | "x" | "y";

export interface HatchRampSpec {
  param: HatchRampParam;
  axis: HatchRampAxis;
  min: number;
  max: number;
}

export interface HatchPassSpec {
  angle: number;                          // degrees, 0 = horizontal
  spacing: number;                        // mm between lines
  ramps: HatchRampSpec[];                 // 0 or more
}

export interface LayerSpec {
  color: string;
  name: string;
  enabled: boolean;
  processing_type: SvgProcessingType;
  scan_angle: number;
  base_params: BaseParams;
  crosshatch_enabled: boolean;
  crosshatch_passes: number;
  crosshatch_step_deg: number;
  hatch_passes: HatchPassSpec[];          // new — non-empty iff HATCHED_LINES
}
```

### Backend (`src/xcs_gen_web/schemas.py`)

```python
class HatchRamp(BaseModel):
    param: Literal["power", "speed", "frequency", "density",
                   "passes", "pulse_width", "spacing"]
    axis: Literal["perp", "parallel", "x", "y"]
    min: float
    max: float


class HatchPass(BaseModel):
    angle: float = 0.0
    spacing: float = Field(default=0.5, gt=0.0)
    ramps: list[HatchRamp] = Field(default_factory=list)


class LayerSpec(BaseModel):
    # ... existing fields ...
    processing_type: Literal[
        "COLOR_FILL_ENGRAVE", "FILL_VECTOR_ENGRAVING",
        "VECTOR_ENGRAVING", "VECTOR_CUTTING",
        "HATCHED_LINES",
    ]
    # existing crosshatch_* fields stay
    hatch_passes: list[HatchPass] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_hatched(self):
        if self.processing_type == "HATCHED_LINES" and not self.hatch_passes:
            raise ValueError(
                f"layer {self.color!r}: HATCHED_LINES requires at least one hatch pass"
            )
        return self
```

### Default factory

`web/src/defaults.ts` gains:

```typescript
export function defaultHatchPass(angle = 0): HatchPassSpec {
  return { angle, spacing: 0.5, ramps: [] };
}
```

When a layer's `processing_type` is switched to `HATCHED_LINES` and `hatch_passes` is empty, the UI auto-seeds with `[defaultHatchPass(0)]` so the form has something to render immediately.

## Backend Wiring

Edit `src/xcs_gen_web/svg_layers_converter.py`. In the main per-shape loop (currently emitting `Path` entries and optionally duplicating for crosshatch), add a branch before the Path emission:

```python
if layer.processing_type == "HATCHED_LINES":
    from xcs_gen.hatch import svg_d_to_polygon, generate_hatch_segments
    from xcs_gen.builder import build_line_display, build_device_entry
    from xcs_gen.svg_source import HatchPass as LibHatchPass, HatchRamp as LibHatchRamp

    lib_passes = [
        LibHatchPass(
            angle=hp.angle,
            spacing=hp.spacing,
            ramps=[
                LibHatchRamp(param=r.param, axis=r.axis,
                             min_value=r.min, max_value=r.max)
                for r in hp.ramps
            ],
        )
        for hp in layer.hatch_passes
    ]
    layer_params = _to_processing_params(layer.base_params)   # existing helper in svg_layers_converter.py
    polygon = svg_d_to_polygon(shape.d, fill_rule=shape.fill_rule)
    for lib_hp in lib_passes:
        segments = generate_hatch_segments(
            polygon, lib_hp,
            layer_color=layer.color,
            fallback_params=layer_params,
        )
        for seg in segments:
            project.extra_displays.append(build_line_display(seg))
            project.extra_device_entries.append(
                build_device_entry(seg.id, "LINE", seg.processing_type,
                                   seg.params or layer_params)
            )
    continue  # skip the Path emission for this shape
```

The `crosshatch_*` fields are ignored for hatched layers (validated away client-side and never reached here since we skip to `continue`).

### Max-segments safety

A running counter at the outer loop level enforces `max_segments=50000`; exceeding → `HTTPException(status_code=400, detail=...)` with the offending color named. Matches the library's `generate_from_svg` convention and the existing `/api/svg-layers` error style.

### API

`POST /api/svg-layers` already carries the entire `SvgLayersRequest`. Extending `LayerSpec` requires no new route. FastAPI/Pydantic re-validates the extended schema.

## Frontend UX

### Processing-type dropdown

One new entry in `SvgLayersPage.tsx`:

```typescript
const PROCESSING_TYPES: { value: SvgProcessingType; label: string }[] = [
  { value: "COLOR_FILL_ENGRAVE", label: "Color fill engrave" },
  { value: "FILL_VECTOR_ENGRAVING", label: "Fill vector engrave" },
  { value: "VECTOR_ENGRAVING", label: "Vector engrave" },
  { value: "VECTOR_CUTTING", label: "Vector cut" },
  { value: "HATCHED_LINES", label: "Hatched lines" },
];
```

### Layer card behavior

When `processing_type === "HATCHED_LINES"`:
- Hide the `scan_angle` field (meaningless for LINE output).
- Hide the `crosshatch_enabled / passes / step_deg` block (hatched has its own multi-pass).
- Show `<HatchPassesEditor>` below `base_params`.

Otherwise the card renders exactly as today.

Auto-seed on dropdown change: when switching to `HATCHED_LINES` and `hatch_passes` is empty, set it to `[defaultHatchPass(0)]`.

### `<HatchPassesEditor>` component

New file `web/src/components/HatchPassesEditor.tsx`. Conceptual layout:

```
┌ Hatch passes ───────────────────────────── [+ Add pass] ┐
│  Pass 1                           [▲] [▼] [✕]           │
│    Angle:   [_0__] °   Spacing: [_0.5_] mm              │
│    Ramps                              [+ Add ramp]      │
│      Ramp 1   [power ▾] [perp ▾]  min [30] max [70] [✕] │
│      Ramp 2   [spacing ▾][y ▾]    min [0.3] max [0.8][✕]│
│                                                         │
│  Pass 2                           [▲] [▼] [✕]           │
│    Angle:   [90_] °   Spacing: [_0.5_] mm               │
│    Ramps                              [+ Add ramp]      │
│      (none)                                             │
└─────────────────────────────────────────────────────────┘
```

Controls:
- `[+ Add pass]` — appends a new `HatchPassSpec`. Default angle = `previousPass.angle + 90` (modulo 360) when the layer already has one pass, else 0. Spacing inherits from the previous pass or defaults to 0.5.
- `[▲] [▼]` — reorder passes via array swap.
- `[✕]` — remove. If the last pass is removed and the layer is `HATCHED_LINES`, validation flags the error but the UI allows the state (user can re-add or change processing type).
- Within a pass, `[+ Add ramp]` appends a new ramp with `{param:"power", axis:"perp", min:0, max:0}`. `[✕]` removes.
- Param and axis are `<SelectField>`s; min/max are `<NumberField>`s; angle and spacing too.

Props:

```typescript
interface HatchPassesEditorProps {
  passes: HatchPassSpec[];
  onChange: (next: HatchPassSpec[]) => void;
  issues: ValidationIssue[];            // scoped to this layer for inline warnings
  layerIdx: number;                     // used to match issue field paths
}
```

All edits go through `onChange` with a fresh array (immutable updates, matching the page's existing pattern).

### Validation (`web/src/validation.ts`)

```typescript
if (layer.processing_type === "HATCHED_LINES" && layer.hatch_passes.length === 0) {
  issues.push({
    field: `layers[${idx}].hatch_passes`,
    message: "Hatched layer requires at least one pass",
    severity: "error",
  });
}
layer.hatch_passes.forEach((hp, p) => {
  if (hp.spacing <= 0) {
    issues.push({
      field: `layers[${idx}].hatch_passes[${p}].spacing`,
      message: "Spacing must be > 0",
      severity: "error",
    });
  }
  hp.ramps.forEach((r, ri) => {
    if (r.min === r.max) {
      issues.push({
        field: `layers[${idx}].hatch_passes[${p}].ramps[${ri}]`,
        message: "Ramp min equals max — value will be constant",
        severity: "warning",
      });
    }
  });
});
```

`hasErrors(issues)` already filters by severity and gates the Generate button.

## Preview

No change. The existing preview renders per-color shape outlines (with optional subtract-overlaps composition) regardless of processing type. Hatched layers appear as their shape outlines, same as other layers. Rendering the actual clipped LINE segments client-side is deferred: it would require either `/api/svg-layers` round-trips on every edit or a port of shapely clipping to JS, both prohibitive for v1. Users validate the hatched result by clicking Generate and opening the `.xcs` in XCS Studio.

## Testing

Backend (`tests/test_svg_layers_converter.py` — extend):
- Layer with `processing_type="HATCHED_LINES"`, two passes (0° + 90°), each with one power ramp. Assert `XCSProject.extra_displays` contains the right number of LINE entries, each has a matching `extra_device_entries` row by id, and ramped power values appear in the emitted entries.

Backend API (`tests/test_svg_layers_api.py` — extend):
- POST a request with a tiny inline SVG + one hatched layer (one pass, no ramps). Assert 200 + non-empty attachment bytes.
- POST with `HATCHED_LINES` but empty `hatch_passes`. Assert 400 with the offending color named.

Frontend (`web/src/validation.test.ts` — extend):
- `HATCHED_LINES` with zero passes → error.
- Pass with `spacing <= 0` → error.
- Ramp with `min === max` → warning.

No React component tests — matches the established web-UI test minimalism (see `docs/superpowers/specs/2026-04-14-web-ui-v1-design.md` § Testing).

## Files Touched

New:
- `web/src/components/HatchPassesEditor.tsx` — new editor component (~180 lines est.).

Modified:
- `web/src/types.ts` — extend `SvgProcessingType`; add `HatchRampParam`, `HatchRampAxis`, `HatchRampSpec`, `HatchPassSpec`; extend `LayerSpec` with `hatch_passes`.
- `web/src/defaults.ts` — `defaultHatchPass`, extend `defaultLayerFromDetected` to include `hatch_passes: []`.
- `web/src/validation.ts` — add hatched-related validators.
- `web/src/validation.test.ts` — new test cases.
- `web/src/components/SvgLayersPage.tsx` — new dropdown entry, conditional rendering, auto-seed on switch.
- `src/xcs_gen_web/schemas.py` — add `HatchRamp`, `HatchPass`; extend `LayerSpec`; `model_validator` for hatched invariant.
- `src/xcs_gen_web/svg_layers_converter.py` — per-shape dispatch to hatch module.
- `tests/test_svg_layers_converter.py` — new hatched case.
- `tests/test_svg_layers_api.py` — hatched API round-trip + 400 cases.

## Success Criteria

- `xcs-gen serve`, open the web UI, go to SVG Layers, upload a Pikachu SVG, change the yellow layer to "Hatched lines", add two passes (0° + 90°) with a power ramp on each. Click Generate. The downloaded `.xcs` opens in XCS Studio with cross-hatched yellow, power fading top-to-bottom, black outlines engraved as vectors.
- Zero client-side regression for existing layers (no hatched config, render unchanged).
- LocalStorage state saved before this change still loads cleanly after the change (Layers list appears with `hatch_passes: []` on every layer).
- A hatched layer with zero passes surfaces as a red error banner on the layer card and disables the Generate button.
