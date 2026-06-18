# Spiral Test — selectable X/Y axis parameters

**Status:** design approved (brainstorm 2026-06-18)
**Builds on:** the Spiral Test page (PR #159, merged) — `#/spiral-test`.

## Goal

Let the user choose *which* parameter each axis of the Spiral Test grid sweeps,
instead of the fixed channel-width (X) × pitch (Y). Each cell's spiral is
generated and cut with that cell's `(x-param, y-param)` values; every other
sweepable param stays fixed from the panel. X and Y are independently
selectable from a common set, and may be any two distinct params — e.g.
channel width on X and focus-per-step on Y.

## Sweepable parameters

Two kinds:

- **Geometry** — change the spiral shape (fed to `spiralFromRegion`): channel
  width, pitch.
- **Profile** — change the `VECTOR_CUTTING` cut settings only (the spiral shape
  is unchanged): speed, passes, power, frequency, pulse width, focus per-step
  amount, focus interval (every-N-passes).

The focus descent's **initial drop** stays fixed (not sweepable). **Diameter**
stays fixed so all cells share one size and the grid is uniform.

### The registry (`web/src/lib/forge/spiralParams.ts`, new)

One entry per sweepable param — the single source of truth for label, unit,
display precision, kind, clamp, and how a value maps into geometry options or
`StageParams`.

| key | label | unit | dp | kind | clamp | maps to |
|---|---|---|---|---|---|---|
| `channelWidth` | Channel width | mm | 2 | geometry | ≥ `minChannelMm` | spiral `channelWidthMm` |
| `pitch` | Pitch | mm | 3 | geometry | > 0 | spiral `pitchMm` |
| `speed` | Speed | mm/s | 0 | profile | ≥ 1 | `StageParams.speed` |
| `passes` | Passes | × | 0 (int) | profile | ≥ 1 (round) | `StageParams.passes` + arm `layerEnd` |
| `power` | Power | % | 0 | profile | 0–100 | `StageParams.power` |
| `frequency` | Frequency | kHz | 0 | profile | ≥ 1 | `StageParams.frequency` (→ `mopaFrequency`) |
| `pulseWidth` | Pulse width | ns | 0 | profile | ≥ 0 | `StageParams.pulseWidth` |
| `focusStep` | Focus / step | mm | 2 | profile | ≥ 0 | `StageParams.descentPerStep` |
| `focusInterval` | Focus interval | passes | 0 (int) | profile | ≥ 1 (round) | `StageParams.descentIntervalDescent` |

Registry entry shape (illustrative):

```ts
export type ParamKey =
  | "channelWidth" | "pitch" | "speed" | "passes" | "power"
  | "frequency" | "pulseWidth" | "focusStep" | "focusInterval";

export interface ParamDef {
  key: ParamKey;
  label: string;          // "Channel width"
  abbrev: string;         // title abbrev, e.g. "CW"
  unit: string;           // "mm", "mm/s", "kHz", "ns", "%", "passes", "×"
  dp: number;             // decimal places for axis label + title
  kind: "geometry" | "profile";
  clamp: (v: number) => number;   // e.g. v => Math.max(1, Math.round(v))
}

export const PARAMS: Record<ParamKey, ParamDef>;
export const PARAM_ORDER: ParamKey[];        // stable order for selects
export function formatValue(key: ParamKey, v: number): string; // toFixed(dp)
```

Abbreviations for the fixed-param summary in the title: `CW` channel width,
`PT` pitch, `S` speed, `PA` passes, `P` power, `F` frequency, `PW` pulse width,
`FS` focus/step, `FI` focus interval. Plus always-fixed `D` diameter and `ID`
initial drop.

## Config model (`SpiralTestConfig`)

Replaces the old `channelWidth`/`pitch` (`AxisSpec`) + `cut` block:

```ts
interface SpiralTestConfig {
  xParam: ParamKey;
  yParam: ParamKey;                 // must differ from xParam
  xAxis: AxisSpec;                  // { min, max, steps } for the X param
  yAxis: AxisSpec;                  // { min, max, steps } for the Y param
  fixed: Record<ParamKey, number>;  // value used when a param is NOT on an axis

  diameterMm: number;
  side: "outside" | "inside";
  minChannelMm: number;
  gapMm: number;
  bedMm: { w: number; h: number };
  focusInitialMm: number;           // fixed initial drop (not sweepable)
  laser: "red" | "blue" | "uv";     // cut laser (fixed)

  labels: { show: boolean; titlePrefix: string };
  score: {                          // label-engrave op — unchanged from PR #159
    laser: "red" | "blue" | "uv"; power: number; speed: number; passes: number;
    linesPerCm: number; scanMode: "bidirectional" | "unidirectional";
    pulseWidth: number; frequency: number;
  };
}
```

`AxisSpec` (`{ min, max, steps }`) and `resolveAxis` are unchanged.

No migration: the page holds config in `useState` with no persistence, so only
`DEFAULT_CFG` changes. `DEFAULT_CFG` reproduces today's behaviour:
`xParam:"channelWidth"`, `yParam:"pitch"`, `xAxis:{0.6,1.0,4}`,
`yAxis:{0.03,0.05,4}`, and `fixed` = `{ channelWidth:0.8, pitch:0.04,
speed:1500, passes:250, power:100, frequency:65, pulseWidth:80, focusStep:0.06,
focusInterval:20 }`, `diameterMm:10`, `focusInitialMm:0.01`, `laser:"red"`,
`side:"outside"`, `minChannelMm:0.4`, `gapMm:4`, `bedMm:{300,300}`, the prior
`labels`/`score` defaults.

## `buildSpiralTest`

For each cell `(col i, row j)`:

```
paramMap = { ...cfg.fixed, [cfg.xParam]: xVals[i], [cfg.yParam]: yVals[j] }
```
where `xVals = resolveAxis(cfg.xAxis)`, `yVals = resolveAxis(cfg.yAxis)`,
clamped per the registry `clamp`.

- **Geometry**: `spiralFromRegion(region, { channelWidthMm: paramMap.channelWidth,
  pitchMm: paramMap.pitch, side: cfg.side, minChannelMm: cfg.minChannelMm })`.
- **Cell size**: `diameterMm + 2 * maxChannel + gapMm`, where `maxChannel` is the
  max channel-width value used anywhere in the grid (the swept range if channel
  width is an axis, else `fixed.channelWidth`). Keeps the grid uniform.
- **Profile**: a `StageParams` built from the profile params in `paramMap`
  (`power, speed, passes, frequency, pulseWidth`, `descentPerStep =
  paramMap.focusStep`, `descentIntervalDescent = paramMap.focusInterval`) plus
  the always-fixed `laser`, `cuttingDrop:true`, `sinkingMethod:"step"`,
  `firstCuttingDropValue = cuttingDropValue = cfg.focusInitialMm`. Each arm's
  `layerEnd = paramMap.passes`.

**Profile dedup / grouping.** Cells are grouped by a stable key over their
profile-param subset of `paramMap` (a deterministic JSON of the rounded profile
values). Each distinct group gets a `groupName` `CUT_<n>` (n = 0,1,2… in first-
appearance order) and one `StageParams`. Each cell's arms are emitted as
`GeneratedPath`s with that `groupName`. Consequences:

- geometry-only sweep (e.g. channel × pitch) → **one** group/profile (today's
  behaviour),
- mixed (one geometry axis, one profile axis) → **N** groups (one per distinct
  profile value),
- profile × profile → up to **N×M** groups.

`buildSpiralTest` returns the per-group params so the export stays dumb:

```ts
interface SpiralTestResult {
  cells: CellInfo[];                 // gains xValue, yValue, groupName
  cutPaths: GeneratedPath[];         // one per arm, groupName = CUT_<n>
  stageParams: Record<string, StageParams>;   // keyed by groupName
  labelOutlines: LabelOutline[];
  footprintMm: { w: number; h: number };
  overBed: boolean;
  warnings: string[];
}
```

## Export (`spiralTestXs.ts`)

`buildSpiralTestXs` passes `result.cutPaths` + `result.stageParams` straight to
`buildGeneratedXcs` (which already groups by `groupName` and applies per-group
`StageParams`, naming displays/layers by group). Each distinct profile becomes
its own `VECTOR_CUTTING` profile/layer in the `.xs` — exactly how Studio
represents distinct cut settings. Label glyphs are still appended as filled
`FILL_VECTOR_ENGRAVING` displays exactly as in PR #159. No other export change.

## Labels & title

Axes render **numeric values only** (no rotated text — `textPaths` is
horizontal), formatted at each param's registry precision. The axis identity
lives in the **title**:

```
[prefix]  X:<xLabel>  Y:<yLabel>   D:<diam> ID:<initial> <off-axis abbrev:val ...>
```

- `X:<xLabel>` / `Y:<yLabel>` use the full param labels.
- The trailing summary lists only the params **not** on an axis (the swept ones
  vary per cell), using the abbreviations above, always including `D`
  (diameter) and `ID` (initial drop).
- `composeTitle(cfg)` is rewritten accordingly; the optional free-text prefix is
  prepended with two spaces as before.

Layout (margins, diameter-aware sizing, descent-aware top band) is otherwise
unchanged from PR #159. `CellInfo` carries `xValue`/`yValue`; X axis shows
`formatValue(xParam, xVals[i])` under each column, Y axis shows
`formatValue(yParam, yVals[j])` down each row.

## Controls

- **Left rail — AXES** (replaces "GRID"): X-param `<Select>` + min/max/steps;
  Y-param `<Select>` + min/max/steps. The Y select omits the current X choice
  and vice versa (distinct axes enforced). Each axis keeps a resolved-values
  readout (e.g. `0.60, 0.73, 0.87, 1.00`). Circle & layout (diameter, gap, bed)
  stays.
- **Right rail — FIXED PARAMS** (replaces "CUT PARAMS"): a numeric input for
  every sweepable param, plus initial drop. The two params currently on axes
  render **disabled** with an "on X"/"on Y" tag (value comes from the axis) —
  disabled, not hidden, to avoid layout jumps. Focus-descent grouping/readout
  is retained for the focus params; the descent-depth readout reflects the fixed
  values, and shows "—" (varies) when `focusStep` or `focusInterval` is on an
  axis, since it then differs per cell. LABEL ENGRAVE + EXPORT sections
  unchanged.

Aria-labels: keep stable, value-based aria-labels for the inputs/selects (e.g.
`x param`, `y param`, `x min`/`x max`/`x steps`, `fixed speed`, etc.) so tests
can target them.

## Preview

Consumes the same `result` (cut arms + filled label outlines + footprint) —
minimal change beyond the new result shape. When only profile params are swept,
all cells' spirals are geometrically identical; the axis labels carry the
distinction (expected, not a bug). Single dark stroke for all cut arms (no
per-group colour) keeps it simple.

## Testing

- **`spiralParams.test.ts`**: `formatValue` precision per key; `clamp` (passes/
  interval round + floor at 1, power 0–100, pitch > 0); `kind` classification.
- **`spiralTest.test.ts`**: per-cell `paramMap` (X/Y override `fixed`); geometry
  uses the swept channel/pitch; **distinct-profile count** — geometry-only sweep
  → 1 group, mixed → N, profile×profile → N×M; cell count; `labelOutlines`
  count + per-param precision; `composeTitle` names both axes and lists only
  off-axis params; over-bed flag; `stageParams` keys match the groups on
  `cutPaths`.
- **`spiralTestXs.test.ts`**: round-trip a profile sweep (X=`speed`) → multiple
  distinct `VECTOR_CUTTING` profiles carrying the swept `speed` values; a
  `focusStep`/`focusInterval` sweep → varying `descentPerStep`/
  `descentIntervalDescent`; label `FILL_VECTOR_ENGRAVING` op still present;
  geometry-only sweep → single `VECTOR_CUTTING` profile.
- **`controls.test.tsx`**: changing the X (or Y) `<Select>` updates `xParam`/
  `yParam`; the Y select cannot pick the X param; the on-axis param's fixed
  input is disabled; editing a fixed input emits the changed config; axis
  min/max/steps edits emit.

## File structure

```
web/src/lib/forge/spiralParams.ts            NEW  registry + ParamKey/ParamDef + formatValue/clamp
web/src/lib/forge/spiralParams.test.ts       NEW
web/src/lib/forge/spiralTest.ts              MOD  config reshape, per-cell paramMap, dedup grouping, stageParams, composeTitle
web/src/lib/forge/spiralTest.test.ts         MOD
web/src/lib/forge/spiralTestXs.ts            MOD  forward result.stageParams to buildGeneratedXcs
web/src/lib/forge/spiralTestXs.test.ts       MOD
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  AXES section (X/Y param + range)
web/src/components/spiraltest/controls.test.tsx        MOD
web/src/components/spiraltest/SpiralTestPreview.tsx    MOD  consume new result shape (minimal)
web/src/pages/SpiralTestPage.tsx             MOD  DEFAULT_CFG, FIXED PARAMS section, setters
changelog/2026-06-18-spiral-test-axes.md     NEW  minor entry
```

## Notes / deviations

- The `.xs` can now contain many `VECTOR_CUTTING` profiles/layers (one per
  distinct cut setting). This is intended and matches Studio's representation;
  dedup keeps geometry-only sweeps to a single profile.
- Passes drives both the cut profile `repeat` and each arm's `layerEnd` (spiral
  repeat count), so sweeping passes changes both per cell — correct.
- The cut `laser` stays fixed at the panel value (MOPA IR by default); it is not
  a sweepable axis (consistent with the user's list). Add later if needed.
