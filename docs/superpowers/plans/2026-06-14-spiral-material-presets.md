# Spiral Cut — brass-thickness presets + per-thickness baselines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brass-thickness selector (1, 1.5, 2, 3, 4 mm) to the Spiral Cut page where each thickness owns its own independently-saved spiral preset and its own incise baseline for the "% of incise" comparison.

**Architecture:** A pure `materialState` module holds a per-thickness map of `ForgeConfig` (persisted under `spiral.material.v1`, migrating from the old single `spiral.config.v1`). `SpiralPage` derives the live `config`/`setConfig` from the active thickness, so all downstream components are unchanged. Each `SpiralConfig` gains `baselineIncise {speed, passes}`, which `estimate.ts::baselineSeconds` uses to make the baseline thickness-aware. A new `MaterialSelector` segmented control switches the active thickness.

**Tech Stack:** TypeScript, React, Vite, Vitest. Spec: `docs/superpowers/specs/2026-06-14-spiral-material-presets-design.md`.

**Branch:** `feat/spiral-material-presets` (already created off `main`).

**Run/verify (from `web/`):** unit `npx vitest run <file>`; typecheck `npx tsc --noEmit`; full `npm test`; build `npm run build` (required before browser test — backend serves `web/dist/`); browser `http://127.0.0.1:8017/#/spiral`, sample `/Users/jonzky/Documents/XTools/demo-files/Amelia.xs`.

---

## File structure

- `web/src/lib/forge/types.ts` — `MaterialThicknessMm` type, `MATERIAL_THICKNESSES_MM` list, `SpiralConfig.baselineIncise`.
- `web/src/lib/forge/presets.ts` — default `baselineIncise` on the two spiral literals.
- `web/src/lib/forge/estimate.ts` — `baselineSeconds` uses `config.spiral.baselineIncise`.
- `web/src/lib/forge/materialState.ts` — **new**: `MaterialState` type, `loadMaterialState`, `serializeMaterialState`, keys. Pure (storage passed in) → unit-testable.
- `web/src/components/forge/MaterialSelector.tsx` — **new**: segmented thickness selector.
- `web/src/pages/SpiralPage.tsx` — back `config`/`setConfig` with `MaterialState`; persist + migrate; render the selector.
- `web/src/components/forge/SpiralControls.tsx` — "Baseline incise" speed/passes fields.
- Tests: `web/src/lib/forge/materialState.test.ts` (new), additions to `estimate.test.ts` and `presets.test.ts`.
- `changelog/2026-06-14-spiral-material-presets.md` — **new**.

---

## Task 1: Types + materials list + `baselineIncise` field + defaults

**Files:**
- Modify: `web/src/lib/forge/types.ts`
- Modify: `web/src/lib/forge/presets.ts`
- Test: `web/src/lib/forge/presets.test.ts`

- [ ] **Step 1: Add the type, list, and field**

In `web/src/lib/forge/types.ts`, add near the top (after the existing type aliases, before `SpiralConfig`):

```ts
/** Brass thicknesses (mm) the Spiral Cut page offers as presets. */
export type MaterialThicknessMm = 1 | 1.5 | 2 | 3 | 4;
export const MATERIAL_THICKNESSES_MM: MaterialThicknessMm[] = [1, 1.5, 2, 3, 4];
```

In the `SpiralConfig` interface (after `neckOverlapMm` / `cutShortestFirst`), add:

```ts
  /** Reference incise rate for the "% of incise" baseline comparison. Per brass
   *  thickness; overrides the imported source's params when computing the baseline. */
  baselineIncise: { speed: number; passes: number };
```

- [ ] **Step 2: Add the default to BOTH spiral literals**

In `web/src/lib/forge/presets.ts`, the `COMMON.spiral` literal and the `SPIRAL_CUT.spiral` literal each end with `cutShortestFirst: true,`. Add `baselineIncise` to each:

```ts
    cutShortestFirst: true,
    baselineIncise: { speed: 1500, passes: 500 },
  },
```

(Apply to both occurrences — the `COMMON` block and the `SPIRAL_CUT` block.)

- [ ] **Step 3: Write the test**

Append to `web/src/lib/forge/presets.test.ts`:

```ts
import { MATERIAL_THICKNESSES_MM } from "./types";

describe("material thickness + baseline defaults", () => {
  it("exposes the five brass thicknesses", () => {
    expect(MATERIAL_THICKNESSES_MM).toEqual([1, 1.5, 2, 3, 4]);
  });
  it("SPIRAL_CUT has a default baselineIncise", () => {
    expect(SPIRAL_CUT.spiral.baselineIncise).toEqual({ speed: 1500, passes: 500 });
  });
});
```

(`SPIRAL_CUT` is already imported in `presets.test.ts`; if not, add `import { SPIRAL_CUT } from "./presets";`. `describe`/`it`/`expect` are globals via vitest config — match the file's existing import style.)

- [ ] **Step 4: Run test + typecheck**

Run: `cd web && npx vitest run src/lib/forge/presets.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc clean. (tsc will fail if any other `SpiralConfig` literal lacks `baselineIncise` — there should be none beyond the two in presets.ts; if tsc reports one, add the field there too.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/presets.ts web/src/lib/forge/presets.test.ts
git commit -m "feat(forge): MaterialThicknessMm list + SpiralConfig.baselineIncise default"
```

---

## Task 2: Thickness-aware baseline in `estimate.ts`

**Files:**
- Modify: `web/src/lib/forge/estimate.ts` (`baselineSeconds`, ~line 72)
- Test: `web/src/lib/forge/estimate.test.ts`

- [ ] **Step 1: Use `config.spiral.baselineIncise` for the baseline rate**

In `web/src/lib/forge/estimate.ts`, replace the body of `baselineSeconds`:

```ts
function baselineSeconds(
  part: Pt[][], config: ForgeConfig, source: StageParams | undefined,
  calib: CutTimeCalibration,
): number {
  const rings = bandFromRegion(part, config.beamWidthMm, config.sideMode);
  if (rings.length < 2) return 0;
  // The baseline incise rate is per brass thickness (config.spiral.baselineIncise);
  // it overrides the imported source's params, falling back to source per-field.
  const bi = config.spiral.baselineIncise;
  const baselineParams: StageParams | undefined = bi
    ? ({ speed: bi.speed, passes: bi.passes } as StageParams)
    : undefined;
  const rate = effectiveRate(baselineParams, source);
  return stageSeconds(geomOf(rings), rate, calib);
}
```

(`StageParams` is already imported in `estimate.ts`. `effectiveRate(resolved, source)` already does `resolved?.[k] ?? source?.[k]`, so `speed`/`passes` come from `baselineIncise` and the rest fall back to `source`.)

- [ ] **Step 2: Write the test**

Append to `web/src/lib/forge/estimate.test.ts` (it already imports `estimateForge`, `SPIRAL_CUT`, and builds a `spiralPath` + `part`; reuse those — check the top of the file for the exact fixture names and mirror them):

```ts
describe("baseline is thickness-aware (baselineIncise)", () => {
  it("a slower baseline incise yields a larger baselineSeconds", () => {
    // square part + one spiral path (reuse the file's helpers if present).
    const part = [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]];
    const spiralPath = generateSpiralPaths(part, SPIRAL_CUT, "o");
    const fast = structuredClone(SPIRAL_CUT);
    fast.spiral.baselineIncise = { speed: 2000, passes: 100 };
    const slow = structuredClone(SPIRAL_CUT);
    slow.spiral.baselineIncise = { speed: 200, passes: 100 };
    const eFast = estimateForge(spiralPath, part, fast, undefined);
    const eSlow = estimateForge(spiralPath, part, slow, undefined);
    expect(eSlow.baselineSeconds).toBeGreaterThan(eFast.baselineSeconds);
    // % of incise is inverse: slower baseline → smaller overheadPct
    expect(eSlow.overheadPct).toBeLessThan(eFast.overheadPct);
  });
});
```

(Add `import { generateSpiralPaths } from "./spiral";` if not already imported. If `estimate.test.ts` already defines a `part`/`spiralPath` fixture, use those names instead of redefining.)

- [ ] **Step 3: Run test + typecheck**

Run: `cd web && npx vitest run src/lib/forge/estimate.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/forge/estimate.ts web/src/lib/forge/estimate.test.ts
git commit -m "feat(forge): baseline uses per-thickness baselineIncise rate"
```

---

## Task 3: `materialState` module (load / migrate / serialize)

**Files:**
- Create: `web/src/lib/forge/materialState.ts`
- Test: `web/src/lib/forge/materialState.test.ts`

- [ ] **Step 1: Write the module**

Create `web/src/lib/forge/materialState.ts`:

```ts
// web/src/lib/forge/materialState.ts
// Per-brass-thickness spiral configs for the Spiral Cut page. Each thickness
// owns a full ForgeConfig, persisted independently. Pure (storage passed in).
import type { ForgeConfig, MaterialThicknessMm } from "./types";
import { MATERIAL_THICKNESSES_MM } from "./types";
import { SPIRAL_CUT } from "./presets";

export const MATERIAL_LS_KEY = "spiral.material.v1";
export const OLD_CONFIG_LS_KEY = "spiral.config.v1";

export interface MaterialState {
  activeThicknessMm: MaterialThicknessMm;
  configs: Record<string, ForgeConfig>; // keyed by String(thicknessMm)
}

/** Floor a persisted (partial) config on SPIRAL_CUT, restoring only the fields
 *  the Spiral page mutates and enforcing the spiral-only invariants. Mirrors the
 *  page's previous loadConfig merge. */
function thicknessConfig(persisted: Partial<ForgeConfig> | undefined): ForgeConfig {
  const base = structuredClone(SPIRAL_CUT);
  if (!persisted) return base;
  return {
    ...base,
    beamWidthMm: persisted.beamWidthMm ?? base.beamWidthMm,
    mmPerUnitOverride: persisted.mmPerUnitOverride ?? base.mmPerUnitOverride,
    spiral: { ...base.spiral, ...(persisted.spiral ?? {}), enabled: true },
    stageParams: persisted.stageParams ?? base.stageParams,
    activePreset: "spiral",
  };
}

function allDefault(): Record<string, ForgeConfig> {
  const configs: Record<string, ForgeConfig> = {};
  for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = structuredClone(SPIRAL_CUT);
  return configs;
}

/**
 * Load the per-thickness state from storage. Prefers the new key; otherwise
 * MIGRATES from the old single `spiral.config.v1` (seeding EVERY thickness from
 * it so a returning user keeps their tuning). Falls back to all-defaults on any
 * parse error. Side-effect free — the caller persists + removes the old key.
 */
export function loadMaterialState(getItem: (k: string) => string | null): MaterialState {
  try {
    const rawNew = getItem(MATERIAL_LS_KEY);
    if (rawNew) {
      const parsed = JSON.parse(rawNew) as {
        activeThicknessMm?: number;
        configs?: Record<string, Partial<ForgeConfig>>;
      };
      const configs: Record<string, ForgeConfig> = {};
      for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(parsed.configs?.[String(mm)]);
      const active = (MATERIAL_THICKNESSES_MM as number[]).includes(parsed.activeThicknessMm as number)
        ? (parsed.activeThicknessMm as MaterialThicknessMm)
        : MATERIAL_THICKNESSES_MM[0];
      return { activeThicknessMm: active, configs };
    }
    // Migrate from the old single-config key.
    const rawOld = getItem(OLD_CONFIG_LS_KEY);
    const old = rawOld ? (JSON.parse(rawOld) as Partial<ForgeConfig>) : undefined;
    const configs: Record<string, ForgeConfig> = {};
    for (const mm of MATERIAL_THICKNESSES_MM) configs[String(mm)] = thicknessConfig(old);
    return { activeThicknessMm: MATERIAL_THICKNESSES_MM[0], configs };
  } catch {
    return { activeThicknessMm: MATERIAL_THICKNESSES_MM[0], configs: allDefault() };
  }
}

export function serializeMaterialState(s: MaterialState): string {
  return JSON.stringify(s);
}
```

- [ ] **Step 2: Write the tests**

Create `web/src/lib/forge/materialState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadMaterialState, serializeMaterialState, MATERIAL_LS_KEY, OLD_CONFIG_LS_KEY } from "./materialState";
import { MATERIAL_THICKNESSES_MM } from "./types";
import { SPIRAL_CUT } from "./presets";

/** A fake getItem backed by a plain map. */
const store = (m: Record<string, string>) => (k: string) => (k in m ? m[k] : null);

describe("loadMaterialState", () => {
  it("fresh (no keys) → all five thicknesses default to SPIRAL_CUT, active 1mm", () => {
    const s = loadMaterialState(store({}));
    expect(s.activeThicknessMm).toBe(1);
    expect(Object.keys(s.configs).sort()).toEqual(MATERIAL_THICKNESSES_MM.map(String).sort());
    expect(s.configs["2"].spiral.channelWidthMm).toBe(SPIRAL_CUT.spiral.channelWidthMm);
    expect(s.configs["4"].spiral.baselineIncise).toEqual(SPIRAL_CUT.spiral.baselineIncise);
  });

  it("migrates from the old single config → every thickness seeded from it", () => {
    const old = JSON.stringify({ spiral: { ...SPIRAL_CUT.spiral, channelWidthMm: 0.99 } });
    const s = loadMaterialState(store({ [OLD_CONFIG_LS_KEY]: old }));
    for (const mm of MATERIAL_THICKNESSES_MM) {
      expect(s.configs[String(mm)].spiral.channelWidthMm).toBe(0.99);
    }
  });

  it("new key wins over old; restores active + per-thickness fields", () => {
    const state = {
      activeThicknessMm: 3,
      configs: { "3": { spiral: { ...SPIRAL_CUT.spiral, pitchMm: 0.07 } } },
    };
    const s = loadMaterialState(store({ [MATERIAL_LS_KEY]: JSON.stringify(state), [OLD_CONFIG_LS_KEY]: "{}" }));
    expect(s.activeThicknessMm).toBe(3);
    expect(s.configs["3"].spiral.pitchMm).toBe(0.07);
    // unset thickness falls back to default
    expect(s.configs["1"].spiral.pitchMm).toBe(SPIRAL_CUT.spiral.pitchMm);
  });

  it("round-trips through serialize", () => {
    const s = loadMaterialState(store({}));
    s.configs["2"].spiral.channelWidthMm = 0.6;
    const back = loadMaterialState(store({ [MATERIAL_LS_KEY]: serializeMaterialState(s) }));
    expect(back.configs["2"].spiral.channelWidthMm).toBe(0.6);
    expect(back.configs["1"].spiral.channelWidthMm).toBe(SPIRAL_CUT.spiral.channelWidthMm);
  });

  it("corrupt JSON → all-defaults fallback", () => {
    const s = loadMaterialState(store({ [MATERIAL_LS_KEY]: "{not json" }));
    expect(s.activeThicknessMm).toBe(1);
    expect(s.configs["1"].spiral.channelWidthMm).toBe(SPIRAL_CUT.spiral.channelWidthMm);
  });

  it("always enforces spiral.enabled = true", () => {
    const old = JSON.stringify({ spiral: { ...SPIRAL_CUT.spiral, enabled: false } });
    const s = loadMaterialState(store({ [OLD_CONFIG_LS_KEY]: old }));
    expect(s.configs["1"].spiral.enabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests + typecheck**

Run: `cd web && npx vitest run src/lib/forge/materialState.test.ts && npx tsc --noEmit`
Expected: 6 PASS; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/forge/materialState.ts web/src/lib/forge/materialState.test.ts
git commit -m "feat(forge): per-thickness materialState load/migrate/serialize"
```

---

## Task 4: `MaterialSelector` component

**Files:**
- Create: `web/src/components/forge/MaterialSelector.tsx`

- [ ] **Step 1: Write the component**

Create `web/src/components/forge/MaterialSelector.tsx`:

```tsx
// web/src/components/forge/MaterialSelector.tsx
// Brass-thickness selector for the Spiral Cut page. Each thickness owns its own
// saved spiral preset + baseline; switching swaps the live config.
import type { MaterialThicknessMm } from "../../lib/forge/types";
import { MATERIAL_THICKNESSES_MM } from "../../lib/forge/types";
import { Card } from "../../ui";

export interface MaterialSelectorProps {
  value: MaterialThicknessMm;
  onChange: (mm: MaterialThicknessMm) => void;
}

export function MaterialSelector({ value, onChange }: MaterialSelectorProps) {
  return (
    <Card className="p-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
          Brass
        </span>
        <div role="tablist" aria-label="Brass thickness" className="flex flex-1 gap-1">
          {MATERIAL_THICKNESSES_MM.map((mm) => {
            const active = mm === value;
            return (
              <button
                key={mm}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(mm)}
                className={
                  "flex-1 rounded-[5px] px-2 py-1 font-mono text-[11px] tabular-nums transition-colors " +
                  (active
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary,#fff)]"
                    : "border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
                }
              >
                {mm} mm
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
```

(Verify `Card` is exported from `web/src/ui` — it is used by `SpiralControls.tsx` via `import { Card, ... } from "../../ui"`. If `--color-on-primary` isn't defined, the fallback `#fff` applies, matching the existing tab button in `ForgeStageParams`.)

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/forge/MaterialSelector.tsx
git commit -m "feat(forge): MaterialSelector brass-thickness segmented control"
```

---

## Task 5: Wire `SpiralPage` to per-thickness state + render the selector

**Files:**
- Modify: `web/src/pages/SpiralPage.tsx`
- Verify: browser

**Context:** Today `SpiralPage` holds one `config` (`useState(loadConfig)`), persists it to `CONFIG_LS_KEY`, and passes `config`/`setConfig` to `useForgeEngine`, `SpiralControls`, and `ForgeStageParams`. We back `config`/`setConfig` with `MaterialState` so those consumers are unchanged, add the selector, and migrate persistence.

- [ ] **Step 1: Swap imports + remove the old loader**

In `SpiralPage.tsx`:
- Add imports:
  ```ts
  import { loadMaterialState, serializeMaterialState, MATERIAL_LS_KEY, OLD_CONFIG_LS_KEY, type MaterialState } from "../lib/forge/materialState";
  import { MaterialSelector } from "../components/forge/MaterialSelector";
  import type { MaterialThicknessMm } from "../lib/forge/types";
  ```
- DELETE the `const CONFIG_LS_KEY = "spiral.config.v1";` line and the entire `function loadConfig(): ForgeConfig { ... }` block (now replaced by `materialState`).

- [ ] **Step 2: Replace the config state with material-backed state**

Replace `const [config, setConfig] = useState<ForgeConfig>(loadConfig);` with:

```ts
  const [material, setMaterial] = useState<MaterialState>(() => loadMaterialState((k) => localStorage.getItem(k)));
  const config = material.configs[String(material.activeThicknessMm)];
  const setConfig = useCallback((next: ForgeConfig) => {
    setMaterial((m) => ({ ...m, configs: { ...m.configs, [String(m.activeThicknessMm)]: next } }));
  }, []);
  const setActiveThickness = useCallback((mm: MaterialThicknessMm) => {
    setMaterial((m) => ({ ...m, activeThicknessMm: mm }));
  }, []);
```

(Add `useCallback` to the React import if not present.)

- [ ] **Step 3: Replace the persistence effect (persist new key + drop old)**

Replace the existing persist effect:

```ts
  // persist config to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_LS_KEY, JSON.stringify(config));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [config]);
```

with:

```ts
  // Persist the per-thickness material map; drop the pre-material single-config key.
  useEffect(() => {
    try {
      localStorage.setItem(MATERIAL_LS_KEY, serializeMaterialState(material));
      localStorage.removeItem(OLD_CONFIG_LS_KEY);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [material]);
```

- [ ] **Step 4: Render the selector above the Cut-geometry controls**

Find where `<SpiralControls config={config} onChange={setConfig} />` is rendered in the right rail (the controls column). Immediately BEFORE it, add:

```tsx
              <MaterialSelector value={material.activeThicknessMm} onChange={setActiveThickness} />
```

(Place it as the first child of the right-rail controls container so it sits above "Cut geometry". Keep the existing `SpiralControls` / `ForgeStageParams` exactly as they are — they already use `config`/`setConfig`.)

- [ ] **Step 5: Build + browser-verify**

```bash
cd web && npx tsc --noEmit && npm run build
```
At `http://127.0.0.1:8017/#/spiral` upload `/Users/jonzky/Documents/XTools/demo-files/Amelia.xs`. Confirm:
- A "Brass 1 · 1.5 · 2 · 3 · 4 mm" selector sits above Cut geometry; 1 mm active by default.
- Change Channel width on 2 mm; switch to 4 mm → it shows the default (unchanged); switch back to 2 mm → your change is retained.
- Reload the page → the 2 mm change persists and the active thickness is remembered.
- In devtools Application→localStorage: `spiral.material.v1` exists, `spiral.config.v1` is gone.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/SpiralPage.tsx
git commit -m "feat(forge): Spiral page backed by per-thickness material presets + selector"
```

---

## Task 6: "Baseline incise" fields in `SpiralControls`

**Files:**
- Modify: `web/src/components/forge/SpiralControls.tsx`
- Verify: browser

**Context:** `SpiralControls` renders the Cut-geometry card with `Field` + `NumberField` widgets, mutating via `patchSpiral(p: Partial<SpiralConfig>)`. Add a speed/passes pair bound to `config.spiral.baselineIncise`.

- [ ] **Step 1: Add the Baseline incise fields**

In `SpiralControls.tsx`, inside the Cut-geometry grid (after the "Cut shortest first" `Field`, before the grid closes), add:

```tsx
          <Field label="Baseline incise — speed (mm/s)" hint="Reference incise rate for the % comparison (per thickness)">
            <NumberField
              value={config.spiral.baselineIncise.speed}
              step={50}
              min={1}
              onChange={(v) => patchSpiral({ baselineIncise: { ...config.spiral.baselineIncise, speed: Math.max(1, v) } })}
            />
          </Field>
          <Field label="Baseline incise — passes">
            <NumberField
              value={config.spiral.baselineIncise.passes}
              step={10}
              min={1}
              onChange={(v) => patchSpiral({ baselineIncise: { ...config.spiral.baselineIncise, passes: Math.max(1, v) } })}
            />
          </Field>
```

(`Field`, `NumberField`, and `patchSpiral` already exist in this file. `patchSpiral` sets `activePreset: "custom"` — acceptable.)

- [ ] **Step 2: Build + browser-verify**

```bash
cd web && npx tsc --noEmit && npm run build
```
At the Spiral page with Amelia loaded: the Cut-geometry card shows "Baseline incise — speed / passes". On 1 mm, set speed to a low value (e.g. 300) → the top "% of incise / vs baseline" readout changes (lower % / longer baseline). Switch to 2 mm → it shows the default again (independent). Switch back → retained.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/forge/SpiralControls.tsx
git commit -m "feat(forge): per-thickness Baseline incise (speed/passes) controls"
```

---

## Task 7: Changelog + full gate + PR

**Files:**
- Create: `changelog/2026-06-14-spiral-material-presets.md`
- Verify: full suite, build, browser

- [ ] **Step 1: Changelog**

```markdown
---
id: 2026-06-14-spiral-material-presets
date: 2026-06-14
level: minor
title: Spiral Cut — brass-thickness presets
summary: Pick 1 / 1.5 / 2 / 3 / 4 mm brass on the Spiral Cut page. Each thickness keeps its own saved cut settings and its own incise baseline for the "% of incise" comparison, so you can tune and compare per thickness.
---
```

- [ ] **Step 2: Full gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all tests pass, build succeeds.

- [ ] **Step 3: Browser integration pass**

At the Spiral page with Amelia: switch across all five thicknesses; edit geometry + baseline-incise on two of them; confirm each persists independently across a reload and the "% of incise" tracks the active thickness's baseline.

- [ ] **Step 4: Commit + push + PR**

```bash
git add changelog/2026-06-14-spiral-material-presets.md
git commit -m "docs(changelog): spiral brass-thickness presets"
git push -u origin feat/spiral-material-presets
gh pr create --draft --title "feat(forge): Spiral Cut brass-thickness presets + per-thickness baselines" --body "<summary, verification, link to spec>"
```
Flip to ready when CI is green (`gh pr ready`).

---

## Self-review notes (author)

- **Spec coverage:** thicknesses list + per-thickness config (Task 1,3,5) ✓; independent persistence + migration (Task 3,5) ✓; per-thickness baselineIncise → auto baseline (Task 1,2) ✓; baseline-incise UI (Task 6) ✓; selector UI + placement (Task 4,5) ✓; defaults shared now (Task 1,3) ✓; changelog (Task 7) ✓.
- **Type consistency:** `MaterialThicknessMm`, `MATERIAL_THICKNESSES_MM`, `baselineIncise {speed,passes}` defined in Task 1 and used identically in Tasks 2,3,4,6; `MaterialState`/`loadMaterialState`/`serializeMaterialState`/`MATERIAL_LS_KEY`/`OLD_CONFIG_LS_KEY` defined in Task 3 and consumed in Task 5; `config`/`setConfig`/`setActiveThickness` shapes match the existing consumers.
- **Known follow-ups (out of scope):** distinct tuned values per thickness (user fills later); active-thickness label in the estimate caption.
```
