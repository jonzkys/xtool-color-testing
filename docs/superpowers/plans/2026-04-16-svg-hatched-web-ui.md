# SVG Hatched Lines Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the v2 hatched-lines render mode to the existing **SVG Layers** tab as a fifth processing-type option (`HATCHED_LINES`). When selected, the per-color layer card reveals a multi-pass / multi-ramp editor; the backend converter dispatches hatched layers through the library's hatch module instead of the existing path-stacking flow.

**Architecture:** Pure additive change — extend `LayerSpec` (TS + Pydantic) with `hatch_passes: HatchPassSpec[]`, add a new `<HatchPassesEditor>` React component, branch in `svg_layers_converter.py` to call `xcs_gen.hatch.svg_d_to_polygon` + `generate_hatch_segments` when a layer's processing type is `HATCHED_LINES`. The existing `crosshatch_enabled` block stays for the four path-based modes; UI hides it when hatched is selected. Local-storage migration is automatic (new field defaults to `[]`).

**Tech Stack:** Python 3.10+ / FastAPI / Pydantic v2 (backend); React 18 + Vite + TypeScript + vitest (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-16-svg-hatched-web-ui-design.md`

---

## Task Order Summary

1. Backend schemas — add `HatchRamp`, `HatchPass`, extend `LayerSpec.processing_type` and `LayerSpec.hatch_passes`
2. Backend converter — dispatch hatched layers through `xcs_gen.hatch`; `max_segments` cap
3. Frontend types — `HatchRampParam`, `HatchRampAxis`, `HatchRampSpec`, `HatchPassSpec`; extend `SvgProcessingType` + `LayerSpec`
4. Frontend defaults — `defaultHatchPass()` factory
5. Frontend validation — hatched-mode validators + vitest tests
6. New `<HatchPassesEditor>` React component
7. Integrate into `SvgLayersPage` — dropdown entry, conditional rendering, auto-seed on switch
8. Manual end-to-end verify in dev server (build + open + Pikachu round-trip)

---

### Task 1: Backend schemas

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `tests/test_svg_layers_api.py` (append schema tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_svg_layers_api.py`:

```python
def test_layerspec_accepts_hatched_lines_with_passes():
    from xcs_gen_web.schemas import HatchPass, HatchRamp, LayerSpec
    from xcs_gen_web.schemas import BaseParams
    spec = LayerSpec(
        color="#ffd73e",
        name="yellow",
        processing_type="HATCHED_LINES",
        base_params=BaseParams(power=50, speed=1000, frequency=65,
                               density=100, passes=1, pulse_width=200, laser="red"),
        hatch_passes=[
            HatchPass(angle=0, spacing=0.5,
                      ramps=[HatchRamp(param="power", axis="perp", min=30, max=70)]),
        ],
    )
    assert spec.processing_type == "HATCHED_LINES"
    assert len(spec.hatch_passes) == 1
    assert spec.hatch_passes[0].ramps[0].param == "power"


def test_layerspec_rejects_hatched_with_empty_passes():
    import pytest
    from pydantic import ValidationError
    from xcs_gen_web.schemas import BaseParams, LayerSpec
    with pytest.raises(ValidationError) as exc:
        LayerSpec(
            color="#ffd73e",
            name="yellow",
            processing_type="HATCHED_LINES",
            base_params=BaseParams(power=50, speed=1000, frequency=65,
                                   density=100, passes=1, pulse_width=200, laser="red"),
            hatch_passes=[],
        )
    assert "HATCHED_LINES" in str(exc.value)


def test_layerspec_non_hatched_with_passes_is_allowed():
    """Non-hatched layers with hatch_passes don't fail (the converter ignores them)."""
    from xcs_gen_web.schemas import BaseParams, HatchPass, LayerSpec
    spec = LayerSpec(
        color="#000000",
        name="black",
        processing_type="VECTOR_CUTTING",
        base_params=BaseParams(power=80, speed=500, frequency=65,
                               density=100, passes=1, pulse_width=200, laser="red"),
        hatch_passes=[HatchPass(angle=0, spacing=0.5)],
    )
    assert spec.processing_type == "VECTOR_CUTTING"
    # hatch_passes survive on the model but won't be used by the converter.
    assert len(spec.hatch_passes) == 1
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_svg_layers_api.py::test_layerspec_accepts_hatched_lines_with_passes tests/test_svg_layers_api.py::test_layerspec_rejects_hatched_with_empty_passes -v`
Expected: ImportError on `HatchPass` / `HatchRamp` (or LayerSpec rejects `"HATCHED_LINES"` literal value).

- [ ] **Step 3: Add `HatchRamp`, `HatchPass`, extend `LayerSpec`**

Edit `src/xcs_gen_web/schemas.py`. Add the two new models above `class LayerSpec(BaseModel):` (around line 110):

```python
class HatchRamp(BaseModel):
    """One linear ramp interpolating a parameter across the shape."""

    param: Literal["power", "speed", "frequency", "density",
                   "passes", "pulse_width", "spacing"]
    axis: Literal["perp", "parallel", "x", "y"]
    min: float
    max: float


class HatchPass(BaseModel):
    """One sweep of parallel hatch lines through a shape."""

    angle: float = 0.0
    spacing: float = Field(default=0.5, gt=0.0)
    ramps: list[HatchRamp] = Field(default_factory=list)
```

Then update `LayerSpec.processing_type` to include `"HATCHED_LINES"` and add the `hatch_passes` field plus the `model_validator`. Replace the existing `LayerSpec` class:

```python
class LayerSpec(BaseModel):
    """Per-color processing config for the SVG Layers tab."""

    color: str = Field(pattern=_COLOR_PATTERN)
    name: str = Field(min_length=1, max_length=64)
    enabled: bool = True

    processing_type: Literal[
        "COLOR_FILL_ENGRAVE", "FILL_VECTOR_ENGRAVING",
        "VECTOR_ENGRAVING", "VECTOR_CUTTING",
        "HATCHED_LINES",
    ] = "COLOR_FILL_ENGRAVE"
    scan_angle: float = Field(default=90.0, ge=0.0, le=360.0)
    base_params: BaseParams

    # Per-layer crosshatch (same semantics as ParamTest crosshatch). Ignored
    # when processing_type == "HATCHED_LINES" (which carries its own multi-pass).
    crosshatch_enabled: bool = False
    crosshatch_passes: int = Field(default=2, ge=2, le=10)
    crosshatch_step_deg: float = Field(default=90.0, gt=0.0, le=360.0)

    # v2 hatched render mode: required non-empty when processing_type ==
    # "HATCHED_LINES", ignored otherwise.
    hatch_passes: list[HatchPass] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_hatched(self):
        if self.processing_type == "HATCHED_LINES" and not self.hatch_passes:
            raise ValueError(
                f"layer {self.color!r}: HATCHED_LINES requires at least one hatch pass"
            )
        return self
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pytest tests/test_svg_layers_api.py -v`
Expected: all existing tests still pass plus the 3 new ones.

Then full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py tests/test_svg_layers_api.py
git commit -m "Add HatchPass/HatchRamp schemas and HATCHED_LINES processing type"
```

---

### Task 2: Backend converter dispatch

**Files:**
- Modify: `src/xcs_gen_web/svg_layers_converter.py`
- Modify: `tests/test_svg_layers_api.py` (append converter tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_svg_layers_api.py`:

```python
TWO_COLOR_SVG = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect x="0" y="0" width="50" height="50" fill="#000000"/>
  <rect x="50" y="50" width="50" height="50" fill="#ffd73e"/>
</svg>
"""


def test_layers_request_emits_lines_for_hatched_layer():
    from xcs_gen_web.schemas import (
        BaseParams, HatchPass, HatchRamp, LayerSpec, SvgLayersRequest,
    )
    from xcs_gen_web.svg_layers_converter import build_svg_layers_project
    bp = BaseParams(power=50, speed=1000, frequency=65, density=100,
                    passes=1, pulse_width=200, laser="red")
    req = SvgLayersRequest(
        name="t",
        svg_content=TWO_COLOR_SVG,
        width_mm=50,
        layers=[
            LayerSpec(color="#000000", name="black", processing_type="VECTOR_ENGRAVING",
                      base_params=bp),
            LayerSpec(
                color="#ffd73e", name="yellow", processing_type="HATCHED_LINES",
                base_params=bp,
                hatch_passes=[HatchPass(
                    angle=0, spacing=1.0,
                    ramps=[HatchRamp(param="power", axis="perp", min=30, max=70)],
                )],
            ),
        ],
    )
    project = build_svg_layers_project(req)
    # Black layer → one Path. Yellow layer → many LINE displays.
    assert len(project.paths) >= 1
    line_displays = [d for d in project.extra_displays if d.get("type") == "LINE"]
    assert len(line_displays) > 0
    # Each LINE has a matching device entry by id.
    line_ids = {d["id"] for d in line_displays}
    entry_ids = {eid for eid, _ in project.extra_device_entries}
    assert line_ids.issubset(entry_ids)


def test_layers_hatched_max_segments_cap():
    """Hatched output exceeding max_segments raises with a clear message."""
    import pytest
    from xcs_gen_web.schemas import BaseParams, HatchPass, LayerSpec, SvgLayersRequest
    from xcs_gen_web.svg_layers_converter import build_svg_layers_project
    bp = BaseParams(power=50, speed=1000, frequency=65, density=100,
                    passes=1, pulse_width=200, laser="red")
    req = SvgLayersRequest(
        name="t", svg_content=TWO_COLOR_SVG, width_mm=50,
        layers=[
            LayerSpec(
                color="#ffd73e", name="yellow", processing_type="HATCHED_LINES",
                base_params=bp,
                hatch_passes=[HatchPass(angle=0, spacing=0.05)],  # very dense
            ),
            LayerSpec(color="#000000", name="black",
                      processing_type="VECTOR_ENGRAVING", base_params=bp),
        ],
    )
    with pytest.raises(ValueError, match="max_segments"):
        build_svg_layers_project(req, max_segments=20)


def test_api_layers_endpoint_with_hatched_layer():
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    client = TestClient(create_app())
    payload = {
        "name": "hatched-test",
        "svg_content": TWO_COLOR_SVG,
        "width_mm": 50,
        "layers": [
            {"color": "#000000", "name": "black",
             "processing_type": "VECTOR_ENGRAVING",
             "base_params": {"power": 80, "speed": 500, "frequency": 65,
                              "density": 100, "passes": 1, "pulse_width": 200,
                              "laser": "red"}},
            {"color": "#ffd73e", "name": "yellow",
             "processing_type": "HATCHED_LINES",
             "base_params": {"power": 50, "speed": 1000, "frequency": 65,
                              "density": 100, "passes": 1, "pulse_width": 200,
                              "laser": "red"},
             "hatch_passes": [
                 {"angle": 0, "spacing": 1.0,
                  "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}]},
             ]},
        ],
    }
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert len(resp.content) > 1000  # non-trivial XCS body


def test_api_layers_endpoint_rejects_hatched_with_empty_passes():
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    client = TestClient(create_app())
    payload = {
        "name": "bad", "svg_content": TWO_COLOR_SVG, "width_mm": 50,
        "layers": [
            {"color": "#ffd73e", "name": "yellow",
             "processing_type": "HATCHED_LINES",
             "base_params": {"power": 50, "speed": 1000, "frequency": 65,
                              "density": 100, "passes": 1, "pulse_width": 200,
                              "laser": "red"},
             "hatch_passes": []},
        ],
    }
    resp = client.post("/api/svg-layers", json=payload)
    assert resp.status_code == 422  # Pydantic validation error
    assert "HATCHED_LINES" in resp.text
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_svg_layers_api.py -v`
Expected: 4 new tests fail. The first two raise on the converter not knowing about `HATCHED_LINES`; the API tests probably 500 or 422 incorrectly.

- [ ] **Step 3: Add `max_segments` parameter and hatched dispatch**

Edit `src/xcs_gen_web/svg_layers_converter.py`. Find `def build_svg_layers_project(request)` (or whatever the main function is named — adapt if different). Add `max_segments: int = 50000` keyword param at the end of its signature.

Inside the per-shape loop (the block that does `for shape in shapes: ... project.paths.append(p) ...`), add a hatched branch BEFORE the existing Path emission. The minimal patch:

Find the block:

```python
        layer = layer_by_color[color]

        params = replace(
            _to_processing_params(layer.base_params),
            scan_angle=layer.scan_angle,
        )

        p = Path(
            d=shape.d,
            ...
        )
        project.paths.append(p)
        primary.append((color, p))
```

Replace with:

```python
        layer = layer_by_color[color]

        if layer.processing_type == "HATCHED_LINES":
            from xcs_gen.hatch import svg_d_to_polygon, generate_hatch_segments
            from xcs_gen.builder import build_line_display, build_device_entry
            from xcs_gen.svg_source import HatchPass as LibHatchPass
            from xcs_gen.svg_source import HatchRamp as LibHatchRamp

            layer_params = _to_processing_params(layer.base_params)
            polygon = svg_d_to_polygon(shape.d, fill_rule=shape.fill_rule)
            for hp in layer.hatch_passes:
                lib_hp = LibHatchPass(
                    angle=hp.angle,
                    spacing=hp.spacing,
                    ramps=[
                        LibHatchRamp(param=r.param, axis=r.axis,
                                     min_value=r.min, max_value=r.max)
                        for r in hp.ramps
                    ],
                )
                segments = generate_hatch_segments(
                    polygon, lib_hp,
                    layer_color=color,
                    fallback_params=layer_params,
                )
                for seg in segments:
                    segment_count += 1
                    per_color_counts[color] = per_color_counts.get(color, 0) + 1
                    if segment_count > max_segments:
                        worst = max(per_color_counts, key=per_color_counts.get)
                        raise ValueError(
                            f"hatched output exceeded max_segments={max_segments} "
                            f"(color {worst!r} contributes {per_color_counts[worst]}). "
                            "Increase spacing, reduce passes, or raise max_segments."
                        )
                    project.extra_displays.append(build_line_display(seg))
                    project.extra_device_entries.append(
                        build_device_entry(
                            seg.id, "LINE", seg.processing_type,
                            seg.params or layer_params,
                        )
                    )
            continue  # skip Path emission below for hatched layers

        params = replace(
            _to_processing_params(layer.base_params),
            scan_angle=layer.scan_angle,
        )

        p = Path(
            d=shape.d,
            ...
        )
        project.paths.append(p)
        primary.append((color, p))
```

(Keep the `Path(d=shape.d, ...)` constructor as it currently is in the file — the snippet above is just illustrating placement of the new branch.)

Also, BEFORE the `for shape in shapes:` loop, add the segment counter initialization:

```python
    segment_count = 0
    per_color_counts: dict[str, int] = {}
```

- [ ] **Step 4: Verify the FastAPI endpoint surfaces the validation error as 422**

The `/api/svg-layers` route should already let Pydantic raise its own ValidationError, which FastAPI maps to 422. If the existing route catches all exceptions as 400, adjust to let `ValidationError` bubble up, or to raise `HTTPException(422, detail=...)` for Pydantic errors. (Check the route handler — most likely no change is needed.)

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_svg_layers_api.py -v`
Expected: all 4 new tests PASS plus existing tests still pass.

Then full suite: `pytest -v`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/svg_layers_converter.py tests/test_svg_layers_api.py
git commit -m "Dispatch HATCHED_LINES layers through hatch module with segment cap"
```

---

### Task 3: Frontend types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Edit `web/src/types.ts`**

Find the `SvgProcessingType` union and extend it. Find:

```typescript
export type SvgProcessingType =
  | "COLOR_FILL_ENGRAVE"
  | "FILL_VECTOR_ENGRAVING"
  | "VECTOR_ENGRAVING"
  | "VECTOR_CUTTING";
```

Replace with:

```typescript
export type SvgProcessingType =
  | "COLOR_FILL_ENGRAVE"
  | "FILL_VECTOR_ENGRAVING"
  | "VECTOR_ENGRAVING"
  | "VECTOR_CUTTING"
  | "HATCHED_LINES";

export type HatchRampParam =
  | "power"
  | "speed"
  | "frequency"
  | "density"
  | "passes"
  | "pulse_width"
  | "spacing";

export type HatchRampAxis = "perp" | "parallel" | "x" | "y";

export interface HatchRampSpec {
  param: HatchRampParam;
  axis: HatchRampAxis;
  min: number;
  max: number;
}

export interface HatchPassSpec {
  angle: number;       // degrees, 0 = horizontal
  spacing: number;     // mm between hatch lines
  ramps: HatchRampSpec[];
}
```

Find the `LayerSpec` interface. Find:

```typescript
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
}
```

Replace with:

```typescript
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
  hatch_passes: HatchPassSpec[];   // non-empty iff processing_type === "HATCHED_LINES"
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. (Some files may complain about missing `hatch_passes` on existing `LayerSpec` constructions — those are fixed in subsequent tasks.)

- [ ] **Step 3: Commit**

```bash
git add web/src/types.ts
git commit -m "Add HATCHED_LINES processing type and HatchPassSpec/HatchRampSpec"
```

---

### Task 4: Frontend defaults

**Files:**
- Modify: `web/src/defaults.ts`

- [ ] **Step 1: Add `defaultHatchPass` factory**

Append to `web/src/defaults.ts`:

```typescript
import type { HatchPassSpec } from "./types";

export function defaultHatchPass(angle = 0): HatchPassSpec {
  return { angle, spacing: 0.5, ramps: [] };
}
```

If a `HatchPassSpec` import already exists (e.g. due to other changes), merge them. Otherwise the import goes at the top of the file alongside the existing `import type { ... } from "./types";` line.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/defaults.ts
git commit -m "Add defaultHatchPass factory"
```

---

### Task 5: Frontend validation

**Files:**
- Modify: `web/src/validation.ts`
- Modify: `web/src/validation.test.ts` (append vitest cases)

- [ ] **Step 1: Append failing tests**

Append to `web/src/validation.test.ts`:

```typescript
import { validateLayerSpec } from "./validation";

describe("validateLayerSpec — hatched", () => {
  function bp() {
    return {
      power: 50, speed: 1000, frequency: 65, density: 100,
      passes: 1, pulse_width: 200, laser: "red" as const,
    };
  }

  it("errors when HATCHED_LINES has zero passes", () => {
    const layer = {
      color: "#ffd73e", name: "yellow", enabled: true,
      processing_type: "HATCHED_LINES" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      hatch_passes: [],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.some(
      (i) => i.severity === "error" && i.field === "layers[0].hatch_passes"
    )).toBe(true);
  });

  it("errors when a pass spacing is <= 0", () => {
    const layer = {
      color: "#ffd73e", name: "yellow", enabled: true,
      processing_type: "HATCHED_LINES" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      hatch_passes: [{ angle: 0, spacing: 0, ramps: [] }],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.some(
      (i) => i.severity === "error" && i.field === "layers[0].hatch_passes[0].spacing"
    )).toBe(true);
  });

  it("warns when ramp min equals max", () => {
    const layer = {
      color: "#ffd73e", name: "yellow", enabled: true,
      processing_type: "HATCHED_LINES" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      hatch_passes: [{
        angle: 0, spacing: 0.5,
        ramps: [{ param: "power" as const, axis: "perp" as const, min: 50, max: 50 }],
      }],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.some(
      (i) => i.severity === "warning"
          && i.field === "layers[0].hatch_passes[0].ramps[0]"
    )).toBe(true);
  });

  it("does not flag non-hatched layer with empty hatch_passes", () => {
    const layer = {
      color: "#000000", name: "black", enabled: true,
      processing_type: "VECTOR_CUTTING" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      hatch_passes: [],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.filter((i) => i.field.startsWith("layers[0].hatch_passes")))
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd web && npm test`
Expected: 4 new tests fail (`validateLayerSpec` not exported, or no hatched-specific issues emitted).

- [ ] **Step 3: Add validators**

Edit `web/src/validation.ts`. Add (or extend, if a `validateLayerSpec` function already exists) the following:

```typescript
import type { LayerSpec, ValidationIssue } from "./types";

export function validateLayerSpec(layer: LayerSpec, idx: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

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
        message: "Spacing must be greater than 0",
        severity: "error",
      });
    }
    hp.ramps.forEach((r, ri) => {
      if (r.min === r.max) {
        issues.push({
          field: `layers[${idx}].hatch_passes[${p}].ramps[${ri}]`,
          message: "Ramp min equals max — value will be constant across the shape",
          severity: "warning",
        });
      }
    });
  });

  return issues;
}
```

If there is an existing function that aggregates issues across all layers in a request, fold `validateLayerSpec` into it so layer-card UI surfaces these issues. Otherwise, the new function will be used by `SvgLayersPage` directly in Task 7.

- [ ] **Step 4: Run tests**

Run: `cd web && npm test`
Expected: 4 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/validation.ts web/src/validation.test.ts
git commit -m "Add hatched-mode validators with vitest coverage"
```

---

### Task 6: `<HatchPassesEditor>` component

**Files:**
- Create: `web/src/components/HatchPassesEditor.tsx`

- [ ] **Step 1: Create the component file**

Create `web/src/components/HatchPassesEditor.tsx`:

```typescript
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { defaultHatchPass } from "../defaults";
import type {
  HatchPassSpec, HatchRampSpec, HatchRampAxis, HatchRampParam,
  ValidationIssue,
} from "../types";

const RAMP_PARAMS: { value: HatchRampParam; label: string }[] = [
  { value: "power", label: "Power %" },
  { value: "speed", label: "Speed mm/s" },
  { value: "frequency", label: "Frequency Hz" },
  { value: "density", label: "Density (lines/cm)" },
  { value: "passes", label: "Passes" },
  { value: "pulse_width", label: "Pulse width" },
  { value: "spacing", label: "Spacing (mm)" },
];

const RAMP_AXES: { value: HatchRampAxis; label: string }[] = [
  { value: "perp", label: "Perpendicular to hatch" },
  { value: "parallel", label: "Along hatch" },
  { value: "x", label: "Bbox X" },
  { value: "y", label: "Bbox Y" },
];

export interface HatchPassesEditorProps {
  passes: HatchPassSpec[];
  onChange: (next: HatchPassSpec[]) => void;
  issues: ValidationIssue[];
  layerIdx: number;
}

export function HatchPassesEditor(props: HatchPassesEditorProps) {
  const { passes, onChange, issues, layerIdx } = props;

  function addPass() {
    const lastAngle = passes.length > 0 ? passes[passes.length - 1].angle : 0;
    const next = passes.length > 0
      ? defaultHatchPass((lastAngle + 90) % 360)
      : defaultHatchPass(0);
    onChange([...passes, next]);
  }

  function updatePass(idx: number, patch: Partial<HatchPassSpec>) {
    onChange(passes.map((hp, i) => (i === idx ? { ...hp, ...patch } : hp)));
  }

  function removePass(idx: number) {
    onChange(passes.filter((_, i) => i !== idx));
  }

  function movePass(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= passes.length) return;
    const next = [...passes];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  function addRamp(passIdx: number) {
    const newRamp: HatchRampSpec = {
      param: "power", axis: "perp", min: 0, max: 0,
    };
    updatePass(passIdx, { ramps: [...passes[passIdx].ramps, newRamp] });
  }

  function updateRamp(passIdx: number, rampIdx: number, patch: Partial<HatchRampSpec>) {
    updatePass(passIdx, {
      ramps: passes[passIdx].ramps.map(
        (r, i) => (i === rampIdx ? { ...r, ...patch } : r),
      ),
    });
  }

  function removeRamp(passIdx: number, rampIdx: number) {
    updatePass(passIdx, {
      ramps: passes[passIdx].ramps.filter((_, i) => i !== rampIdx),
    });
  }

  function issueFor(field: string): ValidationIssue | undefined {
    return issues.find((i) => i.field === field);
  }

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>Hatch passes</strong>
        <button type="button" onClick={addPass}>+ Add pass</button>
      </div>

      {passes.length === 0 && (
        <div style={{ color: "#a00", fontSize: 13 }}>
          Hatched layer requires at least one pass. Click "+ Add pass" to start.
        </div>
      )}

      {passes.map((hp, p) => {
        const spacingIssue = issueFor(`layers[${layerIdx}].hatch_passes[${p}].spacing`);
        return (
          <div key={p} style={{ marginBottom: 12, padding: 10, border: "1px solid #eee", borderRadius: 4, background: "#fafafa" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong>Pass {p + 1}</strong>
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" disabled={p === 0} onClick={() => movePass(p, -1)} title="Move up">▲</button>
                <button type="button" disabled={p === passes.length - 1} onClick={() => movePass(p, 1)} title="Move down">▼</button>
                <button type="button" onClick={() => removePass(p)} title="Remove pass">✕</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <NumberField
                label="Angle (°)"
                value={hp.angle}
                onChange={(v) => updatePass(p, { angle: v })}
              />
              <NumberField
                label="Spacing (mm)"
                value={hp.spacing}
                onChange={(v) => updatePass(p, { spacing: v })}
                error={spacingIssue?.message}
              />
            </div>

            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <em style={{ fontSize: 13 }}>Ramps</em>
              <button type="button" onClick={() => addRamp(p)}>+ Add ramp</button>
            </div>

            {hp.ramps.length === 0 && (
              <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>(no ramps — uniform params)</div>
            )}

            {hp.ramps.map((r, ri) => {
              const rampIssue = issueFor(`layers[${layerIdx}].hatch_passes[${p}].ramps[${ri}]`);
              return (
                <div key={ri} style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "flex-end", padding: 6, border: "1px solid #eee", borderRadius: 4, background: "white" }}>
                  <SelectField
                    label="Param"
                    value={r.param}
                    options={RAMP_PARAMS}
                    onChange={(v) => updateRamp(p, ri, { param: v as HatchRampParam })}
                  />
                  <SelectField
                    label="Axis"
                    value={r.axis}
                    options={RAMP_AXES}
                    onChange={(v) => updateRamp(p, ri, { axis: v as HatchRampAxis })}
                  />
                  <NumberField
                    label="Min"
                    value={r.min}
                    onChange={(v) => updateRamp(p, ri, { min: v })}
                  />
                  <NumberField
                    label="Max"
                    value={r.max}
                    onChange={(v) => updateRamp(p, ri, { max: v })}
                    warning={rampIssue?.message}
                  />
                  <button type="button" onClick={() => removeRamp(p, ri)} title="Remove ramp">✕</button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

If `NumberField` or `SelectField` props differ (no `error` / `warning` field), pass the values via a separate `<div>` below or through the existing prop name. Inspect `web/src/components/fields/NumberField.tsx` first if needed.

- [ ] **Step 2: Verify the file builds**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. If `NumberField` doesn't accept `error` / `warning`, drop those props (the issue will still surface via the layer-level WarningBanner).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/HatchPassesEditor.tsx
git commit -m "Add HatchPassesEditor component with multi-pass + multi-ramp UI"
```

---

### Task 7: Integrate into `SvgLayersPage`

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx`

- [ ] **Step 1: Add `HATCHED_LINES` to the dropdown**

Find:

```typescript
const PROCESSING_TYPES: { value: SvgProcessingType; label: string }[] = [
  { value: "COLOR_FILL_ENGRAVE", label: "Color fill engrave" },
  { value: "FILL_VECTOR_ENGRAVING", label: "Fill vector engrave" },
  { value: "VECTOR_ENGRAVING", label: "Vector engrave" },
  { value: "VECTOR_CUTTING", label: "Vector cut" },
];
```

Replace with:

```typescript
const PROCESSING_TYPES: { value: SvgProcessingType; label: string }[] = [
  { value: "COLOR_FILL_ENGRAVE", label: "Color fill engrave" },
  { value: "FILL_VECTOR_ENGRAVING", label: "Fill vector engrave" },
  { value: "VECTOR_ENGRAVING", label: "Vector engrave" },
  { value: "VECTOR_CUTTING", label: "Vector cut" },
  { value: "HATCHED_LINES", label: "Hatched lines" },
];
```

- [ ] **Step 2: Update `defaultLayerFromDetected`**

Find:

```typescript
function defaultLayerFromDetected(detected: DetectedLayer): LayerSpec {
  return {
    color: detected.color,
    name: detected.color,
    enabled: true,
    processing_type: detected.is_fill ? "COLOR_FILL_ENGRAVE" : "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: defaultBaseParams(),
    crosshatch_enabled: false,
    crosshatch_passes: 2,
    crosshatch_step_deg: 90,
  };
}
```

Replace with:

```typescript
function defaultLayerFromDetected(detected: DetectedLayer): LayerSpec {
  return {
    color: detected.color,
    name: detected.color,
    enabled: true,
    processing_type: detected.is_fill ? "COLOR_FILL_ENGRAVE" : "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: defaultBaseParams(),
    crosshatch_enabled: false,
    crosshatch_passes: 2,
    crosshatch_step_deg: 90,
    hatch_passes: [],
  };
}
```

- [ ] **Step 3: Add auto-seed when switching to HATCHED_LINES**

Find the layer-edit form section that contains:

```typescript
<SelectField
  label="Processing type"
  value={selected.processing_type}
  options={PROCESSING_TYPES}
  onChange={(v) =>
    updateLayer(selected.color, { processing_type: v as SvgProcessingType })
  }
/>
```

Replace the `onChange` handler so switching to `HATCHED_LINES` with empty `hatch_passes` seeds one default pass:

```typescript
<SelectField
  label="Processing type"
  value={selected.processing_type}
  options={PROCESSING_TYPES}
  onChange={(v) => {
    const next = v as SvgProcessingType;
    const patch: Partial<LayerSpec> = { processing_type: next };
    if (next === "HATCHED_LINES" && selected.hatch_passes.length === 0) {
      patch.hatch_passes = [defaultHatchPass(0)];
    }
    updateLayer(selected.color, patch);
  }}
/>
```

Add a `defaultHatchPass` import at the top of the file alongside `defaultBaseParams`:

```typescript
import { defaultBaseParams, defaultHatchPass } from "../defaults";
```

- [ ] **Step 4: Conditionally render the HatchPassesEditor + hide non-applicable fields**

Find the section of the editor that renders `scan_angle` and the crosshatch fields. Wrap them with:

```typescript
{selected.processing_type !== "HATCHED_LINES" && (
  <>
    {/* existing scan_angle field */}
    {/* existing crosshatch_enabled / passes / step_deg fields */}
  </>
)}

{selected.processing_type === "HATCHED_LINES" && (
  <HatchPassesEditor
    passes={selected.hatch_passes}
    onChange={(next) => updateLayer(selected.color, { hatch_passes: next })}
    issues={issues}
    layerIdx={request.layers.findIndex((l) => l.color === selected.color)}
  />
)}
```

Add the import:

```typescript
import { HatchPassesEditor } from "./HatchPassesEditor";
```

The `issues` variable is the existing array of validation issues for the request — if it's not already in scope inside the layer editor, derive it via `validateRequest(request)` (existing helper) or pass it down from the parent. Adapt to whatever shape `SvgLayersPage` already uses for surfacing issues.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Quick visual smoke (optional but recommended)**

Run `cd web && npm run dev`, open the URL, go to **SVG Layers**, upload `samples/Pikachu.svg`, click "Detect colors", change one layer's processing type to **Hatched lines**. Confirm the HatchPassesEditor appears with one default pass, you can add a second pass (defaults to angle=90), add a ramp, and the form is responsive.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx
git commit -m "Wire HATCHED_LINES into SvgLayersPage with HatchPassesEditor"
```

---

### Task 8: Manual end-to-end Pikachu round-trip

**Files:**
- (none modified — verification only)

- [ ] **Step 1: Build the frontend**

Run: `cd web && npm run build`
Expected: production bundle written to `web/dist/` with no errors.

- [ ] **Step 2: Start the dev server**

Run: `xcs-gen serve --no-browser` (in one terminal — keep it running).
Expected: uvicorn starts on `http://127.0.0.1:4000` (or whatever the configured default is).

- [ ] **Step 3: Open the UI and exercise the hatched flow**

Open `http://127.0.0.1:4000` in a browser. On the **SVG Layers** tab:

1. Upload `samples/Pikachu.svg`.
2. Click "Detect colors".
3. Find the `#ffd73e` layer (yellow). Change its processing type to **Hatched lines**.
4. The default pass appears (angle=0, spacing=0.5). Edit spacing to **2.0** for visual clarity.
5. Click "+ Add ramp" → set `param=power, axis=perp, min=30, max=70`.
6. Click "+ Add pass" — second pass auto-seeds at angle=90.
7. Find the `#000000` layer. Leave it on **Vector engrave** with default params.
8. Click **Generate**. A `.xcs` file downloads.

- [ ] **Step 4: Verify in XCS Studio**

Open the downloaded `.xcs` file in XCS Studio. Visually confirm:
- Pikachu's yellow body is filled with a cross-hatched pattern (horizontal + vertical lines at 2mm spacing).
- The black outlines are present as vector engrave paths.
- No yellow lines extend off the bed.

If the rendering is wrong, inspect the generated file with the same diagnostic snippet used in earlier work:

```bash
python3 -c "
import json
with open('/path/to/downloaded.xcs') as f:
    data = json.load(f)
displays = data['canvas'][0]['displays']
lines = [d for d in displays if d['type']=='LINE']
xs = [d['x'] for d in lines]
print(f'lines={len(lines)} x range: [{min(xs):.2f}, {max(xs):.2f}]')
"
```

X range should be entirely positive and within the Pikachu body bounds.

- [ ] **Step 5: Run the full test suite one more time**

Run: `pytest && cd web && npm test`
Expected: all backend + frontend tests pass.

- [ ] **Step 6: Commit a marker if anything was tweaked**

If steps 1-5 surfaced any small fixes (TypeScript prop name mismatch, validation edge case, etc.), commit them with a focused message. Otherwise no commit needed — verification only.

---

## Self-Review Checklist

**Spec coverage:**
- Goal & Scope (HATCHED_LINES in SVG Layers tab, multi-pass + multi-ramp editor, backend dispatch, no preview change) → Tasks 1-8.
- Data Model (TS + Pydantic with HatchPass / HatchRamp, extended LayerSpec) → Tasks 1, 3.
- Backend Wiring (svg_layers_converter dispatch + max_segments cap) → Task 2.
- Frontend UX (dropdown, editor, conditional rendering, auto-seed) → Tasks 6, 7.
- Validation (zero-passes error, spacing error, min==max warning) → Task 5.
- Preview unchanged → enforced by not modifying Preview component.
- Testing strategy (backend converter + API tests, frontend validation tests, no React component tests) → Tasks 1, 2, 5; deliberately no Task for component tests.
- LocalStorage migration via `defaultLayerFromDetected` update → Task 7 step 2.

**Placeholder scan:** Every step has concrete code or a concrete command. Task 8's manual verification is inherently human-driven but specifies exactly what to click. Task 6's `NumberField` / `SelectField` prop adaptation is conditional on inspecting the existing component — not a placeholder, just a guarded fallback.

**Type consistency:**
- `HatchRampParam` Literal values match between TS (`"power" | "speed" | ...`) and Pydantic (`Literal["power", "speed", ...]`).
- `HatchRampAxis` matches: `"perp" | "parallel" | "x" | "y"`.
- Library `HatchRamp` uses `min_value`/`max_value`; Pydantic `HatchRamp` uses `min`/`max` (the converter explicitly translates between them in Task 2's snippet).
- `defaultHatchPass(angle = 0)` returns `{ angle, spacing: 0.5, ramps: [] }` — used consistently in Tasks 4, 6, 7.
- `validateLayerSpec(layer, idx)` signature matches between Task 5 (definition + tests) and Task 7 (consumption).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-svg-hatched-web-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.

**2. Inline Execution** — tasks in this session with checkpoints.

Which approach?
