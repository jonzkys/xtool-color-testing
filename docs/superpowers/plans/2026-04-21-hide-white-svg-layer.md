# Hide White SVG Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide near-white colours (all RGB channels ≥ 245) from the SVG layer auto-map list by default, with an opt-in "Include white" checkbox to surface them when needed.

**Architecture:** Backend annotates each `DetectedLayer` with an `is_near_white: bool` flag; frontend filters the detected-layers list client-side. No server-side filtering, no breaking API changes. The filter sits at layer detection, which is the one seam shared by both the SVG-upload and PNG→SVG-then-detect paths. Spec: `docs/superpowers/specs/2026-04-21-hide-white-svg-layer-design.md`.

**Tech Stack:** Python 3.10+ (Pydantic, FastAPI), pytest, React + TypeScript + Vitest.

---

## File Structure

**Modify:**
- `src/xcs_gen/svg_source.py` — add `NEAR_WHITE_THRESHOLD` constant and `is_near_white()` helper.
- `src/xcs_gen_web/schemas.py` — add `is_near_white: bool = False` to `DetectedLayer`.
- `src/xcs_gen_web/svg_layers_converter.py` — populate `is_near_white` on each returned `DetectedLayer`.
- `web/src/types.ts` — add `is_near_white?: boolean` to the `DetectedLayer` interface.
- `web/src/components/SvgLayersPage.tsx` — new `includeNearWhite` state, filter in `applyDetectedSvg`, toggle-re-materialize logic, checkbox UI.

**Add tests:**
- New cases in `tests/test_svg_source.py` for `is_near_white()`.
- New case in `tests/test_svg_layers_api.py` for the `detect_svg_layers` flag.

No new production files; changes fit in existing modules.

---

## Task 1: `is_near_white` helper + unit tests

**Files:**
- Modify: `src/xcs_gen/svg_source.py`
- Test: `tests/test_svg_source.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_svg_source.py`:

```python
def test_is_near_white_pure_white():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#ffffff") is True


def test_is_near_white_vtracer_artefact():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#fdfdfd") is True
    assert is_near_white("#fefefe") is True


def test_is_near_white_threshold_boundary_inclusive():
    """#f5f5f5 is (245,245,245) — exactly on the threshold, counts as near-white."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#f5f5f5") is True


def test_is_near_white_threshold_just_below_is_false():
    """#f4f4f4 is (244,244,244) — one below, not near-white."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#f4f4f4") is False


def test_is_near_white_yellow_one_channel_zero():
    """One channel below threshold disqualifies the colour."""
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#ffff00") is False  # blue channel = 0


def test_is_near_white_cyan_one_channel_below():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("#f5f5f4") is False  # blue channel = 244


def test_is_near_white_invalid_inputs():
    from xcs_gen.svg_source import is_near_white
    assert is_near_white("") is False
    assert is_near_white("none") is False
    assert is_near_white("#fff") is False  # 3-digit hex not supported
    assert is_near_white("ffffff") is False  # missing leading #
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=src pytest tests/test_svg_source.py::test_is_near_white_pure_white -v`
Expected: FAIL with `ImportError: cannot import name 'is_near_white' from 'xcs_gen.svg_source'`.

- [ ] **Step 3: Add the constant and helper**

In `src/xcs_gen/svg_source.py`, find the line containing `def _normalize_color(color)` (around line 224). Insert the following immediately above it:

```python
# RGB channel threshold above which a colour counts as "near white". All
# three channels must be >= this value. 245 catches pure #ffffff and
# vtracer quantization artefacts like #fdfdfd / #fefefe. Configurable
# only via source edit; if that stops being enough, make it a parameter.
NEAR_WHITE_THRESHOLD = 245


def is_near_white(hex_color: str) -> bool:
    """Return True if every RGB channel of a #rrggbb hex colour is >= NEAR_WHITE_THRESHOLD.

    Returns False for any non-7-character hex string (including the 3-digit
    shorthand, "none", "", or anything that's not a #rrggbb literal).
    """
    if not hex_color or not isinstance(hex_color, str):
        return False
    if len(hex_color) != 7 or not hex_color.startswith("#"):
        return False
    try:
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
    except ValueError:
        return False
    return r >= NEAR_WHITE_THRESHOLD and g >= NEAR_WHITE_THRESHOLD and b >= NEAR_WHITE_THRESHOLD
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src pytest tests/test_svg_source.py -v -k is_near_white`
Expected: all 7 new tests PASS.

Then sanity-check the full file:
Run: `PYTHONPATH=src pytest tests/test_svg_source.py -v`
Expected: all PASS (no pre-existing regression).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/svg_source.py tests/test_svg_source.py
git commit -m "svg_source: add is_near_white helper"
```

---

## Task 2: `DetectedLayer` schema field

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Test: `tests/test_svg_layers_api.py` (field default / round-trip)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_svg_layers_api.py`:

```python
def test_detected_layer_is_near_white_defaults_false():
    from xcs_gen_web.schemas import DetectedLayer
    layer = DetectedLayer(color="#ff0000", shape_count=3, is_fill=True)
    assert layer.is_near_white is False


def test_detected_layer_is_near_white_round_trips_true():
    from xcs_gen_web.schemas import DetectedLayer
    layer = DetectedLayer.model_validate({
        "color": "#ffffff",
        "shape_count": 1,
        "is_fill": True,
        "is_near_white": True,
    })
    assert layer.is_near_white is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=src pytest tests/test_svg_layers_api.py -v -k is_near_white`
Expected: FAIL — `is_near_white` field doesn't exist yet (Pydantic will raise `ValidationError` on the second test for the unknown field, and `AttributeError` on the first).

- [ ] **Step 3: Add the field**

In `src/xcs_gen_web/schemas.py`, find the `DetectedLayer` class (around line 247):

```python
class DetectedLayer(BaseModel):
    """One color detected in an SVG with a usage count."""

    color: str
    shape_count: int
    is_fill: bool  # True = appears as a fill, False = appears only as stroke
```

Add a new line directly below `is_fill`:

```python
    is_fill: bool  # True = appears as a fill, False = appears only as stroke
    # True when every RGB channel is >= 245 (pure white + vtracer near-white
    # artefacts). The UI hides these by default; users can tick "Include
    # white" to surface them. Default False keeps the field optional on the
    # wire for older clients / persisted snapshots.
    is_near_white: bool = False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src pytest tests/test_svg_layers_api.py -v -k is_near_white`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/schemas.py tests/test_svg_layers_api.py
git commit -m "schemas: add is_near_white to DetectedLayer"
```

---

## Task 3: Populate `is_near_white` in `detect_svg_layers`

**Files:**
- Modify: `src/xcs_gen_web/svg_layers_converter.py`
- Test: `tests/test_svg_layers_api.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_svg_layers_api.py`:

```python
def test_detect_svg_layers_flags_white_and_near_white(tmp_path):
    """detect_svg_layers marks pure-white and vtracer near-white colours
    with is_near_white=True; anything below the threshold is False."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect x="0" y="0" width="100" height="100" fill="#ffffff"/>'   # pure white
        '<rect x="10" y="10" width="20" height="20" fill="#fdfdfd"/>'    # vtracer artefact
        '<circle cx="60" cy="60" r="10" fill="#ff0000"/>'                # red
        '<circle cx="80" cy="80" r="5" fill="#f4f4f4"/>'                 # 244 — not near-white
        '</svg>'
    )
    req = SvgDetectRequest(svg_content=svg, width_mm=50.0)
    layers = detect_svg_layers(req)

    flags = {l.color: l.is_near_white for l in layers}
    assert flags["#ffffff"] is True
    assert flags["#fdfdfd"] is True
    assert flags["#ff0000"] is False
    assert flags["#f4f4f4"] is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PYTHONPATH=src pytest tests/test_svg_layers_api.py::test_detect_svg_layers_flags_white_and_near_white -v`
Expected: FAIL — every returned layer has `is_near_white=False` (the field default) because the converter doesn't populate it yet.

- [ ] **Step 3: Populate the flag**

In `src/xcs_gen_web/svg_layers_converter.py`, find the existing import line:

```python
from xcs_gen.svg_source import parse_svg
```

Change it to also import the helper:

```python
from xcs_gen.svg_source import is_near_white, parse_svg
```

Then find the `result = [...]` comprehension at the end of `detect_svg_layers` (around line 82):

```python
    result = [
        DetectedLayer(color=c, shape_count=counts[c], is_fill=is_fill[c])
        for c in sorted(order, key=order.get)
    ]
    return result
```

Replace with:

```python
    result = [
        DetectedLayer(
            color=c,
            shape_count=counts[c],
            is_fill=is_fill[c],
            is_near_white=is_near_white(c),
        )
        for c in sorted(order, key=order.get)
    ]
    return result
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PYTHONPATH=src pytest tests/test_svg_layers_api.py::test_detect_svg_layers_flags_white_and_near_white -v`
Expected: PASS.

Then run the full file to catch regressions (the `test_detect_layers_returns_all_svg_colors` test should still pass):

Run: `PYTHONPATH=src pytest tests/test_svg_layers_api.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/svg_layers_converter.py tests/test_svg_layers_api.py
git commit -m "svg_layers: populate DetectedLayer.is_near_white"
```

---

## Task 4: TS type mirror

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Extend the `DetectedLayer` interface**

In `web/src/types.ts`, find the `DetectedLayer` interface (around line 161). It currently looks like:

```typescript
export interface DetectedLayer {
  color: string;
  shape_count: number;
  is_fill: boolean;
}
```

Replace with:

```typescript
export interface DetectedLayer {
  color: string;
  shape_count: number;
  is_fill: boolean;
  /** True when every RGB channel is >= 245 (pure white + vtracer
   *  near-white artefacts). The layer-picker hides these by default
   *  unless the user ticks "Include white". Optional on the wire so
   *  older backend responses still validate. */
  is_near_white?: boolean;
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. The field is optional so nothing else in the TS tree needs to change yet.

- [ ] **Step 3: Run web tests**

Run: `cd web && npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts
git commit -m "web types: add is_near_white to DetectedLayer"
```

---

## Task 5: SvgLayersPage — filter + "Include white" checkbox

**Files:**
- Modify: `web/src/components/SvgLayersPage.tsx`

This is the only user-visible change. By the end of this task, uploading an SVG/PNG with a white background auto-excludes the white layer, and a checkbox above the detected-layers list lets the user re-introduce it.

- [ ] **Step 1: Add `includeNearWhite` state and store raw detections**

In `web/src/components/SvgLayersPage.tsx`, find the component-level state declarations. Near the other `useState` calls (just below the `setRequest` declaration), add:

```tsx
  // When false (default), near-white detected layers are hidden from the
  // layer list. Tick the checkbox above the list to include them.
  const [includeNearWhite, setIncludeNearWhite] = useState(false);
  // Keep the raw detection around so we can re-materialize layers when the
  // checkbox flips without issuing a second detect request.
  const [rawDetected, setRawDetected] = useState<DetectedLayer[]>([]);
```

- [ ] **Step 2: Store raw detections and filter in `applyDetectedSvg`**

Find `applyDetectedSvg` (around line 192). It currently reads:

```tsx
  async function applyDetectedSvg(svgText: string, suggestedName: string) {
    setRequest((prev) => ({ ...prev, svg_content: svgText, name: suggestedName, layers: [] }));
    try {
      const detected = await detectSvgLayers(svgText, 50);
      const layers = detected.map((d) => defaultLayerFromDetected(d, library));
      setRequest((prev) => ({ ...prev, layers }));
      setSelectedColor(layers[0]?.color ?? null);
    } catch (err) {
      setDetectError((err as Error).message);
    }
  }
```

Replace with:

```tsx
  async function applyDetectedSvg(svgText: string, suggestedName: string) {
    setRequest((prev) => ({ ...prev, svg_content: svgText, name: suggestedName, layers: [] }));
    try {
      const detected = await detectSvgLayers(svgText, 50);
      setRawDetected(detected);
      const visible = detected.filter((d) => includeNearWhite || !d.is_near_white);
      const layers = visible.map((d) => defaultLayerFromDetected(d, library));
      setRequest((prev) => ({ ...prev, layers }));
      setSelectedColor(layers[0]?.color ?? null);
    } catch (err) {
      setDetectError((err as Error).message);
    }
  }
```

- [ ] **Step 3: Re-materialize layers when `includeNearWhite` flips**

Still in `SvgLayersPage.tsx`, find the existing `useEffect` hooks in the component. Add a new `useEffect` just below them that re-applies the filter when the toggle changes:

```tsx
  // When the "Include white" toggle flips, re-derive request.layers from the
  // last detection so newly-visible whites appear as LayerSpecs (and freshly-
  // hidden ones disappear). Preserves any per-layer param edits the user has
  // already made to non-white layers.
  useEffect(() => {
    if (rawDetected.length === 0) return;
    const visible = rawDetected.filter((d) => includeNearWhite || !d.is_near_white);
    setRequest((prev) => {
      const byColor = new Map(prev.layers.map((l) => [l.color, l]));
      const nextLayers = visible.map((d) => byColor.get(d.color) ?? defaultLayerFromDetected(d, library));
      return { ...prev, layers: nextLayers };
    });
  }, [includeNearWhite, rawDetected, library]);
```

- [ ] **Step 4: Render the checkbox above the layer list**

Find the `<ul>` that renders the detected layers (around line 432: `{[...request.layers].reverse().map((l) => { ... })}`). Just above that `<ul>` (and also above the "Upload an SVG to detect layers." empty state on line 429–431 so it sits in the same region), add:

```tsx
        {rawDetected.some((d) => d.is_near_white) && (
          <label
            style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 12, color: "#555", marginBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={includeNearWhite}
              onChange={(e) => setIncludeNearWhite(e.target.checked)}
            />
            <span>
              Include white
              {" "}
              <span style={{ color: "#999" }}>
                ({rawDetected.filter((d) => d.is_near_white).length} near-white layer
                {rawDetected.filter((d) => d.is_near_white).length === 1 ? "" : "s"} hidden)
              </span>
            </span>
          </label>
        )}
```

The outer `rawDetected.some(...)` guard keeps the checkbox from appearing when no near-white layers were detected (e.g., a hand-authored SVG with only primary colours).

- [ ] **Step 5: Type-check and test**

Run:
```bash
cd web && npx tsc --noEmit
cd web && npm test
```
Expected: both PASS.

- [ ] **Step 6: Manual smoke test**

Run `cd web && npm run dev`. In the browser:

1. Navigate to the SVG Layers page.
2. Upload a PNG with a visible white background (any PNG from the `samples/` directory or a drag-and-dropped phone screenshot works).
3. Confirm the layer list does NOT include a `#ffffff` (or `#fdfdfd`) entry by default.
4. Confirm a checkbox labelled **"Include white (1 near-white layer hidden)"** appears above the layer list.
5. Tick the checkbox — a white layer appears in the list. Untick — it disappears. Any param edits you made to other layers should persist across toggles.
6. Upload an SVG with no white (e.g., `samples/Pikachu.svg`) — the "Include white" checkbox should NOT render.

Stop the dev server (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SvgLayersPage.tsx
git commit -m "SvgLayersPage: hide near-white layers by default + Include white toggle"
```

---

## Task 6: Full-suite verification

**Files:** none — verification only.

- [ ] **Step 1: Run the complete Python suite**

Run: `PYTHONPATH=src pytest -v`
Expected: all PASS (248 pre-existing + new tests).

- [ ] **Step 2: Run the complete web suite**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 3: End-to-end API sanity**

Start the backend (in a separate terminal):
```bash
cd /Users/jonzky/Documents/XTools/Reverse && PYTHONPATH=src uvicorn xcs_gen_web.app:app --port 4000
```

Hit the detect endpoint with a near-white SVG:
```bash
curl -s -X POST http://localhost:4000/api/svg-detect-layers \
  -H 'content-type: application/json' \
  -d '{"svg_content":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect fill=\"#ffffff\" width=\"10\" height=\"10\"/><circle fill=\"#ff0000\" cx=\"5\" cy=\"5\" r=\"2\"/></svg>","width_mm":50}' | python -m json.tool
```

Expected output includes both layers, with the white one flagged:
```json
[
  {"color": "#ffffff", "shape_count": 1, "is_fill": true, "is_near_white": true},
  {"color": "#ff0000", "shape_count": 1, "is_fill": true, "is_near_white": false}
]
```

Stop the backend (Ctrl-C).

- [ ] **Step 4: No commit** — verification only. If anything failed, return to the relevant task.

---

## Summary of commits produced

1. `svg_source: add is_near_white helper`
2. `schemas: add is_near_white to DetectedLayer`
3. `svg_layers: populate DetectedLayer.is_near_white`
4. `web types: add is_near_white to DetectedLayer`
5. `SvgLayersPage: hide near-white layers by default + Include white toggle`

Each is independently reviewable and reverts cleanly.
