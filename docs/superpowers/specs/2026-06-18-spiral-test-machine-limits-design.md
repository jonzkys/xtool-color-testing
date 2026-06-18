# Spiral Test — machine-conformant parameter limits

**Status:** design approved (brainstorm 2026-06-18)
**Builds on:** the Spiral Test selectable-axes feature (PR #160, merged) — `#/spiral-test`.

## Goal

Make the Spiral Test page's sweepable parameters conform to the real machine's
behaviour: per-parameter lower/upper limits, and **pulse width as a discrete
set of allowed values** (MOPA) rather than a free numeric value. Limits come
from the backend's per-(machine, mode) validation profiles, which the frontend
already fetches; out-of-bound values clamp (snap, for discrete) rather than
reject — matching the project's existing pulse-width-snapping pattern.

## Decisions (from brainstorm)

- **Limits source:** the live `/api/machines` registry, **F2 Ultra `cut`
  profile** specifically (`profiles["F2Ultra:cut"]`). Not machine-aware to the
  TopBar switch — this page is a MOPA-IR fiber spiral-cut jig.
- **Focus descent** (per-step amount + interval) keeps **generous app limits**,
  NOT machine/Studio bounds — the proven Forge defaults (step 0.06 mm, interval
  20) sit outside Studio's UI ranges and must stay valid.
- **Out of scope:** the label-engrave (`score`) panel and the fixed cut laser
  (`red`). This change covers the sweepable cut params only.

## Existing infrastructure (reuse, do not rebuild)

- `web/src/types.ts`: `FieldConstraint = { kind:"range"; min; max; step? } |
  { kind:"stepped"; values:(number|string)[] } | { kind:"enum"; values } |
  { kind:"not_applicable" }`; `ValidationProfile = Record<string, FieldConstraint>`;
  `MachinesPayload = { machines; profiles: Record<string, ValidationProfile> }`.
- `web/src/api/machines.ts`: `getMachines()` — cached fetch of `/api/machines`.
- `web/src/state/machine.ts`: `getValidationProfile(registry, machineId, mode)`
  — pure derivation of the constraint dict.
- `web/src/laser/pulseWidths.ts`: `ALLOWED_PULSE_WIDTHS` (the 16 values),
  `snapPulseWidth`, `allowedPulseWidthsInRange`.
- Backend source of truth: `src/xcs_gen/data/machine_profiles.json`
  (`F2Ultra:cut` → power range 1–100, speed 2–10000, frequency 1–4000, passes
  1–300, pulse_width stepped [2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500],
  laser enum [red,blue]).

## Registry mapping (`web/src/lib/forge/spiralParams.ts`)

Add an optional `profileField?: string` to `ParamDef`:

| param | profileField |
|---|---|
| `speed` | `"speed"` |
| `passes` | `"passes"` |
| `power` | `"power"` |
| `frequency` | `"frequency"` |
| `pulseWidth` | `"pulse_width"` |
| `channelWidth`, `pitch`, `focusStep`, `focusInterval` | (none) |

The existing app-level `clamp` / `step` / `defaultFixed` / `defaultAxis` remain
the **fallback** — used for unbound params and while the registry is loading.
When a profile field exists, the machine constraint overrides the bound.

## `web/src/lib/forge/spiralLimits.ts` (new, pure)

Interprets a `ValidationProfile | null` for our params. Reuses `FieldConstraint`
from `../../types` and `ALLOWED_PULSE_WIDTHS` from `../../laser/pulseWidths`.

```ts
import type { FieldConstraint, ValidationProfile } from "../../types";
import { ALLOWED_PULSE_WIDTHS } from "../../laser/pulseWidths";
import { PARAMS, resolveAxis, type AxisSpec, type ParamKey } from "./spiralParams"; // see note
```
(Implementation note: `resolveAxis` currently lives in `spiralTest.ts`. To avoid
a circular import — `spiralTest.ts` will import `spiralLimits.ts` — move
`resolveAxis` into `spiralParams.ts` (or a tiny shared module) and re-export it
from `spiralTest.ts` for existing importers. `spiralLimits.ts` imports
`resolveAxis` from `spiralParams.ts`.)

API:

- `constraintFor(profile, key): FieldConstraint | null` — `profile[PARAMS[key].profileField]`,
  or `null` when the param is unbound or `profile` is null.
- `clampParam(profile, key, v): number`
  - `range` → `clamp(v, min, max)` then round to `step` (default 1).
  - `stepped` → nearest allowed value by absolute distance.
  - otherwise → `PARAMS[key].clamp(v)` (app fallback).
- `resolveAxisValues(profile, key, axis): number[]`
  - `stepped` → allowed values within `[axis.min, axis.max]` inclusive, sorted;
    if none fall in range, `[nearest allowed to (min+max)/2]` (guarantee ≥1).
  - `range` / none → `resolveAxis(axis).map((v) => clampParam(profile, key, v))`.
- `steppedValues(profile, key): number[] | null`
  - `stepped` → the constraint's values (as numbers).
  - else if `key === "pulseWidth"` → `[...ALLOWED_PULSE_WIDTHS]` (loading fallback).
  - else → `null`.

Local helpers `snapStepped(values, v)` and `steppedInRange(values, lo, hi)` are
generic over a value list (the same logic as `pulseWidths.ts`, but operating on
the profile's values so the registry stays the source of truth).

## Build integration (`web/src/lib/forge/spiralTest.ts`)

`buildSpiralTest(cfg: SpiralTestConfig, profile: ValidationProfile | null = null)`:

- `xVals = resolveAxisValues(profile, cfg.xParam, cfg.xAxis)`,
  `yVals = resolveAxisValues(profile, cfg.yParam, cfg.yAxis)` (replaces the
  current `resolveAxis(...).map(PARAMS[k].clamp)`).
- Per cell, assemble the param map with every value clamped to the machine:
  `paramMap[k] = clampParam(profile, k, cfg.fixed[k])` for all keys, then
  override `[cfg.xParam] = xVals[col]`, `[cfg.yParam] = yVals[row]` (already
  resolved/clamped).
- Everything else (geometry split, profile dedup into `CUT_<n>`, `stageParams`,
  labels, footprint) is unchanged. The default `profile = null` preserves
  today's behavior for existing callers/tests.

`maxCw` (cell sizing) keeps reading the channel-width values (xVals/yVals/fixed)
— channel width is unbound, so `clampParam` returns its app clamp there.

A pulse-width axis therefore yields one column/row per allowed value in range
(grid dimensions follow the discrete set, not Steps).

## UI

### `web/src/components/spiraltest/FixedParams.tsx` (accepts `profile`)

- Stepped param (pulse width): a `<Select aria-label="fixed pulseWidth">` of
  `steppedValues(profile, "pulseWidth")`; `value` = the snapped current
  (`clampParam(profile, "pulseWidth", cfg.fixed.pulseWidth)`); `onChange` emits
  the chosen allowed value. Disabled when on-axis (unchanged).
- Range param: numeric `<Input>` as today, plus `min`/`max` from the constraint
  and the registry `step`; edits clamp via `clampParam(profile, k, …)`.
- Unbound params (channel width, pitch, focus, initial drop): unchanged.

### `web/src/components/spiraltest/SpiralTestControls.tsx` (accepts `profile`)

- `axisRange(which, param, axis, commit)` branches on
  `steppedValues(profile, param)`:
  - stepped → Min and Max are `<Select>`s of allowed values (aria `${which} min`
    / `${which} max`); the **Steps** `<Input>` is omitted.
  - range/none → numeric Min/Max with the per-param `step` and (when bound)
    `min`/`max` attributes; Steps `<Input>` as today.
- Resolved-value readouts use `resolveAxisValues(profile, param, axis)` mapped
  through `formatValue`, so they reflect the discrete/clamped sweep.
- Param-switch axis reset (`defaultAxis`) unchanged.

### `web/src/state/machine.ts` — new hook

```ts
export function useValidationProfile(machineId: string, mode: string): ValidationProfile | null
```
Loads the cached registry via `getMachines()` into state and returns
`getValidationProfile(registry, machineId, mode)` (or `null` while loading /
on error).

### `web/src/pages/SpiralTestPage.tsx`

- `const profile = useValidationProfile("F2Ultra", "cut");`
- `const result = useMemo(() => buildSpiralTest(debouncedCfg, profile), [debouncedCfg, profile]);`
- `onExport`: `buildSpiralTestXs(buildSpiralTest(cfg, profile), cfg)`.
- Pass `profile` to `<SpiralTestControls>` and `<FixedParams>`.
- Degrades to app fallbacks while `profile` is null; the registry is typically
  already cached from the machine switcher.

## Testing

- **`spiralLimits.test.ts`** (fixture profile): `clampParam` — range clamp+round
  (speed 99999→10000, 1.4→2; power 150→100), stepped snap (83→80, 7→6), app
  fallback when unbound (channelWidth) or `profile=null`. `resolveAxisValues` —
  range linspace then clamp; stepped → allowed-in-range (60–150 → [60,80,100,150]);
  empty-range safeguard (7–8 → [the nearest single]); `profile=null` → app path.
  `steppedValues` — profile values; pulse-width loading fallback; `null` for a
  range param.
- **`spiralTest.test.ts`**: with the fixture profile — a pulse-width X axis
  (60–150) → `cells.length === allowed-in-range × rows` and label values are the
  allowed set; a fixed speed above max is clamped in the cut `stageParams`;
  passes capped at 300; **`profile` omitted (null) → all existing assertions
  unchanged**.
- **`spiralTestXs.test.ts`**: a pulse-width sweep with the profile → the round-
  tripped `VECTOR_CUTTING` profiles carry distinct pulse widths drawn from the
  allowed set.
- **`FixedParams.test.tsx`**: pulse-width renders a `<select>` whose options are
  the allowed values and emits a chosen value; a range param's input carries
  `min`/`max`.
- **`controls.test.tsx`**: a stepped axis param renders Min/Max `<select>`s and
  omits the Steps input; a range axis param keeps numeric Min/Max/Steps.
- **`state/machine.test.ts`**: `useValidationProfile("F2Ultra","cut")` returns
  the F2Ultra:cut constraints from a mocked `getMachines`.

## File structure

```
web/src/lib/forge/spiralParams.ts            MOD  add profileField; host resolveAxis (re-exported by spiralTest)
web/src/lib/forge/spiralLimits.ts            NEW  constraintFor / clampParam / resolveAxisValues / steppedValues
web/src/lib/forge/spiralLimits.test.ts       NEW
web/src/lib/forge/spiralTest.ts              MOD  buildSpiralTest(cfg, profile?); use resolveAxisValues + clampParam
web/src/lib/forge/spiralTest.test.ts         MOD
web/src/lib/forge/spiralTestXs.test.ts       MOD  pulse-width sweep with profile
web/src/state/machine.ts                     MOD  useValidationProfile hook
web/src/state/machine.test.ts                MOD
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  stepped axis min/max selects; accept profile
web/src/components/spiraltest/controls.test.tsx        MOD
web/src/components/spiraltest/FixedParams.tsx          MOD  pulse-width select; min/max attrs; accept profile
web/src/components/spiraltest/FixedParams.test.tsx     MOD
web/src/pages/SpiralTestPage.tsx             MOD  load profile, thread it through
changelog/2026-06-18-spiral-test-machine-limits.md     NEW  minor entry
```

## Notes / deviations

- `resolveAxis` moves to `spiralParams.ts` to break the
  `spiralTest ↔ spiralLimits` import cycle; `spiralTest.ts` re-exports it so the
  existing `import { resolveAxis } from "./spiralTest"` (controls) keeps working.
- Geometry (channel width, pitch) and focus descent stay app-bound; only
  speed/passes/power/frequency/pulse-width gain machine limits.
- The page reads `F2Ultra:cut` regardless of the TopBar machine (per the
  approved scope); making it machine-aware later is a localized change to the
  `useValidationProfile` call.
