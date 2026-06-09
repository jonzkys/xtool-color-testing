# Forge Relief Vents (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scrap-side relief vents to Forge — auto-placed at sharp corners and at near-gaps (scrap necks between near-touching part edges), as outward/channel-aligned slots that can never bite the part — plus the `?? "blue"` → `"red"` laser-default fix.

**Architecture:** A new pure `nearGap.ts` detects scrap necks over the whole part region (resample → spatial grid → nearest non-adjacent → midpoint-in-scrap). The existing `perforate` stage is evolved into a "relief" stage: it now anchors over **all** loops (not just the largest), and emits either today's square pockets or new kerf-wide **slots**, guarded so the slot body stays in scrap. No new `GeneratedClass` — vents stay class `"perforate"`. This is PR 1 of two; the A/B/C/D comparison mode is PR 2 (separate plan, after a cut test).

**Tech Stack:** TypeScript, React, Vite, Vitest. Pure geometry in `web/src/lib/forge/`. Spec: `docs/superpowers/specs/2026-06-09-forge-relief-vents-comparison-design.md` (sections A + C).

**Conventions:** `cd web` for all `npx`/`npm`. After any `web/src/**` change you want in the browser, `cd web && npm run build`. Run targeted vitest by path (combining `src/lib/forge` + `src/components/forge` path filters in ONE vitest invocation spuriously fails jsdom — run component tests on their own). Every commit ends with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Work on `feat/forge-relief-comparison` off `main` (Task 0).

---

## File structure

**New:**
- `web/src/lib/forge/nearGap.ts` — `inPart`, `detectNearGaps`, `buildSlotRect`, `slotInScrap`, `NearGapAnchor`.
- `web/src/lib/forge/nearGap.test.ts`

**Modified:**
- `web/src/lib/forge/types.ts` — `PerforateConfig` gains `shape/nearGap/gapThresholdMm/slotLengthMm`.
- `web/src/lib/forge/defaults.ts` — default perforate fields.
- `web/src/lib/forge/presets.ts` — `LEAN`/`AGGRESSIVE` perforate fields.
- `web/src/lib/forge/stages.ts` — `generatePerforationPaths`: all-loop anchors + slot shape + near-gap.
- `web/src/lib/forge/stages.test.ts` — slot/guard/all-loop tests.
- `web/src/pages/ForgePage.tsx` — `CONFIG_LS_KEY` v5 → v6.
- `web/src/components/forge/ForgeControls.tsx` — Perforate → "Perforate / Relief" card.
- `web/src/components/forge/ForgeStageParams.tsx` — laser fallback `?? "blue"` → `"red"`.
- `~/Documents/XTools/forge-cal/gen_probes3.py` — `"blue"` → `"red"` label.
- `changelog/2026-06-09-forge-relief-vents.md` (new).

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch.** (The implementation runs in a worktree created by the controller via `superpowers:using-git-worktrees`; if not, branch manually.)

Run:
```bash
git checkout main && git pull
git checkout -b feat/forge-relief-comparison
```
Expected: on `feat/forge-relief-comparison`, clean tree, with PR #126's forge code present (`ls web/src/lib/forge/estimate.ts` exists). Copy the spec + this plan into `docs/superpowers/{specs,plans}/` if not already present and commit them first.

---

### Task 1: Near-gap detector

**Files:**
- Create: `web/src/lib/forge/nearGap.ts`
- Test: `web/src/lib/forge/nearGap.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// web/src/lib/forge/nearGap.test.ts
import { describe, it, expect } from "vitest";
import { inPart, detectNearGaps, buildSlotRect, slotInScrap } from "./nearGap";
import type { Pt } from "./types";

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe("inPart (count-based even-odd)", () => {
  // ring (two loops) + a dot loop inside the ring's hole
  const ring = [rect(0, 0, 20, 20), rect(6, 6, 8, 8)]; // outer + hole
  it("is inside the ring wall, outside the ring hole", () => {
    expect(inPart(ring, { x: 2, y: 10 })).toBe(true); // in the wall
    expect(inPart(ring, { x: 10, y: 10 })).toBe(false); // in the hole (scrap)
    expect(inPart(ring, { x: -5, y: 10 })).toBe(false); // outside everything
  });
});

describe("detectNearGaps", () => {
  it("finds the scrap neck between two near-touching bars", () => {
    // two 10x2 bars with a ~0.6mm scrap gap between them (y 2..2.6)
    const part = [rect(0, 0, 10, 2), rect(0, 2.6, 10, 2)];
    const anchors = detectNearGaps(part, 1.5);
    expect(anchors.length).toBeGreaterThan(0);
    // an anchor sits in the gap (y between 2 and 2.6) and is in scrap
    const a = anchors[0];
    expect(a.pt.y).toBeGreaterThan(1.8);
    expect(a.pt.y).toBeLessThan(2.8);
    expect(inPart(part, a.pt)).toBe(false);
    // channel direction runs ALONG the gap (mostly horizontal), not across it
    expect(Math.abs(a.dirX)).toBeGreaterThan(Math.abs(a.dirY));
  });

  it("does NOT flag a lone convex square (no neck)", () => {
    expect(detectNearGaps([rect(0, 0, 10, 10)], 1.5)).toHaveLength(0);
  });

  it("flags the annular scrap of a ring+dot", () => {
    // outer 20x20, its hole 4..16, and a 2x2 dot centred in the hole
    const part = [rect(0, 0, 20, 20), rect(4, 4, 12, 12), rect(9, 9, 2, 2)];
    const anchors = detectNearGaps(part, 2.5);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((a) => inPart(part, a.pt) === false)).toBe(true);
  });
});

describe("slot geometry + guard", () => {
  const part = [rect(0, 0, 10, 10)];
  it("buildSlotRect returns a 4-corner kerf-wide rectangle along dir", () => {
    const r = buildSlotRect({ x: 12, y: 5 }, 1, 0, 1.0, 0.06); // outside the part, pointing +x
    expect(r).toHaveLength(4);
    // length ~1.0 along x, width ~0.06 along y
    const xs = r.map((p) => p.x), ys = r.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.0, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.06, 3);
  });
  it("slotInScrap is true fully outside the part, false when it crosses in", () => {
    const outside = buildSlotRect({ x: 12, y: 5 }, 1, 0, 1.0, 0.06);
    expect(slotInScrap(outside, { x: 12, y: 5 }, 1, 0, 1.0, part)).toBe(true);
    const crossing = buildSlotRect({ x: 9.7, y: 5 }, 1, 0, 1.0, 0.06); // straddles x=10 edge
    expect(slotInScrap(crossing, { x: 9.7, y: 5 }, 1, 0, 1.0, part)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify FAIL.**

Run: `cd web && npx vitest run src/lib/forge/nearGap.test.ts`
Expected: FAIL — cannot resolve `./nearGap`.

- [ ] **Step 3: Implement `web/src/lib/forge/nearGap.ts`.**

```ts
// web/src/lib/forge/nearGap.ts
//
// Pure detector for scrap necks ("near-gaps") in a part region, + slot helpers.
// A near-gap is where two NON-ADJACENT pieces of the part boundary nearly touch
// with SCRAP between them (the channel between near-touching script strokes, the
// annulus of a ring+dot, the i/j-dot gap). Used by the relief (perforate) stage
// to place a vent that lets the choked kerf clear sideways. No clipper; O(n) via
// a uniform spatial grid.
import { pointInPolygon } from "./offset";
import type { Pt } from "./types";

export interface NearGapAnchor {
  pt: Pt;
  /** Unit direction ALONG the scrap channel (perpendicular to the s->t chord). */
  dirX: number;
  dirY: number;
}

/** Count-based even-odd: pt is inside the part iff an ODD number of loops contain
 *  it. Orientation-agnostic (clipper hole winding varies) — never use area sign. */
export function inPart(part: Pt[][], pt: Pt): boolean {
  let c = 0;
  for (const loop of part) if (pointInPolygon(loop, pt)) c++;
  return (c & 1) === 1;
}

interface Sample { x: number; y: number; loop: number; edge: number; arc: number }

/** Closed-loop perimeter (mm). */
function perimeter(loop: Pt[]): number {
  let p = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/** Resample a closed loop at uniform arc-length `step`, tagging loop/edge/arc. */
function resampleLoop(loop: Pt[], step: number, loopIndex: number): Sample[] {
  const out: Sample[] = [];
  if (loop.length < 3) return out;
  let arc = 0;   // total arc walked
  let next = 0;  // arc length of the next sample to emit
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    while (next <= arc + len) {
      const d = next - arc;
      out.push({ x: a.x + dx * (d / len), y: a.y + dy * (d / len), loop: loopIndex, edge: i, arc: next });
      next += step;
    }
    arc += len;
  }
  return out;
}

/** Min distance from p to segment ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Detect scrap necks. `gapThresholdMm` = max neck width to vent. */
export function detectNearGaps(part: Pt[][], gapThresholdMm: number): NearGapAnchor[] {
  const step = gapThresholdMm / 3;             // finer than /2 for threshold stability
  const minArcSep = Math.PI * gapThresholdMm;  // same-loop adjacency guard (half-disc rule)
  const loopPerim: number[] = part.map(perimeter);
  const samples: Sample[] = [];
  part.forEach((loop, li) => { for (const s of resampleLoop(loop, step, li)) samples.push(s); });
  if (samples.length === 0) return [];

  // uniform spatial grid, cell = gapThresholdMm
  const cell = gapThresholdMm;
  const grid = new Map<string, number[]>();
  const key = (gx: number, gy: number) => gx + "," + gy;
  samples.forEach((s, idx) => {
    const k = key(Math.floor(s.x / cell), Math.floor(s.y / cell));
    const arr = grid.get(k);
    if (arr) arr.push(idx); else grid.set(k, [idx]);
  });

  const anchors: NearGapAnchor[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    let bestD = Infinity, bestJ = -1;
    for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
      const arr = grid.get(key(gx + ax, gy + ay));
      if (!arr) continue;
      for (const j of arr) {
        if (j === i) continue;
        const t = samples[j];
        if (t.loop === s.loop) {
          const dArc = Math.abs(t.arc - s.arc);
          const wrap = Math.min(dArc, loopPerim[s.loop] - dArc);
          if (wrap < minArcSep) continue; // same-loop & too close along the boundary
        }
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < bestD) { bestD = d; bestJ = j; }
      }
    }
    if (bestJ < 0 || bestD >= gapThresholdMm) continue;
    const t = samples[bestJ];
    // sub-sample refine: true distance from s to t's loop SEGMENT (and neighbours)
    const tl = part[t.loop], n = tl.length;
    let dRef = bestD;
    for (const e of [t.edge - 1, t.edge, t.edge + 1]) {
      const a = tl[((e % n) + n) % n], b = tl[(((e + 1) % n) + n) % n];
      dRef = Math.min(dRef, segDist(s, a, b));
    }
    if (dRef >= gapThresholdMm) continue;
    const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
    if (inPart(part, { x: mx, y: my })) continue; // midpoint must be scrap
    // channel direction = unit perpendicular to the chord t-s
    let cx = -(t.y - s.y), cy = t.x - s.x;
    const cl = Math.hypot(cx, cy);
    if (cl === 0) continue;
    cx /= cl; cy /= cl;
    // dedup by neck identity: loop-pair + bucketed midpoint
    const lo = Math.min(s.loop, t.loop), hi = Math.max(s.loop, t.loop);
    const nk = lo + ":" + hi + ":" + Math.round(mx / gapThresholdMm) + ":" + Math.round(my / gapThresholdMm);
    if (seen.has(nk)) continue;
    seen.add(nk);
    anchors.push({ pt: { x: mx, y: my }, dirX: cx, dirY: cy });
  }
  return anchors;
}

/** A kerf-wide rectangle of `lengthMm` along (dirX,dirY), centred at `center`. */
export function buildSlotRect(center: Pt, dirX: number, dirY: number, lengthMm: number, widthMm: number): Pt[] {
  const hl = lengthMm / 2, hw = widthMm / 2;
  const px = -dirY, py = dirX; // across-axis
  return [
    { x: center.x - dirX * hl - px * hw, y: center.y - dirY * hl - py * hw },
    { x: center.x + dirX * hl - px * hw, y: center.y + dirY * hl - py * hw },
    { x: center.x + dirX * hl + px * hw, y: center.y + dirY * hl + py * hw },
    { x: center.x - dirX * hl + px * hw, y: center.y - dirY * hl + py * hw },
  ];
}

/** True iff the slot's 4 corners AND both end-midpoints are all in scrap. */
export function slotInScrap(rect: Pt[], center: Pt, dirX: number, dirY: number, lengthMm: number, part: Pt[][]): boolean {
  const hl = lengthMm / 2;
  const ends = [
    { x: center.x - dirX * hl, y: center.y - dirY * hl },
    { x: center.x + dirX * hl, y: center.y + dirY * hl },
  ];
  return [...rect, ...ends].every((p) => !inPart(part, p));
}
```

- [ ] **Step 4: Run it — verify PASS.**

Run: `cd web && npx vitest run src/lib/forge/nearGap.test.ts`
Expected: PASS (all). If `detectNearGaps` returns nothing for the bars fixture, check `step`/grid neighbour search; if the annulus test fails, confirm the fixture loops survive (they are passed directly, so all rings are present).

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/forge/nearGap.ts web/src/lib/forge/nearGap.test.ts
git commit -m "feat(forge): near-gap scrap-neck detector + slot geometry helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: PerforateConfig fields

**Files:**
- Modify: `web/src/lib/forge/types.ts` (`PerforateConfig`)
- Modify: `web/src/lib/forge/defaults.ts`
- Modify: `web/src/lib/forge/presets.ts`
- Test: `web/src/lib/forge/presets.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to `presets.test.ts`):

```ts
import { LEAN, AGGRESSIVE } from "./presets";
describe("relief perforate fields", () => {
  it("LEAN uses slot relief with near-gaps on", () => {
    expect(LEAN.perforate.shape).toBe("slot");
    expect(LEAN.perforate.nearGap).toBe(true);
    expect(LEAN.perforate.gapThresholdMm).toBeGreaterThan(0);
    expect(LEAN.perforate.slotLengthMm).toBeGreaterThan(0);
  });
  it("AGGRESSIVE keeps pocket relief (back-compat)", () => {
    expect(AGGRESSIVE.perforate.shape).toBe("pocket");
    expect(AGGRESSIVE.perforate.nearGap).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify FAIL.**

Run: `cd web && npx vitest run src/lib/forge/presets.test.ts`
Expected: FAIL — `shape` undefined.

- [ ] **Step 3a: Extend `PerforateConfig`** in `web/src/lib/forge/types.ts` (after `layerCount`):

```ts
  /** Pocket (square at intervals) or slot (outward/channel-aligned relief tick). */
  shape: "pocket" | "slot";
  /** Place extra vents at scrap necks (near-touching edges / ring+dot / i-j dots). */
  nearGap: boolean;
  /** Max scrap-neck width to vent (mm). */
  gapThresholdMm: number;
  /** Slot length (mm) when shape === "slot". */
  slotLengthMm: number;
```

- [ ] **Step 3b: Defaults** — `web/src/lib/forge/defaults.ts`, in `perforate: { … }` add:
```ts
    shape: "pocket",
    nearGap: false,
    gapThresholdMm: 1.5,
    slotLengthMm: 0.8,
```

- [ ] **Step 3c: Presets** — `web/src/lib/forge/presets.ts`. In `LEAN.perforate` add `shape: "slot", nearGap: true, gapThresholdMm: 1.5, slotLengthMm: 0.8,`. In `AGGRESSIVE.perforate` add `shape: "pocket", nearGap: false, gapThresholdMm: 1.5, slotLengthMm: 0.8,`.

- [ ] **Step 4: Run — verify PASS** (+ confirm no other forge test broke).

Run: `cd web && npx vitest run src/lib/forge/presets.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean (the new REQUIRED fields are only constructed in `DEFAULT_CONFIG`/`LEAN`/`AGGRESSIVE`, all updated).

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/forge/types.ts web/src/lib/forge/defaults.ts web/src/lib/forge/presets.ts web/src/lib/forge/presets.test.ts
git commit -m "feat(forge): perforate/relief config — shape, near-gap, thresholds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Relief stage (all-loop anchors + slots)

**Files:**
- Modify: `web/src/lib/forge/stages.ts` (`generatePerforationPaths`)
- Test: `web/src/lib/forge/stages.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to `stages.test.ts`; reuse its existing imports/helpers — it already imports the stage generators and builds `part` regions):

```ts
import { generatePerforationPaths } from "./stages";
import { inPart } from "./nearGap";
import { DEFAULT_CONFIG } from "./defaults";
import type { Pt } from "./types";

const rectL = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

describe("relief stage", () => {
  it("pocket shape is unchanged (back-compat) and on by default", () => {
    const part = [rectL(0, 0, 20, 12)];
    const cfg = { ...DEFAULT_CONFIG }; // shape:"pocket", nearGap:false
    const paths = generatePerforationPaths(part, cfg, "s");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.rings.length === 1 && p.rings[0].length === 4)).toBe(true);
    expect(paths.every((p) => p.generatedClass === "perforate")).toBe(true);
  });

  it("slot + near-gap vents land in scrap, never in the part", () => {
    const part = [rectL(0, 0, 10, 2), rectL(0, 2.6, 10, 2)]; // two bars, scrap neck between
    const cfg = { ...DEFAULT_CONFIG, perforate: { ...DEFAULT_CONFIG.perforate, shape: "slot" as const, nearGap: true } };
    const paths = generatePerforationPaths(part, cfg, "s");
    expect(paths.length).toBeGreaterThan(0);
    // every emitted slot corner is in scrap
    for (const p of paths) for (const c of p.rings[0]) expect(inPart(part, c)).toBe(false);
  });

  it("anchors over ALL loops (a hole gets vents too)", () => {
    const part = [rectL(0, 0, 40, 40), rectL(15, 15, 10, 10)]; // outer + a hole
    const cfg = { ...DEFAULT_CONFIG, perforate: { ...DEFAULT_CONFIG.perforate, spacingMm: 4 } };
    const paths = generatePerforationPaths(part, cfg, "s");
    // at least one pocket sits near the inner-hole boundary (x or y in 14..26 band)
    const nearHole = paths.some((p) => p.rings[0].some((c) => c.x > 13 && c.x < 27 && c.y > 13 && c.y < 27));
    expect(nearHole).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify FAIL.**

Run: `cd web && npx vitest run src/lib/forge/stages.test.ts`
Expected: FAIL — the "all loops" and "slot" cases fail against the current single-loop/pocket-only code.

- [ ] **Step 3: Replace `generatePerforationPaths`** in `web/src/lib/forge/stages.ts`. Add to the imports at the top of the file: `import { detectNearGaps, buildSlotRect, slotInScrap } from "./nearGap";` (do NOT import `inPart` here — it's only used inside `slotInScrap` and in the test, so importing it into `stages.ts` would be an unused import). Keep the existing `sampleLoopWithNormals`, `outwardNormalAt`, `bandFromRegion` import from `./offset` and `detectCorners` from `./contour`; the old `partOuterLoop` import becomes unused — remove it from the `./offset` import (tsc will flag it). Replace the whole `generatePerforationPaths` function body with:

```ts
/** Stage 2 — perforate / relief. Scrap-side pockets or slots at edges, corners,
 *  and near-gaps (scrap necks), over ALL loops of the part region. */
export function generatePerforationPaths(
  part: Pt[][],
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.perforate.enabled) return [];
  const beam = cfg.beamWidthMm;
  const half = cfg.perforate.pocketSizeMm / 2;
  const biasDist = cfg.perforate.outsideBias ? cfg.perforate.pocketSizeMm : 0;
  const useSlot = cfg.perforate.shape === "slot";

  // anchors: edge + corner over EVERY loop, plus near-gap necks.
  type Anchor = { pt: Pt; dirX: number; dirY: number; kind: "edge" | "gap" };
  const anchors: Anchor[] = [];
  for (const loop of part) {
    if (loop.length < 3) continue;
    for (const a of sampleLoopWithNormals(loop, cfg.perforate.spacingMm)) {
      anchors.push({ pt: a.pt, dirX: a.nx, dirY: a.ny, kind: "edge" });
    }
    if (cfg.perforate.cornerBoost) {
      for (const idx of detectCorners({ points: loop, closed: true }, cfg.perforate.cornerAngleThresholdDeg)) {
        const norm = outwardNormalAt(loop, idx);
        anchors.push({ pt: loop[idx], dirX: norm.nx, dirY: norm.ny, kind: "edge" });
      }
    }
  }
  if (cfg.perforate.nearGap) {
    for (const g of detectNearGaps(part, cfg.perforate.gapThresholdMm)) {
      anchors.push({ pt: g.pt, dirX: g.dirX, dirY: g.dirY, kind: "gap" });
    }
  }

  const out: GeneratedPath[] = [];
  let order = 0;
  for (const a of anchors) {
    let rings: Pt[][] | null = null;
    if (useSlot) {
      // edge slots extend OUTWARD from the boundary; gap slots are centred in the neck.
      // shrink the slot until its whole body is in scrap (else skip).
      let len = cfg.perforate.slotLengthMm;
      while (len >= beam) {
        const off = a.kind === "edge" ? biasDist + len / 2 : 0;
        const center = { x: a.pt.x + a.dirX * off, y: a.pt.y + a.dirY * off };
        const rect = buildSlotRect(center, a.dirX, a.dirY, len, beam);
        if (slotInScrap(rect, center, a.dirX, a.dirY, len, part)) { rings = [rect]; break; }
        len /= 2;
      }
    } else {
      const cx = a.pt.x + a.dirX * biasDist;
      const cy = a.pt.y + a.dirY * biasDist;
      const square: Pt[] = [
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
      ];
      // guard near-gap-only? No — pocket keeps today's behaviour (no inPart filter)
      // so existing output is byte-identical when nearGap is off and shape is pocket.
      rings = [square];
    }
    if (!rings) continue;
    out.push({
      sourceObjectId,
      generatedClass: "perforate",
      groupName: STAGE_GROUPS.perforate,
      layerStart: 0,
      layerEnd: 0,
      widthMultiplier: 1,
      offsetMm: biasDist,
      sideMode: cfg.perforate.outsideBias ? "outside" : cfg.sideMode,
      operationOrder: order++,
      enabled: true,
      rings,
    });
  }
  return out;
}
```

NOTE: this anchors over **all** loops now (a behavioural improvement — previously `partOuterLoop` only). The pocket path is unchanged per-anchor, so pocket output differs from before ONLY by also covering inner loops.

- [ ] **Step 4: Run — verify PASS, and fix existing-test fallout.**

Run: `cd web && npx vitest run src/lib/forge/stages.test.ts`
Expected: the 3 new tests PASS. If an EXISTING perforate test asserted a pocket count tied to the single outer loop, update it to the all-loops reality (the count rises when the part has holes/islands) — preserve the test's intent (pockets are scrap-side squares), don't weaken it. Re-run until green.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/forge/stages.ts web/src/lib/forge/stages.test.ts
git commit -m "feat(forge): relief stage — all-loop anchors, scrap-side slots, near-gap vents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Config v6 migration

**Files:**
- Modify: `web/src/pages/ForgePage.tsx`

- [ ] **Step 1: Bump the key.** Change `web/src/pages/ForgePage.tsx:41` (the `CONFIG_LS_KEY`):
```tsx
const CONFIG_LS_KEY = "forge.config.v6"; // v5→v6: perforate shape/nearGap/gap/slot fields
```
Append the v6 reason to the adjacent version-history comment. `loadConfig`'s `perforate: { ...DEFAULT_CONFIG.perforate, ...(p.perforate ?? {}) }` spread already supplies the new fields — no other change.

- [ ] **Step 2: Verify.**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: clean; build succeeds.

- [ ] **Step 3: Commit.**

```bash
git add web/src/pages/ForgePage.tsx
git commit -m "chore(forge): config v6 — perforate relief fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Perforate / Relief controls

**Files:**
- Modify: `web/src/components/forge/ForgeControls.tsx`

- [ ] **Step 1: Relabel + add controls.** In the Perforate card (`ForgeControls.tsx`), change the card title text `Perforate (CUT_02)` to `Perforate / Relief (CUT_02)`. Inside the card's grid add (matching the existing `Field`/`Select`/`NumberField` idiom):

```tsx
<Field label="Shape">
  <Select value={config.perforate.shape}
    onChange={(e) => patch({ perforate: { ...config.perforate, shape: e.target.value as "pocket" | "slot" } })}>
    <option value="pocket">pocket</option>
    <option value="slot">slot</option>
  </Select>
</Field>
<Field label="Gap threshold (mm)">
  <NumberField value={config.perforate.gapThresholdMm} step={0.25} min={0.25}
    onChange={(v) => patch({ perforate: { ...config.perforate, gapThresholdMm: v } })} />
</Field>
<Field label="Slot length (mm)">
  <NumberField value={config.perforate.slotLengthMm} step={0.1} min={0.1}
    onChange={(v) => patch({ perforate: { ...config.perforate, slotLengthMm: v } })} />
</Field>
<label className="flex items-center gap-2">
  <input type="checkbox" checked={config.perforate.nearGap}
    onChange={(e) => patch({ perforate: { ...config.perforate, nearGap: e.target.checked } })} />
  Near-gap vents
</label>
```

- [ ] **Step 2: Verify** (run the component test alone to avoid the jsdom path-filter artifact).

Run: `cd web && npx tsc --noEmit && npx vitest run src/components/forge/ForgeControls.test.tsx && npm run build`
Expected: tsc clean; test passes (update it only if a changed label broke an assertion, preserving intent); build succeeds.

- [ ] **Step 3: Commit.**

```bash
git add web/src/components/forge/ForgeControls.tsx
git commit -m "feat(forge): Perforate / Relief controls — shape, near-gap, thresholds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Laser-default fix

**Files:**
- Modify: `web/src/components/forge/ForgeStageParams.tsx`
- Modify: `~/Documents/XTools/forge-cal/gen_probes3.py`

- [ ] **Step 1: Fix the fallback.** In `web/src/components/forge/ForgeStageParams.tsx`, the `laserValue()` function returns `override.laser ?? sourceParams?.laser ?? "blue";` — change the trailing `?? "blue"` to `?? "red"` (MOPA IR fibre is the F2 Ultra brass laser; the fallback only fires when the source carries no laser).

- [ ] **Step 2: Fix the probe label.** In `~/Documents/XTools/forge-cal/gen_probes3.py`, change `processing_light_source="blue"` to `processing_light_source="red"` (label only; the time model is light-source-independent, so no re-run is needed).

- [ ] **Step 3: Verify.**

Run: `cd web && npx tsc --noEmit && npx vitest run src/components/forge/ForgeStageParams.test.tsx`
Expected: tsc clean; test passes (the existing laser test asserts the select renders red/blue — the default value changes to "red", update that assertion if present, preserving intent).

- [ ] **Step 4: Commit** (the probe script is outside the repo — commit only the source change):

```bash
git add web/src/components/forge/ForgeStageParams.tsx
git commit -m "fix(forge): default stage laser to red (MOPA IR), not blue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Changelog

**Files:**
- Create: `changelog/2026-06-09-forge-relief-vents.md`

- [ ] **Step 1: Write the entry.**

```markdown
---
id: 2026-06-09-forge-relief-vents
date: 2026-06-09
level: major
title: Forge — scrap-side relief vents
summary: Forge now adds targeted relief at corners and the scrap necks between near-touching edges, so a choking brass kerf can clear sideways.
images:
  - src: forge-relief-vents.png
    caption: Relief slots in the ring+dot gaps and between strokes — always on the scrap side.
---

Deep brass kerfs choke where the scrap can't escape — sharp corners, and the
tight necks between near-touching script strokes, ring+dot decorations and i/j
dots. Forge now finds those spots automatically and adds **scrap-side relief
vents**: short slots that open the choking kerf to free scrap so melt and dross
can clear sideways.

Vents are placed over the whole design — including the inner loops of holes and
disjoint islands — at corners (outward slots) and at near-gaps (slots running
along the scrap channel). A part-side guard checks the whole slot body, so a vent
can never bite the part itself; if a neck is too tight for the configured slot,
the slot shrinks to fit or is skipped.

Turn them on in the **Perforate / Relief** panel: choose pocket or slot, toggle
near-gap vents, and tune the gap threshold and slot length. The Lean preset now
ships slot relief with near-gaps on.

This is the geometry half of the cut-strategy experiment — the comparison mode
that prices candidate strategies against your baseline is next.
```

- [ ] **Step 2: Screenshot** during the Task 8 browser check → `changelog/images/forge-relief-vents.png`.

- [ ] **Step 3: Commit.**

```bash
git add changelog/2026-06-09-forge-relief-vents.md
git commit -m "docs(changelog): Forge scrap-side relief vents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verification + browser check + PR

- [ ] **Step 1: Full suite.**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Then: `uv run --active pytest tests/ -q`
Expected: tsc clean, all vitest green, build OK, pytest green.

- [ ] **Step 2: Browser check (Playwright/Chrome MCP).**
1. `uv run --active xcs-gen serve --host 127.0.0.1 --port 8019` (after the build).
2. Open `http://127.0.0.1:8019/#/forge`; upload `samples/xcs/test-text.xcs`.
3. The default is Lean (slot relief, near-gap on). Confirm relief slots appear in the ring+dot gaps and between letters in the preview, **colour-coded as perforate, none sitting on the black part body**.
4. Toggle Near-gap vents off → the neck vents disappear; toggle Shape pocket↔slot → squares vs slots. 
5. Screenshot the preview → `changelog/images/forge-relief-vents.png`; read it critically (vents in scrap, not on the part).

- [ ] **Step 3: Open the PR.**

```bash
git push -u origin feat/forge-relief-comparison
gh pr create --draft --title "Forge: scrap-side relief vents" --body "$(cat <<'EOF'
Implements PR 1 of docs/superpowers/specs/2026-06-09-forge-relief-vents-comparison-design.md (sections A + C).

- Near-gap detector (nearGap.ts): scrap necks over all loops via resample → spatial grid (O(n)) → nearest non-adjacent (arc-length guard) → sub-sample refine → midpoint-in-scrap.
- Relief stage: corner + near-gap anchors over ALL loops; scrap-side slots (outward at corners, channel-aligned at necks) with a slot-body part-side guard; pockets preserved as the back-compat default.
- PerforateConfig shape/nearGap/gapThresholdMm/slotLengthMm; config v6; Perforate / Relief controls.
- Fix: default stage laser red (MOPA IR), not blue.

Follow-up (PR 2): the A/B/C/D comparison mode (section B) — after a brass cut test of these vents.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Then `gh pr ready` once CI is green.

---

## Notes for the implementer
- Spec: `docs/superpowers/specs/2026-06-09-forge-relief-vents-comparison-design.md` (sections A + C; B is PR 2).
- Reusability invariant from PR #126 still holds: `lib/cuttime/**` must not import from `lib/forge/**`. `nearGap.ts` lives in `lib/forge/` and may import from `./offset`.
- The near-gap detector is a heuristic to be tuned against real cut results — the slot-body `inPart` guard is what makes a wrong vent harmless. Do not weaken it.
