# Forge Stage-Param Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace Forge's free-number stage-param fields with machine-profile-constrained widgets (pulse width as the shared dropdown, etc.) pre-filled from the source incise's values, and replace the lone "Z layers" field with xStudio's Z-descent control (Descend at Z-axis / every N layers / by mm / slices) plus live depth stats.

**Architecture:** Client-side only. (1) Extend `StageParams` + expose each cut target's source params via parse; (2) a pure depth-stats helper; (3) rebuild `ForgeStageParams` to render `COLOR_ENGRAVE`-profile-constrained widgets seeded from source values, with a Z-descent group + stats, wired with the selected target's source params.

**Spec:** `docs/superpowers/specs/2026-05-31-forge-stage-params-design.md`
**Branch:** `feat/forge-incise-only` (combined with the incise-only work).
**Conventions:** tests `cd web && npx vitest run <path>`; typecheck `cd web && npx tsc --noEmit`; build `cd web && npm run build`. Pre-commit hooks flag unused imports — no `--no-verify`. Reuse existing `web/src/components/dynamic-form/*` widgets + `PulseWidthSelect`.

---

## Task 1: Lib — extend StageParams, expose source params, map on export

**Files:** Modify `web/src/lib/forge/types.ts`, `web/src/lib/forge/xcs.ts`; Test `web/src/lib/forge/xcs.test.ts`.

- [ ] **Step 1: Write the failing tests** (add to `xcs.test.ts`)

```ts
describe("source params (incise customize → StageParams)", () => {
  it("attaches mapped params to the cut target (test-text.xcs)", () => {
    const parsed = parseXcsFile(loadText());          // loadText added in the prior feature
    const p = parsed.targets[0].params!;
    expect(p.power).toBe(1);
    expect(p.speed).toBe(80);
    expect(p.passes).toBe(1);          // customize.repeat
    expect(p.pulseWidth).toBe(200);
    expect(p.frequency).toBe(65);      // customize.mopaFrequency
    expect(p.density).toBe(100);
    expect(p.laser).toBe("blue");      // customize.processingLightSource
    expect(p.zAxisMove).toBe(false);
    expect(p.zLayers).toBe(1);
    expect(p.zDecline).toBeCloseTo(0.01, 4);
    expect(p.sliceNumber).toBe(100);
  });
});

describe("applyStageParams (new fields)", () => {
  it("writes density, laser, and the z-descent fields into the INTAGLIO customize", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const seed = paths.find((p) => p.groupName === "CUT_01_SEED")!;
    const stageParams = {
      CUT_01_SEED: { density: 222, laser: "red" as const, zAxisMove: true, zLayers: 8, zDecline: 0.05, sliceNumber: 256 },
    };
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit, stageParams) as {
      device: { data: { value: Array<[string, { displays: { value: Array<[string, { data: { INTAGLIO: { parameter: { customize: Record<string, unknown> } } } }]> } }]> } };
    };
    const entries = out.device.data.value.flatMap(([, g]) => g.displays.value);
    const c = entries.find(([id]) => id === `forge-${seed.operationOrder}`)![1].data.INTAGLIO.parameter.customize;
    expect(c.density).toBe(222);
    expect(c.processingLightSource).toBe("red");
    expect(c.zAxisMove).toBe(true);
    expect(c.zLayers).toBe(8);
    expect(c.zDecline).toBe(0.05);
    expect(c.sliceNumber).toBe(256);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts -t "source params|applyStageParams"`
Expected: FAIL — `params` undefined on the target; new customize fields not written.

- [ ] **Step 3: Extend `StageParams` + `XcsObject` in `types.ts`**

Replace the `StageParams` interface with:

```ts
/** Rough per-stage laser params. All optional — undefined = inherit source. */
export interface StageParams {
  power?: number; // %
  speed?: number; // mm/s
  passes?: number; // → customize.repeat
  pulseWidth?: number; // ns (MOPA)
  frequency?: number; // kHz (→ customize.mopaFrequency)
  density?: number; // lines/cm (→ customize.density)
  laser?: "red" | "blue"; // → customize.processingLightSource
  zAxisMove?: boolean; // "Descend at Z-axis" (→ customize.zAxisMove)
  zLayers?: number; // descend every N layers (→ customize.zLayers)
  zDecline?: number; // mm per descent step (→ customize.zDecline)
  sliceNumber?: number; // total layers/slices (→ customize.sliceNumber)
}
```

Add to `XcsObject` (after `hasGeometry`):

```ts
  /** Source laser params read from this object's INTAGLIO customize (cut
   *  targets only); used to pre-fill the per-stage param widgets. */
  params?: StageParams;
```

(Import is same module, no new import.)

- [ ] **Step 4: Read source customize during parse — `xcs.ts`**

Add a helper near `classify` (it reads an INTAGLIO customize object into `StageParams`):

```ts
/** Map an INTAGLIO `customize` block to the StageParams we expose. */
function readStageParams(customize: Record<string, unknown> | undefined): import("./types").StageParams | undefined {
  if (!customize) return undefined;
  const num = (k: string) => (typeof customize[k] === "number" ? (customize[k] as number) : undefined);
  const laser = customize.processingLightSource;
  return {
    power: num("power"),
    speed: num("speed"),
    passes: num("repeat"),
    pulseWidth: num("pulseWidth"),
    frequency: num("mopaFrequency"),
    density: num("density"),
    laser: laser === "red" || laser === "blue" ? laser : undefined,
    zAxisMove: typeof customize.zAxisMove === "boolean" ? customize.zAxisMove : undefined,
    zLayers: num("zLayers"),
    zDecline: num("zDecline"),
    sliceNumber: num("sliceNumber"),
  };
}
```

In `parseXcsFile`, the device-map loop already has `entry` (the processing entry). Read its INTAGLIO customize for incise objects. Change the `objects.push({...})` so it includes `params`:

```ts
      const processingType = entry.processingType ?? null;
      const modeClass = classify(processingType);
      const entryData = (entry as { data?: Record<string, { parameter?: { customize?: Record<string, unknown> } }> }).data;
      const params =
        modeClass === "incise" ? readStageParams(entryData?.INTAGLIO?.parameter?.customize) : undefined;
      objects.push({
        id: displayId,
        type: disp.type ?? entry.type ?? "UNKNOWN",
        name: disp.name ?? null,
        processingType,
        modeClass,
        dPath: disp.dPath,
        hasGeometry: !!disp.dPath,
        params,
        groupKey,
      });
```

- [ ] **Step 5: Extend `applyStageParams` — `xcs.ts`**

Add `setStr`/`setBool` helpers beside `set`, and the new mappings:

```ts
  const set = (key: string, v: number | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) customize[key] = v;
  };
  const setStr = (key: string, v: string | undefined) => {
    if (typeof v === "string" && v) customize[key] = v;
  };
  const setBool = (key: string, v: boolean | undefined) => {
    if (typeof v === "boolean") customize[key] = v;
  };
  set("power", params.power);
  set("speed", params.speed);
  set("repeat", params.passes);
  set("pulseWidth", params.pulseWidth);
  set("mopaFrequency", params.frequency);
  set("density", params.density);
  setStr("processingLightSource", params.laser);
  setBool("zAxisMove", params.zAxisMove);
  set("zLayers", params.zLayers);
  set("zDecline", params.zDecline);
  set("sliceNumber", params.sliceNumber);
```

- [ ] **Step 6: Run tests + tsc + full lib suite**

Run: `cd web && npx tsc --noEmit && npx vitest run src/lib/forge/`
Expected: PASS (new tests green; existing tests unaffected — `applyStageParams` still writes power/speed/repeat as before, the `params` field is additive).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/xcs.ts web/src/lib/forge/xcs.test.ts
git commit -m "feat(forge): expose source stage params + map density/laser/z-descent on export"
```

---

## Task 2: Lib — depth-stat helper

**Files:** Create `web/src/lib/forge/depth.ts`; Test `web/src/lib/forge/depth.test.ts`.

- [ ] **Step 1: Write the failing test** (`depth.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { descentDepthMm } from "./depth";

describe("descentDepthMm", () => {
  it("total depth = (layers / everyN) * byMm", () => {
    expect(descentDepthMm(256, 10, 0.08)).toBeCloseTo(2.048, 3);
    expect(descentDepthMm(100, 1, 0.01)).toBeCloseTo(1.0, 3);
  });
  it("returns 0 for a non-positive interval (no divide-by-zero)", () => {
    expect(descentDepthMm(256, 0, 0.08)).toBe(0);
    expect(descentDepthMm(256, -1, 0.08)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/depth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `depth.ts`**

```ts
// web/src/lib/forge/depth.ts
/**
 * Total Z descent (mm) for a Z-axis-descend incise: the head steps down by
 * `byMm` every `everyN` layers across `layers` total slices, so the cut floor
 * drops `(layers / everyN) * byMm`. Returns 0 for a non-positive interval.
 */
export function descentDepthMm(layers: number, everyN: number, byMm: number): number {
  if (!(everyN > 0)) return 0;
  return (layers / everyN) * byMm;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/depth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/depth.ts web/src/lib/forge/depth.test.ts
git commit -m "feat(forge): pure depth-stat helper for Z-descent"
```

---

## Task 2B: Lib — deepen param linking (copy from first deepen)

**Files:** Modify `web/src/lib/forge/types.ts`, `web/src/lib/forge/defaults.ts`, `web/src/lib/forge/config.ts`, `web/src/lib/forge/forge.worker.ts`, `web/src/lib/forge/xcs.ts` (1-line comment); Test `web/src/lib/forge/config.test.ts`.

- [ ] **Step 1: Write the failing test** (add to `config.test.ts`)

```ts
import { resolveStageParams } from "./config";
import { DEFAULT_CONFIG } from "./defaults";

describe("resolveStageParams (deepen linking)", () => {
  const names = DEFAULT_CONFIG.deepen.groups.map((g) => g.name);
  const [A, B, C, D] = names;

  it("copies the first deepen group's params to later linked groups", () => {
    const cfg = { ...DEFAULT_CONFIG, stageParams: { [A]: { power: 77, speed: 120 } } };
    const r = resolveStageParams(cfg);
    expect(r[B]).toEqual({ power: 77, speed: 120 });
    expect(r[C]).toEqual({ power: 77, speed: 120 });
    expect(r[D]).toEqual({ power: 77, speed: 120 });
    expect(r[A]).toEqual({ power: 77, speed: 120 }); // first group unchanged
  });

  it("leaves an unlinked deepen group with its own params", () => {
    const groups = DEFAULT_CONFIG.deepen.groups.map((g, i) =>
      i === 1 ? { ...g, copyParamsFromFirst: false } : g);
    const cfg = {
      ...DEFAULT_CONFIG,
      deepen: { ...DEFAULT_CONFIG.deepen, groups },
      stageParams: { [A]: { power: 77 }, [B]: { power: 5 } },
    };
    const r = resolveStageParams(cfg);
    expect(r[B]).toEqual({ power: 5 });   // kept its own
    expect(r[C]).toEqual({ power: 77 });  // still linked → A's
  });

  it("a linked group with no first-group overrides resolves to empty", () => {
    const r = resolveStageParams(DEFAULT_CONFIG);
    expect(r[B]).toEqual({});
  });
});
```

- [ ] **Step 2: Run → expect FAIL** — `cd web && npx vitest run src/lib/forge/config.test.ts -t "resolveStageParams"`

- [ ] **Step 3: `types.ts` — add the flag to `DeepenGroup`**

```ts
export interface DeepenGroup {
  name: string;
  fromLayer: number;
  toLayer: number;
  widthMultiplier: number;
  enabled: boolean;
  /** Deepen groups after the first default to copying the first group's
   *  laser params; undefined is treated as true for non-first groups. */
  copyParamsFromFirst?: boolean;
}
```

- [ ] **Step 4: `defaults.ts` — set the flag on B/C/D**

In `DEFAULT_CONFIG.deepen.groups`, add `copyParamsFromFirst: true` to the three groups after the first (CUT_04/05/06). Leave the first (CUT_03) without it.

- [ ] **Step 5: `config.ts` — add `resolveStageParams`**

```ts
import type { ForgeConfig, StageParams } from "./types";

/**
 * Expand the per-stage override map for export: every deepen group after the
 * first whose `copyParamsFromFirst` is set (default true) inherits the FIRST
 * deepen group's overrides. Pure — returns a new map; never mutates config.
 */
export function resolveStageParams(config: ForgeConfig): Record<string, StageParams> {
  const out: Record<string, StageParams> = { ...config.stageParams };
  const groups = config.deepen.groups;
  if (groups.length === 0) return out;
  const firstName = groups[0].name;
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    if (g.copyParamsFromFirst ?? true) out[g.name] = config.stageParams[firstName] ?? {};
  }
  return out;
}
```

(Update the existing `import type { ForgeConfig } from "./types";` to also import `StageParams`.)

- [ ] **Step 6: `forge.worker.ts` — use resolved params on export**

Change the `export` handler's `buildGeneratedXcs(...)` call to pass `resolveStageParams(config)` instead of `config.stageParams`:

```ts
      const doc = buildGeneratedXcs(parsed, msg.inciseId, paths, stats.mmPerUnit, resolveStageParams(msg.config));
```

Add the import: `import { resolveStageParams } from "./config";`

- [ ] **Step 7: `xcs.ts` — document the INTAGLIO-key assumption** (review nit)

Add a one-line comment to `readStageParams` noting it reads the `INTAGLIO` customize block; `VECTOR_CUTTING` incise targets (not used in the current F2 Ultra Embossment workflow) would yield `undefined` params.

- [ ] **Step 8: Verify + commit**

Run: `cd web && npx tsc --noEmit && npx vitest run src/lib/forge/`
```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/defaults.ts web/src/lib/forge/config.ts web/src/lib/forge/config.test.ts web/src/lib/forge/forge.worker.ts web/src/lib/forge/xcs.ts
git commit -m "feat(forge): deepen groups copy params from the first deepen group"
```

---

## Task 3: UI — ForgeStageParams overhaul + ForgePage wiring

**Files:** Modify `web/src/components/forge/ForgeStageParams.tsx`, `web/src/pages/ForgePage.tsx`; Test `web/src/components/forge/ForgeStageParams.test.tsx`.

**Context for the implementer:**
- The active machine + profile: `import { useCurrentMachine, getValidationProfile } from "../../state/machine"`. Get `const { registry, machineId } = useCurrentMachine();` then `const profile = getValidationProfile(registry, machineId, "color_engrave");` (`ValidationProfile | null`). While `profile` is null (registry loading / non-F2 machine), fall back to free `NumberField`s so the panel still works.
- Widgets: `RangeField` ({label, unit?, min, max, step?, value, onChange}), `SteppedField` ({label, unit?, values, value, onChange}), `EnumField` (read its props in `web/src/components/dynamic-form/EnumField.tsx`), `PulseWidthSelect` ({label, value, onChange}). All from `../dynamic-form/*` / `../PulseWidthSelect`.
- Profile keys are snake_case (`power`,`density`,`frequency`,`speed`,`passes`,`pulse_width`,`laser`); `StageParams` keys are camelCase. Map: `pulse_width`↔`pulseWidth`; `frequency`↔`frequency`; `laser`↔`laser` (string); the rest 1:1.
- `ForgeStageParams` gains a `sourceParams?: StageParams` prop. The page passes the SELECTED target's `params` (see ForgePage step). The displayed value for a field = `config.stageParams[group]?.[field] ?? sourceParams?.[field] ?? <fallback>`.
- Editing a field writes the override into `config.stageParams[group]` (existing `setParam` pattern, but typed for number | string | boolean). DO NOT delete on a 0 anymore (0 is a legitimate value now); instead a per-stage **"Reset to source"** button clears `config.stageParams[group]` entirely.
- Keep the existing stage-tab structure (`stageList`, `activeIdx`).

- [ ] **Step 1: Write the failing component test** (`ForgeStageParams.test.tsx`)

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { ForgeStageParams } from "./ForgeStageParams";
import type { ForgeConfig, StageParams } from "../../lib/forge/types";
import { DEFAULT_CONFIG } from "../../lib/forge/defaults";

// Stub the machine hook so the COLOR_ENGRAVE profile is present synchronously.
vi.mock("../../state/machine", () => ({
  useCurrentMachine: () => ({ registry: {}, machineId: "F2Ultra", machine: null, setMachineId: () => {} }),
  getValidationProfile: () => ({
    power: { kind: "range", min: 1, max: 100, step: 1 },
    pulse_width: { kind: "stepped", values: [2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500] },
    laser: { kind: "enum", values: ["red", "blue"] },
  }),
}));

function Harness({ source }: { source?: StageParams }) {
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
  return <ForgeStageParams config={config} onChange={setConfig} sourceParams={source} />;
}

describe("ForgeStageParams (constrained widgets)", () => {
  it("renders pulse width as a preset dropdown, not a free number", () => {
    render(<Harness source={{ pulseWidth: 200 }} />);
    // a <select> exists carrying the preset options (200 ns present)
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getAllByRole("option").some((o) => /200/.test(o.textContent ?? ""))).toBe(true);
  });
});
```

(Adjust the queries to the real DOM the chosen widgets render — the intent is: pulse width is a select with preset options, seeded from `sourceParams`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/forge/ForgeStageParams.test.tsx`
Expected: FAIL (pulse width still a NumberField; `sourceParams` prop unused).

- [ ] **Step 3: Rebuild `ForgeStageParams.tsx`**

Implement per the Context above:
- Add `sourceParams?: StageParams` to `ForgeStageParamsProps`.
- Resolve `profile` via `useCurrentMachine`/`getValidationProfile(..., "color_engrave")`.
- For each profile field (in the order power, density, frequency, speed, passes, pulse_width, laser), render the constrained widget by `kind` (`range`→RangeField, `stepped`/pulse_width→PulseWidthSelect, `stepped` (others)→SteppedField, `enum`→EnumField, `not_applicable`→skip). Value = override ?? source ?? sensible default; onChange writes the override into `config.stageParams[group]`.
- When `profile` is null, fall back to the current `FIELDS` NumberField grid (minus zLayers — see below) so nothing breaks off-F2.
- Replace the single "Z layers" NumberField with a **Z-descent group**: a checkbox "Descend at Z-axis" (`zAxisMove`, value = override ?? source ?? false); when true, show "Every N layers" (`zLayers`), "By mm" (`zDecline`, step 0.01), "Slices" (`sliceNumber`) as numeric fields, and two read-only stats computed with `descentDepthMm` (import from `../../lib/forge/depth`): **Total depth** = `descentDepthMm(slices, everyN, byMm)` and **Depth @ 256** = `descentDepthMm(256, everyN, byMm)`, formatted to 2–3 dp + " mm".
- Add a **"Reset to source"** button per stage that does `onChange({ ...config, stageParams: { ...config.stageParams, [group]: {} } })` (or deletes the key).
- **Deepen linking:** when the active stage is a deepen group **after the first** (its index in `config.deepen.groups` > 0), render a checkbox **"Copy from first deepen stage"** whose checked state = `group.copyParamsFromFirst ?? true`. While checked: the param widgets show the FIRST deepen group's effective values (`config.stageParams[firstDeepenName]?.[field] ?? sourceParams?.[field]`) and are **disabled**; the "Reset to source" button is hidden. Toggling the checkbox writes `copyParamsFromFirst` onto that group via `onChange` (update `config.deepen.groups[i]`); unchecked → widgets editable against the stage's own overrides. (Export already honours this via `resolveStageParams` from Task 2B — the UI only needs to reflect/drive the flag.)
- Update the caption: "overrides apply on export; cleared fields use the source incise value."

- [ ] **Step 4: Wire ForgePage to pass the selected target's source params**

In `web/src/pages/ForgePage.tsx`, where `ForgeStageParams` is rendered, pass:

```tsx
              <ForgeStageParams
                config={config}
                onChange={setConfig}
                sourceParams={
                  state.kind === "ready" && selectedIncise
                    ? state.objects.find((o) => o.id === selectedIncise)?.params
                    : undefined
                }
              />
```

(The `ForgeStageParams` render currently sits in the full-width bottom row; keep that placement.)

- [ ] **Step 5: Run component tests + tsc**

Run: `cd web && npx tsc --noEmit && npx vitest run src/components/forge/`
Expected: PASS — the new test + the existing `ForgeControls.test.tsx` and the existing `ForgeStageParams` deepen-name test (if it still applies; update its expectations only if the rebuild changed the relevant DOM).

- [ ] **Step 6: Build + commit**

Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK`
Then:
```bash
git add web/src/components/forge/ForgeStageParams.tsx web/src/components/forge/ForgeStageParams.test.tsx web/src/pages/ForgePage.tsx
git commit -m "feat(forge): machine-constrained stage params + Z-descent control with depth stats"
```

---

## Task 4: Changelog

**Files:** Create `changelog/2026-05-31-forge-stage-params.md`.

- [ ] **Step 1: Create the entry**

```markdown
---
id: 2026-05-31-forge-stage-params
date: 2026-05-31
level: minor
title: Forge — machine-aware stage params + Z-descent control
summary: Per-stage laser params now use the same constrained widgets as the rest of the app (pulse width is a preset dropdown), and "Z layers" is replaced by a proper Z-axis descent control with live depth readouts.
---

The Contour Forge stage-parameter panel now mirrors the rest of the app: each
field is constrained to the machine's allowed range (pulse width is the F2
Ultra preset **dropdown**, not a free number), pre-filled from the source
incise's own values so you edit from a sane starting point.

The opaque "Z layers" field is gone. In its place is xStudio's actual model —
**Descend at Z-axis** with **every N layers** and **by N mm** — plus two live
readouts: **total depth** and **depth @ 256 layers**, so you can sanity-check
the expected engraving depth before cutting.

And the deepen stages now share settings by default: B–D copy the first deepen
stage's params (uncheck "Copy from first deepen stage" on any of them to dial
it in separately).
```

- [ ] **Step 2: Verify build + commit**

Run: `cd web && npm run build > /dev/null 2>&1 && echo OK`
```bash
git add changelog/2026-05-31-forge-stage-params.md
git commit -m "docs(changelog): Forge machine-aware stage params + Z-descent"
```

---

## Task 5: Verify + finish branch

- [ ] **Step 1: tsc + full suite + build** — `cd web && npx tsc --noEmit && npm test && npm run build` (all green).
- [ ] **Step 2: Browser check** (server already serves `web/dist/`; Chrome DevTools MCP). On `#/forge` upload `test-text.xcs`, select the target, open the Stage parameters panel: confirm pulse width is a **dropdown** of presets seeded to 200; power/frequency/speed/density/passes are constrained widgets seeded from source; laser shows red/blue; the **Z-descent** group toggles and the **total depth / depth@256** readouts update live as you change every-N / by-mm. Take a screenshot and read it critically.
- [ ] **Step 3:** Use **superpowers:finishing-a-development-branch** to complete (push + PR covering BOTH the incise-only support and this stage-param overhaul).

---

## Self-Review (plan author)
- Spec coverage: COLOR_ENGRAVE profile widgets → Task 3; pulse-width dropdown → Task 3; pre-fill from source → Tasks 1 (expose) + 3 (consume); Z-descent control (zAxisMove/zLayers/zDecline/sliceNumber) + export mapping → Tasks 1 + 3; depth stats → Tasks 2 + 3; density/laser → Tasks 1 + 3; sparse storage + reset → Task 3; changelog → Task 4; verify → Task 5. No gaps.
- Type consistency: `StageParams` (number|string|boolean fields), `XcsObject.params`, `readStageParams`, `applyStageParams` set/setStr/setBool, `descentDepthMm(layers, everyN, byMm)`, `ForgeStageParams` `sourceParams` prop — consistent across tasks.
- Placeholders: none; code given for lib tasks. Task 3's widget wiring is specified by component + mapping (reuses existing dynamic-form components); the implementer reads `EnumField` props as noted.
