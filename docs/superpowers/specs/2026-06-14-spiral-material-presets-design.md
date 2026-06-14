# Spiral Cut — brass-thickness presets + per-thickness baselines

**Date:** 2026-06-14
**Status:** Design approved
**Area:** Forge → Spiral Cut (`web/src/pages/SpiralPage.tsx`, a new `MaterialSelector`, `web/src/lib/forge/{types,presets,pipeline,estimate}.ts`, `SpiralControls.tsx`)

## Goal

Let the user pick a **brass thickness** (1, 1.5, 2, 3, 4 mm) on the Spiral Cut page. Each thickness owns its own saved spiral preset (all the cut settings) **and** its own baseline for the "% of incise" comparison. Initially every thickness shares the current `SPIRAL_CUT` defaults; the user diverges them later by tuning each independently.

## Background / current state

- The Spiral page holds ONE `ForgeConfig`, loaded/saved via `localStorage` key `spiral.config.v1` (`SpiralPage.tsx::loadConfig`, floored on `SPIRAL_CUT`, merging persisted `spiral.*`, `beamWidthMm`, `mmPerUnitOverride`, `stageParams`).
- There is **no** thickness/material concept anywhere in the spiral UI.
- The "% of incise vs baseline" readout (`ForgeEstimateStrip`, `variant="spiral"`) comes from `estimate.ForgeEstimate.overheadPct` / `baselineSeconds`. The baseline is **computed** by `estimate.ts::baselineSeconds(part, config, source, calib)` = the part cut as a single 1×-beam kerf band at the **source incise's** rate (`effectiveRate(undefined, source)`), where `source` is the imported object's `StageParams`. `pipeline.ts:172` calls `estimateForge(forEstimate, activeRegion, cfg, obj.params)` — so the baseline today tracks the *imported file's* incise params, not the brass thickness.
- `PRESETS = { lean, aggressive, spiral }` (`presets.ts`); `SPIRAL_CUT` is the spiral preset.

## Decisions (from brainstorming)

- **Thicknesses:** fixed list `[1, 1.5, 2, 3, 4]` mm brass.
- **Persistence:** *per-thickness, saved independently.* Selecting a thickness loads ITS config; editing saves back to THAT thickness; each persists across sessions; switching swaps the live config.
- **Baseline:** *per-thickness incise params → auto baseline.* Each thickness carries its own incise rate (`speed`, `passes`); the existing auto baseline uses it (overriding the imported `source`), so the comparison is thickness-appropriate. No manual time entry.
- **Defaults now:** all five thicknesses start identical to `SPIRAL_CUT` + a shared default `baselineIncise`; the user tunes each later via the existing controls (which save per-thickness).

---

## Architecture

### 1. Types + materials list (`types.ts`)

- `export type MaterialThicknessMm = 1 | 1.5 | 2 | 3 | 4;`
- `export const MATERIAL_THICKNESSES_MM: MaterialThicknessMm[] = [1, 1.5, 2, 3, 4];`
- Add to `SpiralConfig` (so it travels with the per-thickness config and resolves in the pipeline):
  ```ts
  /** Reference incise rate for the "% of incise" baseline comparison, per brass
   *  thickness. Overrides the imported source's params when computing the baseline. */
  baselineIncise: { speed: number; passes: number };
  ```

### 2. Defaults (`presets.ts`)

- `SPIRAL_CUT.spiral.baselineIncise = { speed: 1500, passes: 1 }` — a sensible shared default: a **single-pass** incise band (the baseline is a 1×-beam kerf reference, so `passes: 1` ≈ the prior source-derived baseline, ~96 min / ~40% for Amelia). NB: `passes` here is the *incise* pass count for the comparison reference, NOT the spiral's pass count — a high value (e.g. 500) would multiply the raster baseline into hundreds of hours. Same value goes on the `COMMON.spiral` literal so the field exists on every config. The user raises `passes`/lowers `speed` per thickness as deep brass warrants.

### 3. Baseline override (`pipeline.ts` + `estimate.ts`)

- `estimate.ts::estimateForge` and `baselineSeconds` already accept a `source: StageParams`. Add an explicit **baseline rate** rather than hijacking `source`:
  - Change `baselineSeconds(part, config, source, calib)` to derive its rate from `config.spiral.baselineIncise` when present: `effectiveRate({ speed: config.spiral.baselineIncise.speed, passes: config.spiral.baselineIncise.passes } as StageParams, source)`. (Falls back to `source` for any unset field.)
  - No signature change needed to `estimateForge` — it reads `config.spiral.baselineIncise` internally. `pipeline.ts:172` stays `estimateForge(forEstimate, activeRegion, cfg, obj.params)`.
- Result: the baseline (and thus `overheadPct` / "vs baseline") reflects the active thickness's incise rate.

### 4. Page state + persistence (`SpiralPage.tsx`)

- Replace the single-config model with a per-thickness map.
- New localStorage key `spiral.material.v1`:
  ```ts
  { activeThicknessMm: MaterialThicknessMm, configs: Record<string, ForgeConfig> }
  ```
  (`configs` keyed by the thickness number as a string, one full `ForgeConfig` each.)
- `loadMaterialState()`:
  1. If `spiral.material.v1` exists, parse it; for each thickness in `MATERIAL_THICKNESSES_MM`, floor on `SPIRAL_CUT` and merge the saved per-thickness fields (same field set today's `loadConfig` merges: `spiral.*`, `beamWidthMm`, `mmPerUnitOverride`, `stageParams`), enforcing `spiral.enabled = true`, `activePreset = "spiral"`.
  2. Else, **migrate**: read the old `spiral.config.v1`; seed EVERY thickness from it (or from `SPIRAL_CUT` if absent); set `activeThicknessMm = 1`. Persist the new key and remove `spiral.config.v1`.
- State: `const [material, setMaterial] = useState(loadMaterialState)`. The live `config` = `material.configs[String(material.activeThicknessMm)]`.
- `setConfig(next)` writes back to `material.configs[active]` and persists the whole `material` object.
- `setActiveThickness(mm)` switches the active key and persists (no merge/overwrite of others).

### 5. UI — `MaterialSelector` (new component) + placement

- New `web/src/components/forge/MaterialSelector.tsx`: a compact segmented control (reuse the workshop styling; `TabBar`-like buttons) — label "Brass", options `1 · 1.5 · 2 · 3 · 4 mm`. Props `{ value: MaterialThicknessMm; onChange: (mm) => void }`.
- Placement: top of the right rail in `SpiralPage`, ABOVE the "Cut geometry" card (it governs everything below).
- `SpiralControls.tsx`: add a **"Baseline incise"** row (two `NumberField`s: speed mm/s, passes) in the Cut-geometry card, bound to `config.spiral.baselineIncise`, so the per-thickness baseline is tunable in the UI.

### 6. Estimate strip

- No change needed — it reads `estimate.overheadPct` / `baselineSeconds`, which now reflect the thickness. (Optional nicety: the caption could note the active thickness, but out of scope.)

---

## Data flow

select thickness → `material.activeThicknessMm` → live `config` = `configs[mm]` → drives `runPipeline`/preview/export as today; estimate's baseline now uses `config.spiral.baselineIncise`. Edits → `setConfig` → `configs[mm]` → persisted. All five configs persist independently under `spiral.material.v1`.

## Edge cases

- **First load, no old key:** all thicknesses = `SPIRAL_CUT` defaults; active = 1 mm.
- **Migration from `spiral.config.v1`:** every thickness seeded from the old single config (so a returning user keeps their tuning on all thicknesses), old key removed.
- **Corrupt/partial localStorage:** fall back to `SPIRAL_CUT` per thickness (try/catch, same as today's `loadConfig`).
- **`baselineIncise` missing on an old persisted config:** floored from `SPIRAL_CUT` default in the merge.
- **Switching thickness mid-edit:** edits already saved to the previous thickness on each change; switch just swaps — no data loss, no overwrite.

## Testing

- **Migration:** seeding `spiral.config.v1` then loading produces all 5 thicknesses from it and removes the old key.
- **Per-thickness persistence:** set thickness=2 mm, change channelWidth; switch to 4 mm (unchanged default); switch back to 2 mm (change retained); reload (persists).
- **Baseline override:** two thicknesses with different `baselineIncise` → `estimateForge` yields different `baselineSeconds`/`overheadPct` for the same part.
- **Defaults:** fresh load → every thickness equals `SPIRAL_CUT` (+ default baselineIncise).
- **Browser:** segmented selector switches; editing one thickness leaves others untouched; baseline-incise field updates "% of incise"; persists across reload.

## Out of scope

- Distinct *tuned* values per thickness (user fills later).
- Materials other than brass; arbitrary/custom thicknesses.
- Showing the active thickness in the estimate caption.
- Any change to the export format (the active thickness just produces a normal spiral export).
