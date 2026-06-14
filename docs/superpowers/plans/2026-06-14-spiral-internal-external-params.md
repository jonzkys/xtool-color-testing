# Spiral Cut — Internal/External classification + independent params — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify every spiral arm as External (the single largest connected body's outer silhouette) or Internal (holes/counters, other islands, neck-split pieces), render them in distinct colours, cut each once (no double-trace), and let the user set External vs Internal laser params independently via a Main|Detail tab.

**Architecture:** Approach A — keep the single whole-region spiral pass and tag each arm by the boundary loop it grew from. A new `classifyLevel0` marks the largest component's outer loop "external" and everything else "internal"; `buildStrands` carries that class per strand; `generateSpiralPaths` maps class → group (`CUT_08_SPIRAL` external / `CUT_09_SPIRAL_DETAIL` internal). Neck-split lobes are wholly internal and get a widened keep-out so the main no longer traces alongside them. The schematic colours by class and draws each internal piece as a real spiral. The param tray gains a Main|Detail tab.

**Tech Stack:** TypeScript, React, Vite, Vitest, clipper-lib (via `offset.ts`). Spec: `docs/superpowers/specs/2026-06-14-spiral-internal-external-params-design.md`.

**Branch:** `feat/spiral-internal-external` (already created off `main`).

**Run/verify commands (from `web/`):**
- Unit (one file): `npx vitest run src/lib/forge/spiral.test.ts`
- Typecheck: `npx tsc --noEmit`
- Full tests: `npm test`
- Build (required before browser test — backend serves `web/dist/`): `npm run build`
- Browser: server at `http://127.0.0.1:8017/#/spiral`; sample at `/Users/jonzky/Documents/XTools/demo-files/Amelia.xs`.

---

## File structure

- `web/src/lib/forge/spiral.ts` — add `ArmClass`, `classifyLevel0`, seed-class in `buildStrands`, `armClass` in `spiralFromRegion`, class-based grouping + ordering + GAP in `generateSpiralPaths`. (Owns classification + generation.)
- `web/src/lib/forge/spiral.test.ts` — unit tests for all of the above + update existing `buildStrands` tests for the new return shape.
- `web/src/components/forge/SpiralCanvas.tsx` — colour arms by class; decompose the main lobe into external/internal pieces; draw internal pieces as spirals; band+gap keep-out. (Owns preview.)
- `web/src/components/forge/ForgeStageParams.tsx` — show spiral groups as Main|Detail tabs; route Detail edits to `stageParams[CUT_09]`. (Owns param editing.)
- `web/src/pages/SpiralPage.tsx` — compute `hasInternal`; pass spiral groups to `ForgeStageParams`. (Owns page wiring.)
- `changelog/2026-06-14-spiral-internal-external.md` — user-visible changelog entry.

No new `SpiralConfig` fields. Group string constants unchanged (`CUT_08_SPIRAL`, `CUT_09_SPIRAL_DETAIL`).

---

## Task 1: `classifyLevel0` + `ArmClass` (pure classification)

**Files:**
- Modify: `web/src/lib/forge/spiral.ts` (imports near line 5; add helpers above `buildStrands` ~line 162)
- Test: `web/src/lib/forge/spiral.test.ts`

- [ ] **Step 1: Add the import + helpers**

In `spiral.ts`, extend the offset import (currently `import { offsetRegion, splitLobesAtNecks, unionRegions, subtractRegion } from "./offset";`) to add `regionComponents`:

```ts
import { offsetRegion, splitLobesAtNecks, unionRegions, subtractRegion, regionComponents } from "./offset";
```

Add near the top of the file (after the imports, before `spiralPathLength`):

```ts
/** An arm is External when it grows from the single largest body's outer
 *  silhouette; Internal for that body's holes/counters, every other
 *  disconnected component, and neck-split pieces. */
export type ArmClass = "external" | "internal";

/** Absolute shoelace area of one closed ring (orientation-agnostic). */
function ringArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[i].x * loop[j].y - loop[j].x * loop[i].y;
  }
  return Math.abs(a) / 2;
}

/**
 * Classify each loop in a flat ring set (one offset level): the largest
 * connected component's OUTER loop is "external"; every other loop — that
 * body's holes and all loops of every smaller component — is "internal".
 * Identity-based: regionComponents returns the same loop refs, so the largest
 * component's outer is matched by reference.
 */
export function classifyLevel0(loops: Pt[][]): ArmClass[] {
  if (loops.length === 0) return [];
  const comps = regionComponents(loops); // [outer, ...holes][]
  let bestOuter: Pt[] | null = null;
  let bestArea = -Infinity;
  for (const comp of comps) {
    const a = ringArea(comp[0]);
    if (a > bestArea) { bestArea = a; bestOuter = comp[0]; }
  }
  return loops.map((loop) => (loop === bestOuter ? "external" : "internal"));
}
```

- [ ] **Step 2: Write the failing test**

Add to `spiral.test.ts` (it already imports from `./offset`; add `regionComponents` is not needed here). Add `classifyLevel0` to the spiral import: `import { spiralFromRegion, spiralPathLength, generateSpiralPaths, buildStrands, classifyLevel0 } from "./spiral";`

```ts
describe("classifyLevel0", () => {
  // big 40x40 outer with a 10x10 hole, plus a separate 6x6 island.
  const bigOuter: Pt[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  const hole: Pt[] = [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }];
  const island: Pt[] = [{ x: 60, y: 0 }, { x: 66, y: 0 }, { x: 66, y: 6 }, { x: 60, y: 6 }];

  it("largest body's outer is external; its hole and other islands are internal", () => {
    const cls = classifyLevel0([bigOuter, hole, island]);
    expect(cls).toEqual(["external", "internal", "internal"]);
  });

  it("a single solid loop is external", () => {
    expect(classifyLevel0([bigOuter])).toEqual(["external"]);
  });

  it("empty input → empty", () => {
    expect(classifyLevel0([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it passes** (implementation written in Step 1)

Run: `cd web && npx vitest run src/lib/forge/spiral.test.ts -t classifyLevel0`
Expected: PASS (3 tests). If the island/hole ordering surprises you, confirm `regionComponents` groups `hole` under `bigOuter` and `island` as its own component — the largest outer (bigOuter, area 1600) wins.

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): classifyLevel0 — largest body external, rest internal"
```

---

## Task 2: `buildStrands` carries the arm class

**Files:**
- Modify: `web/src/lib/forge/spiral.ts` (`buildStrands`, ~line 162–296)
- Test: `web/src/lib/forge/spiral.test.ts` (update the 3 existing `buildStrands` tests + add one)

- [ ] **Step 1: Change `buildStrands` to track + return class**

Replace the signature and the strand bookkeeping. New signature + return type:

```ts
export interface StrandArm { arm: Pt[]; cls: ArmClass; }

export function buildStrands(levels: Pt[][][], pitchMm: number, seedClass?: ArmClass[]): StrandArm[] {
```

Inside, change the `Strand` interface to carry `cls`:

```ts
  interface Strand {
    out: Pt[];
    frontier: Pt[];
    frontierBbox: Bbox;
    active: boolean;
    cls: ArmClass;
  }
```

Precompute seed centroids for the new-strand fallback (insert right before the `const strands: Strand[] = ...` seeding line):

```ts
  // Class for level-0 seeds; new mid-level strands inherit the nearest seed's class.
  const seedInfo = levels[0].map((loop, i) => {
    const b = loopBbox(loop);
    return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, cls: seedClass?.[i] ?? ("external" as ArmClass) };
  });
  const nearestCls = (loop: Pt[]): ArmClass => {
    if (seedInfo.length === 0) return "external";
    const b = loopBbox(loop);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    let best = seedInfo[0], bd = Infinity;
    for (const s of seedInfo) {
      const d = (s.cx - cx) ** 2 + (s.cy - cy) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best.cls;
  };
```

Seed strands with their class (replace the existing `const strands: Strand[] = levels[0].map((loop) => {...})`):

```ts
  const strands: Strand[] = levels[0].map((loop, i) => {
    const loopBb = loopBbox(loop);
    return { out: rotateOpen(loop, 0), frontier: loop, frontierBbox: loopBb, active: true, cls: seedClass?.[i] ?? "external" };
  });
```

Give new mid-level strands a class (in the "Unmatched children … seed fresh strands" loop, replace the `newStrands.push({...})`):

```ts
    for (const c of children) {
      if (c.assigned < 0) {
        const loopBb = loopBbox(c.loop);
        newStrands.push({ out: rotateOpen(c.loop, 0), frontier: c.loop, frontierBbox: loopBb, active: true, cls: nearestCls(c.loop) });
      }
    }
```

Change the return (last line):

```ts
  return strands.filter((s) => s.out.length > 0).map((s) => ({ arm: s.out, cls: s.cls }));
```

- [ ] **Step 2: Update the existing `buildStrands` tests for the new return shape**

In `spiral.test.ts`, the `describe("buildStrands (coverage invariant)")` block builds `arms` from `buildStrands(...)` and reads `arm.length`. Map to `.arm`. There are three places that call `buildStrands` and reduce/measure; update each:

```ts
// was: const arms = buildStrands(levels, 0.1);
const arms = buildStrands(levels, 0.1).map((s) => s.arm);
```
```ts
// was: const arms = buildStrands(levels, pitch);
const arms = buildStrands(levels, pitch).map((s) => s.arm);
```
Apply the same `.map((s) => s.arm)` to the third call (the "topology merge — bridge cap" test). Leave the rest of those tests unchanged.

- [ ] **Step 3: Add a class-propagation test**

```ts
describe("buildStrands — seed class", () => {
  function sq(cx: number, cy: number, s: number): Pt[] {
    return [{ x: cx - s, y: cy - s }, { x: cx + s, y: cy - s }, { x: cx + s, y: cy + s }, { x: cx - s, y: cy + s }];
  }
  it("each arm keeps its seed loop's class", () => {
    // two columns 30mm apart; one external, one internal.
    const levels: Pt[][][] = Array.from({ length: 4 }, (_, k) => [sq(0, 0, 5 - k * 0.04), sq(30, 0, 5 - k * 0.04)]);
    const out = buildStrands(levels, 0.04, ["external", "internal"]);
    expect(out.length).toBe(2);
    // arm rooted at x≈0 is external, at x≈30 is internal
    const byX = out.slice().sort((a, b) => a.arm[0].x - b.arm[0].x);
    expect(byX[0].cls).toBe("external");
    expect(byX[1].cls).toBe("internal");
  });
  it("defaults to external when no seedClass", () => {
    const out = buildStrands([[sq(0, 0, 4)]], 0.04);
    expect(out[0].cls).toBe("external");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/forge/spiral.test.ts`
Expected: all PASS (the buildStrands coverage tests still pass via `.map((s) => s.arm)`; new seed-class tests pass).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): buildStrands tracks per-arm external/internal class"
```

---

## Task 3: `spiralFromRegion` returns `armClass`

**Files:**
- Modify: `web/src/lib/forge/spiral.ts` (`SpiralResult` interface ~line 15; `spiralFromRegion` ~line 298)
- Test: `web/src/lib/forge/spiral.test.ts`

- [ ] **Step 1: Extend `SpiralResult` + `spiralFromRegion`**

Change the interface (currently `export interface SpiralResult { arms: Pt[][]; warnings: string[]; }`):

```ts
export interface SpiralResult { arms: Pt[][]; armClass: ArmClass[]; warnings: string[]; }
```

Update `spiralFromRegion`:

```ts
export function spiralFromRegion(part: Pt[][], opts: SpiralOptions, exclude?: Pt[][]): SpiralResult {
  const warnings: string[] = [];
  if (part.length === 0 || !(opts.pitchMm > 0) || !(opts.channelWidthMm > 0)) {
    return { arms: [], armClass: [], warnings };
  }
  const sign: 1 | -1 = opts.side === "inside" ? -1 : 1;
  const levels = offsetLevels(part, opts, sign, exclude);
  if (levels.length <= 1) {
    warnings.push(
      "spiral: scrap too thin for a venting channel — cutting the contour only here (may not fully sever thick brass; consider incise for this region)",
    );
  }
  const seedClass = classifyLevel0(levels[0] ?? []);
  const strands = buildStrands(levels, opts.pitchMm, seedClass);
  return { arms: strands.map((s) => s.arm), armClass: strands.map((s) => s.cls), warnings };
}
```

- [ ] **Step 2: Fix existing call sites that read `.arms`**

`spiralFromRegion` is used in `generateSpiralPaths` (rewritten in Task 4) and in `spiral.test.ts`. Existing tests reading `r.arms` keep working (still present). No other production caller. Confirm with: `cd web && grep -rn "spiralFromRegion" src` — only `spiral.ts`, `spiral.test.ts` should appear.

- [ ] **Step 3: Add the donut classification test**

```ts
describe("spiralFromRegion — armClass", () => {
  it("a holed body yields an external outer arm and internal hole arm(s)", () => {
    const outer: Pt[] = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const hole: Pt[] = [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }];
    const r = spiralFromRegion([outer, hole], { channelWidthMm: 0.8, pitchMm: 0.04, side: "outside", minChannelMm: 0.4 });
    expect(r.arms.length).toBe(r.armClass.length);
    expect(r.armClass).toContain("external");
    expect(r.armClass).toContain("internal");
    // the longest arm (the big outer silhouette) is external
    let maxI = 0; for (let i = 1; i < r.arms.length; i++) if (spiralPathLength(r.arms[i]) > spiralPathLength(r.arms[maxI])) maxI = i;
    expect(r.armClass[maxI]).toBe("external");
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd web && npx vitest run src/lib/forge/spiral.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): spiralFromRegion returns per-arm armClass"
```

---

## Task 4: `generateSpiralPaths` — group by class, neck-split internal, GAP, order by class

**Files:**
- Modify: `web/src/lib/forge/spiral.ts` (`generateSpiralPaths`, ~line 320–381)
- Test: `web/src/lib/forge/spiral.test.ts`

- [ ] **Step 1: Add the GAP constant + rewrite the collect/order/emit core**

Add a module constant near the top (after `CHILD_SAMPLES`):

```ts
/** Pull the main lobe this many pitches CLEAR of a neck-split detail's venting
 *  zone, so no main arm coincides with the detail's outermost arm (no double-
 *  trace). The thin scrap gap drops out. */
const NECK_GAP_PITCHES = 2;
```

Replace the body of `generateSpiralPaths` from the `detailKeepOut` line through the end with:

```ts
  // Neck-split detail owns its region + the channel it sweeps; keep the main
  // clear of it PLUS a small gap so no main arm lands on the detail's outer arm.
  const detailUnion = unionRegions(lobes.filter((l) => l.kind === "detail").map((l) => l.region));
  const detailKeepOut = detailUnion.length > 0
    ? offsetRegion(detailUnion, channelWidthMm + NECK_GAP_PITCHES * pitchMm)
    : [];

  // Collect every arm with its FINAL class. Main lobe → per-arm seed class
  // (external outer vs internal holes/islands). Neck-split detail lobes → all
  // internal.
  const collected: { cls: ArmClass; arm: Pt[] }[] = [];
  for (const lobe of lobes) {
    const exclude = lobe.kind === "main" ? detailKeepOut : undefined;
    const { arms, armClass } = spiralFromRegion(lobe.region, opts, exclude);
    arms.forEach((arm, i) => {
      collected.push({ cls: lobe.kind === "detail" ? "internal" : armClass[i], arm });
    });
  }

  // Cut-shortest-first: internal pieces first (vent + relief), then external —
  // each block ascending by length. Ordering keys off the final class, NOT the
  // lobe kind (internal arms now also come from the main lobe).
  const sequence = cfg.spiral.cutShortestFirst
    ? (() => {
        const byLen = (a: { arm: Pt[] }, b: { arm: Pt[] }) => spiralPathLength(a.arm) - spiralPathLength(b.arm);
        return [
          ...collected.filter((c) => c.cls === "internal").sort(byLen),
          ...collected.filter((c) => c.cls === "external").sort(byLen),
        ];
      })()
    : collected;

  const out: GeneratedPath[] = [];
  let order = 0;
  for (const { cls, arm } of sequence) {
    const group = cls === "internal" ? STAGE_GROUPS.spiralDetail : STAGE_GROUPS.spiral;
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
  return out;
}
```

- [ ] **Step 2: Update existing `generateSpiralPaths` tests that assume holes/islands are main**

Existing tests in `spiral.test.ts` (`generateSpiralPaths — cut shortest first`, `detail keep-out`, `generateSpiralPaths — neck split`) reference `STAGE_GROUPS.spiral` / `spiralDetail`. Review each:
- The "neck split ON" test expects both groups present — still true.
- The "OFF: every arm is the main spiral group" test (in `generateSpiralPaths — neck split`, splitNecks=false on the `lollipop` which is one connected body with a small bump): the lollipop is ONE connected component with no hole, so all arms are external → `STAGE_GROUPS.spiral`. Still passes. **Verify** the lollipop has no enclosed hole (it doesn't — it's a filled outline). If a test now fails because a fixture has a hole/island, update its expectation to allow `spiralDetail` for those arms.
- The "cut shortest first — ON: ascending" test uses two disjoint squares `[big, small]`: now `small` is a separate component → internal, `big` → external. With cutShortestFirst, internal(small) sorts before external(big), still ascending by length overall (small < big), so `lens` non-decreasing still holds. The "details first" test uses `lollipop` with splitNecks — still has a neck-split detail. Run them; adjust only if red.

- [ ] **Step 3: Add the new classification + invariant tests**

```ts
describe("generateSpiralPaths — internal/external grouping", () => {
  function rect(x0: number, y0: number, x1: number, y1: number): Pt[] {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  it("big body outer → CUT_08; hole and separate island → CUT_09", () => {
    const body = rect(0, 0, 40, 40);
    const hole = rect(15, 15, 25, 25); // counter inside the body
    const island = rect(60, 0, 66, 6); // separate small island
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true; cfg.spiral.splitNecks = false; cfg.spiral.cutShortestFirst = false;
    const paths = generateSpiralPaths([body, hole, island], cfg, "o");
    const external = paths.filter((p) => p.groupName === STAGE_GROUPS.spiral);
    const internal = paths.filter((p) => p.groupName === STAGE_GROUPS.spiralDetail);
    expect(external.length).toBeGreaterThan(0);
    expect(internal.length).toBeGreaterThan(0);
    // the single longest arm (big-body outer) is external
    const longest = paths.slice().sort((a, b) => spiralPathLength(b.rings[0]) - spiralPathLength(a.rings[0]))[0];
    expect(longest.groupName).toBe(STAGE_GROUPS.spiral);
  });

  it("cutShortestFirst orders all internal arms before all external", () => {
    const body = rect(0, 0, 40, 40);
    const island = rect(60, 0, 66, 6);
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.enabled = true; cfg.spiral.splitNecks = false; cfg.spiral.cutShortestFirst = true;
    const paths = generateSpiralPaths([body, island], cfg, "o");
    const lastInternal = Math.max(...paths.filter((p) => p.groupName === STAGE_GROUPS.spiralDetail).map((p) => p.operationOrder));
    const firstExternal = Math.min(...paths.filter((p) => p.groupName === STAGE_GROUPS.spiral).map((p) => p.operationOrder));
    expect(lastInternal).toBeLessThan(firstExternal);
  });
});
```

(`structuredClone`, `SPIRAL_CUT`, `STAGE_GROUPS`, `spiralPathLength` are already imported in `spiral.test.ts`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `cd web && npx vitest run src/lib/forge/spiral.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. Fix any existing-test expectations per Step 2 if red.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/spiral.ts web/src/lib/forge/spiral.test.ts
git commit -m "feat(forge): group spiral arms by class (internal CUT_09 / external CUT_08) + neck-split gap"
```

---

## Task 5: Schematic colours by class + accurate internal spirals (SpiralCanvas)

**Files:**
- Modify: `web/src/components/forge/SpiralCanvas.tsx` (`buildSchematic`, the lobe/arm build + draw)
- Verify: browser (no unit test — canvas render)

**Context:** Today `buildSchematic` builds arms per neck-split lobe and colours by `lobe.kind`. Change it to decompose the MAIN lobe into pieces: the largest component's outer (external, pink) and each hole + each other component (internal, amber); plus neck-split detail lobes (internal, amber). Draw each piece's own concentric fan (so small internal pieces show a spiral, not one loop), with the main pieces' fans kept clear of internal pieces by `band + gap` so no pink hugs amber. This mirrors the generator's classification for colours; exact geometry stays "not to scale".

- [ ] **Step 1: Import the classifier + components**

At the top of `SpiralCanvas.tsx`, extend the offset import to add `regionComponents`, and import `classifyLevel0` is not needed (we decompose by components directly). Current import:
`import { offsetRegion, simplifyLoop, buildFillRegion, buildPartRegion, splitLobesAtNecks, unionRegions, subtractRegion } from "../../lib/forge/offset";`
Change to add `regionComponents`:
```ts
import { offsetRegion, simplifyLoop, buildFillRegion, buildPartRegion, splitLobesAtNecks, unionRegions, subtractRegion, regionComponents } from "../../lib/forge/offset";
```

- [ ] **Step 2: Build pieces with explicit class instead of lobe.kind**

In `buildSchematic`, replace the lobe→arms mapping. After `const lobes = splitNecks ? splitLobesAtNecks(...) : [{ region: part, kind: "main" as const }];`, build a list of `{ region, cls, inward }` pieces:

```ts
  // Decompose into drawable pieces with an explicit class. The MAIN lobe splits
  // into the largest body's outer (external) + each hole / other component
  // (internal). Neck-split DETAIL lobes are wholly internal.
  type Piece = { region: Pt[][]; cls: "external" | "internal"; inward: boolean };
  const ringAbsArea = (loop: Pt[]): number => {
    let a = 0; for (let i = 0, n = loop.length; i < n; i++) { const j = (i + 1) % n; a += loop[i].x * loop[j].y - loop[j].x * loop[i].y; } return Math.abs(a) / 2;
  };
  const pieces: Piece[] = [];
  for (const lobe of lobes) {
    if (lobe.kind === "detail") { pieces.push({ region: lobe.region, cls: "internal", inward: false }); continue; }
    const comps = regionComponents(lobe.region); // [outer, ...holes][]
    if (comps.length === 0) { pieces.push({ region: lobe.region, cls: "external", inward: false }); continue; }
    let bi = 0; for (let i = 1; i < comps.length; i++) if (ringAbsArea(comps[i][0]) > ringAbsArea(comps[bi][0])) bi = i;
    comps.forEach((comp, i) => {
      if (i === bi) {
        // external = the largest body's OUTER solid (holes filled → outer only)
        pieces.push({ region: [comp[0]], cls: "external", inward: false });
        // its holes are internal voids → fan inward to vent
        for (let h = 1; h < comp.length; h++) pieces.push({ region: [comp[h]], cls: "internal", inward: true });
      } else {
        // a separate solid island → internal, outward fan; its holes inward
        pieces.push({ region: [comp[0]], cls: "internal", inward: false });
        for (let h = 1; h < comp.length; h++) pieces.push({ region: [comp[h]], cls: "internal", inward: true });
      }
    });
  }
```

- [ ] **Step 3: Make `buildArms` honour per-piece inward + keep-out, with a ring floor**

Change `buildArms` to accept an explicit direction and guarantee ≥3 rings for small pieces. Replace the `lobeBand` use inside `buildArms` and add a min-ring floor. The existing `buildArms = (region, exclude?) => {...}` becomes:

```ts
  const MIN_INTERNAL_RINGS = 3;
  const buildArms = (region: Pt[][], inward: boolean, exclude?: Pt[][]): Pt[][][] => {
    const clip = (rings: Pt[][]) => (exclude && exclude.length ? subtractRegion(rings, exclude) : rings);
    const r = region.map(simp).filter((p) => p.length >= 3);
    if (r.length === 0) return [];
    const lb = lobeBand(r);
    const dir = inward ? -1 : sign; // holes fan inward regardless of global side
    const want = Math.max(drawArms, MIN_INTERNAL_RINGS);
    const c0 = clip(r).map(simp).filter((p) => p.length >= 3);
    const inner: Pt[][][] = [c0.length > 0 ? c0 : r];
    for (let k = 1; k < want; k++) {
      const dist = dir * (k / Math.max(1, want - 1)) * lb;
      const raw = offsetRegion(r, dist);
      if (raw.length === 0) break;
      const rings = clip(raw).map(simp).filter((p) => p.length >= 3);
      if (rings.length > 0) inner.push(rings);
    }
    return inner.slice().reverse();
  };
```

- [ ] **Step 4: Build groups from pieces; keep-out for external pieces**

Replace the `keepOut` + `groups` construction:

```ts
  // Internal pieces' keep-out: external pieces pull back past each internal
  // piece's drawn fan + a gap, so no pink hugs the amber.
  const GAP_FRAC = 0.4; // of band
  const internalKeepOut = unionRegions(
    pieces.filter((p) => p.cls === "internal").map((p) => offsetRegion(p.region, (1 + GAP_FRAC) * lobeBand(p.region) * (p.inward ? -0 : 1) + lobeBand(p.region))),
  );
  const groups: ArmGroup[] = pieces
    .map((p) => ({ arms: buildArms(p.region, p.inward, p.cls === "external" ? internalKeepOut : undefined), kind: p.cls === "internal" ? "detail" as const : "main" as const }))
    .filter((g) => g.arms.length > 0);
```

> Note: `ArmGroup.kind` stays `"main" | "detail"` (drives the existing colour switch: `group.kind === "detail" ? DETAIL : SPIRAL`). We reuse it as external→main(pink) / internal→detail(amber). The draw code at the bottom already colours by `group.kind`; no change needed there. The `detailLobes` caption count should count internal groups: change `const detailLobes = groups.filter((g) => g.kind === "detail").length;` — it already does.

- [ ] **Step 5: Build the page, open Amelia, verify**

```bash
cd web && npm run build
```
Then in the browser at `http://127.0.0.1:8017/#/spiral` upload `/Users/jonzky/Documents/XTools/demo-files/Amelia.xs` with Split internal detail = on. Take a screenshot and confirm:
- Counters/holes (in "e", "o", "a") render **amber**; the largest body outline renders **pink**.
- Neck-split details render amber with a **multi-ring spiral** (not a single loop).
- **No pink line hugs the amber** edges.

If pink still hugs amber, increase the keep-out margin in Step 4. If internal pieces still show one ring, raise `MIN_INTERNAL_RINGS`.

- [ ] **Step 6: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git add web/src/components/forge/SpiralCanvas.tsx
git commit -m "feat(forge): schematic colours arms by internal/external class + accurate internal spirals"
```

---

## Task 6: Main | Detail param tabs (ForgeStageParams + SpiralPage)

**Files:**
- Modify: `web/src/components/forge/ForgeStageParams.tsx`
- Modify: `web/src/pages/SpiralPage.tsx`
- Verify: browser

**Context:** `ForgeStageParams` currently shows one stage when `lockToGroup` is set (Spiral page locks to `CUT_08_SPIRAL`, tab strip hidden). Add a `cutGroups` prop listing the spiral groups to show as tabs; `SpiralPage` passes `[Main]` or `[Main, Detail]` based on whether internal arms exist. Detail-tab edits write to `config.stageParams[CUT_09_SPIRAL_DETAIL]`; Main keeps writing `config.spiral.*` + `stageParams[CUT_08]`. Focus descent stays Main-only (Detail inherits).

- [ ] **Step 1: Add the `cutGroups` prop**

In `ForgeStageParamsProps` (top of file), add:

```ts
  /** Explicit spiral groups to show as tabs (Spiral page). When provided it
   *  replaces the stageList and is NOT locked to one group. */
  cutGroups?: Array<{ group: string; label: string }>;
```

In the component signature destructure add `cutGroups`. Then change the stage selection (`const allStages = stageList(config); const stages = lockToGroup ? ... : allStages;`):

```ts
  const allStages = cutGroups ?? stageList(config);
  const stages = lockToGroup ? allStages.filter((s) => s.group === lockToGroup) : allStages;
```

- [ ] **Step 2: Show tabs when >1 stage; make both spiral groups count as "spiral"**

Change the tab-strip render condition from `{!lockToGroup && (` to also require multiple stages:

```tsx
        {!lockToGroup && stages.length > 1 && (
```

Make `isSpiral` true for the detail group too (so the focus block + passes routing treat both as spiral). Replace `const isSpiral = current?.group === STAGE_GROUPS.spiral;`:

```ts
  const isSpiral = current?.group === STAGE_GROUPS.spiral || current?.group === STAGE_GROUPS.spiralDetail;
  const isMainSpiral = current?.group === STAGE_GROUPS.spiral;
```

- [ ] **Step 3: Route Passes + Focus for the Detail tab to stageParams**

The Passes field onChange (currently `else if (current.group === STAGE_GROUPS.spiral) onChange({ ...config, spiral: { ...config.spiral, passes: n }, ... })`). Add a branch so the Detail group writes a stageParams override instead:

```ts
          else if (current.group === STAGE_GROUPS.spiral) onChange({ ...config, spiral: { ...config.spiral, passes: n }, activePreset: "custom" });
          else if (current.group === STAGE_GROUPS.spiralDetail) setParam("passes", n);
```

For the focus descent block: keep it rendered only for the MAIN spiral tab. Change its gate from `isSpiral` to `isMainSpiral` (so the Detail tab hides focus descent → Detail inherits Main's focus). Find the focus-descent block (`{isSpiral && (` around the "Focus descent" UI) and change to `{isMainSpiral && (`.

> The numeric fields (power/speed/frequency/pulse) already write via `setParam(... )` keyed by `current.group`, so the Detail tab writes `stageParams[CUT_09]` automatically. The Passes value shown should read the effective value: where Passes `value` is computed for spiral, use `config.spiral.passes` for Main and `config.stageParams[STAGE_GROUPS.spiralDetail]?.passes ?? config.spiral.passes` for Detail. Locate the Passes `value={...}` for the spiral case and apply this fallback.

- [ ] **Step 4: Wire `SpiralPage`**

In `SpiralPage.tsx`, find where `result` (pipeline output) is available and compute internal presence. Near the other derived memos add:

```ts
  const hasInternal = useMemo(
    () => (result?.paths ?? []).some((p) => p.groupName === STAGE_GROUPS.spiralDetail),
    [result],
  );
```

(Ensure `STAGE_GROUPS` is imported from `../lib/forge/config` — it already is.) Then change the `<ForgeStageParams>` usage: replace `lockToGroup={STAGE_GROUPS.spiral}` with:

```tsx
        cutGroups={hasInternal
          ? [{ group: STAGE_GROUPS.spiral, label: "Main" }, { group: STAGE_GROUPS.spiralDetail, label: "Detail" }]
          : [{ group: STAGE_GROUPS.spiral, label: "Main" }]}
```

(Remove the `lockToGroup` prop from that call. Verify `result`'s variable name in SpiralPage — if it's named differently, e.g. `pipelineResult`, use that.)

- [ ] **Step 5: Build + browser verify**

```bash
cd web && npm run build
```
At `http://127.0.0.1:8017/#/spiral` with Amelia + split on: confirm a **Main | Detail** tab strip appears in the Laser & focus tray; switching to Detail and changing e.g. Speed writes only the detail's value; switching back to Main shows Main's value unchanged. With a plain shape that has no internal pieces, confirm only Main shows (no tabs). Screenshot both.

- [ ] **Step 6: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git add web/src/components/forge/ForgeStageParams.tsx web/src/pages/SpiralPage.tsx
git commit -m "feat(forge): Main|Detail param tabs for spiral (independent internal params)"
```

---

## Task 7: Changelog + full gate + integration browser pass

**Files:**
- Create: `changelog/2026-06-14-spiral-internal-external.md`
- Verify: full test suite, build, browser

- [ ] **Step 1: Write the changelog**

```markdown
---
id: 2026-06-14-spiral-internal-external
date: 2026-06-14
level: minor
title: Spiral Cut — internal vs external, with independent params
summary: Holes/counters, separate islands, and split-off details now cut as "internal" (amber) — distinct from the largest body's "external" pass (pink) — each cut once. A Main | Detail tab lets you set internal and external laser params independently.
---
```

- [ ] **Step 2: Full gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all tests pass, build succeeds.

- [ ] **Step 3: Browser integration pass**

At `http://127.0.0.1:8017/#/spiral`, upload Amelia (split on). Confirm end-to-end: amber internal (holes + islands + split) / pink external; no pink hugging amber; Main|Detail tabs edit independently. Export `.xs`, and (optionally) confirm via a throwaway check that `CUT_09_SPIRAL_DETAIL` displays exist and carry the detail params. Screenshot.

- [ ] **Step 4: Commit + push + PR**

```bash
git add changelog/2026-06-14-spiral-internal-external.md
git commit -m "docs(changelog): spiral internal/external + independent params"
git push -u origin feat/spiral-internal-external
gh pr create --draft --title "feat(forge): Spiral Cut internal/external classification + independent params" --body "<summary, verification, link to spec>"
```
Then flip to ready when CI is green (`gh pr ready`).

---

## Self-review notes (author)

- **Spec coverage:** classification (Task 1,3,4) ✓; Approach A single-pass + seed labels (Task 2,3) ✓; request-1 gap fix (Task 4 GAP + Task 5 keep-out) ✓; render colours + accuracy (Task 5) ✓; Main|Detail tabs, detail inherits (Task 6) ✓; ordering by class (Task 4) ✓; changelog (Task 7) ✓.
- **Type consistency:** `ArmClass` ("external"|"internal") used in Tasks 1–4; `StrandArm {arm, cls}` (Task 2) consumed in Task 3; `SpiralResult.armClass` (Task 3) consumed in Task 4; `cutGroups` (Task 6) shape `{group,label}` matches `stageList`'s.
- **Known follow-ups (out of scope):** independent focus-descent for Detail (currently inherits Main); >2 param groups.
```
