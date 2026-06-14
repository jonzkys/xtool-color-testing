# Spiral Neck-Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split thin features off the continuous perimeter spiral into their own short, heat-retaining arms (separate cut jobs), tagged as a distinct layer/group so they can later carry independent machine params.

**Architecture:** A clipper morphological split realises the approved "neck-split". `splitLobesAtNecks(part, neckWidth, overlap)` erodes the part region by `neckWidth/2`; necks narrower than `neckWidth` pinch off, leaving thick-lobe cores. Cores are recovered (dilated back + overlap, clipped to the part) as **main** lobes; thin material no core covers (the "residual") becomes **detail** lobes (grown by overlap so the join is double-cut). `generateSpiralPaths` spirals each lobe with the existing `spiralFromRegion` and tags detail-lobe arms with `STAGE_GROUPS.spiralDetail` (`CUT_09_SPIRAL_DETAIL`). Gated by a `splitNecks` toggle (default off) so the existing path is unchanged when off. This stays in the spiral generator and reuses `offsetRegion`/`clipExecute` — no surgery inside `buildStrands`.

**Tech Stack:** TypeScript, clipper-lib (via `web/src/lib/forge/offset.ts`), Vitest, React (controls).

---

## File structure

- `web/src/lib/forge/types.ts` — `SpiralConfig` gains `splitNecks`, `neckThresholdPct`, `neckOverlapMm`.
- `web/src/lib/forge/config.ts` — `STAGE_GROUPS.spiralDetail`; `resolveStageParams` emits the detail group (v1: copy of the spiral group).
- `web/src/lib/forge/presets.ts` — defaults on both spiral presets.
- `web/src/lib/forge/offset.ts` — new geometry: `regionComponents`, `splitLobesAtNecks` (+ `NeckLobe` type).
- `web/src/lib/forge/spiral.ts` — `generateSpiralPaths` uses `splitLobesAtNecks` when the toggle is on and tags arms by lobe kind.
- `web/src/components/forge/SpiralControls.tsx` — toggle + threshold + overlap controls.
- Tests: `offset.test.ts`, `spiral.test.ts`, `config.test.ts`.
- `changelog/2026-06-13-spiral-neck-split.md` — minor entry.

Run all commands from `web/`. Test runner: `npx vitest run <file>`. Full gate: `npx tsc --noEmit && npm test`.

---

### Task 1: Config schema, detail group, resolved params

**Files:**
- Modify: `web/src/lib/forge/types.ts` (SpiralConfig)
- Modify: `web/src/lib/forge/config.ts` (STAGE_GROUPS, resolveStageParams)
- Modify: `web/src/lib/forge/presets.ts` (both spiral presets)
- Test: `web/src/lib/forge/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/forge/config.test.ts` (import `resolveStageParams`, `STAGE_GROUPS` from `./config`, `SPIRAL_CUT` from `./presets` if not already imported):

```ts
describe("resolveStageParams — spiral detail group", () => {
  it("emits a CUT_09_SPIRAL_DETAIL group mirroring the spiral group's focus params", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    const sp = resolveStageParams(cfg);
    const main = sp[STAGE_GROUPS.spiral];
    const detail = sp[STAGE_GROUPS.spiralDetail];
    expect(detail).toBeDefined();
    expect(detail.sinkingMethod).toBe("step");
    expect(detail.descentPerStep).toBe(main.descentPerStep);
    expect(detail.descentIntervalDescent).toBe(main.descentIntervalDescent);
    // detail mirrors every resolved key of the main spiral group (v1)
    expect(detail).toEqual(main);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/forge/config.test.ts -t "detail group"`
Expected: FAIL — `STAGE_GROUPS.spiralDetail` is `undefined` / detail is undefined.

- [ ] **Step 3: Add the SpiralConfig fields**

In `web/src/lib/forge/types.ts`, in `SpiralConfig`, after `focusInitialMm: number;`:

```ts
  /** Split thin features off the perimeter spiral into their own arms. */
  splitNecks: boolean;
  /** A location counts as a neck when local width < this % of channel width. */
  neckThresholdPct: number;
  /** Overlap (mm) each split arm shares with its neighbour at the neck. */
  neckOverlapMm: number;
```

- [ ] **Step 4: Add the detail group + resolved params**

In `web/src/lib/forge/config.ts`, add to `STAGE_GROUPS`:

```ts
  spiral: "CUT_08_SPIRAL",
  spiralDetail: "CUT_09_SPIRAL_DETAIL",
```

Then, immediately after the `out[STAGE_GROUPS.spiral] = { ... };` block in `resolveStageParams`, add:

```ts
  // Detail arms (necks split off) get their own group/layer so they can carry
  // independent machine params later; v1 mirrors the main spiral group.
  out[STAGE_GROUPS.spiralDetail] = {
    ...out[STAGE_GROUPS.spiral],
    ...(sp[STAGE_GROUPS.spiralDetail] ?? {}),
  };
```

- [ ] **Step 5: Add preset defaults**

In `web/src/lib/forge/presets.ts`, in BOTH spiral preset literals, after `focusInitialMm: 0.01,`:

```ts
    splitNecks: false, neckThresholdPct: 50, neckOverlapMm: 0.8,
```

- [ ] **Step 6: Run typecheck + test to verify pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/forge/config.test.ts -t "detail group"`
Expected: tsc clean (every `SpiralConfig` literal already comes from the presets, so no other literal needs the new fields), test PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/config.ts web/src/lib/forge/presets.ts web/src/lib/forge/config.test.ts
git commit -m "feat(spiral): config + detail group scaffolding for neck split"
```

---

### Task 2: `regionComponents` — group rings into connected solids

**Files:**
- Modify: `web/src/lib/forge/offset.ts`
- Test: `web/src/lib/forge/offset.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/forge/offset.test.ts` (it already imports `rect`, `bbox` helpers and from `./offset`; add `regionComponents` to the import):

```ts
describe("regionComponents", () => {
  it("groups two disjoint squares into two components", () => {
    const comps = regionComponents([
      rect(0, 0, 10, 10, true).points,
      rect(20, 0, 30, 10, true).points,
    ]);
    expect(comps.length).toBe(2);
    expect(comps.every((c) => c.length === 1)).toBe(true); // each: one outer, no holes
  });

  it("attaches a hole to its containing outer (one component with 2 rings)", () => {
    const comps = regionComponents([
      rect(0, 0, 20, 20, true).points,   // outer
      rect(5, 5, 15, 15, false).points,  // hole (opposite winding)
    ]);
    expect(comps.length).toBe(1);
    expect(comps[0].length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/forge/offset.test.ts -t "regionComponents"`
Expected: FAIL — `regionComponents` is not exported.

- [ ] **Step 3: Implement `regionComponents`**

In `web/src/lib/forge/offset.ts`, add (after `buildFillRegion`):

```ts
/** |signed area| of a single ring (shoelace). */
function ringAbsArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    a += (loop[j].x + loop[i].x) * (loop[j].y - loop[i].y);
  }
  return Math.abs(a) / 2;
}

/**
 * Group a flat ring set (outer loops + holes, as produced by offsetRegion /
 * clipExecute) into connected solid regions. Each component is
 * `[outerLoop, ...holeLoops]`. A loop's nesting level = how many OTHER loops
 * contain its first vertex; even levels are outer boundaries, odd levels are
 * holes. Each hole attaches to the smallest-area even-level loop containing it.
 */
export function regionComponents(rings: Pt[][]): Pt[][][] {
  const loops = rings.filter((r) => r.length >= 3);
  const level = loops.map((loop, i) =>
    loops.reduce((n, other, j) => (j !== i && pointInPolygon(other, loop[0]) ? n + 1 : n), 0),
  );
  const outerIdx = loops.map((_, i) => i).filter((i) => level[i] % 2 === 0);
  const comps: Pt[][][] = outerIdx.map((i) => [loops[i]]);
  loops.forEach((loop, i) => {
    if (level[i] % 2 === 0) return; // outer, already a component head
    let best = -1, bestArea = Infinity;
    outerIdx.forEach((oi, ci) => {
      if (pointInPolygon(loops[oi], loop[0])) {
        const a = ringAbsArea(loops[oi]);
        if (a < bestArea) { bestArea = a; best = ci; }
      }
    });
    if (best >= 0) comps[best].push(loop);
  });
  return comps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/forge/offset.test.ts -t "regionComponents"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/offset.ts web/src/lib/forge/offset.test.ts
git commit -m "feat(spiral): regionComponents — group rings into connected solids"
```

---

### Task 3: `splitLobesAtNecks` — pinch the region at necks

**Files:**
- Modify: `web/src/lib/forge/offset.ts`
- Test: `web/src/lib/forge/offset.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/lib/forge/offset.test.ts` (add `splitLobesAtNecks` to the `./offset` import). A "dumbbell" = two 10×10 squares joined by a thin 0.3mm-tall bar; neck width 1.0 (> 0.3) must pinch it into two main lobes plus a thin detail; a solid square must stay one main lobe.

```ts
describe("splitLobesAtNecks", () => {
  // dumbbell: left square 0..10, right square 14..24, thin bridge y 4.85..5.15 (0.3 tall)
  const dumbbell: { x: number; y: number }[][] = [[
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.85 },
    { x: 14, y: 4.85 }, { x: 14, y: 0 }, { x: 24, y: 0 },
    { x: 24, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 5.15 },
    { x: 10, y: 5.15 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]];

  it("splits a thin bridge into two main lobes + a detail", () => {
    const lobes = splitLobesAtNecks(dumbbell, 1.0, 0.4);
    const mains = lobes.filter((l) => l.kind === "main");
    const details = lobes.filter((l) => l.kind === "detail");
    expect(mains.length).toBe(2);       // the two squares
    expect(details.length).toBeGreaterThanOrEqual(1); // the thin bridge
  });

  it("leaves a solid square as a single main lobe", () => {
    const lobes = splitLobesAtNecks([rect(0, 0, 10, 10, true).points], 1.0, 0.4);
    expect(lobes.length).toBe(1);
    expect(lobes[0].kind).toBe("main");
  });

  it("returns the part unsplit when neckWidth is non-positive", () => {
    const lobes = splitLobesAtNecks([rect(0, 0, 10, 10, true).points], 0, 0.4);
    expect(lobes.length).toBe(1);
    expect(lobes[0].kind).toBe("main");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/forge/offset.test.ts -t "splitLobesAtNecks"`
Expected: FAIL — `splitLobesAtNecks` not exported.

- [ ] **Step 3: Implement `splitLobesAtNecks`**

In `web/src/lib/forge/offset.ts`, add (after `regionComponents`):

```ts
/** Reject detail fragments smaller than this (mm²) — clipper rounding noise. */
const MIN_DETAIL_AREA_MM2 = 0.02;

export interface NeckLobe {
  region: Pt[][];
  kind: "main" | "detail";
}

/**
 * Split a part region at necks narrower than `neckWidthMm`. Erodes by
 * neckWidthMm/2 so thin necks pinch off; each surviving core is recovered
 * (dilated back + overlap, clipped to the part) as a MAIN lobe, and thin
 * material no core covers becomes DETAIL lobes (grown by overlap so the join is
 * double-cut). Returns the part as a single main lobe when no neck is found.
 */
export function splitLobesAtNecks(part: Pt[][], neckWidthMm: number, overlapMm: number): NeckLobe[] {
  const whole: NeckLobe[] = [{ region: part, kind: "main" }];
  if (part.length === 0 || !(neckWidthMm > 0)) return whole;
  const r = neckWidthMm / 2;
  const ov = Math.max(0, overlapMm);

  const cores = regionComponents(offsetRegion(part, -r));
  const mains = cores
    .map((core) => clipExecute(ClipperLib.ClipType.ctIntersection, offsetRegion(core, r + ov), part))
    .filter((reg) => reg.length > 0);

  const thick = clipExecute(
    ClipperLib.ClipType.ctUnion,
    cores.flatMap((core) => offsetRegion(core, r)),
    [],
  );
  const residual = clipExecute(ClipperLib.ClipType.ctDifference, part, thick);
  const details = regionComponents(residual)
    .filter((comp) => ringAbsArea(comp[0]) >= MIN_DETAIL_AREA_MM2)
    .map((comp) => clipExecute(ClipperLib.ClipType.ctIntersection, offsetRegion(comp, ov), part))
    .filter((reg) => reg.length > 0);

  // No neck: a single thick core and no meaningful thin residual — leave whole
  // so the un-split spiral path is reproduced exactly.
  if (mains.length <= 1 && details.length === 0) return whole;

  return [
    ...mains.map((region) => ({ region, kind: "main" as const })),
    ...details.map((region) => ({ region, kind: "detail" as const })),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/forge/offset.test.ts -t "splitLobesAtNecks"`
Expected: PASS. The bridge is 0.3 mm tall, below `neckWidthMm` 1.0, so eroding by 0.5 removes it → two square cores → two main lobes + the bridge as detail. If you see >2 mains, the erosion isn't dropping the bridge — check `offsetRegion(dumbbell, -0.5)` returns two components, not three (do not loosen the test bridge to compensate).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/offset.ts web/src/lib/forge/offset.test.ts
git commit -m "feat(spiral): splitLobesAtNecks — pinch region into main + detail lobes"
```

---

### Task 4: Wire `generateSpiralPaths` to split + tag arms

**Files:**
- Modify: `web/src/lib/forge/spiral.ts`
- Test: `web/src/lib/forge/spiral.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/forge/spiral.test.ts` (import `generateSpiralPaths` from `./spiral`, `SPIRAL_CUT` from `./presets`, `STAGE_GROUPS` from `./config`). Reuse the dumbbell shape from Task 3 (redeclare it locally — engineer may read tasks out of order):

```ts
const dumbbell: { x: number; y: number }[][] = [[
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4.85 },
  { x: 14, y: 4.85 }, { x: 14, y: 0 }, { x: 24, y: 0 },
  { x: 24, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 5.15 },
  { x: 10, y: 5.15 }, { x: 10, y: 10 }, { x: 0, y: 10 },
]];

describe("generateSpiralPaths — neck split", () => {
  it("OFF: every arm is the main spiral group (regression-safe path)", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = false;
    const paths = generateSpiralPaths(dumbbell, cfg, "obj1");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.groupName === STAGE_GROUPS.spiral)).toBe(true);
    expect(paths.every((p) => p.generatedClass === "spiral")).toBe(true);
  });

  it("ON: emits at least one detail-group arm, all still generatedClass spiral", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true;
    cfg.spiral.splitNecks = true;
    cfg.spiral.neckThresholdPct = 50;
    cfg.spiral.neckOverlapMm = 0.4;
    const paths = generateSpiralPaths(dumbbell, cfg, "obj1");
    expect(paths.some((p) => p.groupName === STAGE_GROUPS.spiralDetail)).toBe(true);
    expect(paths.every((p) => p.generatedClass === "spiral")).toBe(true);
    // operationOrder is a unique 0..n-1 sequence
    expect(paths.map((p) => p.operationOrder)).toEqual(paths.map((_, i) => i));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/forge/spiral.test.ts -t "neck split"`
Expected: the ON test FAILS (no detail group yet); the OFF test may pass already.

- [ ] **Step 3: Rewrite `generateSpiralPaths`**

In `web/src/lib/forge/spiral.ts`, add `splitLobesAtNecks` to the `./offset` import:

```ts
import { offsetRegion, splitLobesAtNecks } from "./offset";
```

Replace the whole `generateSpiralPaths` function with:

```ts
export function generateSpiralPaths(part: Pt[][], cfg: ForgeConfig, sourceObjectId: string): GeneratedPath[] {
  if (!cfg.spiral.enabled) return [];
  const { channelWidthMm, pitchMm, side, minChannelMm } = cfg.spiral;
  const opts: SpiralOptions = { channelWidthMm, pitchMm, side, minChannelMm };

  // Split thin features off into their own lobes (and group) when enabled;
  // otherwise a single main lobe reproduces the un-split spiral exactly.
  const lobes = cfg.spiral.splitNecks
    ? splitLobesAtNecks(part, (cfg.spiral.neckThresholdPct / 100) * channelWidthMm, cfg.spiral.neckOverlapMm ?? channelWidthMm)
    : [{ region: part, kind: "main" as const }];

  const out: GeneratedPath[] = [];
  let order = 0;
  for (const lobe of lobes) {
    const group = lobe.kind === "detail" ? STAGE_GROUPS.spiralDetail : STAGE_GROUPS.spiral;
    for (const arm of spiralFromRegion(lobe.region, opts).arms) {
      out.push({
        sourceObjectId,
        generatedClass: "spiral",
        groupName: group,
        layerStart: 0,
        layerEnd: cfg.spiral.passes,
        widthMultiplier: channelWidthMm / cfg.beamWidthMm,
        offsetMm: channelWidthMm,
        sideMode: side === "inside" ? "inside" : "outside",
        operationOrder: order++,
        enabled: true,
        rings: [arm],
      });
    }
  }
  return out;
}
```

(`SpiralOptions` and `STAGE_GROUPS` are already imported in spiral.ts; confirm `STAGE_GROUPS` import includes the file — it is imported from `./config`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/forge/spiral.test.ts -t "neck split"`
Expected: PASS (both).

- [ ] **Step 5: Run the full forge suite (regression)**

Run: `npx vitest run src/lib/forge/`
Expected: PASS — existing spiral/xcs tests still green (toggle defaults off, single-lobe path is identical).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(spiral): generate detail arms at necks, tagged with the detail group"
```

---

### Task 5: UI controls (toggle + threshold + overlap)

**Files:**
- Modify: `web/src/components/forge/SpiralControls.tsx`

- [ ] **Step 1: Add the controls**

In `web/src/components/forge/SpiralControls.tsx`, after the `Side` `<Field>` block (the `</Field>` following the `<Select>` for side), add inside the same Cut geometry card:

```tsx
          <Field label="Split internal detail">
            <Select
              value={config.spiral.splitNecks ? "on" : "off"}
              onChange={(e) => patchSpiral({ splitNecks: e.target.value === "on" })}
            >
              <option value="off">off</option>
              <option value="on">on</option>
            </Select>
          </Field>
          {config.spiral.splitNecks && (
            <>
              <Field label="Neck threshold (% width)">
                <NumberField
                  value={config.spiral.neckThresholdPct ?? 50}
                  step={5}
                  min={5}
                  max={100}
                  onChange={(v) => patchSpiral({ neckThresholdPct: Math.min(100, Math.max(5, v)) })}
                />
              </Field>
              <Field label="Split overlap (mm)">
                <NumberField
                  value={config.spiral.neckOverlapMm ?? config.spiral.channelWidthMm}
                  step={0.05}
                  min={0}
                  onChange={(v) => patchSpiral({ neckOverlapMm: v >= 0 ? v : 0 })}
                />
              </Field>
            </>
          )}
```

(`patchSpiral` already exists in this component and stamps `activePreset: "custom"`; `NumberField`, `Field`, `Select` are already imported.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build + browser verify**

Run: `cd web && npm run build` then load `http://127.0.0.1:8017/#/spiral` (hard reload). Import `demo-files/spiral.svg`. Toggle **Split internal detail → on**. Confirm: the threshold + overlap fields appear; the estimate/arm count changes; no console errors. Toggle off → returns to prior arm count.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/forge/SpiralControls.tsx
git commit -m "feat(spiral): UI controls for neck split (toggle + threshold + overlap)"
```

---

### Task 6: Verify, changelog, PR

**Files:**
- Create: `changelog/2026-06-13-spiral-neck-split.md`

- [ ] **Step 1: Full gate**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 2: Browser A/B sanity**

Load `#/spiral`, import `demo-files/spiral.svg`, toggle split on/off, screenshot each, confirm detail arms appear when on and the schematic/estimate update. Export `.xs` with split on and confirm two spiral groups (`CUT_08_SPIRAL` + `CUT_09_SPIRAL_DETAIL`) by unzipping and checking distinct `layerTag`s.

- [ ] **Step 3: Write changelog (minor)**

Create `changelog/2026-06-13-spiral-neck-split.md`:

```markdown
---
id: 2026-06-13-spiral-neck-split
date: 2026-06-13
level: minor
title: Spiral Cut — split internal detail at necks
summary: Optionally break thin features off the main spiral into their own short cut so they retain heat and sever cleanly.
---
```

- [ ] **Step 4: Commit + push + PR**

```bash
git add changelog/2026-06-13-spiral-neck-split.md
git commit -m "docs(changelog): spiral neck split"
git push -u origin feat/spiral-neck-split
gh pr create --draft --title "Spiral Cut — split internal detail at necks" --body "Implements docs/superpowers/specs/2026-06-13-spiral-neck-split-design.md. Toggle (default off) splits thin features off the perimeter spiral into their own heat-retaining arms, tagged CUT_09_SPIRAL_DETAIL for future independent params."
```

---

## Self-review notes

- **Spec coverage:** detection (Task 3 erosion = channel-neck signal), action/overlap (Task 3), distinct detail group for future params (Tasks 1 + 4), controls with defaults (Task 5, Task 1 presets), regression-safe off path (Task 4 OFF test), estimate auto-updates (no code needed — per-arm sum), validation/browser (Tasks 5–6). Preview tinting was a spec "stretch" — intentionally omitted (YAGNI).
- **Realization note:** the spec described "cut the concentric rings"; this plan realises the same outcome via clipper morphological split (erode → lobes), which is more robust and avoids `buildStrands` surgery while staying in the generator on offset data. Outcome (separate, overlap-joined, distinctly-grouped detail arms) is unchanged.
- **Type consistency:** `NeckLobe { region: Pt[][]; kind: "main" | "detail" }` defined in Task 3, consumed in Task 4; `STAGE_GROUPS.spiralDetail` defined Task 1, used Tasks 1/4; `splitNecks`/`neckThresholdPct`/`neckOverlapMm` defined Task 1, used Tasks 4/5.
