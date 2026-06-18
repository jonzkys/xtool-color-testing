# Spiral Test — job time estimate

**Status:** design approved (brainstorm 2026-06-18)
**Builds on:** the Spiral Test page (`#/spiral-test`) — selectable axes (PR #160) + machine limits (PR #161), both merged.

## Goal

Show a **total job time estimate** (spiral cuts + label fill-engrave) on the
Spiral Test page so the user can gauge how long a sweep will take before
exporting/burning. Surfaced compactly in the header status line. The number is a
**ballpark** (reuses the existing approximate cut-time models), signalled with a
`~` prefix.

## Decisions (from brainstorm)

- **Scope:** total = spiral cut time + label engrave time. One headline number
  (no breakdown).
- **Placement:** the existing header status line —
  `16 cells · 86×84 mm` → `16 cells · 86×84 mm · ~4:30`.
- **Accuracy:** ballpark. The cut model is Forge's vector approximation
  (`passes × Σlen / speed`); it ignores focus-descent Z-moves and inter-cell
  travel. The engrave model is the calibrated raster `stageSeconds`.

## Existing infrastructure (reuse, do not rebuild)

- `web/src/lib/cuttime/model.ts`: `stageSeconds(g: StageGeom, r: StageRate, c?)`
  — calibrated raster area-fill model (engrave); `fmtDuration(seconds)` → `m:ss`
  / `h:mm:ss`; `RATE_FALLBACK`. "Generic by design — no domain imports."
- `web/src/lib/cuttime/geometry.ts`: `ringsBBox(rings)`, `ringsFillArea(rings)`,
  `ringsPerimeter(rings)` over `Pt[][]`. (Private `signedArea`/`loopPerimeter`.)
- `web/src/lib/forge/spiral.ts`: `spiralPathLength(arm: Pt[]): number` — open
  polyline length (already used by Forge's estimator).
- `web/src/lib/forge/estimate.ts`: Forge's adapter; its local `spiralSeconds`
  (`passes × Σlen/speed + 0.01/pass`) is the precedent for the vector-cut model.
  Not reused directly — it's coupled to `ForgeConfig`/part/source.
- `web/src/lib/forge/spiralTest.ts`: `SpiralTestResult = { cells, cutPaths:
  GeneratedPath[], stageParams: Record<groupName, StageParams>, labelOutlines:
  LabelOutline[], footprintMm, overBed, warnings }`. `LabelOutline = { text;
  rings: Pt[][] }`. `SpiralTestConfig.score = { …, speed, passes, linesPerCm, … }`.
  `StageParams` has `passes?`, `speed?`.

## New generic helpers (in `cuttime/`, kept tested + domain-free)

**`cuttime/model.ts`** — add:
```ts
/** Linear vector-cut seconds: passes × (length/speed) + a tiny per-pass overhead.
 *  Mirrors the Forge estimator's spiral branch; speed floored at 1. */
export function vectorCutSeconds(lengthMm: number, passes: number, speedMmS: number): number {
  const PER_PASS_OVERHEAD_S = 0.01;
  const p = Math.max(1, passes);
  return p * (Math.max(0, lengthMm) / Math.max(1, speedMmS) + PER_PASS_OVERHEAD_S);
}
```

**`cuttime/geometry.ts`** — add (uses the file-private `signedArea` already defined there):
```ts
/** Sum of |signed area| over all rings (mm²). Unlike ringsFillArea (outer minus
 *  holes), this is correct for a flat list of independent filled shapes — e.g. a
 *  multi-glyph label, where each glyph's outline must add, not subtract. A slight
 *  over-count of glyph counters, which only feed the minor burn term. */
export function ringsInkArea(rings: Pt[][]): number {
  return rings.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
}
```

## Estimator (`web/src/lib/forge/spiralTestTime.ts`, new, pure)

```ts
export interface SpiralTestTime { cutSeconds: number; engraveSeconds: number; totalSeconds: number; }

export function estimateSpiralTestSeconds(result: SpiralTestResult, cfg: SpiralTestConfig): SpiralTestTime;
```

- **Cut:** group `result.cutPaths` by `groupName`, summing each arm's
  `spiralPathLength` (each `GeneratedPath` is one arm; `rings` holds it). For each
  group, `vectorCutSeconds(totalLen, stageParams[group].passes ?? 1,
  stageParams[group].speed ?? RATE_FALLBACK.speedMmS)`. Summed → `cutSeconds`.
  (Per-group passes/speed come from `result.stageParams`, so a passes/speed sweep
  is reflected per cell.)
- **Engrave:** for each `result.labelOutlines` entry,
  `stageSeconds({ bboxW, bboxH } = ringsBBox(rings), fillAreaMm2 =
  ringsInkArea(rings), perimeterMm = ringsPerimeter(rings) }, { sliceNumber: 1,
  repeat: cfg.score.passes, speedMmS: cfg.score.speed, densityLpc:
  cfg.score.linesPerCm })`. Summed → `engraveSeconds`. Zero when labels are off
  (`labelOutlines` empty).
- `totalSeconds = cutSeconds + engraveSeconds`.

Pure; imports `spiralPathLength` from `./spiral`, `stageSeconds`/`vectorCutSeconds`
/`RATE_FALLBACK` from `../cuttime/model`, `ringsBBox`/`ringsInkArea`/
`ringsPerimeter` from `../cuttime/geometry`, and the `SpiralTestResult`/
`SpiralTestConfig` types from `./spiralTest`.

## UI (`web/src/pages/SpiralTestPage.tsx`)

- `const estSeconds = useMemo(() => estimateSpiralTestSeconds(result, debouncedCfg).totalSeconds, [result, debouncedCfg]);`
  (`result` is already built from `debouncedCfg`, so the estimate tracks the
  debounced preview and won't thrash while typing.)
- Header status line gains ` · ~{fmtDuration(estSeconds)}` after the footprint,
  e.g. `16 cells · 86×84 mm · ~4:30` (and still ` · exceeds bed` when over-bed).
  Import `fmtDuration` (re-exported from `../lib/cuttime/model`).

## Testing

- **`cuttime/model.test.ts`**: `vectorCutSeconds` — `passes×len/speed` scaling
  (e.g. len 1000, passes 2, speed 500 → 2×(2+0.01)=4.02); speed floored at 1;
  passes floored at 1.
- **`cuttime/geometry.test.ts`**: `ringsInkArea` — a unit square → 1; two unit
  squares → 2 (adds, unlike `ringsFillArea`).
- **`spiralTestTime.test.ts`**: with a `buildSpiralTest` fixture — labels off →
  `engraveSeconds === 0`, `cutSeconds > 0`, `total === cut`; labels on →
  `engraveSeconds > 0`; doubling fixed `passes` ≈ doubles `cutSeconds`; doubling
  fixed `speed` ≈ halves `cutSeconds`; a larger grid (more cells) increases the
  total.
- Header readout: browser-verified (shows a sane `~m:ss` that grows with
  passes/cells).

## File structure

```
web/src/lib/cuttime/model.ts            MOD  add vectorCutSeconds
web/src/lib/cuttime/model.test.ts       MOD
web/src/lib/cuttime/geometry.ts         MOD  add ringsInkArea (export signedArea use)
web/src/lib/cuttime/geometry.test.ts    MOD
web/src/lib/forge/spiralTestTime.ts     NEW  estimateSpiralTestSeconds
web/src/lib/forge/spiralTestTime.test.ts NEW
web/src/pages/SpiralTestPage.tsx        MOD  compute estimate, append to header
changelog/2026-06-18-spiral-test-time-estimate.md   NEW  minor entry
```

## Notes / deviations

- Reuses Forge's vector-cut approximation rather than re-deriving it; the formula
  lives once as the generic `vectorCutSeconds` (Forge's local `spiralSeconds`
  stays as-is — not refactored in this change to avoid touching shipped code).
- The estimate ignores focus-descent Z-moves and inter-cell rapid travel, so it
  under-counts slightly on heavy focus-step jobs; the `~` prefix flags it as
  approximate. Calibrating against Studio for vector cuts is a future follow-up.
- Scope: cut + label engrave only. The fixed cut laser and label-engrave panel
  are unchanged. Do not touch the other Spiral feature (`SpiralPage` etc.).
