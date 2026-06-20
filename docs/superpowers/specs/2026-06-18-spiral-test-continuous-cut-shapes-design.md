# Spiral Test — continuous single-movement cut + selectable cell shape

**Status:** design approved (brainstorm 2026-06-18)
**Builds on:** the Spiral Test page (`#/spiral-test`) — selectable axes (#160) + machine limits (#161), merged.

## Goal

Two linked changes:

1. **Each hole is cut as one continuous movement** — one `VECTOR_CUTTING` object
   with one focus-descent sequence — so the focus/heat buildup is representative.
   Today the exporter splits a hole's continuous ~3936-point spiral into ~3
   capped chunks (each restarts the focus step-down), and the machine
   auto-optimises the cut order (hopping between holes).
2. **Selectable cell shape** (circle / square / diamond / hexagon / octagon /
   star / letter J) — non-circle shapes are ~10× fewer points (lighter `.xs`,
   snappier preview) and let the test better match real cut geometry.

## Root cause (confirmed)

`spiralFromRegion` returns **one continuous arm per cell** for every shape
(verified: circle 3936 pts; square/diamond 360; hexagon 396; octagon 432; star
730 — all one arm, `side:"outside"` outward offset smooths concavities). The
discontinuity is entirely the exporter:
- `MAX_PATH_POINTS = 1500` chunking in `xcs.ts` splits the one arm into ~3
  `VECTOR_CUTTING` objects, each with its own focus descent.
- `userOrder = false` writes `pathPlanning:"auto"` → the F2 Ultra reorders cuts,
  interleaving holes.

The user has confirmed Studio imports/cuts large (>1570-pt) single paths fine,
so removing the cap is safe.

## Part 1 — Continuity (exporter fix, `web/src/lib/forge/spiralTestXs.ts`)

Foundation, independent of shape. In `buildSpiralTestXs`, change the
`buildGeneratedXcs` call and the `legacyRawToXs` call:
- `maxPathPoints`: pass `Infinity` instead of `MAX_PATH_POINTS`. The exporter's
  `length > cap` check never fires, so each cell's single arm exports as **one**
  `VECTOR_CUTTING` object (no `forge-N-k` chunks) with one focus-descent
  sequence.
- `userOrder`: pass `true` to both `buildGeneratedXcs(...)` and
  `legacyRawToXs(doc, null, true)`. The `.xs` then sets `pathPlanning:"custom"` +
  `isProcessByLayer:true`, so the machine cuts in the authored row-major display
  order (one hole fully, then the next) instead of auto-planning.

`buildSpiralTest` already emits one `GeneratedPath` per arm, and every shape is
one arm, so this yields one continuous movement per hole. (The `MAX_PATH_POINTS`
import in `spiralTestXs.ts` is dropped if it becomes unused.) Forge's own spiral
cut keeps its cap — this change is scoped to the spiral-test export.

## Part 2 — Cell shapes (`web/src/lib/forge/spiralShapes.ts`, new)

```ts
export type CellShape =
  | "circle" | "square" | "diamond" | "hexagon" | "octagon" | "star" | "letterJ";

/** A closed region (Pt[][]) for one test cell, bounded by ~`sizeMm`, centred at
 *  (cx,cy). Fed to spiralFromRegion as the part to sever. */
export function shapeRegion(shape: CellShape, cx: number, cy: number, sizeMm: number): Pt[][];
```

Generators (one closed outer loop unless noted):
- `circle` — the existing `circleRegion` (96-segment loop, diameter `sizeMm`).
  `circleRegion` MOVES here from `spiralTest.ts`; `spiralTest.ts` re-exports it
  (`export { circleRegion } from "./spiralShapes";`) so existing imports/tests
  keep working.
- `square` — regular 4-gon, radius `sizeMm/2`, rotated π/4 (axis-aligned edges).
- `diamond` — regular 4-gon, radius `sizeMm/2`, vertex up.
- `hexagon` / `octagon` — regular 6-/8-gon, radius `sizeMm/2`.
- `star` — 5-point star, outer radius `sizeMm/2`, inner radius `0.4 × outer`.
- `letterJ` — reuse the glyph table: `renderText("J", sizeMm, {x:0,y:0})` →
  rings; measure their bbox; uniformly scale so `max(bbox.w, bbox.h) === sizeMm`
  and translate so the bbox centre lands at `(cx,cy)`. (`renderText`/the glyph
  table are already in `web/src/lib/forge/textPaths.ts` + `glyphTable.json`.)

A private `regularPolygon(cx, cy, r, n, rotationRad): Pt[]` backs square/diamond/
hexagon/octagon.

`buildSpiralTest` replaces `circleRegion(cx, cy, cfg.diameterMm)` with
`shapeRegion(cfg.cellShape, cx, cy, cfg.diameterMm)`. Cell sizing (`cell =
diameterMm + 2·maxCw + gap`) and everything downstream (arms, dedup, preview,
labels, time estimate) are already shape-agnostic.

**Verification gate:** the plan must confirm `buildSpiralTest` yields exactly one
arm per cell for ALL shapes (including star + J). If any shape splits into >1 arm,
surface it as a `warnings` entry (so a multi-movement hole is never shipped
silently) — but the probes show all named shapes are one arm.

## Part 3 — Config + UI

**Config** (`spiralTest.ts`): `SpiralTestConfig` gains `cellShape: CellShape`.
`DEFAULT_CFG` (page) sets `cellShape: "circle"`. All test fixtures add it.

**Controls** (`SpiralTestControls.tsx`): in the layout section (rename title
"Circle & layout" → "Shape & layout") add a **Shape** `<Select aria-label="cell
shape">` with options Circle / Square / Diamond / Hexagon / Octagon / Star / J,
bound to `cfg.cellShape`. Relabel the **"Diameter (mm)"** field to **"Size
(mm)"** (it's the bounding size for non-circles; the field stays `diameterMm`,
aria-label `diameter` unchanged so existing tests pass).

**Preview / title:** unchanged. `SpiralTestPreview` already draws the arms as
polylines, so any shape renders automatically. The title stays the cut-param
summary (shape isn't a cut param and is obvious in the preview).

## Testing

- **`spiralShapes.test.ts`** (new): each generator returns ≥1 closed loop whose
  bbox is centred near `(cx,cy)` and within ~`sizeMm`; polygon point counts are
  far below the circle's; `letterJ` returns a non-empty ring scaled to ~`sizeMm`;
  `shapeRegion` dispatches every `CellShape` key.
- **`spiralTest.test.ts`**: `buildSpiralTest` per shape → cells built; **exactly
  one arm per cell for every shape** (incl. star + J) — the continuity guarantee;
  cell count unchanged; default shape is `circle`.
- **`spiralTestXs.test.ts`**: continuity — a circle config (arm > 1500 pts)
  exports **cut-display count === number of cells** (no chunk expansion, no
  `-k`-suffixed ids); the round-tripped `.xs`/doc carries `pathPlanning:"custom"`
  / `isProcessByLayer:true` (userOrder). A square config still round-trips
  (VECTOR_CUTTING + FILL_VECTOR_ENGRAVING present).
- **`controls.test.tsx`**: the Shape `<Select>` emits a `cellShape` change; the
  existing axis/diameter/title tests still pass.
- **Browser:** switch through every shape → the grid renders each; export a
  circle sweep → one object per hole, row-major order, one focus descent;
  confirm J resolves to one arm.

## File structure

```
web/src/lib/forge/spiralShapes.ts            NEW  CellShape, shapeRegion, regularPolygon, circleRegion (moved), letterJ
web/src/lib/forge/spiralShapes.test.ts       NEW
web/src/lib/forge/spiralTest.ts              MOD  cellShape config field; shapeRegion call; re-export circleRegion
web/src/lib/forge/spiralTest.test.ts         MOD  per-shape arm-count tests; fixture gets cellShape
web/src/lib/forge/spiralTestXs.ts            MOD  maxPathPoints=Infinity + userOrder=true (both calls)
web/src/lib/forge/spiralTestXs.test.ts       MOD  continuity (no-chunk) + pathPlanning assertions; fixture gets cellShape
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  Shape select; "Diameter"→"Size" label; section title
web/src/components/spiraltest/controls.test.tsx        MOD  shape-select test; fixture gets cellShape
web/src/components/spiraltest/FixedParams.test.tsx     MOD  fixture gets cellShape (compile)
web/src/pages/SpiralTestPage.tsx             MOD  DEFAULT_CFG gets cellShape: "circle"
changelog/2026-06-18-spiral-test-continuous-shapes.md  NEW  minor entry (continuous cut + selectable shape)
```

## Notes / deviations

- Removing the cap is scoped to the spiral-test export only (the user verified
  Studio handles large single paths on the F2 Ultra). Forge's spiral cut keeps
  `MAX_PATH_POINTS`.
- Very dense configs (large channel ÷ tiny pitch) still produce large single
  paths; that's intended (one continuous movement) and the user owns keeping the
  sweep reasonable.
- `cellShape` is a new required config field; every `SpiralTestConfig` literal
  (DEFAULT_CFG + all test fixtures) must add it — pure mechanical churn.
- Do NOT touch the other Spiral feature (`SpiralPage`/`SpiralControls`/
  `SpiralCanvas`/`spiral.ts`/`presets.ts`) or Forge's `estimate.ts`/`xcs.ts`
  chunking (the cap stays; we just opt out by passing `Infinity`).
