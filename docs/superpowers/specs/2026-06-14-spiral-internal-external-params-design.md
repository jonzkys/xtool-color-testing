# Spiral Cut — Internal/External classification + independent params

**Date:** 2026-06-14
**Status:** Design approved (Approach A)
**Area:** Forge → Spiral Cut (`web/src/lib/forge/spiral.ts`, `SpiralCanvas.tsx`, `ForgeStageParams.tsx`, `SpiralPage.tsx`, `config.ts`, `types.ts`)

## Goal

Distinguish **External** (the single largest connected body's outer silhouette) from **Internal** (everything else — holes/counters, other disconnected solid islands, and neck-split pieces) across the spiral cut, so that:

1. Internal pieces are cut **once**, not double-traced alongside the main path (fixes a bug with "split internal detail").
2. Internal and external arms render in distinct colours (external pink, internal amber).
3. The user can set laser params **independently** for External vs Internal via a `Main | Detail` tab in the param tray.

## Background / current state

- The spiral generates concentric-spiral `VECTOR_CUTTING` arms from a contour region (`buildFillRegion`/`buildPartRegion` → `spiralFromRegion` → `buildStrands`). Arms become `GeneratedPath`s with a `groupName`.
- Two groups exist today: `STAGE_GROUPS.spiral` = `CUT_08_SPIRAL` (pink) and `STAGE_GROUPS.spiralDetail` = `CUT_09_SPIRAL_DETAIL` (amber). `CUT_09` is currently populated **only** by neck-split lobes (`splitLobesAtNecks`).
- Holes/counters and disconnected solid islands are spiraled as part of the one whole-region pass and are currently labeled **main** (pink). There is no "internal" concept beyond neck-split.
- Per-group params live in `config.stageParams[groupName]`; `resolveStageParams` already makes `CUT_09` inherit `CUT_08` unless overridden. The param tray (`ForgeStageParams`) is `lockToGroup={CUT_08_SPIRAL}` on the Spiral page, so `CUT_09` params are **not editable** in the UI.
- Two bugs/limitations to fix:
  - **Double-trace:** neck-split spirals the peeled feature separately with a keep-out (`detailKeepOut = offsetRegion(detailUnion, channelWidth)`); the main's clipped edge lands exactly on the detail's outermost arm → coincident pink+amber ("original path traces alongside the detail").
  - **Render accuracy:** small internal pieces draw as a single loop in the schematic, not a real concentric spiral.

## Decisions (from brainstorming)

- **Classification:** Internal = *everything but the single largest connected body* — i.e. the largest component's holes/counters, every other disconnected solid component, and neck-split pieces. External = the largest component's outer silhouette spiral.
- **Approach A — "label, don't re-spiral":** keep the single whole-region spiral pass (correct hole venting + merge of adjacent pieces, no double-cut) and tag each arm by the boundary loop it grew from. (Approach B — separate external/internal regions spiraled independently — was rejected: adjacent pieces would double-vent the shared scrap.)
- **Param tabs:** `Main | Detail` tab strip; Detail inherits Main until a field is overridden; tabs appear only when internal arms exist.
- The group **string constants stay** (`CUT_08_SPIRAL` = external/main, `CUT_09_SPIRAL_DETAIL` = internal/detail) to preserve export layer names + persisted `stageParams` keys; only UI labels and what *feeds* `CUT_09` change.

---

## Architecture

### 1. Per-arm classification (spiral.ts)

Add a per-arm class `"external" | "internal"` produced by `spiralFromRegion`, derived from each strand's **seed loop** (the level-0 loop it grew from).

**`classifyLevel0(loops: Pt[][]): ("external" | "internal")[]`** (new helper in spiral.ts, uses `regionComponents` + `signedRingArea` from offset.ts):
- `comps = regionComponents(loops)`; pick the component with the max `|signedRingArea(comp[0])|` as the largest body.
- For each loop in `loops`: `"external"` iff it is the largest component's outer loop (`comp[0]`, by reference identity — `regionComponents` returns the same loop refs); otherwise `"internal"` (holes of the largest body, and all loops of every other component).

**`buildStrands` change:** accept an optional `seedClass?: ("external"|"internal")[]` indexed by `levels[0]`. Each `Strand` carries a `cls` field:
- Strands seeded at level 0 from `levels[0][i]` get `cls = seedClass[i]` (default `"external"` when no `seedClass`).
- Forked strands (a strand splits into multiple children) **inherit the parent strand's `cls`**.
- New mid-level strands (unmatched/bridge-rejected children seeding fresh strands) inherit the `cls` of the **nearest level-0 loop by centroid** (fallback `"internal"` if none) — these are rare in outside mode (small features appearing after the boundary recedes), and treating an isolated late-appearing loop as internal is the safe default.
- `buildStrands` returns `{ arm: Pt[], cls }[]` (was `Pt[][]`). Callers/tests updated.

**`spiralFromRegion`** returns `{ arms: Pt[][]; armClass: ("external"|"internal")[]; warnings: string[] }` (was `{ arms, warnings }`). It computes `seedClass = classifyLevel0(levels[0])` and passes it to `buildStrands`. `levels[0]` is the (possibly keep-out-clipped) region, so classification runs on the actual seeding loops — no stale index mapping.

### 2. generateSpiralPaths (spiral.ts)

```
region = spiralRegionFor(processingType, subpaths)
lobes  = splitNecks ? splitLobesAtNecks(region, …) : [{ region, kind: "main" }]
detailUnion   = unionRegions(detail lobes' regions)
detailKeepOut = detailUnion.length ? offsetRegion(detailUnion, channelWidthMm + GAP) : []   // GAP fix
for each lobe:
  if lobe.kind === "main":
     { arms, armClass } = spiralFromRegion(lobe.region, opts, detailKeepOut)   // honour armClass
     group per arm = armClass[i] === "internal" ? CUT_09 : CUT_08
  else:  // neck-split detail lobe → always internal
     { arms } = spiralFromRegion(lobe.region, opts)
     group = CUT_09 for all arms
collect → order (cutShortestFirst: internal group first, then external, each ascending) → stamp operationOrder
```

- **GAP** = `2 * pitchMm` (so the main's nearest arm sits ≥2 pitch from the detail's outermost arm — no coincident line; the thin scrap gap drops out). Defined as a module constant `NECK_GAP_PITCHES = 2`.
- **Ordering must key off the final per-arm class, not the lobe kind.** Internal arms now also come from the *main* lobe (holes/islands classified internal), so PR #137's sort changes from "lobe.kind === detail first" to "**class === internal first**, then external, each ascending by length" when `cutShortestFirst` is on. Collect `{ cls, arm }` then sort by `cls`.

### 3. Render colours + accuracy (SpiralCanvas.tsx)

- The schematic mirrors the generator: build the same lobes, but colour arms by the **same classification** (external pink `#ec4899`, internal amber `#f59e0b`) — so holes/counters, islands, and neck-split all render amber.
- Reuse `classifyLevel0` (export it from spiral.ts) to colour the main-lobe arms; detail lobes are all amber.
- **Render accuracy:** internal pieces must draw as a concentric spiral, not a single loop. The per-lobe `lobeBand` already scales the fan to the piece's size; additionally guarantee each internal piece draws **at least 3 concentric rings** (offset inward at a fraction of its own size, stopping at collapse) so the amber reads as a spiral rather than one outline.
- **Preview keep-out (mirror of the GAP fix):** the schematic uses exaggerated bands, so the main-lobe keep-out is `offsetRegion(detailUnion, lobeBand(detail) + gap)` (band + a small gap), NOT the literal `channelWidth + GAP` — so the pink pulls back past the amber's *drawn* fan and no pink hugs the amber.

### 4. Param tabs (ForgeStageParams.tsx + SpiralPage.tsx)

- `SpiralPage` computes `hasInternal = result.paths.some(p => p.groupName === STAGE_GROUPS.spiralDetail)` from the pipeline result.
- Replace `lockToGroup={CUT_08_SPIRAL}` with passing the spiral groups to show: `[CUT_08]` when no internal arms, `[CUT_08, CUT_09]` when `hasInternal`.
- `ForgeStageParams` renders a `Main | Detail` tab strip (reuse the `TabBar` primitive in `web/src/ui/Tabs.tsx`) over those groups; the active tab edits `config.stageParams[group]`. Labels: "Main" (CUT_08), "Detail" (CUT_09).
- Detail inheritance: unchanged — `resolveStageParams` already resolves `CUT_09` as `{ …CUT_08_resolved, …stageParams[CUT_09] }`. The Detail tab's fields show the inherited value as the effective default and write only overridden fields into `stageParams[CUT_09]`.

### 5. types.ts / config.ts

- No new `SpiralConfig` fields required (classification is derived). `STAGE_GROUPS` constants unchanged.
- `SpiralResult` type updated to include `armClass`.

---

## Data flow

contour → `spiralRegionFor` → region → `splitLobesAtNecks` (optional) → per lobe `spiralFromRegion` (returns arms + per-arm class via `classifyLevel0`+`buildStrands`) → group per arm (CUT_08 external / CUT_09 internal) → order → `GeneratedPath[]` → emitter (each group its own layer + params). Preview path mirrors the same classification for colours.

## Edge cases

- **No internal pieces** (a plain solid, no holes/islands, split off): all arms external; Detail tab hidden; identical to today.
- **Region with only holes, no neck-split:** holes labeled internal with zero geometry change (single pass) — no double-trace.
- **Two equal-largest bodies:** ties broken deterministically (first max by area); only one is external. Acceptable per the chosen rule.
- **Empty/degenerate arms, single arm, tiny region:** classification defaults safe (`"external"` when `classifyLevel0` finds one component); existing fallback (contour-only + warning) preserved.
- **`cutShortestFirst` off:** order = lobes/strand order; classification still applied for colours/params/groups.

## Testing

- `classifyLevel0`: largest outer → external; its holes → internal; smaller component → internal.
- `spiralFromRegion`: returns `armClass`; a region (big body + hole + small island) → exactly one external class on the big-body outer arm, internal on hole + island arms.
- `generateSpiralPaths`: holes/islands land in `CUT_09`, big-body outer in `CUT_08`; neck-split lobes → `CUT_09`.
- No-double-trace invariant (extends the PR #136/#137 test): with neck-split on, main arms keep ≥ GAP clear of the detail region (no main point within `channelWidth` of the detail; no coincident arm).
- Param round-trip: editing the Detail tab writes `stageParams[CUT_09]`; `resolveStageParams` resolves CUT_09 = CUT_08 ⊕ overrides.
- Browser (Amelia): counters/islands render amber, neck-split detail has no pink hugging it, Main/Detail tabs edit independently.

## Out of scope

- Per-piece (more than two) param groups. Two groups only (External/Internal).
- Changing the export/emit layer mechanism (each groupName already → its own layer + params).
- Inside-mode hole venting rework (the whole-region outside pass already vents holes correctly).
