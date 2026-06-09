# Forge — scrap-side relief vents + A/B/C/D comparison mode

**Status:** design for review (2026-06-09)
**Owner:** Jon
**Route:** `#/forge`
**Branch:** `feat/forge-relief-comparison` (off `main`); **two PRs** — see Implementation stages.
**Extends:** `2026-06-08-forge-time-aware-design.md` (cut-time model, estimator,
presets, footgun fix — shipped in PR #126, on `main`).

> This spec was adversarially reviewed against the merged code; line refs below
> are to that code in `web/src/lib/forge/` unless noted.

## Purpose

Forge can now *price* a strategy. This stage adds the two things needed to try to
**beat the user's known-good baseline on time + quality**:

1. **Scrap-side relief vents** — targeted relief at the spots a deep brass kerf
   chokes: sharp corners, and **near-gaps** (the scrap necks between near-touching
   script strokes, ring+dot decorations, i/j dots, necklace loops). The hypothesis
   they enable: with the kerf able to clear sideways, the **main incise can run
   leaner (fewer slices) and still cut through** — the only way a staged strategy
   can beat the baseline on time.
2. **An A/B/C/D comparison/experiment mode** — generate candidate strategies, price
   each with the estimator, export them as a cut-test batch, and record the one
   thing the estimator can't give: *did it cut through, and how clean is the edge.*

### The reframing that shapes this (from PR #126's calibration)

Studio's time estimate is motion-driven and **barely depends on speed**; it scales
with `slices × density × area`. "Beat on speed" can't come from cutting faster — a
staged strategy *adds* geometry, so it wins on time only if relief lets the **main
cut do less work and still cut through**. The comparison mode is an **experiment to
find the lean floor**, not a time optimiser. The estimator gives the time axis;
only a physical brass cut gives cut-through + quality. All vent thresholds are
heuristics to be tuned against real cut results.

Baseline of record (user's working "Cut out 3 mm" preset, F2 Ultra, **MOPA IR**):
100 layers, 100 % power, 200 mm/s, 300 lines/cm, 15°, 200 ns, 65 kHz, z-descent
every 10 layers × 0.08 mm. It cuts through 3 mm brass.

## Decisions (locked with the user)

- Both subsystems in one spec, **shipped as two PRs** (vents, then comparison).
- Vents placed auto at **corners + near-gaps**, over **all** loops of the part,
  never part-side.
- Vents **evolve the existing `perforate` stage** (add near-gap placement + a slot
  shape; keep uniform pockets as an option) — no new `GeneratedClass`. Internal
  class stays `"perforate"`, groupName stays `CUT_02_PERFORATE`; UI label gains
  "/ Relief".
- Comparison candidates **auto-seeded A/B/C/D from config, each editable**; B seeds
  at ~80 % of the resolved baseline slice count.
- **Lightweight per-candidate cut-result tracking** in `localStorage`.
- Folded-in bug-fix: `ForgeStageParams` laser fallback `?? "blue"` → `"red"`.

## Scope

A. **Vent geometry** — `nearGap.ts` detector + relief slots in `stages.ts`;
   `PerforateConfig` extensions; config v6; UI relabel + controls.
B. **Comparison mode** — a `requestId` on the worker protocol; `comparison.ts`
   candidate builder; `ForgeComparePanel`; export-all (serial queue);
   `localStorage` result tracking; `downloadBuf` filename refactor.
C. **Laser-default fix** (1 line) + probe-script label fix.

### Out of scope / follow-up
- A true medial-axis neck-finder (the sampled detector is v1).
- Backend persistence (results stay in `localStorage`).
- A distinct vent-vs-pocket count in `ForgeEstimate` (v1 shows the combined
  `pocketCount` relabeled; a split tally is a follow-up).

---

## A. Vent geometry (PR 1 — shippable on its own)

### A1. Near-gap detector — `web/src/lib/forge/nearGap.ts` (new, pure)

Input: the full part region `part: Pt[][]` (**all** loops — outer + holes +
disjoint islands — from `buildPartRegion`, `offset.ts:165`; the pipeline already
builds it in **mm** at `pipeline.ts:85` after `toMm`), `gapThresholdMm`,
`beamWidthMm`. Output: `NearGapAnchor[] = { pt: Pt; dirX: number; dirY: number }`
where `(dirX,dirY)` is the unit **channel direction** (along the scrap neck).

`inPart(pt)` (the scrap test) is **count-based even-odd**, orientation-agnostic —
never use ring area-sign (clipper hole winding varies, `offset.ts:231-233`):
```
inPart(pt) = (part.filter((loop) => pointInPolygon(loop, pt)).length % 2) === 1
```
(`pointInPolygon(poly, pt)` — polygon first — exists at `offset.ts:106`.)

Algorithm:
1. **Resample** every loop to a uniform arc-length step `h = gapThresholdMm/2`,
   tagging each sample `(loopIndex, sampleIndex, arcLen)`.
2. **Spatial grid** over all samples, cell size = `gapThresholdMm`, so each
   sample's candidate neighbours are the 3×3 cells around it → overall **O(n)**,
   not O(n²) (matters: a dense monogram is thousands of samples, re-priced up to
   4× in compare mode).
3. For each sample `s`, find the nearest sample `t` that is **non-adjacent**:
   a different loop, OR the same loop with **arc-length separation
   `> π·gapThresholdMm`** (so the tightest convex curve that legitimately fits the
   gap — a half-disc of radius `gapThreshold/2` — is never flagged; a fixed sample
   count is wrong).
4. **Sub-sample refine**: project `s` onto the boundary *segment* at `t` (and vice
   versa) to get the true minimum distance `d` before thresholding (avoids
   resample-resolution false +/−).
5. If `d < gapThresholdMm` **and** `!inPart(m)` where `m = (s+t)/2`, record a
   near-gap: anchor `pt = m`, **channel direction `dir = unit(perp(t−s))`** (the
   direction *along* the neck; the chord `t−s` crosses it). This is the corrected
   orientation — the from-interior-toward-m vector points *across* the neck and is
   wrong.
6. **Dedup** by neck identity (`{min,max} loop-pair` + bucketed arc position),
   *not* a flat radius, so two parallel necks closer than `gapThresholdMm` both get
   a vent.

Pure (sampling + grid + distance + point-in-polygon; no clipper). Unit-tested on
synthetic fixtures (A "Testing").

### A2. Relief stage — extend `generatePerforationPaths` (`stages.ts:60`)

Keeps `generatedClass:"perforate"`, `groupName: STAGE_GROUPS.perforate`. Changes:

- **Cover all loops.** Today the stage anchors only on `partOuterLoop(part)` (a
  single largest ring, `stages.ts:67`) — it can't see holes/islands. Iterate
  `detectCorners` (`contour.ts:290`, takes a `Contour`) + `sampleLoopWithNormals`
  (`offset.ts:247`) over **every loop of `part`**, so corner/edge anchors appear on
  inner loops too (this also fixes the known "pockets on largest island only"
  limitation noted in the incise-only design).
- **Near-gap anchors** (when `perforate.nearGap`): from `detectNearGaps(part, …)`,
  merged with the corner/edge anchors.
- **Slot shape** (when `perforate.shape === "slot"`): emit a **kerf-wide filled
  rectangle of length `slotLengthMm`** centered on the anchor, oriented:
  - corner/edge anchors → along the loop's **outward normal** (`outwardNormalAt`,
    `offset.ts:279`, or the normal `sampleLoopWithNormals` already returns);
  - near-gap anchors → along the anchor's **channel `dir`** (perp to the chord).
  `shape:"pocket"` keeps today's square (default `"pocket"`; LEAN preset `"slot"`).
- **Slot-body part-side guard** (replaces the single-point test): emit the slot
  only if **both ends and all four corners** of the rectangle satisfy `!inPart`
  (else shrink `slotLengthMm` until they do, or skip the anchor). The
  midpoint-only test does **not** guarantee "never bites the part" on thin walls.
- Slots/pockets inherit the shallow `perforate.layerCount` (PR #126). Scrap-side
  bias (`outsideBias`) unchanged.

### A3. Config — `PerforateConfig` (`types.ts:65`) + `defaults.ts`/`presets.ts` + `ForgePage.tsx`

Add to `PerforateConfig` (all with defaults so old saves load): `shape:
"pocket"|"slot"` (default `"pocket"`; LEAN `"slot"`), `nearGap: boolean` (default
`false`; LEAN `true`), `gapThresholdMm: number` (default `1.5`), `slotLengthMm:
number` (default `0.8`). Set them on `LEAN.perforate` and `AGGRESSIVE.perforate`
(`presets.ts:21,38`). **`CONFIG_LS_KEY` (`ForgePage.tsx:41`) v5 → v6** (perforate
shape changed). `loadConfig` (`ForgePage.tsx:54`) already merges
`{ ...DEFAULT_CONFIG.perforate, ...(p.perforate ?? {}) }`, sufficient for the new
flat fields; the v6 bump discards old saves anyway.

### A4. UI — `ForgeControls.tsx` Perforate card → "Perforate / Relief"

Relabel; add: Shape select (pocket/slot), Near-gap vents toggle, Gap threshold
(mm), Slot length (mm). Existing controls stay. Route through `patch` (→
`activePreset:"custom"`).

### C (ships with PR 1). Laser-default fix

`ForgeStageParams.tsx:111` `laserValue()` fallback `?? "blue"` → `?? "red"`. (Note:
`readStageParams` narrows source laser to `red|blue|undefined` (`xcs.ts:27`), so
the fallback only fires when the source value is absent/unrecognised — correct for
the F2 Ultra MOPA workflow.) Also fix `processing_light_source="blue"` →
`"red"` in `~/Documents/XTools/forge-cal/gen_probes3.py` (label only; the
time model is light-source-independent, no re-run needed).

---

## B. Comparison / experiment mode (PR 2 — depends on the worker-id change)

### B0. Worker request correlation — `forge.worker.ts`

The worker protocol (`forge.worker.ts:14-29`) has **no request id**, and
`ForgePage`'s `onmessage` dispatches purely on `msg.type` (`ForgePage.tsx:138`),
so 4 fan-out candidate prices/exports would clobber each other. Add an optional
`requestId?: string` to `ForgeRequest` and echo it on `ForgeResponse`. The Compare
panel keeps its own response router (a `Map<requestId, resolve>` promise table)
on the **shared** worker — it does **not** reuse the page's type-only handler.
(`runPipeline` is pure, but the parsed file lives only in the worker's module
scope, so pricing must round-trip the worker, not call `runPipeline` on the main
thread.)

### B1. Candidate builder — `web/src/lib/forge/comparison.ts` (new, pure)

```
buildComparisonCandidates(config, sourceParams) → Candidate[]
  Candidate = { id:"A"|"B"|"C"|"D"; label; config: ForgeConfig; readOnly }
```
`sourceParams: StageParams | undefined = parsed.objects.find(id===inciseId)?.params`
(`xcs.ts:166`; every field optional). Resolve the baseline rate with the **same
fallbacks the estimator uses** (`estimate.ts:44-55`, `cuttime/model.ts:37-42`):
```
baselineSlices  = sourceParams?.sliceNumber ?? 100   // RATE_FALLBACK.sliceNumber
baselineDensity = sourceParams?.density     ?? 300   // RATE_FALLBACK.densityLpc
baselineSpeed   = sourceParams?.speed       ?? 200   // RATE_FALLBACK.speedMmS
```
Each candidate is built from a **clean base** — COMMON-style scalars +
`stageParams: {}` + a **freshly-constructed single main deepen group** with a
**fixed synthetic name `"CUT_03_MAIN"`** (do **not** reuse the live
`config.deepen.groups` — AGGRESSIVE has 4 differently-named groups; a stale
`stageParams` could also override the lean slices via `resolveStageParams`).
Field mapping for the levers:
- **slices** → `mainGroup.toLayer` (→ `sliceNumber` via `resolveStageParams`,
  `config.ts:81`).
- **density / speed** → `stageParams["CUT_03_MAIN"] = { density, speed }`
  (`DeepenGroup` has no density/speed field; `effectiveRate` reads `stageParams`,
  `estimate.ts:44-55`).

Candidates:
- **A — Baseline** (`readOnly`): main `toLayer = baselineSlices`,
  `stageParams.CUT_03_MAIN = { density: baselineDensity, speed: baselineSpeed }`,
  width 1×; seed/perforate/clean `enabled:false`. Built this way, **A's
  `totalSeconds` equals the `baselineSeconds`** every estimate already computes
  (`estimate.ts:64-72`) — use that as the shared Δ denominator (it's identical
  across candidates), and assert the equality in tests.
- **B — Lean main:** `toLayer = round(baselineSlices × 0.8)`, same density/speed;
  extras off.
- **C — B + relief:** B with `perforate` enabled, `shape:"slot"`, `nearGap:true`,
  sparse.
- **D — C + clean:** C with `clean` enabled.

### B2. Pricing — reuse the estimator via the worker

The panel posts an id-tagged `generate` per candidate; the worker returns
`{ type:"generated", requestId, result }` and the panel reads
`result.stats.estimate` (a `ForgeEstimate`, `estimate.ts:74`). Δ vs A = each
candidate's `totalSeconds − baselineSeconds` (abs + %). No new estimation code.

### B3. UI — `web/src/components/forge/ForgeComparePanel.tsx` (new)

A toggle switches the right column between **Edit** (today's controls) and
**Compare**. One row/card per candidate:
- label, **predicted time** (`fmtDuration`), **Δ vs A** (abs + %), green when
  `< A` (caveat line: *a green time only wins if it cuts through — record below*);
- inline editable for B/C/D: **slices**, **density**, **relief** on/off, **clean**
  on/off → edits re-price that candidate live (debounced; one worker round-trip);
- structural metrics from the estimate: pierces, bands, and **`pocketCount`
  labeled "relief features (pockets+slots)"** (the estimate can't separate vents
  from pockets — both are class `"perforate"`; a split count is a follow-up);
- a per-candidate **outcome** row (B5);
- **Export all**.

### B4. Export-all — serial queue, named files

`fileStem = state.fileName.replace(/\.(xcs|xs)$/i, "")` (`state.fileName`,
`ForgePage.tsx:75`). **Refactor `downloadBuf` (`ForgePage.tsx:209`)** to accept a
filename (it currently hard-codes `contour-forge.xs/.xcs`). For each enabled
candidate, post an id-tagged `export` request **serially** (await each
`exported` response before the next — the single worker shares `parsed` module
state) and download as **`‹fileStem›-‹id›.xs`** (e.g. `part-A.xs … part-D.xs`).
Use the stable `id` (A/B/C/D), **not** a mutable "lean80" tag that goes stale when
the user edits B's slices; show a progress indicator.

### B5. Result tracking — `localStorage`

Key `forge.compare.results.v1`, map keyed
**`‹fileStem›|‹sourceHash›|‹id›`** where `sourceHash` is a short `sha256`
(`lib/forge/sha256.ts` exists) of the selected source contour's `dPath` — so two
different files sharing a stem don't cross-contaminate results. Value
`{ cutThrough:"yes"|"no"|"partial"|""; note:string; predictedSeconds:number; ts:number }`.
Each row has a cut-through select + short note; edits persist immediately. A
**"Copy as markdown"** button emits `candidate · predicted · Δ · cut-through ·
note`. No backend.

---

## Testing

- `nearGap.test.ts`: **ring+dot** (dot as a disjoint loop inside a ring's two
  loops) → one near-gap anchor in the annular scrap, `inPart` false there, none
  inside any part loop; **near-touching bars** (two rects with a thin scrap gap) →
  anchor in the gap with `dir` *along* the channel (perp to the chord); **lone
  convex blob / small letter bowl** → no near-gap (arc-length adjacency guard);
  **two parallel necks < gapThreshold apart** → two anchors (neck-keyed dedup);
  sub-sample refinement: a neck just over/under threshold classifies correctly.
  Assert which `buildPartRegion` branch each fixture exercises so all rings are
  present for the even-odd test.
- `stages.test.ts`: slot shape emits an outward kerf-wide rectangle (corner) /
  channel-aligned rectangle (near-gap); **slot-body guard** rejects/shrinks a slot
  whose end or corner is in-part; corner anchors now appear on inner loops;
  `shape:"pocket"` + `nearGap:false` reproduces today's output exactly.
- `comparison.test.ts`: `sourceParams` undefined → `baselineSlices/Density/Speed`
  fall back to 100/300/200 (no NaN); A's config built so `A.totalSeconds ≈
  estimate.baselineSeconds`; B `toLayer = round(baseline×0.8)`; C adds relief
  (`slot`,`nearGap`); D adds clean; candidates use a clean `stageParams:{}` and the
  synthetic `CUT_03_MAIN`; density lever writes `stageParams.CUT_03_MAIN.density`.
- worker test: a `generate`/`export` with `requestId` echoes it back; two
  interleaved ids route to the right resolvers.
- `ForgeComparePanel` test: renders A–D with times + Δ; editing B's slices
  re-prices; outcome persists to `localStorage` under the hashed key; export-all
  posts N serial id-tagged export requests and names files `‹stem›-‹id›.xs`.
- Browser check (Playwright): upload `test-text.xcs`; Edit mode → relief slots
  land in the ring+dot gaps and between strokes (colour-coded), none on the part;
  Compare mode → A–D times + Δ, edit B, export-all (4 named files), set an outcome
  and reload → persists.
- Full `tsc` + `vitest` + `pytest` green; build green.

## Risks

- **Near-gap precision.** Heuristic; the hardened guards (slot-body `inPart`,
  arc-length adjacency, sub-sample refine) make a *wrong* vent harmless (never
  part-side) and thresholds are user-tunable + cut-test-refined. Medial-axis is the
  follow-up.
- **`buildPartRegion` branch coverage** — even-odd `inPart` needs every hole/island
  ring present; tests pin the branch (Difference vs even-odd Union, `offset.ts:180`)
  per fixture.
- **Perf** — O(n) via the spatial grid; compare mode re-prices ≤4× through the
  debounced worker. State a sample-count ceiling and verify on a dense monogram.
- **Candidate-A parity** — A's `totalSeconds` must equal `estimate.baselineSeconds`
  by construction (tested); otherwise Δ-vs-A and the panel's `% of incise` disagree.
- **Worker-id change touches the shared protocol** — additive (`requestId?`
  optional), the page ignores it, the panel routes on it.
- **Result-key collisions** — mitigated by the `sourceHash` segment.

## Implementation stages → **two PRs**

1. **PR 1 — Vents (+ laser fix):** `nearGap.ts` + detector tests → relief
   slots/all-loop anchors in `stages.ts` → `PerforateConfig`/defaults/presets (v6)
   → UI controls → laser-default fix. Self-contained: vents visible in preview +
   export, no worker/protocol change. Ship + cut-test before PR 2.
2. **PR 2 — Comparison:** worker `requestId` (B0) → `comparison.ts` →
   `ForgeComparePanel` + `downloadBuf` refactor → export-all serial queue →
   `localStorage` results. Builds on PR 1's relief stage for candidates C/D.

## Changelog

PR 1: major `changelog/2026-06-09-forge-relief-vents.md` — scrap-side relief vents
(auto at corners + near-gaps over all loops, never part-side). PR 2: major
`changelog/2026-06-09-forge-comparison.md` — A/B/C/D comparison (price candidates,
export a cut-test batch, record what actually cut). Screenshots; Workshop-Instrument
voice.
