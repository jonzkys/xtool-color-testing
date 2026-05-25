# Contour Forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side experimental page (`#/forge`) that parses an uploaded xTool `.xcs`, treats its INTAGLIO contour as source geometry, and generates staged seed/perforate/deepen/clean cut strategies for MOPA-fibre brass cutting, previewable on canvas and re-exportable as a new `.xcs`.

**Architecture:** Pure, framework-free TypeScript library in `web/src/lib/forge/` (parse, geometry, scheduling, stages, build/export) covered by vitest; a Vite web worker that runs parse + the full generation pipeline off the main thread; and a React page + components under `web/src/pages/` and `web/src/components/forge/` for upload, controls, colour-coded preview, and debug/validation panels. The source incise object is **removed** from exported cut ops; emboss + model objects are preserved untouched.

**Tech Stack:** TypeScript, React 18, Vite worker, vitest, `clipper2-js` (polygon offsetting), existing `web/src/ui/` design primitives.

**Spec:** `docs/superpowers/specs/2026-05-25-contour-forge-design.md`

**Conventions (from CLAUDE.md):**
- All work on this branch `feat/contour-forge`. Commit frequently.
- After any `web/src/**` change that you want to see in the running app: `cd web && npm run build`. Frontend "done" gate: `cd web && npx tsc --noEmit && npm test && npm run build`, **then** load it in Chrome MCP and read a screenshot critically.
- Run a single vitest file: `cd web && npx vitest run src/lib/forge/<file>.test.ts`.

**Coordinate convention used throughout:** all generated geometry is computed in **millimetre space**. `mmPerUnit` (derived in Task 5) converts the XCS `dPath` units → mm on parse, and back on export.

---

## File structure

Created:
- `web/src/lib/forge/types.ts` — shared types (single source of truth).
- `web/src/lib/forge/contour.ts` — dPath flatten, normalise, closed-detect, winding/outside, segment, corners.
- `web/src/lib/forge/offset.ts` — clipper2-js offset-stack wrapper.
- `web/src/lib/forge/schedule.ts` — interlaced segment ordering.
- `web/src/lib/forge/xcs.ts` — parse, find emboss/incise, extract geometry, calibrate units, build + export.
- `web/src/lib/forge/stages.ts` — seed/perforate/deepen/clean generators.
- `web/src/lib/forge/pipeline.ts` — `runPipeline(parsed, config)` → ordered `GeneratedPath[]` + debug stats.
- `web/src/lib/forge/defaults.ts` — `DEFAULT_CONFIG`.
- `web/src/lib/forge/forge.worker.ts` — worker: parse + pipeline.
- `web/src/components/forge/ForgeCanvas.tsx` — colour-coded auto-fit preview.
- `web/src/components/forge/ForgeControls.tsx` — stage control panels.
- `web/src/components/forge/ForgeDebugPanel.tsx` — debug + validation panel.
- `web/src/pages/ForgePage.tsx` — page state machine + layout.
- `changelog/2026-05-25-contour-forge.md` — major changelog entry.
- Test files colocated: `*.test.ts` beside each lib module.

Modified:
- `web/src/router.ts` — add `forge` route.
- `web/src/App.tsx` — lazy page + render gate + title.
- `web/src/components/TopBar.tsx` — nav entry.
- `web/package.json` — add `clipper2-js` dependency (via npm install).

---

## Task 0: Branch + dependency + sample fixture

**Files:**
- Modify: `web/package.json` (npm install writes it)
- Test fixture: `samples/xcs/incise_emboss.xcs` (already present; commit it so tests can read it)

- [ ] **Step 1: Confirm branch**

Run: `git rev-parse --abbrev-ref HEAD`
Expected: `feat/contour-forge`

- [ ] **Step 2: Install the offset library**

Run: `cd web && npm install clipper2-js`
Expected: `package.json` gains `"clipper2-js"` under dependencies; `package-lock.json` updated.

- [ ] **Step 3: Verify the package's actual export names**

Run: `cd web && node -e "const c=require('clipper2-js'); console.log(Object.keys(c))"`
Expected: prints exported names. **Record** the offset entry point and enums — the published `clipper2-js` exposes a `Clipper` facade with `InflatePaths`, plus `JoinType` and `EndType` enums, operating on `Path64`/`Paths64` arrays of `{x,y}` integer points. If names differ, adjust only `offset.ts` (Task 6) to match — nothing else imports clipper.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json "samples/xcs/incise_emboss.xcs"
git commit -m "chore(forge): add clipper2-js + commit incise/emboss sample fixture"
```

---

## Task 1: Core types

No tests (type-only module). Establishes names every later task depends on.

**Files:**
- Create: `web/src/lib/forge/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// web/src/lib/forge/types.ts
// Shared types for the Contour Forge feature. All geometry is in mm space.

/** A 2D point in millimetres. */
export interface Pt {
  x: number;
  y: number;
}

/** A polyline contour in mm space. `closed` means the last point joins the first. */
export interface Contour {
  points: Pt[];
  closed: boolean;
}

/** Which side of the contour widening is biased toward. */
export type SideMode = "outside" | "inside" | "symmetric" | "flip";

/** The four functional path classes the tool emits. */
export type GeneratedClass = "seed" | "perforate" | "deepen" | "clean";

export type Direction = "forward" | "reverse";

/**
 * One generated path with full provenance metadata. Kept internally for
 * preview/debug even where the .xcs format cannot represent every field.
 */
export interface GeneratedPath {
  sourceObjectId: string;
  generatedClass: GeneratedClass;
  groupName: string;
  layerStart: number;
  layerEnd: number;
  widthMultiplier: number;
  offsetMm: number;
  sideMode: SideMode;
  direction: Direction;
  segmentIndex?: number;
  operationOrder: number;
  enabled: boolean;
  /** Geometry in mm space. */
  points: Pt[];
  closed: boolean;
}

/** One editable deepen pass-group row. */
export interface DeepenGroup {
  name: string;
  fromLayer: number;
  toLayer: number;
  widthMultiplier: number;
  enabled: boolean;
}

export interface SeedConfig {
  enabled: boolean;
  widthMultiplier: number;
  layerCount: number;
  outsideOnly: boolean;
}

export interface PerforateConfig {
  enabled: boolean;
  spacingMm: number;
  cornerBoost: boolean;
  cornerAngleThresholdDeg: number;
  pocketSizeMm: number;
  outsideBias: boolean;
}

export interface DeepenConfig {
  groups: DeepenGroup[];
  interlaceEnabled: boolean;
  segmentLengthMm: number;
  interlaceStride: number;
  reverseAlternatePasses: boolean;
  staggerStartPoint: boolean;
  avoidSameStartPoint: boolean;
  outsideOnly: boolean;
}

export interface CleanConfig {
  enabled: boolean;
  /** Which walls to follow. */
  offsetSelection: "walls" | "outer" | "inner";
  passes: number;
}

export interface ForgeConfig {
  beamWidthMm: number;
  sideMode: SideMode;
  /** Manual unit override; null = use perimeter-derived calibration. */
  mmPerUnitOverride: number | null;
  seed: SeedConfig;
  perforate: PerforateConfig;
  deepen: DeepenConfig;
  clean: CleanConfig;
}

/** One object detected inside the uploaded XCS. */
export interface XcsObject {
  id: string;
  type: string; // PATH | BITMAP | CIRCLE | ...
  name: string | null;
  processingType: string | null; // INTAGLIO | RELIEF | VECTOR_CUTTING | ...
  modeClass: "incise" | "emboss" | "other";
  dPath?: string;
  /** id of the device.data process group this object belongs to. */
  groupKey: string;
}

/** Result of parsing an uploaded .xcs. `raw` is the full JSON document. */
export interface ParsedXcs {
  raw: unknown;
  objects: XcsObject[];
  emboss: XcsObject[];
  incise: XcsObject[];
}

/** Stats + warnings surfaced in the debug panel. */
export interface DebugStats {
  mmPerUnit: number;
  mmPerUnitConfident: boolean;
  pathCounts: Record<GeneratedClass, number>;
  segmentCount: number;
  totalPaths: number;
  warnings: string[];
}

export interface PipelineResult {
  paths: GeneratedPath[];
  stats: DebugStats;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/forge/types.ts
git commit -m "feat(forge): core types"
```

---

## Task 2: dPath flattening + contour basics

**Files:**
- Create: `web/src/lib/forge/contour.ts`
- Test: `web/src/lib/forge/contour.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/forge/contour.test.ts
import { describe, it, expect } from "vitest";
import {
  flattenDPath,
  normaliseContour,
  detectClosedContour,
  contourPerimeter,
} from "./contour";

describe("flattenDPath", () => {
  it("flattens M/L/Z into a closed polyline", () => {
    const c = flattenDPath("M0,0 L10,0 L10,10 L0,10 Z");
    expect(c.closed).toBe(true);
    expect(c.points[0]).toEqual({ x: 0, y: 0 });
    expect(c.points).toContainEqual({ x: 10, y: 10 });
  });

  it("flattens a quadratic bezier (Q) into multiple points", () => {
    const c = flattenDPath("M0,0 Q5,10 10,0");
    expect(c.points.length).toBeGreaterThan(3); // subdivided
    expect(c.points[0]).toEqual({ x: 0, y: 0 });
    const last = c.points[c.points.length - 1];
    expect(last.x).toBeCloseTo(10, 3);
    expect(last.y).toBeCloseTo(0, 3);
  });

  it("flattens a cubic bezier (C)", () => {
    const c = flattenDPath("M0,0 C0,10 10,10 10,0");
    expect(c.points.length).toBeGreaterThan(3);
    expect(c.points[c.points.length - 1].x).toBeCloseTo(10, 3);
  });

  it("supports comma- and space-separated coords", () => {
    const a = flattenDPath("M0 0 L10 0");
    const b = flattenDPath("M0,0L10,0");
    expect(a.points).toEqual(b.points);
  });
});

describe("detectClosedContour", () => {
  it("detects an explicitly closed path", () => {
    expect(detectClosedContour(flattenDPath("M0,0 L10,0 L0,10 Z"))).toBe(true);
  });
  it("treats first≈last as closed even without Z", () => {
    const c = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }], closed: false };
    expect(detectClosedContour(c)).toBe(true);
  });
  it("reports open for a non-returning polyline", () => {
    const c = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    expect(detectClosedContour(c)).toBe(false);
  });
});

describe("normaliseContour", () => {
  it("drops duplicate consecutive points and a closing dupe", () => {
    const c = normaliseContour({
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }],
      closed: true,
    });
    // closing duplicate removed, interior dupe collapsed
    expect(c.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(c.closed).toBe(true);
  });
});

describe("contourPerimeter", () => {
  it("measures a closed unit square as 4", () => {
    const sq = flattenDPath("M0,0 L1,0 L1,1 L0,1 Z");
    expect(contourPerimeter(sq)).toBeCloseTo(4, 6);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/contour.test.ts`
Expected: FAIL ("flattenDPath is not a function" / module not found).

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/forge/contour.ts
import type { Contour, Pt } from "./types";

const BEZIER_STEPS = 16; // subdivisions per bezier segment

/** Tokenise an SVG path into [command, ...numbers] groups. */
function tokenize(d: string): Array<{ cmd: string; nums: number[] }> {
  const out: Array<{ cmd: string; nums: number[] }> = [];
  const re = /([MmLlHhVvQqCcZz])([^MmLlHhVvQqCcZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    out.push({ cmd: m[1], nums });
  }
  return out;
}

function quad(p0: Pt, c: Pt, p1: Pt, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    });
  }
  return pts;
}

function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return pts;
}

/**
 * Flatten an SVG-style dPath (M/L/H/V/Q/C/Z, absolute or relative) into a
 * mm-space polyline. Beziers are subdivided into BEZIER_STEPS chords. Only the
 * commands seen in xTool .xcs incise paths are handled (no arcs / S / T).
 */
export function flattenDPath(d: string): Contour {
  const tokens = tokenize(d);
  const points: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let closed = false;

  for (const { cmd, nums } of tokens) {
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const base = () => (rel ? cur : { x: 0, y: 0 });
    switch (C) {
      case "M": {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const b = base();
          cur = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          if (i === 0) start = cur;
          points.push(cur);
        }
        break;
      }
      case "L": {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const b = base();
          cur = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          points.push(cur);
        }
        break;
      }
      case "H": {
        for (const n of nums) {
          cur = { x: (rel ? cur.x : 0) + n, y: cur.y };
          points.push(cur);
        }
        break;
      }
      case "V": {
        for (const n of nums) {
          cur = { x: cur.x, y: (rel ? cur.y : 0) + n };
          points.push(cur);
        }
        break;
      }
      case "Q": {
        for (let i = 0; i + 3 < nums.length; i += 4) {
          const b = base();
          const c = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          const p1 = { x: b.x + nums[i + 2], y: b.y + nums[i + 3] };
          points.push(...quad(cur, c, p1, BEZIER_STEPS));
          cur = p1;
        }
        break;
      }
      case "C": {
        for (let i = 0; i + 5 < nums.length; i += 6) {
          const b = base();
          const c1 = { x: b.x + nums[i], y: b.y + nums[i + 1] };
          const c2 = { x: b.x + nums[i + 2], y: b.y + nums[i + 3] };
          const p1 = { x: b.x + nums[i + 4], y: b.y + nums[i + 5] };
          points.push(...cubic(cur, c1, c2, p1, BEZIER_STEPS));
          cur = p1;
        }
        break;
      }
      case "Z": {
        closed = true;
        cur = start;
        break;
      }
    }
  }
  return { points, closed };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const EPS = 1e-6;

/** True if the contour is explicitly closed or its ends coincide. */
export function detectClosedContour(c: Contour): boolean {
  if (c.closed) return true;
  if (c.points.length < 3) return false;
  return dist(c.points[0], c.points[c.points.length - 1]) < 1e-3;
}

/** Remove consecutive duplicate points and any closing duplicate of point 0. */
export function normaliseContour(c: Contour): Contour {
  const pts: Pt[] = [];
  for (const p of c.points) {
    const last = pts[pts.length - 1];
    if (!last || dist(last, p) > EPS) pts.push(p);
  }
  const closed = detectClosedContour(c);
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < EPS) {
    pts.pop();
  }
  return { points: pts, closed };
}

/** Total length walking the polyline (wrapping if closed). */
export function contourPerimeter(c: Contour): number {
  const n = c.points.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += dist(c.points[i], c.points[i + 1]);
  if (c.closed) total += dist(c.points[n - 1], c.points[0]);
  return total;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/contour.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/contour.ts web/src/lib/forge/contour.test.ts
git commit -m "feat(forge): dPath flattening + contour basics"
```

---

## Task 3: Winding + inside/outside inference

**Files:**
- Modify: `web/src/lib/forge/contour.ts`
- Modify: `web/src/lib/forge/contour.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// append to web/src/lib/forge/contour.test.ts
import { signedArea, inferWindingAndOutside } from "./contour";

describe("signedArea / winding", () => {
  it("is positive for CCW, negative for CW (screen coords, y-down)", () => {
    const ccw = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const cw = { points: [...ccw.points].reverse(), closed: true };
    expect(Math.sign(signedArea(ccw))).toBe(1);
    expect(Math.sign(signedArea(cw))).toBe(-1);
  });
});

describe("inferWindingAndOutside", () => {
  it("is confident for a clean closed polygon", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const r = inferWindingAndOutside(sq);
    expect(r.confident).toBe(true);
    // outsideSign is +1 or -1, the delta sign that inflates away from the interior
    expect(Math.abs(r.outsideSign)).toBe(1);
  });
  it("is not confident for an open contour", () => {
    const open = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false };
    expect(inferWindingAndOutside(open).confident).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/contour.test.ts`
Expected: FAIL ("signedArea is not a function").

- [ ] **Step 3: Implement (append to contour.ts)**

```typescript
// append to web/src/lib/forge/contour.ts
import type { Contour } from "./types"; // already imported at top; keep one import

/** Shoelace signed area. >0 CCW, <0 CW in screen (y-down) coords. */
export function signedArea(c: Contour): number {
  const p = c.points;
  const n = p.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return a / 2;
}

export interface WindingInfo {
  /**
   * The sign to multiply a positive clipper delta by so the offset moves to
   * the OUTSIDE (scrap side) of the contour. For a closed polygon, outside =
   * inflate, so this encodes winding handedness.
   */
  outsideSign: 1 | -1;
  confident: boolean;
}

/**
 * Infer which side is "outside" (scrap). For a closed polygon we use winding:
 * Clipper inflates a positive-area (CCW) polygon outward with a positive delta,
 * so outsideSign = +1 for CCW and -1 for CW. Open contours can't be classified
 * by winding, so we report not-confident and the caller must require a manual
 * side choice (the UI "flip" control).
 */
export function inferWindingAndOutside(c: Contour): WindingInfo {
  if (!detectClosedContour(c) || c.points.length < 3) {
    return { outsideSign: 1, confident: false };
  }
  const area = signedArea(c);
  if (Math.abs(area) < 1e-9) return { outsideSign: 1, confident: false };
  return { outsideSign: area > 0 ? 1 : -1, confident: true };
}
```

Note: ensure `contour.ts` has a single `import type { Contour, Pt } from "./types";` at the top; remove the duplicate import line shown in the append block.

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/contour.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/contour.ts web/src/lib/forge/contour.test.ts
git commit -m "feat(forge): winding + inside/outside inference"
```

---

## Task 4: Segmentation + corner detection

**Files:**
- Modify: `web/src/lib/forge/contour.ts`
- Modify: `web/src/lib/forge/contour.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// append to web/src/lib/forge/contour.test.ts
import { segmentContour, detectCorners, resampleByArcLength } from "./contour";

describe("resampleByArcLength", () => {
  it("places points every step along a straight line", () => {
    const line = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
    const r = resampleByArcLength(line, 2);
    expect(r.length).toBe(6); // 0,2,4,6,8,10
    expect(r[3]).toEqual({ x: 6, y: 0 });
  });
});

describe("segmentContour", () => {
  it("splits a 40mm closed square into ~4 segments of 10mm at segLen=10", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const segs = segmentContour(sq, 10);
    expect(segs.length).toBe(4);
    // each segment is a short polyline
    expect(segs[0].points.length).toBeGreaterThanOrEqual(2);
  });
  it("covers the whole perimeter (segment lengths sum ≈ perimeter)", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const segs = segmentContour(sq, 7);
    const total = segs.reduce((s, seg) => s + contourPerimeter({ points: seg.points, closed: false }), 0);
    expect(total).toBeCloseTo(40, 2);
  });
});

describe("detectCorners", () => {
  it("flags the 4 corners of a square above a 45° threshold", () => {
    const sq = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true };
    const idx = detectCorners(sq, 45);
    expect(idx.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
  it("flags nothing on a gently sampled circle at a high threshold", () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      pts.push({ x: Math.cos(t) * 10, y: Math.sin(t) * 10 });
    }
    expect(detectCorners({ points: pts, closed: true }, 45)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/contour.test.ts`
Expected: FAIL ("segmentContour is not a function").

- [ ] **Step 3: Implement (append to contour.ts)**

```typescript
// append to web/src/lib/forge/contour.ts

/** Walk the contour and emit a point every `stepMm` of arc length (endpoints kept). */
export function resampleByArcLength(c: Contour, stepMm: number): Pt[] {
  const pts = c.points;
  if (pts.length < 2 || stepMm <= 0) return [...pts];
  const loop = c.closed ? [...pts, pts[0]] : pts;
  const out: Pt[] = [loop[0]];
  let carry = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    const a = loop[i];
    const b = loop[i + 1];
    let segLen = dist(a, b);
    if (segLen < EPS) continue;
    let t = (stepMm - carry) / segLen;
    while (t <= 1 + EPS) {
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      t += stepMm / segLen;
    }
    carry = (carry + segLen) % stepMm;
  }
  return out;
}

/**
 * Split a contour into consecutive short polyline segments, each roughly
 * `segmentLengthMm` long, covering the whole perimeter. Returned segments are
 * always open polylines (they are the pieces between cut breaks).
 */
export function segmentContour(c: Contour, segmentLengthMm: number): Contour[] {
  const norm = normaliseContour(c);
  const loop = norm.closed ? [...norm.points, norm.points[0]] : norm.points;
  const segs: Contour[] = [];
  let cur: Pt[] = [loop[0]];
  let acc = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    const a = loop[i];
    const b = loop[i + 1];
    let segLen = dist(a, b);
    let from = a;
    while (acc + segLen >= segmentLengthMm - EPS) {
      const need = segmentLengthMm - acc;
      const t = need / segLen;
      const split = { x: from.x + (b.x - from.x) * t, y: from.y + (b.y - from.y) * t };
      cur.push(split);
      segs.push({ points: cur, closed: false });
      cur = [split];
      from = split;
      segLen = dist(from, b);
      acc = 0;
    }
    cur.push(b);
    acc += segLen;
  }
  if (cur.length >= 2) segs.push({ points: cur, closed: false });
  return segs;
}

/**
 * Return indices of vertices where the turn angle exceeds `angleThresholdDeg`
 * (a sharp corner / high-curvature region). Used to inject extra perforations.
 */
export function detectCorners(c: Contour, angleThresholdDeg: number): number[] {
  const p = normaliseContour(c).points;
  const n = p.length;
  if (n < 3) return [];
  const out: number[] = [];
  const limit = (angleThresholdDeg * Math.PI) / 180;
  const range = c.closed ? n : n - 1;
  for (let i = c.closed ? 0 : 1; i < range; i++) {
    const prev = p[(i - 1 + n) % n];
    const curP = p[i];
    const next = p[(i + 1) % n];
    const v1 = { x: curP.x - prev.x, y: curP.y - prev.y };
    const v2 = { x: next.x - curP.x, y: next.y - curP.y };
    const m1 = Math.hypot(v1.x, v1.y);
    const m2 = Math.hypot(v2.x, v2.y);
    if (m1 < EPS || m2 < EPS) continue;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos))); // deviation from straight
    if (turn > limit) out.push(i);
  }
  return out;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/contour.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/contour.ts web/src/lib/forge/contour.test.ts
git commit -m "feat(forge): segmentation + corner detection"
```

---

## Task 5: XCS parse, detection, geometry extraction, unit calibration

**Files:**
- Create: `web/src/lib/forge/xcs.ts`
- Test: `web/src/lib/forge/xcs.test.ts`

Reference facts (from the sample): top-level `canvas[0].displays[]`; processing modes live in `device.data = { dataType:"Map", value:[[groupKey, group], …] }` where `group.mode` (e.g. `"RELIEF_PROCESS"`) and `group.displays = { dataType:"Map", value:[[displayId, entry], …] }`, `entry.processingType ∈ {INTAGLIO, RELIEF, …}`. `group.data[group.mode].perimeter` is the contour perimeter in mm.

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/forge/xcs.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseXcsFile,
  findEmbossObjects,
  findInciseObjects,
  extractContourGeometry,
  calibrateMmPerUnit,
} from "./xcs";

const SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xcs");
function loadSample(): ArrayBuffer {
  const buf = readFileSync(SAMPLE);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("parseXcsFile (real sample)", () => {
  it("finds exactly one incise (INTAGLIO) and one emboss (RELIEF) object", () => {
    const parsed = parseXcsFile(loadSample());
    expect(findInciseObjects(parsed).length).toBe(1);
    expect(findEmbossObjects(parsed).length).toBe(1);
    expect(findInciseObjects(parsed)[0].processingType).toBe("INTAGLIO");
    expect(findEmbossObjects(parsed)[0].processingType).toBe("RELIEF");
  });

  it("extracts a closed contour with points from the incise object", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const contour = extractContourGeometry(incise);
    expect(contour.points.length).toBeGreaterThan(10);
    expect(contour.closed).toBe(true);
  });

  it("calibrates mmPerUnit confidently from the RELIEF_PROCESS perimeter", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const cal = calibrateMmPerUnit(parsed, incise);
    expect(cal.confident).toBe(true);
    expect(cal.mmPerUnit).toBeGreaterThan(0);
  });
});

describe("parseXcsFile (errors)", () => {
  it("throws on non-JSON input", () => {
    const bad = new TextEncoder().encode("not json").buffer;
    expect(() => parseXcsFile(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts`
Expected: FAIL ("parseXcsFile is not a function").

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/forge/xcs.ts
import type { Contour, ParsedXcs, XcsObject } from "./types";
import { flattenDPath, normaliseContour, contourPerimeter } from "./contour";

const INCISE_TYPES = new Set(["INTAGLIO", "VECTOR_CUTTING"]);
const EMBOSS_TYPES = new Set(["RELIEF", "VECTOR_ENGRAVING", "FILL_VECTOR_ENGRAVING", "COLOR_FILL_ENGRAVE"]);

function classify(pt: string | null): XcsObject["modeClass"] {
  if (pt && INCISE_TYPES.has(pt)) return "incise";
  if (pt && EMBOSS_TYPES.has(pt)) return "emboss";
  return "other";
}

/** A serialised JS Map: { dataType:"Map", value:[[k,v],…] }. */
interface XcsMap<V> {
  dataType: "Map";
  value: Array<[string, V]>;
}
function isXcsMap(v: unknown): v is XcsMap<unknown> {
  return !!v && typeof v === "object" && (v as { dataType?: string }).dataType === "Map";
}
function mapEntries<V>(m: unknown): Array<[string, V]> {
  return isXcsMap(m) ? (m.value as Array<[string, V]>) : [];
}

interface RawDisplay {
  id: string;
  type: string;
  name?: string | null;
  dPath?: string;
  isClosePath?: boolean;
}
interface RawEntry {
  type?: string;
  processingType?: string;
}
interface RawGroup {
  mode?: string;
  data?: Record<string, { perimeter?: number }>;
  displays?: unknown;
}

/** Parse raw .xcs JSON bytes into the in-memory model. Throws on bad JSON. */
export function parseXcsFile(buf: ArrayBuffer): ParsedXcs {
  const text = new TextDecoder().decode(buf);
  const raw = JSON.parse(text) as {
    canvas?: Array<{ displays?: RawDisplay[] }>;
    device?: { data?: unknown };
  };
  const displays: RawDisplay[] = raw.canvas?.[0]?.displays ?? [];
  const byId = new Map(displays.map((d) => [d.id, d]));

  // Walk device.data Map → group → displays Map → processing entries.
  const objects: XcsObject[] = [];
  for (const [groupKey, group] of mapEntries<RawGroup>(raw.device?.data)) {
    for (const [displayId, entry] of mapEntries<RawEntry>(group.displays)) {
      const disp = byId.get(displayId);
      const processingType = entry.processingType ?? null;
      objects.push({
        id: displayId,
        type: disp?.type ?? entry.type ?? "UNKNOWN",
        name: disp?.name ?? null,
        processingType,
        modeClass: classify(processingType),
        dPath: disp?.dPath,
        groupKey,
      });
    }
  }

  const parsed: ParsedXcs = {
    raw,
    objects,
    emboss: objects.filter((o) => o.modeClass === "emboss"),
    incise: objects.filter((o) => o.modeClass === "incise"),
  };
  return parsed;
}

export function findEmbossObjects(p: ParsedXcs): XcsObject[] {
  return p.emboss;
}
export function findInciseObjects(p: ParsedXcs): XcsObject[] {
  return p.incise;
}

/** Flatten + normalise the object's dPath into a mm-ish contour (still in path units). */
export function extractContourGeometry(obj: XcsObject): Contour {
  if (!obj.dPath) {
    throw new Error(`object ${obj.id} has no dPath — not a usable vector contour`);
  }
  return normaliseContour(flattenDPath(obj.dPath));
}

export interface Calibration {
  mmPerUnit: number;
  confident: boolean;
}

/**
 * Derive path-units → mm. The RELIEF_PROCESS group records the real-world
 * `perimeter` (mm) of its contour; dividing by the flattened path perimeter
 * (units) gives mm-per-unit. If the field is missing/zero we fall back to 1.0
 * and report not-confident (caller surfaces a warning + manual override).
 */
export function calibrateMmPerUnit(p: ParsedXcs, incise: XcsObject): Calibration {
  const raw = p.raw as { device?: { data?: unknown } };
  let perimeterMm = 0;
  for (const [, group] of mapEntries<RawGroup>(raw.device?.data)) {
    if (group.mode && group.data?.[group.mode]?.perimeter) {
      perimeterMm = group.data[group.mode]!.perimeter!;
      break;
    }
  }
  const units = contourPerimeter(extractContourGeometry(incise));
  if (perimeterMm > 0 && units > 0) {
    return { mmPerUnit: perimeterMm / units, confident: true };
  }
  return { mmPerUnit: 1, confident: false };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/xcs.ts web/src/lib/forge/xcs.test.ts
git commit -m "feat(forge): xcs parse, emboss/incise detection, unit calibration"
```

---

## Task 6: Offset stack via clipper2-js

**Files:**
- Create: `web/src/lib/forge/offset.ts`
- Test: `web/src/lib/forge/offset.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/forge/offset.test.ts
import { describe, it, expect } from "vitest";
import { offsetContour, generateOffsetStack } from "./offset";
import { signedArea, contourPerimeter } from "./contour";
import type { Contour } from "./types";

const square: Contour = {
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  closed: true,
};

describe("offsetContour", () => {
  it("inflates a CCW square outward (larger perimeter) for outsideSign +1, delta>0", () => {
    const ccw = signedArea(square) > 0 ? square : { ...square, points: [...square.points].reverse() };
    const out = offsetContour(ccw, 1, 1); // 1mm outward
    expect(out.length).toBe(1);
    expect(contourPerimeter(out[0])).toBeGreaterThan(contourPerimeter(ccw));
  });
  it("shrinks when offsetting inward (negative effective delta)", () => {
    const ccw = signedArea(square) > 0 ? square : { ...square, points: [...square.points].reverse() };
    const inward = offsetContour(ccw, 1, -1); // inside
    expect(contourPerimeter(inward[0])).toBeLessThan(contourPerimeter(ccw));
  });
});

describe("generateOffsetStack", () => {
  it("1x outside-only yields just the centreline (no extra offsets)", () => {
    const stack = generateOffsetStack(square, 1, 0.05, "outside");
    expect(stack.length).toBe(1); // centreline only at width 1x
  });
  it("4x outside-only yields centreline + multiple outside offsets", () => {
    const stack = generateOffsetStack(square, 4, 0.05, "outside");
    expect(stack.length).toBeGreaterThan(2);
    // every offset ring is on the outside → larger perimeter than centreline
    const base = contourPerimeter(square);
    for (const ring of stack.slice(1)) {
      expect(contourPerimeter(ring)).toBeGreaterThanOrEqual(base);
    }
  });
  it("symmetric splits offsets to both sides", () => {
    const stack = generateOffsetStack(square, 4, 0.05, "symmetric");
    const base = contourPerimeter(square);
    const hasInner = stack.some((r) => contourPerimeter(r) < base);
    const hasOuter = stack.some((r) => contourPerimeter(r) > base);
    expect(hasInner && hasOuter).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/offset.test.ts`
Expected: FAIL ("offsetContour is not a function").

- [ ] **Step 3: Implement**

`clipper2-js` mirrors Clipper2: `Clipper.InflatePaths(paths, delta, joinType, endType, miterLimit)` on integer `Paths64` (arrays of `{x,y}`). We scale mm→int by `SCALE` and back. **If Step 3 of Task 0 showed different export names, adjust the import + the three call sites below — this is the only file that touches clipper.**

```typescript
// web/src/lib/forge/offset.ts
import { Clipper, JoinType, EndType } from "clipper2-js";
import type { Contour, Pt, SideMode } from "./types";
import { inferWindingAndOutside } from "./contour";

const SCALE = 1e4; // mm → integer units for clipper precision

function toPath64(c: Contour): Array<{ x: number; y: number }> {
  return c.points.map((p) => ({ x: Math.round(p.x * SCALE), y: Math.round(p.y * SCALE) }));
}
function fromPath64(path: Array<{ x: number; y: number }>): Pt[] {
  return path.map((p) => ({ x: p.x / SCALE, y: p.y / SCALE }));
}

/**
 * Offset a single contour by `distanceMm`. `outsideSign` is +1/-1 telling which
 * delta sign moves to the scrap side (from inferWindingAndOutside). Closed
 * contours use Polygon end type; open ones use Square. Returns the resulting
 * ring(s) as closed contours.
 */
export function offsetContour(c: Contour, distanceMm: number, outsideSign: 1 | -1): Contour[] {
  if (distanceMm === 0) return [c];
  const delta = distanceMm * outsideSign * SCALE;
  const endType = c.closed ? EndType.Polygon : EndType.Square;
  const solution = Clipper.InflatePaths([toPath64(c)], delta, JoinType.Round, endType, 2.0);
  return solution.map((path: Array<{ x: number; y: number }>) => ({
    points: fromPath64(path),
    closed: true,
  }));
}

/**
 * Build the offset stack for a deepen/seed width.
 * Width multiplier semantics (kerf = widthMultiplier × beamWidthMm):
 *   1x → centreline only
 *   2x → centreline + 1 ring
 *   4x → centreline + multiple rings
 *   8x → centreline + a wider ring stack
 * One ring per beam-width step out to the target half-kerf, scrap-side biased.
 * sideMode: outside (all outward), inside (all inward), symmetric (split),
 * flip (outward with the inverted side sign).
 */
export function generateOffsetStack(
  contour: Contour,
  widthMultiplier: number,
  beamWidthMm: number,
  sideMode: SideMode,
): Contour[] {
  const stack: Contour[] = [contour]; // index 0 = centreline
  if (widthMultiplier <= 1 || beamWidthMm <= 0) return stack;

  const winding = inferWindingAndOutside(contour);
  const outSign: 1 | -1 = sideMode === "flip" ? (winding.outsideSign === 1 ? -1 : 1) : winding.outsideSign;
  const inSign: 1 | -1 = outSign === 1 ? -1 : 1;

  // total widening beyond the centreline, in mm
  const totalWiden = (widthMultiplier - 1) * beamWidthMm;
  const steps = Math.max(1, Math.round(totalWiden / beamWidthMm));

  for (let i = 1; i <= steps; i++) {
    const d = i * beamWidthMm;
    if (sideMode === "outside" || sideMode === "flip") {
      stack.push(...offsetContour(contour, d, outSign));
    } else if (sideMode === "inside") {
      stack.push(...offsetContour(contour, d, inSign));
    } else {
      // symmetric: alternate outward/inward at half the distance
      const half = d / 2;
      stack.push(...offsetContour(contour, half, outSign));
      stack.push(...offsetContour(contour, half, inSign));
    }
  }
  return stack;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/offset.test.ts`
Expected: PASS. If clipper enum/method names differ, fix imports/calls per Task 0 Step 3 and re-run.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/offset.ts web/src/lib/forge/offset.test.ts
git commit -m "feat(forge): clipper2-js offset stack (scrap-side biased)"
```

---

## Task 7: Interlaced segment scheduling

**Files:**
- Create: `web/src/lib/forge/schedule.ts`
- Test: `web/src/lib/forge/schedule.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/forge/schedule.test.ts
import { describe, it, expect } from "vitest";
import { orderSegmentsInterlaced } from "./schedule";

describe("orderSegmentsInterlaced", () => {
  it("processes non-adjacent segments first (stride 3)", () => {
    const order = orderSegmentsInterlaced(9, { stride: 3, reverse: false, stagger: false, pass: 0 });
    // first pass picks 0,3,6 then 1,4,7 then 2,5,8
    expect(order.slice(0, 3)).toEqual([0, 3, 6]);
    expect(order.length).toBe(9);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("reverses order on odd passes when reverse=true", () => {
    const even = orderSegmentsInterlaced(6, { stride: 2, reverse: true, stagger: false, pass: 0 });
    const odd = orderSegmentsInterlaced(6, { stride: 2, reverse: true, stagger: false, pass: 1 });
    expect(odd).toEqual([...even].reverse());
  });
  it("staggers the starting offset between passes when stagger=true", () => {
    const p0 = orderSegmentsInterlaced(6, { stride: 3, reverse: false, stagger: true, pass: 0 });
    const p1 = orderSegmentsInterlaced(6, { stride: 3, reverse: false, stagger: true, pass: 1 });
    expect(p0[0]).not.toBe(p1[0]); // different physical start
  });
  it("is a permutation regardless of options", () => {
    const order = orderSegmentsInterlaced(10, { stride: 4, reverse: true, stagger: true, pass: 3 });
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/schedule.test.ts`
Expected: FAIL ("orderSegmentsInterlaced is not a function").

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/forge/schedule.ts

export interface InterlaceOptions {
  /** Process every Nth segment first, then fill the gaps. */
  stride: number;
  /** Reverse the whole order on odd passes (counter-propagating). */
  reverse: boolean;
  /** Shift the starting segment by `pass` so successive passes don't share a start. */
  stagger: boolean;
  /** Zero-based pass index within the group. */
  pass: number;
}

/**
 * Produce a processing order over `count` segments that spreads heat around the
 * contour: take every `stride`-th segment starting at an offset, then advance
 * the offset to fill remaining segments. Optionally reverse on odd passes and
 * stagger the start point per pass so we never restart at the same physical
 * point. Always returns a permutation of [0..count-1].
 */
export function orderSegmentsInterlaced(count: number, opts: InterlaceOptions): number[] {
  if (count <= 0) return [];
  const stride = Math.max(1, Math.floor(opts.stride));
  const startShift = opts.stagger ? opts.pass % count : 0;

  const order: number[] = [];
  const seen = new Set<number>();
  for (let offset = 0; offset < stride && order.length < count; offset++) {
    for (let i = offset; i < count; i += stride) {
      const idx = (i + startShift) % count;
      if (!seen.has(idx)) {
        seen.add(idx);
        order.push(idx);
      }
    }
  }
  // safety: append any missed (possible when startShift collides)
  for (let i = 0; i < count; i++) {
    if (!seen.has(i)) order.push(i);
  }
  if (opts.reverse && opts.pass % 2 === 1) order.reverse();
  return order;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/schedule.ts web/src/lib/forge/schedule.test.ts
git commit -m "feat(forge): interlaced segment scheduling"
```

---

## Task 8: Defaults

**Files:**
- Create: `web/src/lib/forge/defaults.ts`

No standalone test (validated indirectly by the pipeline test in Task 13).

- [ ] **Step 1: Implement defaults**

```typescript
// web/src/lib/forge/defaults.ts
import type { ForgeConfig } from "./types";

/** Sensible default profile per the spec. Layer ranges span 0..256. */
export const DEFAULT_CONFIG: ForgeConfig = {
  beamWidthMm: 0.05,
  sideMode: "outside",
  mmPerUnitOverride: null,
  seed: {
    enabled: true,
    widthMultiplier: 2, // ~2x beam width conditioning track
    layerCount: 3, // <= 5 enforced in UI
    outsideOnly: true,
  },
  perforate: {
    enabled: true,
    spacingMm: 2,
    cornerBoost: true,
    cornerAngleThresholdDeg: 35,
    pocketSizeMm: 0.2,
    outsideBias: true,
  },
  deepen: {
    groups: [
      { name: "CUT_03_DEEPEN_A_0_50_1X", fromLayer: 0, toLayer: 50, widthMultiplier: 1, enabled: true },
      { name: "CUT_04_DEEPEN_B_50_100_2X", fromLayer: 50, toLayer: 100, widthMultiplier: 2, enabled: true },
      { name: "CUT_05_DEEPEN_C_100_200_4X", fromLayer: 100, toLayer: 200, widthMultiplier: 4, enabled: true },
      { name: "CUT_06_DEEPEN_D_200_256_8X", fromLayer: 200, toLayer: 256, widthMultiplier: 8, enabled: true },
    ],
    interlaceEnabled: true,
    segmentLengthMm: 8,
    interlaceStride: 3,
    reverseAlternatePasses: true,
    staggerStartPoint: true,
    avoidSameStartPoint: true,
    outsideOnly: true,
  },
  clean: {
    enabled: true,
    offsetSelection: "walls",
    passes: 1,
  },
};
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

```bash
git add web/src/lib/forge/defaults.ts
git commit -m "feat(forge): default strategy profile"
```

---

## Task 9: Stage generators

**Files:**
- Create: `web/src/lib/forge/stages.ts`
- Test: `web/src/lib/forge/stages.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/forge/stages.test.ts
import { describe, it, expect } from "vitest";
import {
  generateSeedPaths,
  generatePerforationPaths,
  generateDeepenPaths,
  generateCleanPaths,
} from "./stages";
import { DEFAULT_CONFIG } from "./defaults";
import { contourPerimeter } from "./contour";
import type { Contour } from "./types";

const square: Contour = {
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  closed: true,
};
const SRC = "src-id";

describe("generateSeedPaths", () => {
  it("emits paths tagged seed with CUT_01_SEED group and layerCount clamped to ≤5", () => {
    const cfg = { ...DEFAULT_CONFIG, seed: { ...DEFAULT_CONFIG.seed, layerCount: 9 } };
    const paths = generateSeedPaths(square, cfg, SRC);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.generatedClass === "seed")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_01_SEED")).toBe(true);
    // layer count clamped to 5
    expect(new Set(paths.map((p) => p.layerStart)).size).toBeLessThanOrEqual(5);
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, seed: { ...DEFAULT_CONFIG.seed, enabled: false } };
    expect(generateSeedPaths(square, cfg, SRC)).toEqual([]);
  });
});

describe("generatePerforationPaths", () => {
  it("emits perforate-class micro features at spacing, with extra at corners", () => {
    const paths = generatePerforationPaths(square, DEFAULT_CONFIG, SRC);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.generatedClass === "perforate")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_02_PERFORATE")).toBe(true);
    // each perforation is a tiny segment (pocketSize-scale), not the full contour
    for (const p of paths) {
      expect(contourPerimeter({ points: p.points, closed: false })).toBeLessThan(2);
    }
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, perforate: { ...DEFAULT_CONFIG.perforate, enabled: false } };
    expect(generatePerforationPaths(square, cfg, SRC)).toEqual([]);
  });
});

describe("generateDeepenPaths", () => {
  it("emits deepen paths grouped by pass-group in A→B→C→D order", () => {
    const paths = generateDeepenPaths(square, DEFAULT_CONFIG, SRC);
    expect(paths.every((p) => p.generatedClass === "deepen")).toBe(true);
    const names = paths.map((p) => p.groupName);
    expect(names.indexOf("CUT_03_DEEPEN_A_0_50_1X")).toBeLessThan(names.lastIndexOf("CUT_06_DEEPEN_D_200_256_8X"));
  });
  it("group A (1x) has a single offset ring per segment; D (8x) has more", () => {
    const paths = generateDeepenPaths(square, DEFAULT_CONFIG, SRC);
    const a = paths.filter((p) => p.groupName.includes("DEEPEN_A"));
    const d = paths.filter((p) => p.groupName.includes("DEEPEN_D"));
    expect(d.length).toBeGreaterThan(a.length);
  });
  it("interlaced order means consecutive deepen paths in a group aren't adjacent segments", () => {
    const paths = generateDeepenPaths(square, DEFAULT_CONFIG, SRC).filter((p) =>
      p.groupName.includes("DEEPEN_A"),
    );
    // segmentIndex present and not strictly 0,1,2,...
    const segs = paths.map((p) => p.segmentIndex ?? -1).filter((s) => s >= 0);
    const isSequential = segs.every((s, i) => i === 0 || s === segs[i - 1] + 1);
    expect(isSequential).toBe(false);
  });
});

describe("generateCleanPaths", () => {
  it("emits clean-class paths following walls (inner+outer)", () => {
    const paths = generateCleanPaths(square, DEFAULT_CONFIG, SRC);
    expect(paths.every((p) => p.generatedClass === "clean")).toBe(true);
    expect(paths.every((p) => p.groupName === "CUT_07_CLEAN")).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(2); // walls = 2 sides
  });
  it("returns nothing when disabled", () => {
    const cfg = { ...DEFAULT_CONFIG, clean: { ...DEFAULT_CONFIG.clean, enabled: false } };
    expect(generateCleanPaths(square, cfg, SRC)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/stages.test.ts`
Expected: FAIL ("generateSeedPaths is not a function").

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/forge/stages.ts
//
// Stage generators. Each path class has a distinct PURPOSE:
//   seed      — improves initial coupling by roughening/darkening the future
//               kerf (surface conditioning only; NOT a deep cut).
//   perforate — creates distributed starter/ejection points so melt, vapour and
//               debris can escape; denser near corners/high curvature.
//   deepen    — builds depth via PROGRESSIVE WIDENING + thermal interlacing,
//               not by repeating one line; widening is scrap-side biased.
//   clean     — removes recast/oxide from the trench WALLS without trying to
//               force more depth (a separate path class, not another deepen).
//
import type { Contour, ForgeConfig, GeneratedPath, Pt, SideMode } from "./types";
import { generateOffsetStack, offsetContour } from "./offset";
import {
  contourPerimeter,
  detectCorners,
  inferWindingAndOutside,
  normaliseContour,
  resampleByArcLength,
  segmentContour,
} from "./contour";
import { orderSegmentsInterlaced } from "./schedule";

const SEED_MAX_LAYERS = 5;

function ring(
  contour: Contour,
  meta: Omit<GeneratedPath, "points" | "closed">,
): GeneratedPath {
  return { ...meta, points: contour.points, closed: contour.closed };
}

/** Stage 1 — seed. Shallow scrap-side conditioning track, ≤5 layers. */
export function generateSeedPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.seed.enabled) return [];
  const side: SideMode = cfg.seed.outsideOnly ? "outside" : cfg.sideMode;
  const stack = generateOffsetStack(contour, cfg.seed.widthMultiplier, cfg.beamWidthMm, side);
  const layers = Math.min(SEED_MAX_LAYERS, Math.max(1, cfg.seed.layerCount));
  const out: GeneratedPath[] = [];
  let order = 0;
  for (let layer = 0; layer < layers; layer++) {
    for (const r of stack) {
      out.push(
        ring(r, {
          sourceObjectId,
          generatedClass: "seed",
          groupName: "CUT_01_SEED",
          layerStart: layer,
          layerEnd: layer,
          widthMultiplier: cfg.seed.widthMultiplier,
          offsetMm: 0,
          sideMode: side,
          direction: "forward",
          operationOrder: order++,
          enabled: true,
        }),
      );
    }
  }
  return out;
}

/** Stage 2 — perforate. Tiny scrap-side pockets at intervals + extra at corners. */
export function generatePerforationPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.perforate.enabled) return [];
  const norm = normaliseContour(contour);
  const winding = inferWindingAndOutside(norm);
  const outSign: 1 | -1 = winding.outsideSign;

  // base perforation anchor points spaced along the contour
  const anchors: Pt[] = resampleByArcLength(norm, cfg.perforate.spacingMm);

  // extra anchors at sharp corners
  if (cfg.perforate.cornerBoost) {
    for (const idx of detectCorners(norm, cfg.perforate.cornerAngleThresholdDeg)) {
      anchors.push(norm.points[idx]);
    }
  }

  const half = cfg.perforate.pocketSizeMm / 2;
  const out: GeneratedPath[] = [];
  let order = 0;
  for (const a of anchors) {
    // micro-segment: a short stub crossing the kerf, biased to scrap side.
    // Bias direction approximated by nudging along the outward normal estimate.
    const biasMm = cfg.perforate.outsideBias ? half * outSign : 0;
    const seg: Contour = {
      points: [
        { x: a.x - half, y: a.y + biasMm },
        { x: a.x + half, y: a.y + biasMm },
      ],
      closed: false,
    };
    out.push(
      ring(seg, {
        sourceObjectId,
        generatedClass: "perforate",
        groupName: "CUT_02_PERFORATE",
        layerStart: 0,
        layerEnd: 0,
        widthMultiplier: 1,
        offsetMm: biasMm,
        sideMode: cfg.perforate.outsideBias ? "outside" : cfg.sideMode,
        direction: "forward",
        operationOrder: order++,
        enabled: true,
      }),
    );
  }
  return out;
}

/** Stage 3 — deepen. Progressive widening + interlaced segment ordering. */
export function generateDeepenPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  const out: GeneratedPath[] = [];
  let order = 0;
  const side: SideMode = cfg.deepen.outsideOnly ? "outside" : cfg.sideMode;

  cfg.deepen.groups.forEach((group, gi) => {
    if (!group.enabled) return;
    const stack = generateOffsetStack(contour, group.widthMultiplier, cfg.beamWidthMm, side);

    stack.forEach((ringContour, ri) => {
      if (!cfg.deepen.interlaceEnabled) {
        out.push(
          ring(ringContour, {
            sourceObjectId,
            generatedClass: "deepen",
            groupName: group.name,
            layerStart: group.fromLayer,
            layerEnd: group.toLayer,
            widthMultiplier: group.widthMultiplier,
            offsetMm: ri * cfg.beamWidthMm,
            sideMode: side,
            direction: "forward",
            operationOrder: order++,
            enabled: true,
          }),
        );
        return;
      }
      const segs = segmentContour(ringContour, cfg.deepen.segmentLengthMm);
      const ord = orderSegmentsInterlaced(segs.length, {
        stride: cfg.deepen.interlaceStride,
        reverse: cfg.deepen.reverseAlternatePasses,
        stagger: cfg.deepen.staggerStartPoint,
        pass: gi * stack.length + ri,
      });
      ord.forEach((segIdx) => {
        const seg = segs[segIdx];
        const reversed = cfg.deepen.reverseAlternatePasses && (gi + ri) % 2 === 1;
        const pts = reversed ? [...seg.points].reverse() : seg.points;
        out.push({
          sourceObjectId,
          generatedClass: "deepen",
          groupName: group.name,
          layerStart: group.fromLayer,
          layerEnd: group.toLayer,
          widthMultiplier: group.widthMultiplier,
          offsetMm: ri * cfg.beamWidthMm,
          sideMode: side,
          direction: reversed ? "reverse" : "forward",
          segmentIndex: segIdx,
          operationOrder: order++,
          enabled: true,
          points: pts,
          closed: false,
        });
      });
    });
  });
  return out;
}

/** Stage 4 — clean. Follow trench walls (inner + outer), low-energy placeholder. */
export function generateCleanPaths(
  contour: Contour,
  cfg: ForgeConfig,
  sourceObjectId: string,
): GeneratedPath[] {
  if (!cfg.clean.enabled) return [];
  const winding = inferWindingAndOutside(contour);
  const outSign: 1 | -1 = winding.outsideSign;
  const inSign: 1 | -1 = outSign === 1 ? -1 : 1;
  const wallOffset = cfg.beamWidthMm; // walls one beam-width either side of centreline

  const walls: Array<{ c: Contour; offsetMm: number; side: SideMode }> = [];
  if (cfg.clean.offsetSelection !== "inner") {
    walls.push({ c: offsetContour(contour, wallOffset, outSign)[0], offsetMm: wallOffset, side: "outside" });
  }
  if (cfg.clean.offsetSelection !== "outer") {
    walls.push({ c: offsetContour(contour, wallOffset, inSign)[0], offsetMm: wallOffset, side: "inside" });
  }

  const out: GeneratedPath[] = [];
  let order = 0;
  for (let pass = 0; pass < Math.max(1, cfg.clean.passes); pass++) {
    for (const w of walls) {
      out.push(
        ring(w.c, {
          sourceObjectId,
          generatedClass: "clean",
          groupName: "CUT_07_CLEAN",
          layerStart: 0,
          layerEnd: 0,
          widthMultiplier: 1,
          offsetMm: w.offsetMm,
          sideMode: w.side,
          direction: pass % 2 === 1 ? "reverse" : "forward",
          operationOrder: order++,
          enabled: true,
        }),
      );
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/stages.test.ts`
Expected: PASS. (If the deepen "interlaced not sequential" assertion is flaky for a 4-segment square, raise `segmentLengthMm` in the test contour to produce more segments — use a larger square, e.g. 40mm sides — rather than weakening the assertion.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/stages.ts web/src/lib/forge/stages.test.ts
git commit -m "feat(forge): seed/perforate/deepen/clean stage generators"
```

---

## Task 10: Pipeline orchestration

**Files:**
- Create: `web/src/lib/forge/pipeline.ts`
- Test: `web/src/lib/forge/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/forge/pipeline.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseXcsFile, findInciseObjects } from "./xcs";
import { runPipeline } from "./pipeline";
import { DEFAULT_CONFIG } from "./defaults";

const SAMPLE = resolve(__dirname, "../../../../samples/xcs/incise_emboss.xcs");
function loadSample(): ArrayBuffer {
  const b = readFileSync(SAMPLE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe("runPipeline", () => {
  it("returns paths in physical process order seed→perforate→deepen→clean", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { paths, stats } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    const classes = paths.map((p) => p.generatedClass);
    const firstDeepen = classes.indexOf("deepen");
    const firstClean = classes.indexOf("clean");
    expect(classes.indexOf("seed")).toBeLessThan(classes.indexOf("perforate"));
    expect(classes.indexOf("perforate")).toBeLessThan(firstDeepen);
    expect(firstDeepen).toBeLessThan(firstClean);
    expect(stats.totalPaths).toBe(paths.length);
    expect(stats.pathCounts.deepen).toBeGreaterThan(0);
  });

  it("operationOrder is strictly increasing across the whole result", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    const { paths } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i].operationOrder).toBeGreaterThan(paths[i - 1].operationOrder);
    }
  });

  it("warns (not throws) when winding can't be inferred confidently", () => {
    const parsed = parseXcsFile(loadSample());
    const inciseId = findInciseObjects(parsed)[0].id;
    // force an open contour by overriding the object's dPath via config? Instead
    // assert the confident-path produces no winding warning:
    const { stats } = runPipeline(parsed, inciseId, DEFAULT_CONFIG);
    expect(Array.isArray(stats.warnings)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/pipeline.test.ts`
Expected: FAIL ("runPipeline is not a function").

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/forge/pipeline.ts
import type {
  Contour,
  DebugStats,
  ForgeConfig,
  GeneratedClass,
  GeneratedPath,
  ParsedXcs,
  PipelineResult,
} from "./types";
import { extractContourGeometry, calibrateMmPerUnit } from "./xcs";
import { inferWindingAndOutside } from "./contour";
import {
  generateCleanPaths,
  generateDeepenPaths,
  generatePerforationPaths,
  generateSeedPaths,
} from "./stages";

/** Scale a contour's points from path units → mm. */
function toMm(c: Contour, mmPerUnit: number): Contour {
  return { points: c.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })), closed: c.closed };
}

/**
 * Run the full generation pipeline against the selected incise object. Returns
 * ordered GeneratedPath[] (seed → perforate → deepen A..D → clean) plus debug
 * stats + warnings. Pure: no I/O, no DOM. Throws only on unrecoverable input
 * (no such object / not a vector path) — soft issues become warnings.
 */
export function runPipeline(
  parsed: ParsedXcs,
  inciseId: string,
  cfg: ForgeConfig,
): PipelineResult {
  const obj = parsed.objects.find((o) => o.id === inciseId);
  if (!obj) throw new Error(`incise object ${inciseId} not found`);
  if (!obj.dPath) throw new Error(`incise object ${inciseId} is not a usable vector/path contour`);

  const warnings: string[] = [];

  const cal = calibrateMmPerUnit(parsed, obj);
  const mmPerUnit = cfg.mmPerUnitOverride ?? cal.mmPerUnit;
  if (!cal.confident && cfg.mmPerUnitOverride == null) {
    warnings.push("Could not calibrate path units → mm from the file; using 1.0. Set a manual mm/unit.");
  }

  const contour = toMm(extractContourGeometry(obj), mmPerUnit);

  const winding = inferWindingAndOutside(contour);
  if (!winding.confident) {
    warnings.push("Inside/outside could not be inferred with confidence — choose a side (flip) before export.");
  }

  // Physical process order. Each generator stamps its own operationOrder
  // locally; we re-stamp a global monotonic order here.
  const seed = generateSeedPaths(contour, cfg, inciseId);
  const perf = generatePerforationPaths(contour, cfg, inciseId);
  const deepen = generateDeepenPaths(contour, cfg, inciseId);
  const clean = generateCleanPaths(contour, cfg, inciseId);

  const ordered: GeneratedPath[] = [...seed, ...perf, ...deepen, ...clean];
  ordered.forEach((p, i) => (p.operationOrder = i));

  const pathCounts: Record<GeneratedClass, number> = {
    seed: seed.length,
    perforate: perf.length,
    deepen: deepen.length,
    clean: clean.length,
  };
  const segmentCount = deepen.filter((p) => p.segmentIndex !== undefined).length;

  const stats: DebugStats = {
    mmPerUnit,
    mmPerUnitConfident: cal.confident || cfg.mmPerUnitOverride != null,
    pathCounts,
    segmentCount,
    totalPaths: ordered.length,
    warnings,
  };
  return { paths: ordered, stats };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/forge/pipeline.ts web/src/lib/forge/pipeline.test.ts
git commit -m "feat(forge): pipeline orchestration with process ordering + stats"
```

---

## Task 11: Build + export modified XCS (round-trip)

**Files:**
- Modify: `web/src/lib/forge/xcs.ts` (add `buildGeneratedXcs`, `exportXcs`, `contourToDPath`)
- Modify: `web/src/lib/forge/xcs.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// append to web/src/lib/forge/xcs.test.ts
import { buildGeneratedXcs, exportXcs } from "./xcs";
import { runPipeline } from "./pipeline";
import { DEFAULT_CONFIG } from "./defaults";

describe("buildGeneratedXcs round-trip", () => {
  it("removes the source incise object and adds generated INTAGLIO entries", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const embossId = findEmbossObjects(parsed)[0].id;
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);

    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit);
    const reparsed = parseXcsFile(exportXcs(out));

    // source incise gone
    expect(reparsed.objects.find((o) => o.id === incise.id)).toBeUndefined();
    // emboss preserved
    expect(reparsed.objects.find((o) => o.id === embossId)).toBeDefined();
    // generated cut entries present and all INTAGLIO
    const generated = reparsed.objects.filter((o) => o.id.startsWith("forge-"));
    expect(generated.length).toBe(paths.length);
    expect(generated.every((o) => o.processingType === "INTAGLIO")).toBe(true);
  });

  it("produces JSON that re-parses (valid document)", () => {
    const parsed = parseXcsFile(loadSample());
    const incise = findInciseObjects(parsed)[0];
    const { paths, stats } = runPipeline(parsed, incise.id, DEFAULT_CONFIG);
    const out = buildGeneratedXcs(parsed, incise.id, paths, stats.mmPerUnit);
    expect(() => JSON.parse(new TextDecoder().decode(exportXcs(out)))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts`
Expected: FAIL ("buildGeneratedXcs is not a function").

- [ ] **Step 3: Implement (append to xcs.ts)**

```typescript
// append to web/src/lib/forge/xcs.ts
import type { GeneratedPath } from "./types";

/** Serialise a mm-space contour back to a dPath string in path units. */
export function contourToDPath(points: { x: number; y: number }[], closed: boolean, mmPerUnit: number): string {
  if (points.length === 0) return "";
  const u = (v: number) => +(v / mmPerUnit).toFixed(4);
  const cmds = points.map((p, i) => `${i === 0 ? "M" : "L"}${u(p.x)},${u(p.y)}`);
  if (closed) cmds.push("Z");
  return cmds.join(" ");
}

interface MutableMap<V> {
  dataType: "Map";
  value: Array<[string, V]>;
}

/**
 * Build a new XCS document: deep-clone the original, REMOVE the source incise
 * display + its device.data entry, and APPEND one new PATH display + INTAGLIO
 * processing entry per generated path (params copied from the source incise
 * object). Emboss + model objects are left untouched. Generated ids are
 * `forge-<operationOrder>` so tests/preview can find them. Returns the new
 * raw JSON object (not yet serialised).
 */
export function buildGeneratedXcs(
  parsed: ParsedXcs,
  inciseId: string,
  paths: GeneratedPath[],
  mmPerUnit: number,
): unknown {
  const raw = JSON.parse(JSON.stringify(parsed.raw)) as {
    canvas: Array<{ displays: RawDisplay[] }>;
    device: { data: MutableMap<RawGroup & { displays: MutableMap<RawEntry & Record<string, unknown>> }> };
  };

  const incise = parsed.objects.find((o) => o.id === inciseId)!;
  const groupKey = incise.groupKey;

  // locate the process group + the source display template
  const groupPair = raw.device.data.value.find(([k]) => k === groupKey);
  const sourceTemplateDisplay = raw.canvas[0].displays.find((d) => d.id === inciseId);
  const sourceEntryPair = groupPair?.[1].displays.value.find(([id]) => id === inciseId);

  // remove source incise from canvas + device.data
  raw.canvas[0].displays = raw.canvas[0].displays.filter((d) => d.id !== inciseId);
  if (groupPair) {
    groupPair[1].displays.value = groupPair[1].displays.value.filter(([id]) => id !== inciseId);
  }

  // append generated displays + processing entries
  for (const path of paths) {
    const id = `forge-${path.operationOrder}`;
    const dPath = contourToDPath(path.points, path.closed, mmPerUnit);

    const display: RawDisplay = {
      ...(sourceTemplateDisplay ?? ({} as RawDisplay)),
      id,
      type: "PATH",
      name: path.groupName,
      dPath,
      isClosePath: path.closed,
    };
    raw.canvas[0].displays.push(display);

    if (groupPair) {
      // clone the source INTAGLIO entry so params/processingType carry over
      const baseEntry = sourceEntryPair
        ? JSON.parse(JSON.stringify(sourceEntryPair[1]))
        : { isFill: true, type: "PATH", processingType: "INTAGLIO" };
      baseEntry.processingType = "INTAGLIO";
      baseEntry.type = "PATH";
      groupPair[1].displays.value.push([id, baseEntry]);
    }
  }

  return raw;
}

/** Serialise a built XCS document to UTF-8 bytes (compact JSON, like write_xcs). */
export function exportXcs(xcs: unknown): ArrayBuffer {
  const text = JSON.stringify(xcs);
  return new TextEncoder().encode(text).buffer;
}
```

Note: add `GeneratedPath` to the existing type import at the top of `xcs.ts` rather than a second import statement.

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && npx vitest run src/lib/forge/xcs.test.ts`
Expected: PASS.

- [ ] **Step 5: Full library test run + commit**

Run: `cd web && npx vitest run src/lib/forge`
Expected: PASS (all forge lib tests green).

```bash
git add web/src/lib/forge/xcs.ts web/src/lib/forge/xcs.test.ts
git commit -m "feat(forge): build + export modified XCS (source incise replaced)"
```

---

## Task 12: Worker

**Files:**
- Create: `web/src/lib/forge/forge.worker.ts`

No unit test (thin message wrapper around tested pure functions; exercised via the page in Task 16).

- [ ] **Step 1: Implement worker**

```typescript
// web/src/lib/forge/forge.worker.ts
import type { ForgeConfig, ParsedXcs, PipelineResult, XcsObject } from "./types";
import { parseXcsFile } from "./xcs";
import { runPipeline } from "./pipeline";
import { buildGeneratedXcs, exportXcs } from "./xcs";

export type ForgeRequest =
  | { type: "parse"; buf: ArrayBuffer }
  | { type: "generate"; inciseId: string; config: ForgeConfig }
  | { type: "export"; inciseId: string; config: ForgeConfig };

export type ForgeResponse =
  | { type: "parsed"; objects: XcsObject[]; embossIds: string[]; inciseIds: string[] }
  | { type: "generated"; result: PipelineResult }
  | { type: "exported"; buf: ArrayBuffer }
  | { type: "error"; message: string };

let parsed: ParsedXcs | null = null;

self.onmessage = (e: MessageEvent<ForgeRequest>) => {
  const post = (r: ForgeResponse, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(r, transfer ?? []);
  try {
    const msg = e.data;
    if (msg.type === "parse") {
      parsed = parseXcsFile(msg.buf);
      post({
        type: "parsed",
        objects: parsed.objects,
        embossIds: parsed.emboss.map((o) => o.id),
        inciseIds: parsed.incise.map((o) => o.id),
      });
      return;
    }
    if (!parsed) throw new Error("no file parsed yet");
    if (msg.type === "generate") {
      post({ type: "generated", result: runPipeline(parsed, msg.inciseId, msg.config) });
      return;
    }
    if (msg.type === "export") {
      const { paths, stats } = runPipeline(parsed, msg.inciseId, msg.config);
      const doc = buildGeneratedXcs(parsed, msg.inciseId, paths, stats.mmPerUnit);
      const buf = exportXcs(doc);
      post({ type: "exported", buf }, [buf]);
      return;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

```bash
git add web/src/lib/forge/forge.worker.ts
git commit -m "feat(forge): worker (parse/generate/export off main thread)"
```

---

## Task 13: Routing + nav registration

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`

- [ ] **Step 1: Add the route to `router.ts`**

In the `Route` union (after `| { name: "guide" }`), add:
```typescript
  | { name: "forge" }
```
In `parseRoute`, before the final `return { name: "tests" };`, add:
```typescript
  if (h === "forge") return { name: "forge" };
```
In `formatRoute`'s switch, add:
```typescript
    case "forge":       return "#/forge";
```

- [ ] **Step 2: Wire the lazy page in `App.tsx`**

After the `GuidePage` lazy definition (around line 53), add:
```typescript
const ForgePage = lazy(() =>
  import("./pages/ForgePage").then((m) => ({ default: m.ForgePage })),
);
```
In the title ternary (around line 166), add before the `:` chain end:
```typescript
    : route.name === "forge"      ? "Contour Forge"
```
In the render gate block (near the other `gate === "ready" && route.name === …` lines), add:
```tsx
          {gate === "ready" && route.name === "forge" && <ForgePage />}
```

- [ ] **Step 3: Add a TopBar nav button**

In `web/src/components/TopBar.tsx`, mirror the existing standalone "Guide" button (the block around lines 198–215 that renders `onClick={() => onNavigate({ name: "guide" })}`). Add an adjacent button:
```tsx
            <button
              onClick={() => onNavigate({ name: "forge" })}
              title="Open Contour Forge"
              aria-label="Open Contour Forge"
              className={cn(
                "px-3 py-1.5 text-xs font-mono uppercase tracking-wide rounded transition-colors",
                route.name === "forge"
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              Forge
            </button>
```
Match the exact className tokens used by the neighbouring Guide button in this file (copy them verbatim if they differ from the above).

- [ ] **Step 4: Add a stub page so the route compiles**

Create `web/src/pages/ForgePage.tsx`:
```tsx
export function ForgePage() {
  return <div className="p-8 font-mono text-sm">Contour Forge — coming up.</div>;
}
```

- [ ] **Step 5: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/router.ts web/src/App.tsx web/src/components/TopBar.tsx web/src/pages/ForgePage.tsx
git commit -m "feat(forge): #/forge route + nav entry + page stub"
```

---

## Task 14: Preview canvas

**Files:**
- Create: `web/src/components/forge/ForgeCanvas.tsx`

No unit test (canvas; verified in browser in Task 16). Auto-fit transform mirrors the standard pattern (fit bbox with padding, center, devicePixelRatio scaling).

- [ ] **Step 1: Implement the canvas**

```tsx
// web/src/components/forge/ForgeCanvas.tsx
import { useEffect, useRef } from "react";
import type { Contour, GeneratedClass, GeneratedPath } from "../../lib/forge/types";

/** Colour per path class — distinct, readable on the dark workbench. */
const CLASS_COLOR: Record<GeneratedClass, string> = {
  seed: "#7dd3fc", // sky
  perforate: "#facc15", // amber
  deepen: "#f97316", // orange (depth)
  clean: "#a3e635", // lime
};
const SOURCE_COLOR = "#64748b"; // slate — the original contour

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxOf(paths: GeneratedPath[], source: Contour | null): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  source?.points.forEach((p) => eat(p.x, p.y));
  paths.forEach((pa) => pa.points.forEach((p) => eat(p.x, p.y)));
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export interface ForgeCanvasProps {
  source: Contour | null;
  paths: GeneratedPath[];
  /** which classes to draw */
  visible: Record<GeneratedClass, boolean>;
  width: number;
  height: number;
}

export function ForgeCanvas({ source, paths, visible, width, height }: ForgeCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bb = bboxOf(paths, source);
    const pad = 16;
    const w = bb.maxX - bb.minX || 1;
    const h = bb.maxY - bb.minY || 1;
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = pad + (width - 2 * pad - w * scale) / 2 - bb.minX * scale;
    const oy = pad + (height - 2 * pad - h * scale) / 2 - bb.minY * scale;
    const X = (x: number) => x * scale + ox;
    const Y = (y: number) => y * scale + oy;

    const stroke = (pts: { x: number; y: number }[], closed: boolean, color: string, wpx: number) => {
      if (pts.length < 1) return;
      ctx.beginPath();
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      if (closed) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = wpx;
      ctx.stroke();
    };

    // source contour first (faint dashed)
    if (source) {
      ctx.setLineDash([4, 3]);
      stroke(source.points, source.closed, SOURCE_COLOR, 1);
      ctx.setLineDash([]);
    }
    // generated paths, class-coloured
    for (const p of paths) {
      if (!visible[p.generatedClass]) continue;
      stroke(p.points, p.closed, CLASS_COLOR[p.generatedClass], p.generatedClass === "deepen" ? 1.5 : 1);
    }
  }, [source, paths, visible, width, height]);

  return <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />;
}

export { CLASS_COLOR };
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

```bash
git add web/src/components/forge/ForgeCanvas.tsx
git commit -m "feat(forge): colour-coded auto-fit preview canvas"
```

---

## Task 15: Controls + debug panel

**Files:**
- Create: `web/src/components/forge/ForgeControls.tsx`
- Create: `web/src/components/forge/ForgeDebugPanel.tsx`

No unit test (UI; verified in browser). Uses real `web/src/ui` primitives: `Field`, `NumberField`, `Select`, `Button`, `Badge`, `Card`, `CardHeader`, `CardTitle`, `cn`.

- [ ] **Step 1: Implement `ForgeControls.tsx`**

```tsx
// web/src/components/forge/ForgeControls.tsx
import { Card, CardHeader, CardTitle, Field, NumberField, Select, Button } from "../../ui";
import type { DeepenGroup, ForgeConfig, GeneratedClass, SideMode } from "../../lib/forge/types";

const CLASSES: GeneratedClass[] = ["seed", "perforate", "deepen", "clean"];

export interface ForgeControlsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
  visible: Record<GeneratedClass, boolean>;
  onToggleVisible: (c: GeneratedClass) => void;
}

export function ForgeControls({ config, onChange, visible, onToggleVisible }: ForgeControlsProps) {
  // helper to patch nested config immutably
  const patch = (p: Partial<ForgeConfig>) => onChange({ ...config, ...p });

  const setGroup = (i: number, g: Partial<DeepenGroup>) => {
    const groups = config.deepen.groups.map((row, idx) => (idx === i ? { ...row, ...g } : row));
    patch({ deepen: { ...config.deepen, groups } });
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <Card>
        <CardHeader><CardTitle>Global</CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
          <Field label="Beam width (mm)">
            <NumberField value={config.beamWidthMm} step={0.01} min={0.005}
              onChange={(v) => patch({ beamWidthMm: v })} />
          </Field>
          <Field label="Offset side">
            <Select value={config.sideMode}
              onChange={(e) => patch({ sideMode: e.target.value as SideMode })}>
              <option value="outside">outside</option>
              <option value="inside">inside</option>
              <option value="symmetric">symmetric</option>
              <option value="flip">flip</option>
            </Select>
          </Field>
          <Field label="mm / unit override (blank = auto)">
            <NumberField value={config.mmPerUnitOverride ?? 0} step={0.0001} min={0}
              onChange={(v) => patch({ mmPerUnitOverride: v > 0 ? v : null })} />
          </Field>
        </div>
      </Card>

      {/* Stage visibility toggles */}
      <Card>
        <CardHeader><CardTitle>Preview layers</CardTitle></CardHeader>
        <div className="flex flex-wrap gap-2 p-2">
          {CLASSES.map((c) => (
            <label key={c} className="flex items-center gap-1 font-mono uppercase">
              <input type="checkbox" checked={visible[c]} onChange={() => onToggleVisible(c)} />
              {c}
            </label>
          ))}
        </div>
      </Card>

      {/* Seed */}
      <Card>
        <CardHeader><CardTitle>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.seed.enabled}
              onChange={(e) => patch({ seed: { ...config.seed, enabled: e.target.checked } })} />
            Seed (CUT_01)
          </label>
        </CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
          <Field label="Width × beam">
            <NumberField value={config.seed.widthMultiplier} step={1} min={1}
              onChange={(v) => patch({ seed: { ...config.seed, widthMultiplier: v } })} />
          </Field>
          <Field label="Layers (≤5)">
            <NumberField value={config.seed.layerCount} step={1} min={1} max={5}
              onChange={(v) => patch({ seed: { ...config.seed, layerCount: Math.min(5, v) } })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={config.seed.outsideOnly}
              onChange={(e) => patch({ seed: { ...config.seed, outsideOnly: e.target.checked } })} />
            Outside-only
          </label>
        </div>
      </Card>

      {/* Perforate */}
      <Card>
        <CardHeader><CardTitle>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.enabled}
              onChange={(e) => patch({ perforate: { ...config.perforate, enabled: e.target.checked } })} />
            Perforate (CUT_02)
          </label>
        </CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
          <Field label="Spacing (mm)">
            <NumberField value={config.perforate.spacingMm} step={0.5} min={0.25}
              onChange={(v) => patch({ perforate: { ...config.perforate, spacingMm: v } })} />
          </Field>
          <Field label="Pocket size (mm)">
            <NumberField value={config.perforate.pocketSizeMm} step={0.05} min={0.05}
              onChange={(v) => patch({ perforate: { ...config.perforate, pocketSizeMm: v } })} />
          </Field>
          <Field label="Corner angle (°)">
            <NumberField value={config.perforate.cornerAngleThresholdDeg} step={5} min={5} max={170}
              onChange={(v) => patch({ perforate: { ...config.perforate, cornerAngleThresholdDeg: v } })} />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.cornerBoost}
              onChange={(e) => patch({ perforate: { ...config.perforate, cornerBoost: e.target.checked } })} />
            Corner boost
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.outsideBias}
              onChange={(e) => patch({ perforate: { ...config.perforate, outsideBias: e.target.checked } })} />
            Outside bias
          </label>
        </div>
      </Card>

      {/* Deepen pass-group table */}
      <Card>
        <CardHeader><CardTitle>Deepen pass groups (CUT_03–06)</CardTitle></CardHeader>
        <div className="p-2 overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-left text-[var(--color-muted)]">
                <th>on</th><th>name</th><th>from</th><th>to</th><th>×beam</th>
              </tr>
            </thead>
            <tbody>
              {config.deepen.groups.map((g, i) => (
                <tr key={g.name}>
                  <td><input type="checkbox" checked={g.enabled} onChange={(e) => setGroup(i, { enabled: e.target.checked })} /></td>
                  <td><input className="w-40 bg-transparent border-b" value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} /></td>
                  <td><input className="w-12 bg-transparent border-b" type="number" value={g.fromLayer} onChange={(e) => setGroup(i, { fromLayer: Number(e.target.value) })} /></td>
                  <td><input className="w-12 bg-transparent border-b" type="number" value={g.toLayer} onChange={(e) => setGroup(i, { toLayer: Number(e.target.value) })} /></td>
                  <td><input className="w-12 bg-transparent border-b" type="number" value={g.widthMultiplier} onChange={(e) => setGroup(i, { widthMultiplier: Number(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Field label="Segment length (mm)">
              <NumberField value={config.deepen.segmentLengthMm} step={1} min={1}
                onChange={(v) => patch({ deepen: { ...config.deepen, segmentLengthMm: v } })} />
            </Field>
            <Field label="Interlace stride">
              <NumberField value={config.deepen.interlaceStride} step={1} min={1}
                onChange={(v) => patch({ deepen: { ...config.deepen, interlaceStride: v } })} />
            </Field>
            <label className="flex items-center gap-2"><input type="checkbox" checked={config.deepen.interlaceEnabled} onChange={(e) => patch({ deepen: { ...config.deepen, interlaceEnabled: e.target.checked } })} /> Interlace</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={config.deepen.reverseAlternatePasses} onChange={(e) => patch({ deepen: { ...config.deepen, reverseAlternatePasses: e.target.checked } })} /> Reverse alt</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={config.deepen.staggerStartPoint} onChange={(e) => patch({ deepen: { ...config.deepen, staggerStartPoint: e.target.checked } })} /> Stagger start</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={config.deepen.outsideOnly} onChange={(e) => patch({ deepen: { ...config.deepen, outsideOnly: e.target.checked } })} /> Outside-only</label>
          </div>
        </div>
      </Card>

      {/* Clean */}
      <Card>
        <CardHeader><CardTitle>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.clean.enabled}
              onChange={(e) => patch({ clean: { ...config.clean, enabled: e.target.checked } })} />
            Clean (CUT_07)
          </label>
        </CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
          <Field label="Walls">
            <Select value={config.clean.offsetSelection}
              onChange={(e) => patch({ clean: { ...config.clean, offsetSelection: e.target.value as "walls" | "outer" | "inner" } })}>
              <option value="walls">both walls</option>
              <option value="outer">outer only</option>
              <option value="inner">inner only</option>
            </Select>
          </Field>
          <Field label="Passes">
            <NumberField value={config.clean.passes} step={1} min={1}
              onChange={(v) => patch({ clean: { ...config.clean, passes: v } })} />
          </Field>
        </div>
      </Card>
    </div>
  );
}
```

If `NumberField`'s `onChange` signature differs from `(value:number)=>void` (check `web/src/ui/NumberField.tsx`), adapt the call sites to match its actual prop contract — do not change the primitive.

- [ ] **Step 2: Implement `ForgeDebugPanel.tsx`**

```tsx
// web/src/components/forge/ForgeDebugPanel.tsx
import { Badge, Card, CardHeader, CardTitle } from "../../ui";
import type { DebugStats } from "../../lib/forge/types";

export function ForgeDebugPanel({ stats }: { stats: DebugStats | null }) {
  if (!stats) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Debug</CardTitle></CardHeader>
      <div className="p-2 font-mono text-[11px] flex flex-col gap-1">
        <div>mm/unit: {stats.mmPerUnit.toFixed(4)} {stats.mmPerUnitConfident ? "✓" : "⚠ unconfident"}</div>
        <div>paths: total {stats.totalPaths} — seed {stats.pathCounts.seed}, perforate {stats.pathCounts.perforate}, deepen {stats.pathCounts.deepen}, clean {stats.pathCounts.clean}</div>
        <div>deepen segments: {stats.segmentCount}</div>
        {stats.warnings.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {stats.warnings.map((w, i) => (
              <Badge key={i} variant="info">{w}</Badge>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
```

If `Badge` has no `variant="info"`, use whatever variants `web/src/ui/Badge.tsx` actually exports (e.g. `accent`).

- [ ] **Step 3: Typecheck + commit**

Run: `cd web && npx tsc --noEmit`
Expected: PASS.

```bash
git add web/src/components/forge/ForgeControls.tsx web/src/components/forge/ForgeDebugPanel.tsx
git commit -m "feat(forge): control panels + debug panel"
```

---

## Task 16: Page assembly (upload, validation, worker wiring, export)

**Files:**
- Modify: `web/src/pages/ForgePage.tsx` (replace the stub)

No unit test (page; verified in browser in Task 17).

- [ ] **Step 1: Implement the page**

```tsx
// web/src/pages/ForgePage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { PageContainer, Section, Toolbar, MetalBar, Button, EmptyState, Card, CardHeader, CardTitle, Badge, notify } from "../ui";
import ForgeWorker from "../lib/forge/forge.worker?worker";
import type { ForgeRequest, ForgeResponse } from "../lib/forge/forge.worker";
import type { Contour, ForgeConfig, GeneratedClass, PipelineResult, XcsObject } from "../lib/forge/types";
import { DEFAULT_CONFIG } from "../lib/forge/defaults";
import { flattenDPath, normaliseContour } from "../lib/forge/contour";
import { ForgeCanvas } from "../components/forge/ForgeCanvas";
import { ForgeControls } from "../components/forge/ForgeControls";
import { ForgeDebugPanel } from "../components/forge/ForgeDebugPanel";

type State =
  | { kind: "idle" }
  | { kind: "loading"; fileName: string }
  | { kind: "ready"; fileName: string; objects: XcsObject[]; embossIds: string[]; inciseIds: string[] }
  | { kind: "error"; message: string };

const ALL_VISIBLE: Record<GeneratedClass, boolean> = { seed: true, perforate: true, deepen: true, clean: true };

export function ForgePage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
  const [selectedIncise, setSelectedIncise] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [visible, setVisible] = useState(ALL_VISIBLE);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 480 });

  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // one persistent worker for the page lifetime
  useEffect(() => {
    const w = new ForgeWorker();
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<ForgeResponse>) => {
      const msg = ev.data;
      if (msg.type === "parsed") {
        setState({ kind: "ready", fileName: state.kind === "loading" ? state.fileName : "file.xcs", objects: msg.objects, embossIds: msg.embossIds, inciseIds: msg.inciseIds });
        setSelectedIncise(msg.inciseIds.length === 1 ? msg.inciseIds[0] : null);
      } else if (msg.type === "generated") {
        setResult(msg.result);
      } else if (msg.type === "exported") {
        downloadBuf(msg.buf);
      } else if (msg.type === "error") {
        notify({ level: "error", message: msg.message });
        setState({ kind: "error", message: msg.message });
      }
    };
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // responsive canvas
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({ w: Math.max(320, el.clientWidth), h: Math.max(320, Math.round(el.clientWidth * 0.8)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.kind]);

  // source contour (mm-agnostic preview; pipeline output is already mm) — draw raw units
  const sourceContour: Contour | null = useMemo(() => {
    if (state.kind !== "ready" || !selectedIncise) return null;
    const obj = state.objects.find((o) => o.id === selectedIncise);
    if (!obj?.dPath) return null;
    return normaliseContour(flattenDPath(obj.dPath));
  }, [state, selectedIncise]);

  // debounced regenerate on config / selection change
  useEffect(() => {
    if (state.kind !== "ready" || !selectedIncise) return;
    const t = setTimeout(() => {
      const req: ForgeRequest = { type: "generate", inciseId: selectedIncise, config };
      workerRef.current?.postMessage(req);
    }, 150);
    return () => clearTimeout(t);
  }, [state, selectedIncise, config]);

  function handleFile(f: File) {
    setState({ kind: "loading", fileName: f.name });
    setResult(null);
    f.arrayBuffer().then((buf) => {
      const req: ForgeRequest = { type: "parse", buf };
      workerRef.current?.postMessage(req, [buf]);
    });
  }

  function downloadBuf(buf: ArrayBuffer) {
    const blob = new Blob([buf], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contour-forge.xcs";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- validation ----
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (state.kind === "ready") {
      if (state.embossIds.length === 0) errors.push("No emboss-mode (RELIEF) object found.");
      if (state.inciseIds.length === 0) errors.push("No incise-mode (INTAGLIO) object found.");
      if (state.inciseIds.length > 1 && !selectedIncise) errors.push("Multiple incise objects — select a target contour.");
      const obj = selectedIncise ? state.objects.find((o) => o.id === selectedIncise) : null;
      if (selectedIncise && !obj?.dPath) errors.push("Selected incise object is not a usable vector/path contour.");
    }
    // soft warnings from the pipeline (winding/units)
    const warnings = result?.stats.warnings ?? [];
    return { errors, warnings };
  }, [state, selectedIncise, result]);

  const canExport = state.kind === "ready" && !!selectedIncise && validation.errors.length === 0 && !!result;

  function onExport() {
    if (!selectedIncise) return;
    const req: ForgeRequest = { type: "export", inciseId: selectedIncise, config };
    workerRef.current?.postMessage(req);
  }

  return (
    <PageContainer>
      <Section title="Contour Forge" dense>
        <Toolbar
          trailing={
            <>
              <label className="px-3 py-1.5 text-xs font-mono uppercase rounded bg-[var(--color-accent)] text-[var(--color-on-accent)] cursor-pointer">
                Upload .xcs
                <input ref={fileInputRef} type="file" accept=".xcs,application/json" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              </label>
              <Button disabled={!canExport} onClick={onExport}>Export modified .xcs</Button>
            </>
          }
        />
        <MetalBar variant="soft" />

        {state.kind === "idle" && (
          <EmptyState title="Upload an xTool .xcs" description="The file must contain one emboss (RELIEF) object and one incise (INTAGLIO) contour. The incise contour is used as source geometry to generate staged seed/perforate/deepen/clean cut paths." />
        )}
        {state.kind === "loading" && <div className="p-6 font-mono text-sm">Parsing {state.fileName}…</div>}
        {state.kind === "error" && <div className="p-6 font-mono text-sm text-red-400">Error: {state.message}</div>}

        {state.kind === "ready" && (
          <div className="grid grid-cols-[260px_1fr_320px] gap-3">
            {/* LEFT: validation + object lists */}
            <div className="flex flex-col gap-3 text-xs">
              <Card>
                <CardHeader><CardTitle>Validation</CardTitle></CardHeader>
                <div className="p-2 flex flex-col gap-1">
                  {validation.errors.length === 0
                    ? <Badge variant="accent">ready</Badge>
                    : validation.errors.map((e, i) => <Badge key={i} variant="info">{e}</Badge>)}
                  {validation.warnings.map((w, i) => <Badge key={`w${i}`} variant="info">{w}</Badge>)}
                </div>
              </Card>
              <Card>
                <CardHeader><CardTitle>Emboss objects</CardTitle></CardHeader>
                <div className="p-2 font-mono">{state.embossIds.map((id) => <div key={id}>{id.slice(0, 8)} · RELIEF</div>)}</div>
              </Card>
              <Card>
                <CardHeader><CardTitle>Incise objects</CardTitle></CardHeader>
                <div className="p-2 font-mono flex flex-col gap-1">
                  {state.inciseIds.map((id) => (
                    <label key={id} className="flex items-center gap-2">
                      <input type="radio" name="incise" checked={selectedIncise === id} onChange={() => setSelectedIncise(id)} />
                      {id.slice(0, 8)} · INTAGLIO
                    </label>
                  ))}
                </div>
              </Card>
            </div>

            {/* CENTER: preview */}
            <div ref={canvasWrapRef} className="min-w-0">
              <ForgeCanvas source={sourceContour} paths={result?.paths ?? []} visible={visible} width={canvasSize.w} height={canvasSize.h} />
            </div>

            {/* RIGHT: controls + debug */}
            <div className="flex flex-col gap-3">
              <ForgeControls
                config={config}
                onChange={setConfig}
                visible={visible}
                onToggleVisible={(c) => setVisible((v) => ({ ...v, [c]: !v[c] }))}
              />
              <ForgeDebugPanel stats={result?.stats ?? null} />
            </div>
          </div>
        )}
      </Section>
    </PageContainer>
  );
}
```

If `Toolbar`/`Section`/`notify` prop contracts differ from the above (check `web/src/ui/Toolbar.tsx`, `Section.tsx`, `Toast.ts`), adapt the call sites to the real signatures. The preview draws the source contour in raw path units and generated paths in mm; since the page only needs relative shape inspection, the canvas auto-fit normalises both — acceptable for v1. (If the mm-vs-units scale mismatch makes the source contour and generated paths render at wildly different sizes, multiply the source contour points by `result.stats.mmPerUnit` before passing to `ForgeCanvas` so both share mm space.)

- [ ] **Step 2: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ForgePage.tsx
git commit -m "feat(forge): page — upload, validation, worker wiring, preview, export"
```

---

## Task 17: Changelog + full verification

**Files:**
- Create: `changelog/2026-05-25-contour-forge.md`

- [ ] **Step 1: Write the changelog entry (major)**

```markdown
---
id: 2026-05-25-contour-forge
date: 2026-05-25
level: major
title: Contour Forge — staged cut strategies for fibre brass
summary: Upload an .xcs, turn its incise contour into seed / perforate / deepen / clean machining passes, and preview before export.
---

Brass on a MOPA fibre laser doesn't cut like sheet metal — a narrow kerf
self-limits as recast and ejecta seal the trench. **Contour Forge** (an
experimental page at `#/forge`) treats the cut contour as a staged process
instead of one repeated line.

Upload a project containing an emboss (RELIEF) object and an incise (INTAGLIO)
contour. The incise contour becomes source geometry for four path classes:

- **seed** — a shallow scrap-side track that conditions the surface and improves
  initial coupling;
- **perforate** — distributed starter/ejection pockets, denser at corners, so
  melt and vapour can escape;
- **deepen** — progressive scrap-side widening (1× → 8× beam width) with
  interlaced, direction-reversing segments to spread heat;
- **clean** — low-energy wall passes that lift recast/oxide without forcing more
  depth.

Everything is configurable and colour-coded in a live preview so you can check
which side the widening lands on before exporting a new `.xcs`. The original
incise contour is replaced by the generated stages; emboss and model objects are
left untouched.
```

- [ ] **Step 2: Full automated gate**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: typecheck clean, all vitest suites (incl. all `src/lib/forge/*.test.ts`) PASS, build succeeds.

- [ ] **Step 3: Manual browser verification (required by CLAUDE.md)**

Run the dev server build is already in `web/dist/`. Start the backend:
`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`
Then drive Chrome via the Chrome DevTools / Playwright MCP:
- Navigate to `http://127.0.0.1:8017/#/forge`.
- Confirm the empty state renders and the TopBar "Forge" entry is present + highlights.
- Upload `samples/xcs/incise_emboss.xcs` (use the MCP `upload_file`/`browser_file_upload` against the hidden input).
- Verify: validation shows "ready"; the incise object auto-selects; the preview shows the source contour (dashed) plus colour-coded seed/perforate/deepen/clean paths.
- Toggle each preview layer and confirm classes show/hide. Switch "Offset side" outside↔flip and **read a screenshot** to confirm the widening visibly moves to the opposite side of the contour.
- Click "Export modified .xcs"; confirm a file downloads and re-uploading it shows the source incise gone and the generated `forge-*` paths present.

Read each screenshot critically (per the project's UI-review rule). Fix any layout/scale issues found, rebuild, and re-screenshot before declaring done.

- [ ] **Step 4: Commit + push + draft PR**

```bash
git add changelog/2026-05-25-contour-forge.md
git commit -m "docs(forge): changelog entry for Contour Forge"
git push -u origin feat/contour-forge
gh pr create --draft --title "feat: Contour Forge — staged contour-machining generator" --body "Implements the staged seed/perforate/deepen/clean contour strategy generator per docs/superpowers/specs/2026-05-25-contour-forge-design.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Flip to ready with `gh pr ready` once CI is green.

---

## Self-review notes (for the implementer)

- **clipper2-js API names are the one external unknown.** Task 0 Step 3 records the real exports; `offset.ts` is the only file to adjust if they differ. Everything else is internal.
- **mm-vs-units in preview:** the page note in Task 16 Step 1 covers the fallback if source + generated paths render at mismatched scales.
- **UI primitive prop contracts** (`NumberField.onChange`, `Toolbar`, `Badge` variants, `notify`): each task that uses them flags "adapt to the real signature" — verify against `web/src/ui/*` while implementing, don't fight the primitive.
- **Tests are the spec's safety net:** the round-trip test (Task 11) is the load-bearing guarantee that emboss/model survive and the source incise is replaced.
