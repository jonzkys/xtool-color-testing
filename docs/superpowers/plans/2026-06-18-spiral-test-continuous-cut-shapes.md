# Spiral Test — continuous single-movement cut + cell shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut each Spiral Test hole as one continuous movement (one `VECTOR_CUTTING` object, one focus-descent sequence, no hole-hopping) and let the cell shape be selected (circle / square / diamond / hexagon / octagon / star / letter J).

**Architecture:** A new pure `spiralShapes.ts` provides `shapeRegion(shape, cx, cy, size)` (the letter reuses the baked glyph table); `buildSpiralTest` feeds it to the existing generator, which yields one continuous arm per shape. The exporter stops chunking (`maxPathPoints = Infinity`) and authors the cut order (`userOrder = true`), so each hole is one object cut in grid order.

**Tech Stack:** TypeScript + React + Vite; vitest. Pure functions; no new deps.

**Spec:** `docs/superpowers/specs/2026-06-18-spiral-test-continuous-cut-shapes-design.md`. On `main` (incl. #160 axes, #161 limits, #162 time estimate).

**Key facts (verified):**
- `web/src/lib/forge/spiral.ts` `spiralFromRegion(part, opts)` returns ONE arm per cell for every named shape (`side:"outside"` outward offset smooths concavities — circle/square/diamond/hex/oct/star all 1 arm).
- `web/src/lib/forge/spiralTest.ts`: `circleRegion(cx, cy, d, segments=96): Pt[][]` (lines 18-27); `SpiralTestConfig` (line 29) has `diameterMm`, `side`, `labels`, `score{ speed,passes,linesPerCm,... }`; `CellInfo.cut: Pt[][]` is the cell's arms; `buildSpiralTest` builds the region at line 174 `const region = circleRegion(cx, cy, cfg.diameterMm);`. Imports `Pt` from `./types`, `renderText`/`textWidth` from `./textPaths`. Already `export { resolveAxis } from "./spiralParams";`.
- `web/src/lib/forge/textPaths.ts`: `renderText(text: string, sizeMm: number, origin: Pt): Pt[][]` (filled glyph-outline rings; "J" → one closed ring, no counter).
- `web/src/lib/forge/spiralTestXs.ts`: imports `MAX_PATH_POINTS` from `./xcs`; line 109-111 `buildGeneratedXcs(parsed, inciseId, result.cutPaths, 1, result.stageParams, undefined /*scanAngle*/, false /*userOrder*/, MAX_PATH_POINTS, false /*joinStrands*/)`; line 138 `return legacyRawToXs(doc, null, false);`.
- `buildGeneratedXcs` chunks a spiral path only when `rings[0].length > cap` where `cap = maxPathPoints > 0 ? maxPathPoints : MAX_PATH_POINTS` — so `Infinity` disables chunking. `userOrder` (xcs.ts:667-686 + xs.ts) sets `pathPlanning:"custom"` + `isProcessByLayer:true`.
- `web/src/components/spiraltest/SpiralTestControls.tsx`: "Circle & layout" `<Section>` (line 118); "Diameter (mm)" `<Field>` + `<Input aria-label="diameter">` (lines 120-123); a `set<K>(k, v)` helper; already imports `Select`.
- `web/src/pages/SpiralTestPage.tsx`: `DEFAULT_CFG` literal (line 12).
- Existing test fixtures build `SpiralTestConfig` literals (`spiralTest.test.ts`, `spiralTestXs.test.ts`, `controls.test.tsx`, `FixedParams.test.tsx`, `spiralTestTime.test.ts`). **`cellShape` is added as OPTIONAL** (default `"circle"` in `buildSpiralTest`), so those fixtures need NO change.

**Conventions:** Gate before commit: `cd web && npx tsc --noEmit && npm test -- --run`. Rebuild for the browser: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/src/lib/forge/spiralShapes.ts            NEW  CellShape, circleRegion, regularPolygon, starLoop, letterRegion, shapeRegion
web/src/lib/forge/spiralShapes.test.ts       NEW
web/src/lib/forge/spiralTestXs.ts            MOD  maxPathPoints=Infinity + userOrder=true (both calls); drop MAX_PATH_POINTS import
web/src/lib/forge/spiralTestXs.test.ts       MOD  continuity (no-chunk) assertion
web/src/lib/forge/spiralTest.ts              MOD  optional cellShape; shapeRegion call; circleRegion moves to spiralShapes (re-exported)
web/src/lib/forge/spiralTest.test.ts         MOD  per-shape one-arm tests
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  Shape select; "Diameter"→"Size"; section title
web/src/components/spiraltest/controls.test.tsx        MOD  shape-select test
web/src/pages/SpiralTestPage.tsx             MOD  DEFAULT_CFG cellShape: "circle"
changelog/2026-06-18-spiral-test-continuous-shapes.md  NEW  minor entry
```

---

## Task 1: Shape generators (`spiralShapes.ts`)

Pure, self-contained. Owns `circleRegion` (canonical home) + the new shapes.

**Files:** Create `web/src/lib/forge/spiralShapes.ts`, `web/src/lib/forge/spiralShapes.test.ts`.

- [ ] **Step 1: Write the failing test** — create `web/src/lib/forge/spiralShapes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { shapeRegion, circleRegion, type CellShape } from "./spiralShapes";

const SHAPES: CellShape[] = ["circle", "square", "diamond", "hexagon", "octagon", "star", "letterJ"];

function span(rings: { x: number; y: number }[][]) {
  const pts = rings.flat();
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, n: pts.length };
}

describe("shapeRegion", () => {
  it("every shape is ≥1 closed loop, centred at (cx,cy), bounded by ~sizeMm", () => {
    for (const shape of SHAPES) {
      const rings = shapeRegion(shape, 50, 50, 10);
      expect(rings.length).toBeGreaterThanOrEqual(1);
      const s = span(rings);
      expect(s.n).toBeGreaterThanOrEqual(3);
      expect(Math.max(s.w, s.h)).toBeGreaterThan(4);          // fills a meaningful part of the box
      expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(10.01);  // within sizeMm
      expect(Math.abs(s.cx - 50)).toBeLessThan(0.6);          // centred
      expect(Math.abs(s.cy - 50)).toBeLessThan(0.6);
    }
  });
  it("polygons are far fewer region points than a circle", () => {
    const circlePts = circleRegion(50, 50, 10)[0].length; // 96
    for (const shape of ["square", "diamond", "hexagon", "octagon"] as CellShape[]) {
      expect(shapeRegion(shape, 50, 50, 10)[0].length).toBeLessThan(circlePts);
    }
  });
  it("letterJ scales its larger dimension to ~sizeMm", () => {
    const s = span(shapeRegion("letterJ", 50, 50, 10));
    expect(Math.max(s.w, s.h)).toBeCloseTo(10, 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralShapes.test.ts`
Expected: FAIL — cannot find module `./spiralShapes`.

- [ ] **Step 3: Implement `web/src/lib/forge/spiralShapes.ts`**:
```ts
// web/src/lib/forge/spiralShapes.ts
// Cell-shape region generators for the Spiral Test. Each returns a closed region
// (Pt[][]) bounded by ~sizeMm and centred at (cx,cy), fed to spiralFromRegion as
// the part to sever. Pure; the letter shape reuses the baked glyph table.
import type { Pt } from "./types";
import { renderText } from "./textPaths";

export type CellShape =
  | "circle" | "square" | "diamond" | "hexagon" | "octagon" | "star" | "letterJ";

/** One closed loop of `segments` points on a circle of diameter `d` at (cx,cy). */
export function circleRegion(cx: number, cy: number, d: number, segments = 96): Pt[][] {
  const r = d / 2;
  const loop: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    loop.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return [loop];
}

/** A regular n-gon of circumradius `r` at (cx,cy), first vertex at `rotRad`. */
function regularPolygon(cx: number, cy: number, r: number, n: number, rotRad: number): Pt[] {
  const loop: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotRad + (2 * Math.PI * i) / n;
    loop.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return loop;
}

/** A `points`-pointed star (outer radius `ro`, inner `ri`) at (cx,cy), first
 *  outer point up. */
function starLoop(cx: number, cy: number, ro: number, ri: number, points: number): Pt[] {
  const loop: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / points;
    const r = i % 2 === 0 ? ro : ri;
    loop.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return loop;
}

function bbox(rings: Pt[][]): { minX: number; minY: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { minX: x0, minY: y0, w: x1 - x0, h: y1 - y0 };
}

/** A glyph as a region: the baked outline, uniformly scaled so its larger
 *  dimension is `sizeMm`, centred at (cx,cy). */
function letterRegion(ch: string, cx: number, cy: number, sizeMm: number): Pt[][] {
  const raw = renderText(ch, sizeMm, { x: 0, y: 0 });
  const b = bbox(raw);
  const s = sizeMm / (Math.max(b.w, b.h) || 1);
  const bcx = b.minX + b.w / 2, bcy = b.minY + b.h / 2;
  return raw.map((ring) => ring.map((p) => ({ x: cx + (p.x - bcx) * s, y: cy + (p.y - bcy) * s })));
}

/** A closed region (Pt[][]) for one test cell, bounded by ~`sizeMm`, centred at
 *  (cx,cy). The part fed to spiralFromRegion. */
export function shapeRegion(shape: CellShape, cx: number, cy: number, sizeMm: number): Pt[][] {
  const r = sizeMm / 2;
  switch (shape) {
    case "circle": return circleRegion(cx, cy, sizeMm);
    case "square": return [regularPolygon(cx, cy, r, 4, Math.PI / 4)];
    case "diamond": return [regularPolygon(cx, cy, r, 4, -Math.PI / 2)];
    case "hexagon": return [regularPolygon(cx, cy, r, 6, -Math.PI / 2)];
    case "octagon": return [regularPolygon(cx, cy, r, 8, Math.PI / 8)];
    case "star": return [starLoop(cx, cy, r, r * 0.4, 5)];
    case "letterJ": return letterRegion("J", cx, cy, sizeMm);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralShapes.test.ts`
Expected: PASS (3 tests). (`square` rotated π/4 has a ~7.07mm bbox — `>4` and `≤10.01` hold; `diamond`/`hex`/`circle`/`letterJ` reach ~10.)

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → clean; all pass. (`circleRegion` now exists in BOTH `spiralShapes.ts` and `spiralTest.ts` — harmless until Task 3 dedups.)
```bash
git add web/src/lib/forge/spiralShapes.ts web/src/lib/forge/spiralShapes.test.ts
git commit -m "feat(spiral-test): cell-shape region generators (circle/polygon/star/letter)"
```

---

## Task 2: Continuity — stop chunking + author cut order (`spiralTestXs.ts`)

**Files:** Modify `spiralTestXs.ts`, `spiralTestXs.test.ts`.

- [ ] **Step 1: Edit `web/src/lib/forge/spiralTestXs.ts`**

(a) Drop the now-unused `MAX_PATH_POINTS` import. Change:
```ts
import { buildGeneratedXcs, parseXcsFile, ringsToDPath, MAX_PATH_POINTS } from "./xcs";
```
to:
```ts
import { buildGeneratedXcs, parseXcsFile, ringsToDPath } from "./xcs";
```

(b) The `buildGeneratedXcs(...)` call (around line 109) — set `userOrder` true and `maxPathPoints` `Infinity`. Replace:
```ts
  const doc = buildGeneratedXcs(
    parsed, inciseId, result.cutPaths, 1 /* mmPerUnit */, result.stageParams,
    undefined /* scanAngle */, false /* userOrder */, MAX_PATH_POINTS, false /* joinStrands */,
```
with:
```ts
  const doc = buildGeneratedXcs(
    parsed, inciseId, result.cutPaths, 1 /* mmPerUnit */, result.stageParams,
    undefined /* scanAngle */, true /* userOrder: author the cut order */,
    Infinity /* maxPathPoints: never chunk — one continuous object per hole */, false /* joinStrands */,
```
(Keep the rest of that call — the `) as {...}` cast — unchanged.)

(c) The final return (line 138) — author the order in the `.xs` too. Replace:
```ts
  return legacyRawToXs(doc, null, false);
```
with:
```ts
  // userOrder=true → pathPlanning "custom" + isProcessByLayer → the machine cuts
  // in the authored display order (one hole fully, then the next).
  return legacyRawToXs(doc, null, true);
```

(d) Update the file header comment (lines 1-4) to note: "Each hole's spiral is one continuous VECTOR_CUTTING object (no point-cap chunking) and the cut order is authored (pathPlanning custom)."

- [ ] **Step 2: Add a continuity test to `web/src/lib/forge/spiralTestXs.test.ts`**

Append inside the existing `describe("buildSpiralTestXs", …)` block (the file already has `buildSpiralTest`, `buildSpiralTestXs`, `xsToLegacyRaw`, and a `baseCfg(over)` factory):
```ts
  it("emits ONE continuous cut object per hole (no point-cap chunking)", () => {
    // A circle config: each arm is ~3936 pts (> the old 1500 cap), which used to
    // split into ~3 objects. With chunking disabled it's one object per arm.
    const cfg = baseCfg({ xAxis: { min: 0.6, max: 1.0, steps: 2 }, yAxis: { min: 0.03, max: 0.05, steps: 2 } });
    const result = buildSpiralTest(cfg);
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(result, cfg));
    const r = raw as { canvas: Array<{ displays: Array<{ id: string }> }>;
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { processingType?: string }]> } }]> } } };
    const entries = r.device.data.value[0][1].displays.value;
    const cutCount = entries.filter(([, e]) => e.processingType === "VECTOR_CUTTING").length;
    // one cut object per arm — no chunk expansion (would be ~3× with the cap on)
    expect(cutCount).toBe(result.cutPaths.length);
    expect(result.cutPaths.length).toBe(result.cells.length); // one arm per cell
    // no chunk-suffixed display ids (forge-N-k)
    const cutDisplays = r.canvas[0].displays.filter((d) => d.id.startsWith("forge-"));
    expect(cutDisplays.every((d) => !/^forge-\d+-\d+$/.test(d.id))).toBe(true);
  });
```

- [ ] **Step 3: Run the lib test**

Run: `cd web && npx vitest run src/lib/forge/spiralTestXs.test.ts`
Expected: PASS. (Before the Step-1 change this test would fail — `cutCount` would be ~3× `cutPaths.length`. If `xsToLegacyRaw` exposes the device entries under a different path, mirror the existing assertions in that file, but keep the `cutCount === cutPaths.length` contract.)

- [ ] **Step 4: Typecheck + commit**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → clean; all pass. Confirm no stale `MAX_PATH_POINTS` ref: `grep -n "MAX_PATH_POINTS" web/src/lib/forge/spiralTestXs.ts` → nothing.
```bash
git add web/src/lib/forge/spiralTestXs.ts web/src/lib/forge/spiralTestXs.test.ts
git commit -m "fix(spiral-test): one continuous cut object per hole + authored cut order"
```

---

## Task 3: Wire shapes into the model (`spiralTest.ts`)

**Files:** Modify `spiralTest.ts`, `spiralTest.test.ts`.

- [ ] **Step 1: Edit `web/src/lib/forge/spiralTest.ts`**

(a) Add the shapes import after the existing imports (after line 13):
```ts
import { shapeRegion, type CellShape } from "./spiralShapes";
```

(b) Delete the local `circleRegion` definition (lines 18-27) and re-export it from `spiralShapes` instead. Replace the whole `circleRegion` block with:
```ts
export { circleRegion } from "./spiralShapes";
export type { CellShape } from "./spiralShapes";
```

(c) Add `cellShape` (optional) to `SpiralTestConfig` — after the `diameterMm` line:
```ts
  diameterMm: number;
  cellShape?: CellShape;             // cut-out shape (default "circle")
```

(d) In `buildSpiralTest`, replace the region line (currently `const region = circleRegion(cx, cy, cfg.diameterMm);`) with:
```ts
      const region = shapeRegion(cfg.cellShape ?? "circle", cx, cy, cfg.diameterMm);
```

- [ ] **Step 2: Run tsc + existing tests (must stay green after the circleRegion move)**

Run: `cd web && npx tsc --noEmit && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: PASS. (`spiralTest.test.ts` imports `circleRegion` from `./spiralTest` — still works via the re-export. Existing fixtures omit `cellShape` → defaults to `"circle"` → unchanged behavior.)

- [ ] **Step 3: Add per-shape one-arm tests to `web/src/lib/forge/spiralTest.test.ts`**

Append a `describe` block (the file has a `baseCfg(over)` factory). This is the continuity verification gate — every shape must be one arm per cell:
```ts
import type { CellShape } from "./spiralTest";

describe("cell shapes", () => {
  const SHAPES: CellShape[] = ["circle", "square", "diamond", "hexagon", "octagon", "star", "letterJ"];
  it("every shape produces exactly one continuous arm per cell", () => {
    for (const cellShape of SHAPES) {
      const r = buildSpiralTest(baseCfg({
        cellShape,
        xAxis: { min: 0.6, max: 1.0, steps: 2 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
      }));
      expect(r.cells.length).toBe(4);
      // one arm per cell → one GeneratedPath per cell, each CellInfo.cut has 1 arm
      expect(r.cells.every((c) => c.cut.length === 1)).toBe(true, `${cellShape} split into >1 arm`);
      expect(r.cutPaths.length).toBe(r.cells.length);
    }
  });
  it("defaults to circle when cellShape is omitted", () => {
    const omitted = buildSpiralTest(baseCfg());
    const circle = buildSpiralTest(baseCfg({ cellShape: "circle" }));
    expect(omitted.cutPaths.length).toBe(circle.cutPaths.length);
  });
});
```
(Note: `expect(...).toBe(true, msg)` — if this vitest version rejects the 2nd arg, drop the message: `expect(r.cells.every((c) => c.cut.length === 1)).toBe(true);`.)

- [ ] **Step 4: Run the lib test**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts`
Expected: PASS. If any shape (most likely `letterJ` or `star`) yields a cell with `cut.length > 1`, that shape splits — STOP and report it (the spec's gate); do not loosen the assertion. The probes show all are one arm, so this should pass.

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → clean; all pass.
```bash
git add web/src/lib/forge/spiralTest.ts web/src/lib/forge/spiralTest.test.ts
git commit -m "feat(spiral-test): selectable cell shape in buildSpiralTest (default circle)"
```

---

## Task 4: Shape selector UI

**Files:** Modify `SpiralTestControls.tsx`, `controls.test.tsx`, `SpiralTestPage.tsx`.

- [ ] **Step 1: Add the Shape select to `web/src/components/spiraltest/SpiralTestControls.tsx`**

(a) Import `CellShape` — add to the existing `spiralTest` type import. The file imports `type { SpiralTestConfig } from "../../lib/forge/spiralTest";`; change it to:
```ts
import type { SpiralTestConfig, CellShape } from "../../lib/forge/spiralTest";
```

(b) Rename the layout section title and relabel the diameter field, and add the Shape select as the first field in that section's grid. Replace:
```tsx
      <Section title="Circle & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Diameter (mm)">
            <Input aria-label="diameter" type="number" mono step={0.5} value={cfg.diameterMm}
              onChange={(e) => set("diameterMm", num(e.target.value, cfg.diameterMm))} />
          </Field>
```
with:
```tsx
      <Section title="Shape & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Shape" className="col-span-2">
            <Select aria-label="cell shape" value={cfg.cellShape ?? "circle"}
              onChange={(e) => set("cellShape", e.target.value as CellShape)}>
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="diamond">Diamond</option>
              <option value="hexagon">Hexagon</option>
              <option value="octagon">Octagon</option>
              <option value="star">Star</option>
              <option value="letterJ">J</option>
            </Select>
          </Field>
          <Field label="Size (mm)">
            <Input aria-label="diameter" type="number" mono step={0.5} value={cfg.diameterMm}
              onChange={(e) => set("diameterMm", num(e.target.value, cfg.diameterMm))} />
          </Field>
```
(`set` is the existing helper; `Select`/`Field`/`Input` are already imported. The `aria-label="diameter"` stays so existing tests keep matching.)

- [ ] **Step 2: Add a shape-select test to `web/src/components/spiraltest/controls.test.tsx`**

Add inside the `describe("SpiralTestControls", …)` block:
```ts
  it("emits a changed cell shape", () => {
    const onChange = vi.fn();
    render(<SpiralTestControls cfg={baseCfg()} onChange={onChange} footprint={{ w: 1, h: 1 }} overBed={false} />);
    fireEvent.change(screen.getByLabelText("cell shape"), { target: { value: "star" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cellShape: "star" }));
  });
```
(`baseCfg`, `render`, `screen`, `fireEvent`, `vi` are already imported in this file.)

- [ ] **Step 3: Set the default shape in `web/src/pages/SpiralTestPage.tsx`**

In `DEFAULT_CFG`, add `cellShape: "circle"` — change the line:
```ts
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
```
to:
```ts
  diameterMm: 10, cellShape: "circle", side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
```

- [ ] **Step 4: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/spiraltest/SpiralTestControls.tsx web/src/components/spiraltest/controls.test.tsx web/src/pages/SpiralTestPage.tsx
git commit -m "feat(spiral-test): Shape selector (circle/square/diamond/hex/oct/star/J)"
```

---

## Task 5: Changelog + browser verification

**Files:** Create `changelog/2026-06-18-spiral-test-continuous-shapes.md`.

- [ ] **Step 1: Write the changelog** — create `changelog/2026-06-18-spiral-test-continuous-shapes.md`:
```markdown
---
id: 2026-06-18-spiral-test-continuous-shapes
date: 2026-06-18
level: minor
title: Spiral Test — continuous single-movement cut + cell shapes
summary: Each test hole is now cut as one continuous movement (one focus descent, no hole-hopping), and the cell shape is selectable — circle, square, diamond, hexagon, octagon, star, or a J — with polygons running far fewer points.
---
```

- [ ] **Step 2: Full suites**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.

- [ ] **Step 3: Browser golden path**

Restart/refresh the dev server, open `http://127.0.0.1:8017/#/spiral-test`, and verify:
- The **Shape** dropdown is in "Shape & layout"; switching through Circle / Square / Diamond / Hexagon / Octagon / Star / J redraws the grid with that shape; the size field reads "Size (mm)".
- Default (Circle) export: unzip the `.xs` and confirm **one `VECTOR_CUTTING` display per cell** (no `forge-N-k` chunk ids — a default circle was ~3 chunks/cell before), and `pathPlanning:"custom"` / `isProcessByLayer:true` in the device/mode data.
- A Square export has visibly far fewer points (smaller `.xs`); J renders as one continuous outline. Screenshot and review critically.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-18-spiral-test-continuous-shapes.md
git commit -m "docs(spiral-test): changelog for continuous cut + cell shapes"
```

---

## Execution notes

- Branch: `feat/spiral-test-continuous-cut-shapes` is NOT used — work on `feat/spiral-test-shapes` (already off `main`). Push + draft PR when done; ready when CI is green.
- `cellShape` is OPTIONAL with a `"circle"` default, so existing `SpiralTestConfig` fixtures need no change (only `DEFAULT_CFG` sets it explicitly).
- Removing the cap is scoped to the spiral-test export (`Infinity`); Forge's `xcs.ts` cap is untouched. Do NOT modify the other Spiral feature or Forge's `estimate.ts`.
- The verification gate (Task 3 Step 4): if any shape splits into >1 arm, stop and report — never ship a silently multi-movement hole.
```
