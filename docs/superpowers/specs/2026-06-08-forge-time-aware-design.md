# Contour Forge — time-aware estimation, budget warning & lean defaults

**Status:** design for review (2026-06-08)
**Owner:** Jon
**Route:** `#/forge`
**Branch:** `feat/forge-time-aware` (to be created off `main` at implementation)
**Extends:** `2026-05-25-contour-forge-design.md` (+ sliver-band addendum),
`2026-05-31-forge-stage-params-design.md`

## Problem

The staged generator can emit a technically-interesting but impractically slow
cut. Forge gives no signal of cut time before export, so a strategy that costs
many times a plain incise looks identical in the UI to a lean one.

A measure-first calibration (13 probe `.xs` files opened in xTool Studio, F2
Ultra) confirmed the concern is real **and** isolated *which* knobs drive it —
which is not what the original "stack of offset lines" mental model assumed.

### What we measured (see Appendix A for raw data)

Studio's estimated time for one INTAGLIO sliver-band stage fits, within ~6%
across all 13 probes:

```
stage_seconds = sliceNumber × repeat ×
    [ d·( bboxW·bboxH / V_SCAN )  +  d·bboxH·TAU  +  K_BURN·d·fillArea / speed ]
  where d = density_lines_per_cm / 10   (lines per mm)
        V_SCAN = 2532 (mm/s, raster sweep rate — NOT the speed setting)
        TAU    = 0.006217 (s per scan line, turnaround)
        K_BURN = 0.916
        bboxW = extent along scan, bboxH = extent across scan (line count)
```

Findings, in order of impact on the design:

1. **`sliceNumber` is a perfectly linear time multiplier, ~zero intercept**
   (50→100→200→256 ⇒ ×2.00, ×4.00, ×5.14). Cumulative deepen depth costs
   exactly proportional time. The depth concern is **confirmed**.
2. **`repeat` (passes) multiplies identically** to `sliceNumber`
   (effective traversals = `sliceNumber × repeat`).
3. **Density is a 1:1 linear multiplier** (×2 density ⇒ ×2 time). The user's
   real jobs run density 300 (3× the calibration's 100), so real per-slice cost
   is ~3× the base probe.
4. **Speed barely matters for thin kerf bands** (300→600 mm/s ⇒ −3.6%). The
   raster sweep dominates; the burn term is small until the band is both **wide
   and slow** (1 mm band at 100 mm/s ⇒ burn dominates). *Implication: "cut
   faster" is a weak lever in Studio's estimate; fewer slices/passes/area is the
   strong one.*
5. **Band width is sub-linear** (10× width ⇒ 1.86× time). An "8× deepen" band is
   ~1.15–1.2× per slice, **not** 8×. The blow-up is width × cumulative depth
   *together*, not width alone.

### The quantified problem (user's real regime: density 300, speed 200,
slices 100, blue light, z-descent), for a 30×20 mm part (~100 mm kerf):

| | model estimate | vs vanilla incise |
|---|---|---|
| Vanilla incise (1 kerf, 100 slices) | ~20:37 | 100% |
| Deepen schedule alone (A50+B100+C200+D256) | ~2h13m | ~650% |
| **Full current default** | **~3h10m** | **~920%** |

Two roughly-equal culprits:

- **The slice-inheritance footgun.** Seed/perforate/clean ship `stageParams`
  empty, so on export they inherit the *source incise's* deep `sliceNumber`.
  `seed.layerCount` (3) never reaches the file (it is "informational",
  `stages.ts:48`). Seed + clean alone run full-depth where they should be
  shallow ≈ **half** the overhead.
- **The genuinely cumulative deepen schedule** (each group re-engraves 0→toLayer;
  `config.ts:53` sets `sliceNumber = toLayer`), ~6.5× baseline by itself.

## Decisions (locked with the user)

- **Measure first** — calibrate against Studio, then build on real numbers (done).
- **Lean preset shipped as the default**; keep the current 1×/2×/4×/8× schedule
  as a selectable "Aggressive" preset (honors "keep the staged approach
  optional/experimental").
- **Fix the export footgun** — shallow stages stop inheriting the deep source
  slice count.
- **Budget warning default 1.5× baseline**, configurable, **warn-only** (never
  blocks export).

## Scope (this round)

Options 1, 2, 4, 5, 8, 9 from the brief, plus the footgun fix:

A. Geometry helpers (ring bbox / fill-area / perimeter).
B. `lib/forge/estimate.ts` — the validated cut-time model + baseline + outputs.
C. `DebugStats` extension + pipeline wiring.
D. Estimate panel (per-stage time, total, % vs baseline, counts).
E. Budget warning (1.5× default, warn-only).
F. Footgun fix (resolveStageParams + shallow layer-count config + UI).
G. Lean default + presets + sparse perforation + cumulative-layer relabel.
H. Config persistence / migration.

### Out of scope — follow-up note (next stage)

- **Options 3 & 6** — scrap-side relief *vents* / partial selective relief as a
  new geometry capability (instead of full-contour widening). New geometry,
  larger; its own spec.
- **Option 7** — an explicit A/B/C/D *comparison mode* (vanilla vs faster vs
  +sparse relief vs +clean) driven by the estimator. Wants the estimator first.
- Per-density/scan-angle re-calibration of the model constants beyond the F2
  Ultra @ ~15° point measured here.

## Design

### A. Geometry helpers — `lib/cuttime/geometry.ts` (new, pure, reusable)

Generic ring helpers (operate on `Pt[][]`, no Forge coupling). `contour.ts`
already has `signedArea` and `contourPerimeter` — reuse them here:

- `ringsBBox(rings: Pt[][]): {w, h, minX, minY}` — AABB over all ring points.
- `ringsFillArea(rings): number` — even-odd filled area. Forge rings are always
  `[outer, inner]` (band) or `[square]` (pocket), so:
  `len≥2 ⇒ |area(rings[0])| − Σ|area(rings[1..])|`; `len==1 ⇒ |area(rings[0])|`.
- `ringsPerimeter(rings): number` — Σ `contourPerimeter` of each ring.

(For scan-angle awareness the estimator uses `perpendicularExtentAt` from
`scanangle.ts` for `bboxH` and the extent at angle+90° for `bboxW`; at the
calibration point — axis-aligned, ~15° — these equal the AABB. Documented as an
approximation; AABB is the fallback when no angle is resolved.)

### B. Cut-time model + estimator — split into a reusable core + a Forge adapter

**Reusability (explicit requirement).** The cut-time *model* must be usable from
other pages (gcode viewer, test/exposure pages, gradient generator) without
importing anything Forge-specific. So it splits in two:

- **`lib/cuttime/model.ts` (new, generic, zero Forge imports)** — the calibrated
  laser engrave/incise time model. Exports `CutTimeCalibration`,
  `DEFAULT_CALIBRATION`, `RATE_FALLBACK`, `StageGeom`, `StageRate`,
  `stageSeconds(geom, rate, calib?)`, and `fmtDuration(seconds)`. It knows only
  about generic geometry summaries (`bboxW/bboxH/fillArea/perimeter`) and rates
  (`slices/repeat/speed/density`) — never `GeneratedPath`, `ForgeConfig`, etc.
  Any page that can produce a `StageGeom` + `StageRate` (e.g. from a RECT fill,
  a `dPath`, or a device customize block) gets a cut-time estimate from this one
  function. Calibration constants live here, documented with their provenance.
- **`lib/forge/estimate.ts` (new, Forge adapter)** — imports the core and maps
  Forge's `GeneratedPath[]` + `part` + `ForgeConfig` + `sourceParams` into
  `StageGeom`/`StageRate` per stage, computes the baseline, applies the budget,
  and returns `ForgeEstimate`. All Forge knowledge lives here.

The geometry helpers in §A (`ringsBBox`/`ringsFillArea`/`ringsPerimeter`) operate
on generic `Pt[][]`, so they live alongside the core (`lib/cuttime/geometry.ts`)
and are reusable too; the Forge adapter calls them to build each `StageGeom`.

```ts
// lib/cuttime/model.ts
export interface CutTimeCalibration {
  vScanMmS: number;   // 2532
  tauSPerLine: number; // 0.006217
  kBurn: number;       // 0.916
  // calibrated F2 Ultra, processAngle≈15°, 2026-06 (Appendix A)
}
export const DEFAULT_CALIBRATION: CutTimeCalibration = { vScanMmS: 2532, tauSPerLine: 0.006217, kBurn: 0.916 };

export interface StageGeom { bboxW: number; bboxH: number; fillAreaMm2: number; perimeterMm: number; }
export interface StageRate { sliceNumber: number; repeat: number; speedMmS: number; densityLpc: number; }

// one stage's laser-on seconds
export function stageSeconds(g: StageGeom, r: StageRate, c = DEFAULT_CALIBRATION): number {
  const d = r.densityLpc / 10;                 // lines per mm
  const perSlice = d * (g.bboxW * g.bboxH) / c.vScanMmS
                 + d * g.bboxH * c.tauSPerLine
                 + c.kBurn * d * g.fillAreaMm2 / Math.max(1, r.speedMmS);
  return perSlice * Math.max(1, r.sliceNumber) * Math.max(1, r.repeat);
}
```

**Effective per-stage rate (must match what export writes).** A pure
`effectiveStageRate(groupName, generatedClass, config, sourceParams)` returns the
final `{sliceNumber, repeat, speedMmS, densityLpc}` resolved exactly as export
will: `resolveStageParams(config)[group]` over the selected target's
`sourceParams` (`XcsObject.params`), with the footgun-fix defaults (§F). When the
source carries no value for a field (`sourceParams` undefined or sparse — e.g.
`test-text.xcs` has `perimeter: null` and may lack a customize speed/density),
fall back to documented constants `RATE_FALLBACK = { speedMmS: 200, densityLpc:
300, sliceNumber: 100, repeat: 1 }` (the user's measured working regime) so the
estimate is never silently zero. The estimator and `buildGeneratedXcs` MUST
derive these the same way — share the
`resolveStageParams` helper so they cannot drift (a stage left at "inherit" must
estimate with the inherited value).

**Baseline.** `baselineSeconds` = the part cut as a *single 1×-beam kerf band*
(`bandFromRegion(part, beamWidthMm, sideMode)`) at the **source incise's**
resolved rate. This is "cut the outline once, the un-staged way" — the honest
denominator for "% overhead".

**Top-level (Forge adapter):**

```ts
// lib/forge/estimate.ts
export interface StageEstimate {
  groupName: string; generatedClass: GeneratedClass;
  pathCount: number; sliceNumber: number; repeat: number; speedMmS: number; densityLpc: number;
  perimeterMm: number; fillAreaMm2: number; seconds: number; pierces: number;
}
export interface ForgeEstimate {
  stages: StageEstimate[];
  totalSeconds: number; baselineSeconds: number; overheadPct: number;
  pierces: number; pocketCount: number; bandCount: number;
  budgetX: number; overBudget: boolean;
  worst: { groupName: string; seconds: number; pct: number }[]; // top 2–3, for the warning
}
export function estimateForge(
  paths: GeneratedPath[], part: Pt[][], config: ForgeConfig,
  sourceParams: StageParams | undefined, calib?: CutTimeCalibration,
): ForgeEstimate;
```

Perforation pockets share a `groupName` (`CUT_02_PERFORATE`) → one
`StageEstimate` aggregating all pockets (sum of seconds, `pathCount` = pocket
count). Each path/pocket = one pierce/start-stop.

### C. Pipeline wiring — `pipeline.ts` + `types.ts`

`runPipeline` already builds `part` and `paths`. After building them, compute
`estimate = estimateForge(ordered, part, cfg, obj.params)` and attach to
`DebugStats`:

```ts
// add to DebugStats:
estimate: ForgeEstimate;
```

`forge.worker.ts` already returns `stats` — no new message. (The empty-region
early-return path gets a zeroed estimate.)

### D. Estimate panel — `components/forge/ForgeEstimatePanel.tsx` (new)

A new `Card` mounted in the right column **above** `ForgeDebugPanel`
(`ForgePage.tsx` right flex column), same `font-mono text-[11px]` register:

- **Header line:** `Est. cut time  <total>  ·  <overheadPct>% of incise` with the
  % badged green ≤ budget, amber/red over budget.
- **Per-stage table:** stage · time (mm:ss) · % of total · slices×repeat ·
  pierces. Sorted by physical order; worst stage subtly emphasised.
- **Footer counts (option 9):** total pierces/start-stops, pocket count, band
  count, total fill-area mm². Baseline incise time shown for reference.
- Formatting helper `fmtDuration(seconds)` → `m:ss` / `h:mm:ss`.

(Counts that already live in `DebugStats.pathCounts` are reused; the panel does
not recompute geometry — it reads `stats.estimate`.)

### E. Budget warning — config + `pipeline.ts`

- `ForgeConfig.timeBudgetX: number | null` — multiplier vs baseline; `null` = off.
  Default **1.5**. UI: a `Select` in the ForgeControls **Global** card
  (`off / 1.25 / 1.5 / 2 / 3`).
- In `estimateForge`, `overBudget = timeBudgetX != null && overheadPct/100 > timeBudgetX`.
- When over budget, `runPipeline` pushes ONE warning into `stats.warnings`
  (so it surfaces in both the Validation card and the Debug panel, zero new
  wiring): e.g. *"Estimated cut ~3h10m = 9.2× a plain incise (budget 1.5×).
  Biggest: deepen-D 62m, clean 38m. Reduce slices/width, clean passes, or
  perforation density."* Built from `estimate.worst`.
- **Never blocks** — `canExport` is untouched.

### F. Footgun fix — `config.ts`, `types.ts`, `defaults.ts`, `ForgeStageParams.tsx`

Stop seed/perforate/clean inheriting the source's deep `sliceNumber`; give each a
shallow, explicit layer count that actually reaches the file.

- **Types/defaults:** add `layerCount` to `PerforateConfig` (default `2`) and
  `CleanConfig` (default `10`). `SeedConfig.layerCount` already exists.
- **Group-name constants:** extract `STAGE_GROUPS = { seed:"CUT_01_SEED",
  perforate:"CUT_02_PERFORATE", clean:"CUT_07_CLEAN" }` (currently string
  literals in `stages.ts`) so config and export reference one source of truth.
- **`resolveStageParams`:** in addition to the deepen rule, set the three fixed
  stages' `sliceNumber` from their config layer count, with an explicit
  per-stage override still winning:
  ```
  out[STAGE_GROUPS.seed]      = { ...sp.seed,      sliceNumber: sp.seed?.sliceNumber      ?? config.seed.layerCount };
  out[STAGE_GROUPS.perforate] = { ...sp.perforate, sliceNumber: sp.perforate?.sliceNumber ?? config.perforate.layerCount };
  out[STAGE_GROUPS.clean]     = { ...sp.clean,     sliceNumber: sp.clean?.sliceNumber     ?? config.clean.layerCount,
                                  repeat: sp.clean?.passes ?? config.clean.passes };  // wire the currently-dead clean.passes → repeat
  ```
  (`sp = config.stageParams`.) Only `sliceNumber`/`repeat` get defaults; all
  other laser params still inherit the source.
- **UI single-source-of-truth:** for non-deepen stages, the "Layer count
  (slices)" field in `ForgeStageParams` binds to the stage's
  `config.{seed,perforate,clean}.layerCount` (not `stageParams.sliceNumber`), and
  ForgeControls gains a "Layers" field for perforate and clean (seed already has
  one). The source-inherited `sliceNumber` pre-fill for these three stages is
  removed (it was the footgun).

### G. Lean default + presets + sparse perforation + cumulative relabel

- **Presets** — `lib/forge/presets.ts`: named `ForgeConfig` builders.
  - `LEAN` (new default): seed 2× / 3 layers; perforate **sparse** (spacing 4 mm,
    corners on); deepen = **one** enabled group `CUT_03_MAIN`, width 1×, with a
    static `toLayer: 256` (the main incise does the full-depth work in a single
    pass — the user tunes the number to their stock/recipe), plus an optional
    **disabled-by-default** wider relief group `CUT_04_RELIEF` (2×, 64 layers) as
    a one-click "add side-wall relief" affordance; clean both walls / 10 layers /
    1 pass. Net: ≈ baseline incise + a shallow seed + sparse perforation + a
    shallow clean (target ≈ 1.1–1.4× baseline, well under the 1.5× warning).
  - `AGGRESSIVE`: the current 1×/2×/4×/8× × 50/100/200/256 schedule (today's
    `DEFAULT_CONFIG`), preserved verbatim.
  - `ForgeConfig.activePreset?: "lean" | "aggressive" | "custom"`; editing any
    field flips it to `"custom"`. UI: a `Select` at the top of ForgeControls;
    choosing a preset replaces the staged config (with a confirm if `custom`).
  - `DEFAULT_CONFIG` becomes `LEAN`.
- **Sparse perforation (option 5):** `LEAN` uses `spacingMm: 4`; the generator is
  unchanged (already spacing-driven). (Outward "ticks/slots vs squares" is part
  of the vents follow-up, not this round.)
- **Cumulative-layer relabel (option 8):** in the Deepen table, relabel the `to`
  column header to **"cum. layers"** and add a one-line note: *"each group
  re-engraves from the surface (0) to this depth."* No behaviour change (it is
  already 0→toLayer); this removes the "50–100 / 100–200" range mental model.

### H. Config persistence / migration — `ForgePage.tsx`

- Bump `CONFIG_LS_KEY` `forge.config.v4 → v5` (default strategy + shape changed
  → discard stale saves so users land on `LEAN`). Add merge lines in
  `loadConfig` for the new nested fields (`perforate.layerCount`,
  `clean.layerCount`, `timeBudgetX`, `activePreset`).

## Testing

- `lib/cuttime/geometry.test.ts`: `ringsFillArea` (band annulus = outer−inner;
  pocket = square area), `ringsBBox`, `ringsPerimeter` on known rectangles.
- `lib/cuttime/model.test.ts` (reusable core): `stageSeconds` reproduces the
  Appendix-A probe times within ±10% (table-driven over all 13 probes incl. the
  validated `p13` = 20:32); `fmtDuration` formatting. No Forge imports in the
  test (guards the decoupling).
- `lib/forge/estimate.test.ts` (adapter): `estimateForge` totals = Σ stages;
  `overheadPct` vs baseline; `overBudget` flips at the threshold; pierce/pocket/
  band counts; `RATE_FALLBACK` used when `sourceParams` is absent.
- `config.test.ts`: `resolveStageParams` now sets seed/perforate/clean
  `sliceNumber` from their layer counts; explicit `stageParams[*].sliceNumber`
  still wins; deepen rule unchanged; `clean.passes → repeat`.
- `presets.test.ts`: `LEAN`/`AGGRESSIVE` shapes; `AGGRESSIVE` equals the prior
  `DEFAULT_CONFIG`; editing flips `activePreset` to `custom`.
- Round-trip (`xcs.test.ts`): a forged export's seed/perforate/clean carry the
  shallow `sliceNumber` (not the source's deep value).
- **Browser check (Chrome MCP, per project convention):** upload
  `test-text.xcs`; confirm the Estimate panel shows per-stage times + % vs
  baseline; switch Lean↔Aggressive and watch the total/% and the 1.5× warning
  appear on Aggressive; confirm export still enabled.
- **Empirical validation:** after build, export the `LEAN` and `AGGRESSIVE`
  defaults for the 30×20 fixture, open in Studio, and confirm the panel's totals
  track Studio within ~10% (one more probe round; the model is locked, this
  guards the end-to-end summation + the footgun fix).

## Risks

- **Model is calibrated at one scan angle (~15°) and on rectangles.** Curved/
  script geometry and other angles are approximated via `perpendicularExtentAt`.
  Mitigation: the panel labels the time "estimated"; the empirical-validation
  step checks a real forged export end-to-end; constants live in one block for
  easy re-fit.
- **Changing the default to LEAN changes shipped behaviour.** Intentional and
  flagged in the changelog; the AGGRESSIVE preset reproduces today's output
  exactly, and `v5` key reset means no silent mix of old/new saves.
- **Estimator/export drift.** Mitigated by sharing `resolveStageParams` between
  both and the round-trip test.
- **Blue-light / z-descent regime** (the user's real settings) untested for the
  burn constant; `p13_realbase.xs` validation pending (non-blocking; thin-band
  burn is a small term).

## Changelog

Major entry `changelog/2026-06-08-forge-time-aware.md`: Forge now estimates cut
time per stage and total, shows % over a plain incise, warns past a configurable
budget (default 1.5×), and ships a lean default strategy (the deep 1/2/4/8
schedule moves to an "Aggressive" preset). Body: the calibration story (time is
linear in slices/passes/density, weak in speed), the footgun fix, and a note to
re-verify cuts. Screenshot of the Estimate panel.

## Appendix A — calibration data

Probes generated by `/Users/jonzky/Documents/XTools/forge-cal/gen_probes*.py`
(Python `xcs_v2` emitter; one INTAGLIO even-odd kerf band, verbatim `customize`).
Reference `p01`: 30×20 mm part (~100 mm kerf), 0.1 mm band, 50 slices, 1 repeat,
300 mm/s, density 100. Studio (F2 Ultra) reported:

| probe | change vs p01 | time | ×p01 |
|---|---|---|---|
| p01_base | — | 3:16 | 1.00 |
| p02_slice100 | slice ×2 | 6:32 | 2.00 |
| p03_slice200 | slice ×4 | 13:04 | 4.00 |
| p04_repeat2 | repeat ×2 | 6:34 | 2.01 |
| p05_width_wide | band 0.1→1.0 mm | 6:05 | 1.86 |
| p06_width_024 | band 0.1→0.24 mm | 3:52 | 1.18 |
| p07_perim200 | part 30×20→60×40 | 10:34 | 3.23 |
| p08_speed600 | speed ×2 | 3:09 | 0.96 |
| p09_vanilla256 | slice 256 | 16:48 | 5.14 |
| p10_density200 | density ×2 | 6:34 | 2.01 |
| p11_speed100 | speed ÷3 (thin) | 3:51 | 1.18 |
| p12_wide_speed100 | 1 mm band + 100 mm/s | 12:04 | 3.69 |
| p13_realbase | user regime (pending) | ~20:37 pred | — |

Least-squares fit of the two-component raster model → `V_SCAN 2532`,
`TAU 0.006217`, `K_BURN 0.916`; predictions within ~6% on every probe.
