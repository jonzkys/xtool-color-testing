# Spiral Test — machine-conformant parameter limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Spiral Test page's sweepable params obey the real machine limits — per-param min/max and pulse width as a discrete preset list — sourced from the existing `/api/machines` `F2Ultra:cut` validation profile, snapping/clamping rather than rejecting.

**Architecture:** A pure `spiralLimits.ts` interprets a `ValidationProfile | null` for our params (clamp/snap a value, resolve an axis to its swept values, list discrete options), falling back to each param's app-level clamp when unbound or while the registry loads. `buildSpiralTest(cfg, profile?)` and the UI thread the profile through; pulse width renders a `<Select>` and, on an axis, sweeps the allowed-in-range set.

**Tech Stack:** React + TypeScript + Vite; vitest. Reuses `web/src/types.ts` `FieldConstraint`/`ValidationProfile`, `web/src/api/machines.ts` `getMachines`, `web/src/state/machine.ts` `getValidationProfile`, `web/src/laser/pulseWidths.ts`.

**Spec:** `docs/superpowers/specs/2026-06-18-spiral-test-machine-limits-design.md`. Builds on PR #160 (merged).

**Key facts (do not re-derive):**
- `web/src/types.ts`: `FieldConstraint = {kind:"range";min;max;step?} | {kind:"stepped";values:(number|string)[]} | {kind:"enum";values} | {kind:"not_applicable"}`; `ValidationProfile = Record<string, FieldConstraint>`; `MachinesPayload = {machines; profiles: Record<string,ValidationProfile>}`.
- `web/src/api/machines.ts`: `getMachines(): Promise<MachinesPayload>` (cached).
- `web/src/state/machine.ts`: `getValidationProfile(registry, machineId, mode): ValidationProfile | null`; file already imports `useState`, `useEffect`, `getMachines`, and the types.
- `web/src/laser/pulseWidths.ts`: `ALLOWED_PULSE_WIDTHS` (the 16 ns values).
- `F2Ultra:cut` fields: power range 1–100 step 1, speed range 2–10000 step 1, frequency range 1–4000 step 1, passes range 1–300 step 1, pulse_width stepped (the 16 values), laser enum [red,blue].
- `web/src/lib/forge/spiralParams.ts` (current): `ParamDef` has `key,label,abbrev,unit,dp,step,kind,clamp,defaultFixed,defaultAxis`; `PARAMS`, `PARAM_ORDER`, `PROFILE_KEYS`, `formatValue`. `resolveAxis` currently lives in `spiralTest.ts`.
- `web/src/lib/forge/spiralTest.ts` (current): exports `resolveAxis`, `circleRegion`, `composeTitle`, `ringsBBox`, `buildSpiralTest(cfg)`; re-exports `AxisSpec`/`ParamKey`. `buildSpiralTest` line: `const xVals = resolveAxis(cfg.xAxis).map((v) => PARAMS[cfg.xParam].clamp(v));` (and yVals), and `const paramMap = { ...cfg.fixed, [cfg.xParam]: xVals[col], [cfg.yParam]: yVals[row] } as Record<ParamKey, number>;`.

**Conventions:** Gate before commit: `cd web && npx tsc --noEmit && npm test -- --run`. Rebuild for the browser: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/src/lib/forge/spiralParams.ts            MOD  add profileField; host resolveAxis
web/src/lib/forge/spiralLimits.ts            NEW  constraintFor/clampParam/resolveAxisValues/steppedValues/snapStepped
web/src/lib/forge/spiralLimits.test.ts       NEW
web/src/lib/forge/spiralTest.ts              MOD  re-export resolveAxis (Task 1); buildSpiralTest(cfg, profile?) (Task 2)
web/src/lib/forge/spiralTest.test.ts         MOD
web/src/lib/forge/spiralTestXs.test.ts       MOD
web/src/state/machine.ts                     MOD  useValidationProfile hook
web/src/state/machine.test.ts                MOD
web/src/components/spiraltest/SpiralTestControls.tsx   MOD  stepped axis selects; accept profile
web/src/components/spiraltest/controls.test.tsx        MOD
web/src/components/spiraltest/FixedParams.tsx          MOD  pulse-width select; min/max; accept profile
web/src/components/spiraltest/FixedParams.test.tsx     MOD
web/src/pages/SpiralTestPage.tsx             MOD  load profile, thread it
changelog/2026-06-18-spiral-test-machine-limits.md     NEW  minor entry
```

---

## Task 1: Registry mapping + `spiralLimits` (host `resolveAxis`)

Add `profileField`, move `resolveAxis` into `spiralParams.ts` (re-exported from `spiralTest.ts`) to break the import cycle, and build the pure limits interpreter. Self-contained + tsc-green (`buildSpiralTest` still uses the now-imported `resolveAxis`).

**Files:** Modify `spiralParams.ts`, `spiralTest.ts`; Create `spiralLimits.ts`, `spiralLimits.test.ts`.

- [ ] **Step 1: Add `resolveAxis` + `profileField` to `web/src/lib/forge/spiralParams.ts`**

(a) Add the `resolveAxis` function just below the `AxisSpec` interface (after line 12):
```ts
/** `steps` values linearly spaced over [min, max] (steps>=1; 1 → [min]). */
export function resolveAxis(a: AxisSpec): number[] {
  const n = Math.max(1, Math.floor(a.steps));
  if (n === 1) return [a.min];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a.min + ((a.max - a.min) * i) / (n - 1));
  return out;
}
```

(b) Add `profileField` to `ParamDef` (after the `step` line):
```ts
  step: number;        // numeric-input increment (precision-appropriate, not 1)
  profileField?: string; // machine validation-profile field, if machine-bound
```

(c) Add `profileField` to the five machine-bound entries in `PARAMS` (leave channelWidth/pitch/focusStep/focusInterval without it):
```ts
  speed:         { key: "speed",         label: "Speed",         abbrev: "S",  unit: "mm/s",   dp: 0, step: 50,    profileField: "speed",       kind: "profile",  clamp: intMin1,  defaultFixed: 1500, defaultAxis: { min: 1000, max: 2000, steps: 4 } },
  passes:        { key: "passes",        label: "Passes",        abbrev: "PA", unit: "×",      dp: 0, step: 10,    profileField: "passes",      kind: "profile",  clamp: intMin1,  defaultFixed: 250,  defaultAxis: { min: 150,  max: 300,  steps: 4 } },
  power:         { key: "power",         label: "Power",         abbrev: "P",  unit: "%",      dp: 0, step: 5,     profileField: "power",       kind: "profile",  clamp: pct,      defaultFixed: 100,  defaultAxis: { min: 60,   max: 100,  steps: 4 } },
  frequency:     { key: "frequency",     label: "Frequency",     abbrev: "F",  unit: "kHz",    dp: 0, step: 5,     profileField: "frequency",   kind: "profile",  clamp: intMin1,  defaultFixed: 65,   defaultAxis: { min: 30,   max: 80,   steps: 4 } },
  pulseWidth:    { key: "pulseWidth",    label: "Pulse width",   abbrev: "PW", unit: "ns",     dp: 0, step: 10,    profileField: "pulse_width", kind: "profile",  clamp: nonNeg,   defaultFixed: 80,   defaultAxis: { min: 50,   max: 500,  steps: 4 } },
```

- [ ] **Step 2: Update `web/src/lib/forge/spiralTest.ts`** to source `resolveAxis` from `spiralParams` (remove the local copy, re-export it).

Replace the import + the local `resolveAxis` block (current lines 11–22) with:
```ts
import { PARAMS, PARAM_ORDER, PROFILE_KEYS, formatValue, resolveAxis, type AxisSpec, type ParamKey } from "./spiralParams";

export type { AxisSpec, ParamKey } from "./spiralParams";
export { resolveAxis } from "./spiralParams";
```
(`circleRegion` and everything after stay. `buildSpiralTest` still calls `resolveAxis` — now the imported one.)

- [ ] **Step 3: Run the lib tests (must stay green after the move)**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts src/components/spiraltest/controls.test.tsx`
Expected: PASS (controls imports `resolveAxis` from `./spiralTest`, which now re-exports it).

- [ ] **Step 4: Write the failing test** — create `web/src/lib/forge/spiralLimits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ValidationProfile } from "../../types";
import { clampParam, resolveAxisValues, steppedValues, snapStepped } from "./spiralLimits";

const PROFILE: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  speed: { kind: "range", min: 2, max: 10000, step: 1 },
  frequency: { kind: "range", min: 1, max: 4000, step: 1 },
  passes: { kind: "range", min: 1, max: 300, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};

describe("snapStepped", () => {
  it("returns the nearest value by absolute distance", () => {
    expect(snapStepped([2, 4, 6, 9], 5)).toBe(4); // tie-ish: 5→4 (first closest)
    expect(snapStepped([60, 80, 100], 83)).toBe(80);
  });
});

describe("clampParam", () => {
  it("range params clamp to [min,max] and round to step", () => {
    expect(clampParam(PROFILE, "speed", 99999)).toBe(10000);
    expect(clampParam(PROFILE, "speed", 1.4)).toBe(2);
    expect(clampParam(PROFILE, "power", 150)).toBe(100);
    expect(clampParam(PROFILE, "passes", 999)).toBe(300);
  });
  it("stepped params snap to the nearest allowed value", () => {
    expect(clampParam(PROFILE, "pulseWidth", 83)).toBe(80);
    expect(clampParam(PROFILE, "pulseWidth", 7)).toBe(6);
  });
  it("unbound params fall back to the app clamp", () => {
    expect(clampParam(PROFILE, "pitch", -1)).toBe(0.01); // pitch app floor
    expect(clampParam(PROFILE, "channelWidth", -1)).toBeGreaterThan(0);
  });
  it("null profile falls back to the app clamp even for machine-bound params", () => {
    expect(clampParam(null, "speed", 1.4)).toBe(1); // app intMin1 (round, >=1)
  });
});

describe("resolveAxisValues", () => {
  it("range params linspace then clamp", () => {
    expect(resolveAxisValues(PROFILE, "speed", { min: 1000, max: 2000, steps: 3 })).toEqual([1000, 1500, 2000]);
  });
  it("stepped params yield the allowed values in range (steps ignored)", () => {
    expect(resolveAxisValues(PROFILE, "pulseWidth", { min: 60, max: 150, steps: 99 })).toEqual([60, 80, 100, 150]);
  });
  it("a stepped range containing no allowed value falls back to the single nearest", () => {
    expect(resolveAxisValues(PROFILE, "pulseWidth", { min: 7, max: 8, steps: 4 })).toEqual([6]);
  });
  it("null profile uses the app linspace+clamp path", () => {
    expect(resolveAxisValues(null, "speed", { min: 1000, max: 2000, steps: 2 })).toEqual([1000, 2000]);
  });
});

describe("steppedValues", () => {
  it("returns the stepped option list for a stepped param", () => {
    expect(steppedValues(PROFILE, "pulseWidth")).toEqual([2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500]);
  });
  it("falls back to ALLOWED_PULSE_WIDTHS for pulseWidth when the profile is null", () => {
    expect(steppedValues(null, "pulseWidth")).toContain(500);
    expect(steppedValues(null, "pulseWidth")!.length).toBe(16);
  });
  it("returns null for a non-stepped param", () => {
    expect(steppedValues(PROFILE, "speed")).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/spiralLimits.test.ts`
Expected: FAIL — cannot find module `./spiralLimits`.

- [ ] **Step 6: Implement `web/src/lib/forge/spiralLimits.ts`**:

```ts
// web/src/lib/forge/spiralLimits.ts
// Interpret a machine ValidationProfile for the Spiral Test's sweepable params:
// clamp/snap a fixed value, resolve an axis to its swept values, and expose the
// discrete option list for stepped params (pulse width). Pure. Falls back to the
// param's app-level clamp when a param is unbound (geometry/focus) or the
// registry hasn't loaded yet.
import type { FieldConstraint, ValidationProfile } from "../../types";
import { ALLOWED_PULSE_WIDTHS } from "../../laser/pulseWidths";
import { PARAMS, resolveAxis, type AxisSpec, type ParamKey } from "./spiralParams";

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The machine constraint for a param, or null when it's unbound (geometry/
 *  focus) or the profile hasn't loaded. */
export function constraintFor(profile: ValidationProfile | null, key: ParamKey): FieldConstraint | null {
  const field = PARAMS[key].profileField;
  if (!profile || !field) return null;
  return profile[field] ?? null;
}

/** Nearest value in `values` by absolute distance. */
export function snapStepped(values: number[], v: number): number {
  let best = values[0];
  let bestD = Math.abs(v - best);
  for (const w of values) {
    const d = Math.abs(v - w);
    if (d < bestD) { best = w; bestD = d; }
  }
  return best;
}

function steppedInRange(values: number[], lo: number, hi: number): number[] {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  return values.filter((w) => w >= a && w <= b).sort((x, y) => x - y);
}

/** Clamp/snap a value to the machine constraint, or the param's app clamp when
 *  unbound / loading. */
export function clampParam(profile: ValidationProfile | null, key: ParamKey, v: number): number {
  const c = constraintFor(profile, key);
  if (c?.kind === "range") {
    const step = c.step && c.step > 0 ? c.step : 1;
    return clampN(Math.round(v / step) * step, c.min, c.max);
  }
  if (c?.kind === "stepped") return snapStepped(c.values as number[], v);
  return PARAMS[key].clamp(v);
}

/** The swept values for an axis, machine-aware. */
export function resolveAxisValues(profile: ValidationProfile | null, key: ParamKey, axis: AxisSpec): number[] {
  const c = constraintFor(profile, key);
  if (c?.kind === "stepped") {
    const vals = c.values as number[];
    const inRange = steppedInRange(vals, axis.min, axis.max);
    return inRange.length > 0 ? inRange : [snapStepped(vals, (axis.min + axis.max) / 2)];
  }
  return resolveAxis(axis).map((v) => clampParam(profile, key, v));
}

/** Discrete option list for a stepped param (for a <Select>), sorted ascending;
 *  the pulse-width set is the loading fallback; null for non-stepped params. */
export function steppedValues(profile: ValidationProfile | null, key: ParamKey): number[] | null {
  const c = constraintFor(profile, key);
  if (c?.kind === "stepped") return (c.values as number[]).slice().sort((a, b) => a - b);
  if (key === "pulseWidth") return [...ALLOWED_PULSE_WIDTHS];
  return null;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/spiralLimits.test.ts`
Expected: PASS (all cases). Note `snapStepped([2,4,6,9],5)` → 4 (first value reaching the minimal distance; 5 is equidistant to 4 and 6, the loop keeps the earlier 4 since it uses strict `<`).

- [ ] **Step 8: Typecheck + commit**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → clean; all pass.
```bash
git add web/src/lib/forge/spiralParams.ts web/src/lib/forge/spiralTest.ts \
        web/src/lib/forge/spiralLimits.ts web/src/lib/forge/spiralLimits.test.ts
git commit -m "feat(spiral-test): machine-limit interpreter (spiralLimits) + profileField mapping"
```

---

## Task 2: Thread the profile through `buildSpiralTest`

`buildSpiralTest(cfg, profile = null)` resolves axes + clamps fixed values via `spiralLimits`. Default `null` preserves today's behavior for existing callers/tests.

**Files:** Modify `spiralTest.ts`, `spiralTest.test.ts`, `spiralTestXs.test.ts`.

- [ ] **Step 1: Update `web/src/lib/forge/spiralTest.ts`**

(a) Add to the imports (after the `spiralParams` import line):
```ts
import { clampParam, resolveAxisValues } from "./spiralLimits";
import type { ValidationProfile } from "../../types";
```

(b) Change the `buildSpiralTest` signature + the axis resolution. Replace:
```ts
export function buildSpiralTest(cfg: SpiralTestConfig): SpiralTestResult {
  const xVals = resolveAxis(cfg.xAxis).map((v) => PARAMS[cfg.xParam].clamp(v));
  const yVals = resolveAxis(cfg.yAxis).map((v) => PARAMS[cfg.yParam].clamp(v));
```
with:
```ts
export function buildSpiralTest(cfg: SpiralTestConfig, profile: ValidationProfile | null = null): SpiralTestResult {
  const xVals = resolveAxisValues(profile, cfg.xParam, cfg.xAxis);
  const yVals = resolveAxisValues(profile, cfg.yParam, cfg.yAxis);
```

(c) Clamp every fixed param to the machine when assembling each cell's map. Replace:
```ts
      const paramMap = { ...cfg.fixed, [cfg.xParam]: xVals[col], [cfg.yParam]: yVals[row] } as Record<ParamKey, number>;
```
with:
```ts
      const paramMap = Object.fromEntries(
        PARAM_ORDER.map((k) => [k, clampParam(profile, k, cfg.fixed[k])]),
      ) as Record<ParamKey, number>;
      paramMap[cfg.xParam] = xVals[col];
      paramMap[cfg.yParam] = yVals[row];
```
(`PARAM_ORDER` is already imported. `resolveAxis` stays imported because it is still re-exported from this file; if tsc flags it as unused after this change, keep the re-export line `export { resolveAxis } from "./spiralParams";` and drop `resolveAxis` from the value import — the re-export does not require a local binding.)

- [ ] **Step 2: Update `web/src/lib/forge/spiralTest.test.ts`** — add machine-profile cases. Append these imports + a fixture + a `describe` block (keep all existing tests; they call `buildSpiralTest(cfg)` with the default `null`):

At the top, after the existing imports, add:
```ts
import type { ValidationProfile } from "../../types";

const CUT_PROFILE: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  speed: { kind: "range", min: 2, max: 10000, step: 1 },
  frequency: { kind: "range", min: 1, max: 4000, step: 1 },
  passes: { kind: "range", min: 1, max: 300, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};
```
Add this `describe` block at the end of the file:
```ts
describe("buildSpiralTest with a machine profile", () => {
  it("a pulse-width axis sweeps the allowed-in-range values (cells = allowed × rows)", () => {
    const r = buildSpiralTest(baseCfg({
      xParam: "pulseWidth", yParam: "pitch",
      xAxis: { min: 60, max: 150, steps: 99 }, yAxis: { min: 0.03, max: 0.05, steps: 2 },
    }), CUT_PROFILE);
    // allowed in [60,150] = 60,80,100,150 → 4 cols × 2 rows
    expect(r.cells.length).toBe(8);
    expect(r.labelOutlines.some((l) => l.text === "80")).toBe(true);
    expect(r.labelOutlines.some((l) => l.text === "150")).toBe(true);
  });
  it("clamps a fixed value above the machine max into the cut profile", () => {
    const r = buildSpiralTest(baseCfg({
      fixed: { ...baseCfg().fixed, speed: 99999 },
    }), CUT_PROFILE);
    expect(Object.values(r.stageParams).every((s) => s.speed === 10000)).toBe(true);
  });
  it("omitting the profile preserves the app-clamp behaviour", () => {
    const r = buildSpiralTest(baseCfg({ fixed: { ...baseCfg().fixed, speed: 99999 } }));
    expect(Object.values(r.stageParams).every((s) => s.speed === 99999)).toBe(true);
  });
});
```

- [ ] **Step 3: Update `web/src/lib/forge/spiralTestXs.test.ts`** — add a pulse-width sweep test driven by a profile. Add the same `CUT_PROFILE` fixture + `import type { ValidationProfile } from "../../types";` near the top, and append inside the existing `describe("buildSpiralTestXs", …)`:
```ts
  it("a pulse-width sweep emits distinct cut pulse widths from the allowed set", () => {
    const cfg = baseCfg({ xParam: "pulseWidth", yParam: "pitch", xAxis: { min: 60, max: 150, steps: 99 } });
    const { raw } = xsToLegacyRaw(buildSpiralTestXs(buildSpiralTest(cfg, CUT_PROFILE), cfg));
    const pws = new Set(cutCustomizes(raw).map((c) => c.pulseWidth));
    expect(pws.has(60)).toBe(true);
    expect(pws.has(80)).toBe(true);
    expect(pws.has(150)).toBe(true);
    expect(pws.has(83)).toBe(false); // only allowed values appear
  });
```
(`cutCustomizes`, `baseCfg`, `xsToLegacyRaw` already exist in this file from PR #160.)

- [ ] **Step 4: Run the lib tests**

Run: `cd web && npx vitest run src/lib/forge/spiralTest.test.ts src/lib/forge/spiralTestXs.test.ts src/lib/forge/spiralLimits.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → clean; all pass.
```bash
git add web/src/lib/forge/spiralTest.ts web/src/lib/forge/spiralTest.test.ts web/src/lib/forge/spiralTestXs.test.ts
git commit -m "feat(spiral-test): apply machine limits in buildSpiralTest (profile-aware axes + fixed clamps)"
```

---

## Task 3: UI + profile hook

Add the `useValidationProfile` hook; render pulse width as a select (fixed) / value selects (axis); thread the profile from the page. Props are added across components, so this lands as one tsc-green unit.

**Files:** Modify `state/machine.ts`, `state/machine.test.ts`, `SpiralTestControls.tsx`, `controls.test.tsx`, `FixedParams.tsx`, `FixedParams.test.tsx`, `SpiralTestPage.tsx`.

- [ ] **Step 1: Add `useValidationProfile` to `web/src/state/machine.ts`** — append at the end of the file:
```ts
/** React hook: load the cached registry and return the constraint dict for
 *  (machineId, mode), or null while loading / if unsupported. */
export function useValidationProfile(machineId: string, mode: string): ValidationProfile | null {
  const [registry, setRegistry] = useState<MachinesPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMachines().then((p) => { if (!cancelled) setRegistry(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return getValidationProfile(registry, machineId, mode);
}
```
(`useState`, `useEffect`, `MachinesPayload`, `ValidationProfile`, `getMachines`, `getValidationProfile` are all already imported/defined in this file.)

- [ ] **Step 2: Add a hook test to `web/src/state/machine.test.ts`** — append:
```ts
import { renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { useValidationProfile } from "./machine";
import * as machinesApi from "../api/machines";
import type { MachinesPayload } from "../types";

const PAYLOAD: MachinesPayload = {
  machines: [{
    id: "F2Ultra", display_name: "F2 Ultra", ext_id: "GS004-CLASS-4", ext_name: "F2 Ultra",
    image: "/machines/f2ultra.png",
    lasers: [{ kind: "fiber", wattage: 60, spot_mm: [0.03, 0.03] }],
    modes: [{ id: "cut", profile: "F2Ultra:cut" }],
  }],
  profiles: { "F2Ultra:cut": { speed: { kind: "range", min: 2, max: 10000, step: 1 } } },
};

describe("useValidationProfile", () => {
  it("returns the (machine, mode) constraints once the registry loads", async () => {
    vi.spyOn(machinesApi, "getMachines").mockResolvedValue(PAYLOAD);
    const { result } = renderHook(() => useValidationProfile("F2Ultra", "cut"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.speed).toEqual({ kind: "range", min: 2, max: 10000, step: 1 });
  });
});
```
(If `machine.test.ts` already imports some of these symbols, merge rather than duplicate the imports.)

- [ ] **Step 3: Rewrite `web/src/components/spiraltest/FixedParams.tsx`** — accept `profile`, machine-clamp on edit, render pulse width as a select, add range min/max attributes. Replace the whole file with:
```tsx
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import type { ValidationProfile } from "../../types";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";
import { clampParam, constraintFor, snapStepped, steppedValues } from "../../lib/forge/spiralLimits";
import { descentDepthMm } from "../../lib/forge/depth";
import { Field, Input, Section, Select } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  profile?: ValidationProfile | null;
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** The non-swept cut parameters. Every sweepable param has an input here; the
 *  two currently on an axis are disabled (their value comes from the axis).
 *  Values clamp/snap to the machine profile on edit. Pulse width is discrete. */
export function FixedParams({ cfg, onChange, profile = null }: Props) {
  const setFixed = (k: ParamKey, v: number) =>
    onChange({ ...cfg, fixed: { ...cfg.fixed, [k]: clampParam(profile, k, v) } });

  const onAxis = (k: ParamKey): "X" | "Y" | null =>
    k === cfg.xParam ? "X" : k === cfg.yParam ? "Y" : null;

  const depthVaries = (["passes", "focusStep", "focusInterval"] as ParamKey[]).some((k) => onAxis(k) !== null);
  const depth = descentDepthMm(cfg.fixed.passes, cfg.fixed.focusInterval, cfg.fixed.focusStep);

  return (
    <Section title="Fixed params" dense>
      <div className="grid grid-cols-2 gap-2">
        {PARAM_ORDER.map((k) => {
          const ax = onAxis(k);
          const label = `${PARAMS[k].label}${ax ? ` (on ${ax})` : ` (${PARAMS[k].unit})`}`;
          const opts = steppedValues(profile, k);
          if (opts) {
            // Discrete (pulse width): a select of the machine's allowed values.
            return (
              <Field key={k} label={label}>
                <Select aria-label={`fixed ${k}`} value={String(snapStepped(opts, cfg.fixed[k]))} disabled={ax !== null}
                  onChange={(e) => setFixed(k, Number(e.target.value))}>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Field>
            );
          }
          const c = constraintFor(profile, k);
          const rangeAttrs = c?.kind === "range" ? { min: c.min, max: c.max } : {};
          return (
            <Field key={k} label={label}>
              <Input aria-label={`fixed ${k}`} type="number" mono step={PARAMS[k].step} value={cfg.fixed[k]}
                disabled={ax !== null} {...rangeAttrs}
                onChange={(e) => setFixed(k, num(e.target.value, cfg.fixed[k]))} />
            </Field>
          );
        })}
        <Field label="Initial drop (mm)">
          <Input aria-label="focus initial" type="number" mono step={0.01} value={cfg.focusInitialMm}
            onChange={(e) => onChange({ ...cfg, focusInitialMm: Math.max(0, num(e.target.value, cfg.focusInitialMm)) })} />
        </Field>
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
        {depthVaries ? "Descent @ varies: —" : `Descent @ ${cfg.fixed.passes}p: ${depth.toFixed(3)} mm`}
      </p>
    </Section>
  );
}
```

- [ ] **Step 4: Update `web/src/components/spiraltest/SpiralTestControls.tsx`** — accept `profile`, stepped axis selects, machine-aware readouts.

(a) Imports: add `profile` types + the limits helpers. Replace the two `spiralParams`/`spiralTest` import lines with:
```tsx
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import type { ValidationProfile } from "../../types";
import { PARAMS, PARAM_ORDER, formatValue, type AxisSpec, type ParamKey } from "../../lib/forge/spiralParams";
import { clampParam, constraintFor, resolveAxisValues, snapStepped, steppedValues } from "../../lib/forge/spiralLimits";
import { Field, Input, Section, Select } from "../../ui";
```
(Remove the now-unused `import { resolveAxis } from "../../lib/forge/spiralTest";` line.)

(b) Props: add `profile`:
```tsx
interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  footprint: { w: number; h: number };
  overBed: boolean;
  profile?: ValidationProfile | null;
}
```
and the signature: `export function SpiralTestControls({ cfg, onChange, footprint, overBed, profile = null }: Props) {`.

(c) Readouts — replace the `xs`/`ys` lines with profile-aware ones:
```tsx
  const xs = resolveAxisValues(profile, cfg.xParam, cfg.xAxis).map((v) => formatValue(cfg.xParam, v)).join(", ");
  const ys = resolveAxisValues(profile, cfg.yParam, cfg.yAxis).map((v) => formatValue(cfg.yParam, v)).join(", ");
```

(d) Rewrite `axisRange` to branch on stepped vs range. Replace the whole `axisRange` arrow (the current `const axisRange = (which, param, axis, commit) => ( … )`) with:
```tsx
  const axisRange = (
    which: "x" | "y", param: ParamKey, axis: AxisSpec, commit: (a: AxisSpec) => void,
  ) => {
    const opts = steppedValues(profile, param);
    if (opts) {
      // Discrete param: Min/Max are selects of allowed values; Steps is implied
      // by the allowed-in-range count (shown in the readout), so it's omitted.
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min">
            <Select aria-label={`${which} min`} value={String(snapStepped(opts, axis.min))}
              onChange={(e) => commit({ ...axis, min: Number(e.target.value) })}>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field>
          <Field label="Max">
            <Select aria-label={`${which} max`} value={String(snapStepped(opts, axis.max))}
              onChange={(e) => commit({ ...axis, max: Number(e.target.value) })}>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field>
        </div>
      );
    }
    const c = constraintFor(profile, param);
    const rangeAttrs = c?.kind === "range" ? { min: c.min, max: c.max } : {};
    return (
      <div className="grid grid-cols-3 gap-2">
        <Field label="Min">
          <Input aria-label={`${which} min`} type="number" mono step={PARAMS[param].step} value={axis.min} {...rangeAttrs}
            onChange={(e) => commit({ ...axis, min: num(e.target.value, axis.min) })} />
        </Field>
        <Field label="Max">
          <Input aria-label={`${which} max`} type="number" mono step={PARAMS[param].step} value={axis.max} {...rangeAttrs}
            onChange={(e) => commit({ ...axis, max: num(e.target.value, axis.max) })} />
        </Field>
        <Field label="Steps">
          <Input aria-label={`${which} steps`} type="number" mono step={1} value={axis.steps}
            onChange={(e) => commit({ ...axis, steps: num(e.target.value, axis.steps) })} />
        </Field>
      </div>
    );
  };
```
(The two call sites `axisRange("x", cfg.xParam, cfg.xAxis, (a) => set("xAxis", a))` and the `"y"` one are unchanged.)

- [ ] **Step 5: Update `web/src/pages/SpiralTestPage.tsx`** — load + thread the profile.

(a) Add the import:
```tsx
import { useValidationProfile } from "../state/machine";
```
(b) Inside the component, after `const [cfg, setCfg] = useState…`, add:
```tsx
  // Machine limits for the cut op (F2 Ultra MOPA-IR fiber spiral cut). Null
  // while the registry loads → app-default clamps; usually already cached.
  const profile = useValidationProfile("F2Ultra", "cut");
```
(c) Use it in the build + export:
```tsx
  const result = useMemo(() => buildSpiralTest(debouncedCfg, profile), [debouncedCfg, profile]);
```
```tsx
    const buf = buildSpiralTestXs(buildSpiralTest(cfg, profile), cfg);
```
(d) Pass it to the two components:
```tsx
            <SpiralTestControls cfg={cfg} onChange={setCfg} footprint={result.footprintMm} overBed={result.overBed} profile={profile} />
```
```tsx
            <FixedParams cfg={cfg} onChange={setCfg} profile={profile} />
```

- [ ] **Step 6: Update `web/src/components/spiraltest/FixedParams.test.tsx`** — add the `CUT_PROFILE` fixture + pulse-width/range cases. Add near the top (after existing imports):
```tsx
import type { ValidationProfile } from "../../types";
const CUT_PROFILE: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  speed: { kind: "range", min: 2, max: 10000, step: 1 },
  frequency: { kind: "range", min: 1, max: 4000, step: 1 },
  passes: { kind: "range", min: 1, max: 300, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};
```
Add these tests inside the `describe("FixedParams", …)` block:
```tsx
  it("renders pulse width as a select of the machine's allowed values", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} profile={CUT_PROFILE} />);
    const sel = screen.getByLabelText("fixed pulseWidth");
    expect(sel.tagName).toBe("SELECT");
    expect([...sel.querySelectorAll("option")].map((o) => o.textContent)).toContain("500");
  });
  it("emits a chosen pulse-width value", () => {
    const onChange = vi.fn();
    render(<FixedParams cfg={baseCfg()} onChange={onChange} profile={CUT_PROFILE} />);
    fireEvent.change(screen.getByLabelText("fixed pulseWidth"), { target: { value: "150" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fixed: expect.objectContaining({ pulseWidth: 150 }) }));
  });
  it("a range param input carries machine min/max", () => {
    render(<FixedParams cfg={baseCfg()} onChange={() => {}} profile={CUT_PROFILE} />);
    const speed = screen.getByLabelText("fixed speed");
    expect(speed).toHaveAttribute("min", "2");
    expect(speed).toHaveAttribute("max", "10000");
  });
```
(Keep the existing tests — they render without `profile`, so pulse width falls back to a select via the loading default; if the existing "renders an input for every sweepable param" test asserts every `fixed ${k}` is present, it still passes because the pulse-width select also has that aria-label. If that test asserts the element is specifically an `<input>` for pulseWidth, change that one param to check presence only.)

- [ ] **Step 7: Update `web/src/components/spiraltest/controls.test.tsx`** — add a stepped-axis case. Add the `CUT_PROFILE` fixture + `import type { ValidationProfile } from "../../types";` (as in Step 6), then add:
```tsx
  it("renders Min/Max selects (and no Steps) when the axis param is discrete", () => {
    render(<SpiralTestControls cfg={baseCfg({ xParam: "pulseWidth", yParam: "pitch", xAxis: { min: 50, max: 500, steps: 4 } })}
      onChange={() => {}} footprint={{ w: 1, h: 1 }} overBed={false} profile={CUT_PROFILE} />);
    expect(screen.getByLabelText("x min").tagName).toBe("SELECT");
    expect(screen.getByLabelText("x max").tagName).toBe("SELECT");
    expect(screen.queryByLabelText("x steps")).toBeNull();
  });
```
(Existing tests render without `profile` → numeric inputs as today, so they stay green.)

- [ ] **Step 8: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass.
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 9: Commit**

```bash
git add web/src/state/machine.ts web/src/state/machine.test.ts \
        web/src/components/spiraltest/FixedParams.tsx web/src/components/spiraltest/FixedParams.test.tsx \
        web/src/components/spiraltest/SpiralTestControls.tsx web/src/components/spiraltest/controls.test.tsx \
        web/src/pages/SpiralTestPage.tsx
git commit -m "feat(spiral-test): machine-limit UI — pulse-width select, discrete axis, profile hook"
```

---

## Task 4: Changelog + browser verification

**Files:** Create `changelog/2026-06-18-spiral-test-machine-limits.md`.

- [ ] **Step 1: Write the changelog entry** — create `changelog/2026-06-18-spiral-test-machine-limits.md`:
```markdown
---
id: 2026-06-18-spiral-test-machine-limits
date: 2026-06-18
level: minor
title: Spiral Test — machine-aware parameter limits
summary: Spiral Test params now obey the F2 Ultra's real limits — speed/power/frequency/passes clamp to range, and pulse width is a discrete preset list (a dropdown, and a discrete axis sweep).
---
```

- [ ] **Step 2: Full suites**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.

- [ ] **Step 3: Browser golden path**

Restart/refresh the dev server, open `http://127.0.0.1:8017/#/spiral-test`, and verify:
- FIXED PARAMS: **Pulse width** is a dropdown of the allowed values (2…500); Speed/Power/Frequency/Passes are numeric with machine min/max (try typing 99999 into Speed → clamps to 10000 on commit; Power >100 → 100).
- Set X param = **Pulse width** → the X Min/Max become dropdowns and the Steps field disappears; set Min 60 / Max 150 → the grid shows 4 columns labelled 60, 80, 100, 150; the bottom axis values match.
- Export `.xs` for that pulse-width sweep; unzip → the `VECTOR_CUTTING` profiles carry only allowed pulse widths (60/80/100/150), no interpolated values.
- Switch X back to a range param (Speed) → numeric Min/Max/Steps return. Screenshot and review critically.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-18-spiral-test-machine-limits.md
git commit -m "docs(spiral-test): changelog for machine-aware parameter limits"
```

---

## Execution notes

- Branch: `feat/spiral-test-machine-limits` (off `main`). Push + draft PR when done; ready when CI is green.
- `buildSpiralTest`'s new `profile` arg defaults to `null` → existing callers/tests keep working unchanged; only the page passes a real profile.
- Pulse width always renders as a select (the loading fallback is `ALLOWED_PULSE_WIDTHS`), so the UI is consistent before/after the registry loads.
- Scope: cut sweep params only — the label-engrave panel and the fixed cut laser (`red`) are unchanged.
- Do NOT touch the other Spiral feature files (`SpiralPage`, `SpiralControls`, `SpiralCanvas`, `spiral.ts`, `presets.ts`).
```
