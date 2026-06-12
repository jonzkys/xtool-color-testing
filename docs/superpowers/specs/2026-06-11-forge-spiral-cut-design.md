# Forge Spiral Cut — Design Spec

**Date:** 2026-06-11
**Status:** approved (standalone strategy), pending spec review → implementation plan

## Goal

Add a new **Spiral Cut** strategy to Forge that, for an uploaded SVG, auto-generates
continuous-spiral vector cut lines which sever 3 mm brass on the xTool F2 Ultra —
cleaner and ~2× faster than the existing raster incise.

## Background (why this exists)

Empirically established over the cut-vs-incise investigation:

- A **narrow** vector cut cannot sever 3 mm brass on this machine — there's no
  assist gas, so molten brass with nowhere to go re-solidifies and re-welds the kerf.
- A **wide open channel** vents melt/vapour upward and cuts through. The raster
  incise works for exactly this reason, but it sweeps the whole bounding box.
- A **continuous spiral** — a single open `VECTOR_CUTTING` polyline sweeping a
  venting-width channel along the part boundary, at galvo speed with many passes and
  per-pass focus step-down — vents like incise but sweeps *only the channel*, so it's
  faster. Confirmed on brass: severs cleanly.

The spiral is the vectorised open-trench: same melt-venting physics as incise,
focused on the channel the part actually needs.

## Confirmed recipe → defaults

| Param | Default | Notes |
|---|---|---|
| `channelWidthMm` | **0.8** | 0.8 cuts clean; 0.4 marginal-but-works = floor |
| `pitchMm` | **0.04** | ~beam; arms overlap so the channel fully ablates |
| `speedMmS` | **1500** | galvo speed (not slow-vector) |
| `passes` | **500** | many fast light passes |
| `focusStepMm` | **0.06** | focus descent per step |
| `focusIntervalPasses` | **10** | step every 10 passes → 0.06×(500/10) = 3 mm total |
| `power / freq / pulseWidth / laser` | **100 / 65 kHz / 80 ns / MOPA IR (red)** | |

Mode: flat-surface `LASER_PLANE`, `processingType: VECTOR_CUTTING`.
Estimated ~4 min for a small square vs incise ~11 min → **~2× faster, cleaner edge.**

## Architecture decision — standalone strategy

Spiral is a **new opt-in strategy** parallel to incise. **Exports as a pure flat-mode
job:** when Spiral Cut is enabled, the `.xs` contains only `VECTOR_CUTTING` entries →
`activeMode` resolves to `LASER_PLANE` automatically.

**Mixed incise + spiral is OUT OF SCOPE.** A file with both `INTAGLIO` and
`VECTOR_CUTTING` forces the whole job into `RELIEF_PROCESS` (Embossment), where a
vector cut is unverified. So: **if both spiral and incise stages are enabled, emit a
warning and export spiral-only** (don't ship an unverified mixed job). You'd use one or
the other on a given part anyway.

Geometry lives in a new `web/src/lib/forge/spiral.ts`, parallel to `stages.ts` — the
algorithm is substantially different from band-and-go and is independently testable.

## The `spiralFromRegion` algorithm

Input: `part: Pt[][]` (reconstructed part region from `buildPartRegion`) + spiral opts.
Output: `{ arms: Pt[][], warnings: string[] }` — each arm is one open polyline.

1. **Concentric offsets.** Loop `offsetRegion(part, sign·k·pitch)` for k = 1..N until
   the cumulative offset exceeds `channelWidthMm` (sign: + for outer/scrap, − inward
   for holes). Each level is a `Pt[][]` (may be multiple loops).
2. **Topology tracking.** Match loops parent→child between consecutive levels via
   `pointInPolygon`. A parent with one child = normal strand; zero children = offset
   collapsed (strand ends); **N children = a concave-neck split → spawn N independent
   strands.** This is the full-arbitrary payoff.
3. **Polyline stitching.** For each strand, traverse each level's loop as an *open*
   ring (do not close it) and bridge to the next level with a short segment. Seam =
   closest-point: rotate each loop to start nearest the next loop's start, so bridges
   are short. At galvo speed the bridge time is negligible.
4. **Holes & multi-part.** Running on the full part region, negative offsets trace
   inward into each hole until it collapses (handled by the "zero children" rule).
   Separate part islands produce independent strands (no bridging between them).
5. **Thin-neck / tiny-hole fallback.** If the first offset (`pitchMm`) is already empty
   for a region, halve `channelWidthMm` toward `minChannelMm` (0.4); if still empty,
   record a warning and emit no arm for that region. **Fallback = warn only** (don't
   auto-inject incise; the user re-enables incise if they want it).

Never throws — all anomalies return `{ arms: [], warnings }`.

## Resolved design decisions

- **Holes in scope** (full-arbitrary case chosen): inward spirals fall out of the
  negative-offset + topology rules.
- **Spiral direction (tunable):** default to ordering the pass on the **part-boundary
  contour last**, so the cleanest pass defines the kept edge. Whether inner-last or
  outer-last actually cuts cleaner is confirmed on real brass; the direction stays a
  tunable param.
- **Seam:** closest-point bridge (tunable; fixed-angle is the alternative if real cuts
  prefer it).
- **Sub-floor features:** warn, no auto-incise.
- **Standalone export only** (mixed-mode out of scope, see above).

Seam style and spiral direction are genuinely empirical — left tunable, settled on real cuts.

## Files

**Create**
- `web/src/lib/forge/spiral.ts` — `spiralFromRegion` + `generateSpiralPaths` + `spiralPathLength`.
- `web/src/lib/forge/spiral.test.ts` — unit tests (below).
- `changelog/2026-06-11-spiral-cut.md` — major entry (with screenshot).

**Modify (library)**
- `types.ts` — add `"spiral"` to `GeneratedClass`; add `SpiralConfig`; add `spiral` to
  `ForgeConfig`; add VECTOR_CUTTING focus-step fields (`cuttingDrop`, `sinkingMethod`,
  `descentIntervalDescent`, `descentPerStep`) to `StageParams`.
- `config.ts` — `STAGE_GROUPS.spiral = "CUT_08_SPIRAL"`; spiral branch in `resolveStageParams`.
- `presets.ts` — add disabled `spiral` to `COMMON`; add `SPIRAL_CUT` preset (recipe above); `PresetId`.
- `pipeline.ts` — call `generateSpiralPaths` when `cfg.spiral.enabled`; append to `ordered`;
  `pathCounts.spiral`; **warn if spiral + any incise stage both enabled.**
- `estimate.ts` — `spiralSeconds(path) = passes × (pathLength/speedMmS + perPassOverhead)`;
  branch on `generatedClass === "spiral"`.
- `xcs.ts` — in `buildGeneratedXcs`, per-path `isFill`/`isClosePath`/`fillRule`/
  `processingType`/`dPath`: spiral → `contourToDPath(arm, false, …)`, `isFill:false`,
  `isClosePath:false`, fresh `VECTOR_CUTTING` entry (not cloned INTAGLIO) seeded with the
  customize block + focus-step fields; extend `applyStageParams` for the descent fields.
- `xs.ts` — thread `lightSourceMode: "red"` for a flat-mode job whose displays use the
  red (MOPA IR) laser (default stays `"blue"` for back-compat).

**Modify (UI)**
- `ForgeCanvas.tsx` — `CLASS_COLOR.spiral` (e.g. violet); stroke-only render branch for
  open polyline arms (not `fillBand`).
- `ForgeControls.tsx` — `"spiral"` in `CLASSES`; SpiralConfig card (enable, channelWidth,
  pitch, side, "Load Spiral Cut preset" button).
- `ForgeStageParams.tsx` — spiral tab in `stageList()`; descent fields in the Z section.
- `ForgePage.tsx` — `spiral` in `ALL_VISIBLE`; bump `CONFIG_LS_KEY` to v7; safe-merge
  `spiral` in `loadConfig`.

## Data flow

SVG upload → `parseForgeInput` → `runPipeline` → `buildPartRegion` → existing stage
generators (+ `generateSpiralPaths` when enabled) → `estimateForge` (spiral branch) →
canvas (stroke arms) / estimate. Export → `buildGeneratedXcs` (VECTOR_CUTTING for spiral,
INTAGLIO for incise) → `.xs`.

## Build sequence (testable increments)

1. **Types/config scaffold** — union, `SpiralConfig`, `StageParams` fields, `STAGE_GROUPS`,
   preset, `resolveStageParams`. `tsc --noEmit` green.
2. **Geometry core** — `spiral.ts` + `spiral.test.ts` (convex disc → 1 arm; C-shape split
   → 2 arms; hole below floor → empty+warning; 0.8/0.04 → 20 levels; multi-part → 2 arms).
   `npm test` green.
3. **Pipeline + estimator** — wire `generateSpiralPaths`, `pathCounts.spiral`, the
   spiral+incise warning, `spiralSeconds`. Tests green.
4. **Exporter** — per-path display flags + VECTOR_CUTTING customize + `applyStageParams`
   descent + `xs.ts` lightSourceMode. Round-trip test: spiral path → `isFill:false`,
   `processingType:"VECTOR_CUTTING"`, `cuttingDrop:true`, `LASER_PLANE`.
5. **UI** — canvas stroke render, controls card, stage-params tab, page wiring. `npm run
   build` + browser walkthrough (upload, enable spiral, see violet arms, export).
6. **Changelog + PR** — major entry + screenshot; PR vs `main` on a fresh `feat/forge-spiral-cut`.

## Testing

- Unit (`spiral.test.ts`): topology splits, holes, multi-part, fallback, level count, arm continuity.
- Export round-trip: VECTOR_CUTTING + flat mode + focus-step customize.
- Estimator: spiral linear-time formula.
- Browser: golden-path walkthrough + screenshot for changelog.

## Risks / to-confirm-empirically

- **Spiral direction** (inner-last vs outer-last) — which gives the cleaner part edge.
- **Seam strategy** (closest-point vs fixed angle) — galvo scan smoothness.
- **Real cut-time vs ~11 min incise** — confirm the ~2× on a real part via `incise_compare.xs`.

## Out of scope

- Mixed incise + spiral in one `.xs` (forces Embossment; unverified). Warn + export spiral-only.
- Wobble (runtime explodes) and break-point tabs — not needed for the spiral.
- Cut for thicker-than-tested stock; non-brass materials (defaults are brass-specific).
