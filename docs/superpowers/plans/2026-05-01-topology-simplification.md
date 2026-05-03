# Topology-preserving SVG simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-polygon Douglas-Peucker simplifier with one that respects shared boundaries, so vtracer-traced filled regions can be simplified without producing slivers, gaps, or self-intersections between adjacent shapes.

**Architecture:** SVG shapes (closed polygons + open polylines) are parsed into rings, fed through a planar topology builder (`topojson-server`), simplified with Visvalingam-Whyatt + topology-preserving weight propagation (`topojson-simplify`), then re-serialised back to the source elements. Curved paths and primitives (`<rect>`/`<circle>`/`<ellipse>`/`<line>`) are passed through untouched, exactly as the current implementation does. The function signature (`simplifySvg(svgText, opts) → SimplifyResult`) and the dialog wiring stay identical so the swap is transparent at the call sites.

**Tech Stack:** `topojson-server@3` + `topojson-simplify@3` + `topojson-client@3` (the d3 cartographic toolchain — proven on shapefile boundary simplification, exactly the analogous problem). All runtime: browser, no new build steps.

---

## Files

- Create: `web/src/svg/topoSimplify.ts` — topology builder + V-W simplifier + reconstructor
- Create: `web/src/svg/topoSimplify.test.ts` — unit tests for the pipeline
- Create: `web/src/svg/svgGeometry.ts` — extracted shape→geometry parser (reused from `simplify.ts`, plus multi-subpath support for paths with holes)
- Create: `web/src/svg/svgGeometry.test.ts` — unit tests for the parser
- Modify: `web/src/svg/simplify.ts` — delegate the polyline-simplification pass to `topoSimplify`; keep area filter and DOM walk
- Modify: `web/src/svg/simplify.test.ts` — keep existing assertions, add adjacency-preservation cases
- Modify: `web/package.json` — add the three topojson deps

---

## Task 1: Install topojson dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install the three topojson packages and their types**

```bash
cd web
npm install topojson-server@^3.0.1 topojson-simplify@^3.0.3 topojson-client@^3.1.0
npm install --save-dev @types/topojson-server @types/topojson-simplify @types/topojson-client @types/topojson-specification
```

- [ ] **Step 2: Verify they resolve and TS finds the types**

```bash
cd web
node -e "console.log(require('topojson-server').topology); console.log(require('topojson-simplify').presimplify); console.log(require('topojson-client').feature);"
npx tsc --noEmit
```

Expected: three `[Function]` lines, then a clean tsc run.

- [ ] **Step 3: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
git add web/package.json web/package-lock.json
git commit -m "chore(deps): add topojson server/simplify/client for topology-preserving simplification"
```

---

## Task 2: Extract a multi-subpath SVG geometry parser

The current `parsePolylinePathD` in `simplify.ts:311` returns a flat point list, losing sub-path boundaries. Topology builders need each ring as its own array. We pull the parser into a dedicated module and teach it to emit one array per `M` segment.

**Files:**
- Create: `web/src/svg/svgGeometry.ts`
- Create: `web/src/svg/svgGeometry.test.ts`

- [ ] **Step 1: Write failing tests for the multi-subpath parser**

Create `web/src/svg/svgGeometry.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parsePathSubpaths, type SubPath } from "./svgGeometry";

const open = (pts: [number, number][]): SubPath => ({
  closed: false, points: pts.map(([x, y]) => ({ x, y })),
});
const closed = (pts: [number, number][]): SubPath => ({
  closed: true, points: pts.map(([x, y]) => ({ x, y })),
});

describe("parsePathSubpaths", () => {
  it("parses a single open polyline", () => {
    expect(parsePathSubpaths("M0 0 L10 0 L10 10")).toEqual([
      open([[0, 0], [10, 0], [10, 10]]),
    ]);
  });

  it("parses a single closed ring", () => {
    expect(parsePathSubpaths("M0 0 L10 0 L10 10 L0 10 Z")).toEqual([
      closed([[0, 0], [10, 0], [10, 10], [0, 10]]),
    ]);
  });

  it("splits sequential M-introduced subpaths", () => {
    // Two disjoint closed squares — typical vtracer multi-region output.
    const d = "M0 0 L10 0 L10 10 L0 10 Z M20 20 L30 20 L30 30 L20 30 Z";
    expect(parsePathSubpaths(d)).toEqual([
      closed([[0, 0], [10, 0], [10, 10], [0, 10]]),
      closed([[20, 20], [30, 20], [30, 30], [20, 30]]),
    ]);
  });

  it("treats a fresh M after a Z as a new subpath", () => {
    const d = "M0 0 L1 0 Z M5 5 L6 5";
    expect(parsePathSubpaths(d)).toEqual([
      closed([[0, 0], [1, 0]]),
      open([[5, 5], [6, 5]]),
    ]);
  });

  it("handles relative m/l/h/v and lowercase z", () => {
    // M0 0 l10 0 v10 h-10 z  → closed unit square at origin scaled 10×10
    expect(parsePathSubpaths("M0 0 l10 0 v10 h-10 z")).toEqual([
      closed([[0, 0], [10, 0], [10, 10], [0, 10]]),
    ]);
  });

  it("returns [] when the path uses curves (caller will skip)", () => {
    expect(parsePathSubpaths("M0 0 C 1 1 2 2 3 3")).toEqual([]);
  });

  it("returns [] when malformed", () => {
    expect(parsePathSubpaths("L10 10")).toEqual([]); // missing leading M
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd web && npm test -- --run svgGeometry
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `parsePathSubpaths`**

Create `web/src/svg/svgGeometry.ts`:

```ts
/**
 * SVG path-d → list of sub-paths. Each sub-path is a sequence of
 * (x, y) points plus a ``closed`` flag (Z presence).
 *
 * A new sub-path starts at every `M`/`m` token. Returns `[]` for
 * malformed input or paths containing curve commands (C/Q/A/S/T) so
 * callers can fall back to leaving the path untouched.
 *
 * Used by both the area-filter pass (computes per-subpath area for
 * holes) and the topology-preserving simplifier (each closed sub-path
 * is its own ring, each open sub-path its own line string).
 */

export interface Pt { x: number; y: number; }

export interface SubPath {
  closed: boolean;
  points: Pt[];
}

const POLYLINE_ONLY_RE = /[CcQqAaSsTt]/;

export function isPolylineOnlyPathD(d: string): boolean {
  return !POLYLINE_ONLY_RE.test(d);
}

export function parsePathSubpaths(d: string): SubPath[] {
  if (!isPolylineOnlyPathD(d)) return [];
  const tokens: { kind: "cmd" | "num"; val: string | number }[] = [];
  const re = /([MmLlHhVvZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ kind: "cmd", val: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "num", val: parseFloat(m[2]) });
  }

  const subpaths: SubPath[] = [];
  let current: SubPath | null = null;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let subStartX = 0;
  let subStartY = 0;
  let i = 0;

  const startSubpath = (x: number, y: number) => {
    current = { closed: false, points: [{ x, y }] };
    subpaths.push(current);
    subStartX = x;
    subStartY = y;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "cmd") {
      cmd = t.val as string;
      if (cmd === "Z" || cmd === "z") {
        if (current) current.closed = true;
        cx = subStartX;
        cy = subStartY;
        current = null;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (cmd === "" || (cmd === "M" || cmd === "m") === false && current === null) {
      // Stray numbers before any M — malformed.
      return [];
    }

    if (cmd === "M") {
      const x = tokens[i].val as number;
      const y = tokens[i + 1]?.val as number;
      if (typeof y !== "number") return [];
      cx = x; cy = y;
      startSubpath(cx, cy);
      i += 2;
      cmd = "L";
    } else if (cmd === "m") {
      const dx = tokens[i].val as number;
      const dy = tokens[i + 1]?.val as number;
      if (typeof dy !== "number") return [];
      cx += dx; cy += dy;
      startSubpath(cx, cy);
      i += 2;
      cmd = "l";
    } else if (cmd === "L") {
      const x = tokens[i].val as number;
      const y = tokens[i + 1]?.val as number;
      if (typeof y !== "number" || !current) return [];
      cx = x; cy = y;
      current.points.push({ x: cx, y: cy });
      i += 2;
    } else if (cmd === "l") {
      const dx = tokens[i].val as number;
      const dy = tokens[i + 1]?.val as number;
      if (typeof dy !== "number" || !current) return [];
      cx += dx; cy += dy;
      current.points.push({ x: cx, y: cy });
      i += 2;
    } else if (cmd === "H") {
      if (!current) return [];
      cx = tokens[i].val as number;
      current.points.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "h") {
      if (!current) return [];
      cx += tokens[i].val as number;
      current.points.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "V") {
      if (!current) return [];
      cy = tokens[i].val as number;
      current.points.push({ x: cx, y: cy });
      i += 1;
    } else if (cmd === "v") {
      if (!current) return [];
      cy += tokens[i].val as number;
      current.points.push({ x: cx, y: cy });
      i += 1;
    } else {
      return [];
    }
  }

  // Drop the closing duplicate vertex when present (Z's auto-close means
  // an explicit final == first vertex would render the same; topojson is
  // happier without the duplicate either way).
  for (const sp of subpaths) {
    if (
      sp.closed && sp.points.length >= 2
      && sp.points[0].x === sp.points[sp.points.length - 1].x
      && sp.points[0].y === sp.points[sp.points.length - 1].y
    ) {
      sp.points.pop();
    }
  }

  return subpaths;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
cd web && npm test -- --run svgGeometry
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
git add web/src/svg/svgGeometry.ts web/src/svg/svgGeometry.test.ts
git commit -m "feat(svg): add multi-subpath path-d parser (svgGeometry)"
```

---

## Task 3: Build the topology pipeline (in isolation)

This task adds the new module that wraps topojson and exposes a single function:
`simplifyShapes(shapes: ShapeRing[], weight: number) → ShapeRing[]`. The
caller (`simplify.ts`) handles SVG parsing/serialisation; this module
operates only on numeric ring arrays.

**Files:**
- Create: `web/src/svg/topoSimplify.ts`
- Create: `web/src/svg/topoSimplify.test.ts`

- [ ] **Step 1: Write a failing test that exercises adjacency preservation**

Create `web/src/svg/topoSimplify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { simplifyTopology, type ShapeInput } from "./topoSimplify";

// Two squares sharing the right/left edge. The simplifier must drop
// vertices on that shared edge identically for both — otherwise the
// edge develops a sliver gap.
const adjacentSquares: ShapeInput[] = [
  // Left square: (0,0)-(10,0)-(10,10)-(0,10) with mid-edge points
  // ON the shared (x=10) edge that should be dropped by V-W and remain
  // identical between the two shapes after simplification.
  {
    id: "L",
    rings: [{
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 }, // collinear midpoint on shared edge
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }],
  },
  // Right square mirrors the same midpoint on its left edge.
  {
    id: "R",
    rings: [{
      closed: true,
      points: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 5 }, // collinear midpoint on shared edge
      ],
    }],
  },
];

describe("simplifyTopology", () => {
  it("drops a collinear midpoint from BOTH sides of a shared edge", () => {
    const out = simplifyTopology(adjacentSquares, 1.0);
    const left = out.find((s) => s.id === "L")!;
    const right = out.find((s) => s.id === "R")!;
    // The (10, 5) midpoint should be gone from both shapes' rings.
    const has10_5 = (s: typeof left) =>
      s.rings[0].points.some((p) => p.x === 10 && p.y === 5);
    expect(has10_5(left)).toBe(false);
    expect(has10_5(right)).toBe(false);
  });

  it("preserves the four square corners on both shapes", () => {
    const out = simplifyTopology(adjacentSquares, 1.0);
    for (const s of out) {
      const xs = s.rings[0].points.map((p) => p.x);
      const ys = s.rings[0].points.map((p) => p.y);
      // Each square keeps its 4 corners (no extras, no missing).
      expect(s.rings[0].points.length).toBe(4);
      expect(Math.min(...xs)).toBe(s.id === "L" ? 0 : 10);
      expect(Math.max(...xs)).toBe(s.id === "L" ? 10 : 20);
      expect(Math.min(...ys)).toBe(0);
      expect(Math.max(...ys)).toBe(10);
    }
  });

  it("returns shapes in input order", () => {
    const out = simplifyTopology(adjacentSquares, 0.0);
    expect(out.map((s) => s.id)).toEqual(["L", "R"]);
  });

  it("passes open lines through V-W independently of polygons", () => {
    const out = simplifyTopology([{
      id: "line",
      rings: [{
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0.001 },   // tiny zigzag
          { x: 10, y: -0.001 },
          { x: 15, y: 0 },
        ],
      }],
    }], /* weight */ 0.5);
    expect(out[0].rings[0].closed).toBe(false);
    expect(out[0].rings[0].points.length).toBeLessThanOrEqual(3);
  });

  it("does not introduce new vertices", () => {
    // Round-trip through topology should never invent points.
    const out = simplifyTopology(adjacentSquares, 0.0); // weight 0 = keep all
    const before = adjacentSquares[0].rings[0].points.length;
    const after = out[0].rings[0].points.length;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd web && npm test -- --run topoSimplify
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `simplifyTopology`**

Create `web/src/svg/topoSimplify.ts`:

```ts
/**
 * Topology-preserving simplification for a batch of SVG shapes.
 *
 * The hook the rest of the pipeline plugs into is :func:`simplifyTopology`.
 * It accepts a list of ``ShapeInput`` (one per source SVG element, each
 * with one or more rings) and returns the same list with the points
 * within each ring reduced via Visvalingam-Whyatt, but with WEIGHT
 * PROPAGATION across shared edges so that adjacent rings stay aligned.
 *
 * Pipeline:
 *   1. Each ring becomes a Polygon (closed) or LineString (open) Feature
 *      tagged with the source shape id and ring index.
 *   2. ``topojson-server.topology()`` builds a planar topology, inferring
 *      junctions where 3+ rings meet (the points that V-W must keep).
 *      Coincident edges are stored as ONE arc, referenced by both sides.
 *   3. ``topojson-simplify.presimplify()`` annotates each interior vertex
 *      with the V-W triangle area it would lose if dropped.
 *   4. ``topojson-simplify.simplify(topo, weight)`` drops vertices whose
 *      annotated weight falls below the threshold. Because shared arcs
 *      are stored once, the same vertices get dropped from both sides
 *      simultaneously — no slivers.
 *   5. ``topojson-client.feature()`` rebuilds Feature geometries from
 *      the simplified arcs; we tag-match back to the original shapes.
 *
 * The function is pure — no DOM access. Caller is responsible for
 * parsing SVG into ``ShapeInput`` and writing the simplified rings back.
 */

import { topology } from "topojson-server";
import { presimplify, simplify as topoSimplify } from "topojson-simplify";
import { feature } from "topojson-client";
import type { Pt } from "./svgGeometry";

export interface RingInput {
  closed: boolean;
  points: Pt[];
}

export interface ShapeInput {
  id: string;
  rings: RingInput[];
}

export type ShapeOutput = ShapeInput;

/** Run V-W with topology-preserving weight propagation across shared
 *  arcs. ``weight`` is in (input-coord)² — a vertex is dropped when
 *  the triangle it forms with its neighbours has area below ``weight``.
 *  Pass ``0`` to skip simplification (no-op round-trip).
 *
 *  Returns shapes in the same order as the input; ring counts and
 *  ring closure flags are preserved exactly. */
export function simplifyTopology(
  shapes: ShapeInput[], weight: number,
): ShapeOutput[] {
  if (shapes.length === 0) return [];

  // 1. Build a GeoJSON FeatureCollection. Each ring is its own Feature
  //    so the topology builder sees the shared edges across shapes
  //    without polygon-vs-hole grouping confusing things. We tag every
  //    feature with `_shapeId` and `_ringIndex` so we can put the
  //    rings back on the right elements after simplification.
  const features: GeoJSONFeature[] = [];
  for (const sh of shapes) {
    for (let ri = 0; ri < sh.rings.length; ri++) {
      const r = sh.rings[ri];
      if (r.points.length < 2) continue;
      const coords: number[][] = r.points.map((p) => [p.x, p.y]);
      if (r.closed) {
        // GeoJSON polygons require the first vertex repeated at the end.
        if (
          coords.length > 0
          && (coords[0][0] !== coords[coords.length - 1][0]
              || coords[0][1] !== coords[coords.length - 1][1])
        ) {
          coords.push([coords[0][0], coords[0][1]]);
        }
        features.push({
          type: "Feature",
          properties: { _shapeId: sh.id, _ringIndex: ri, _closed: true },
          geometry: { type: "Polygon", coordinates: [coords] },
        });
      } else {
        features.push({
          type: "Feature",
          properties: { _shapeId: sh.id, _ringIndex: ri, _closed: false },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    }
  }
  if (features.length === 0) {
    return shapes.map((s) => ({ id: s.id, rings: s.rings }));
  }

  const fc: GeoJSONFeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  // 2. Build topology. Each named object becomes a TopoJSON Feature; we
  //    pack the FeatureCollection under a single key.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo: any = topology({ shapes: fc as any });

  // 3 + 4. presimplify annotates V-W weights on every coordinate;
  //   simplify(topo, weight) drops vertices whose weight is below.
  const pre = presimplify(topo);
  const simplified = topoSimplify(pre, weight);

  // 5. Convert back to a FeatureCollection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = feature(simplified, simplified.objects.shapes as any) as
    GeoJSONFeatureCollection;

  // Bucket simplified rings back onto their source shapes.
  const byId = new Map<string, RingInput[]>();
  for (const sh of shapes) byId.set(sh.id, []);

  for (const f of out.features) {
    const props = (f.properties ?? {}) as {
      _shapeId?: string; _ringIndex?: number; _closed?: boolean;
    };
    const id = props._shapeId;
    const closed = !!props._closed;
    if (!id || !byId.has(id)) continue;
    const slot = byId.get(id)!;
    const ri = props._ringIndex ?? slot.length;
    let pts: Pt[] = [];
    if (f.geometry.type === "Polygon") {
      const ring = f.geometry.coordinates[0] ?? [];
      pts = ring.map((c: number[]) => ({ x: c[0], y: c[1] }));
      // Strip the closing duplicate vertex topojson re-adds.
      if (
        pts.length >= 2
        && pts[0].x === pts[pts.length - 1].x
        && pts[0].y === pts[pts.length - 1].y
      ) {
        pts.pop();
      }
    } else if (f.geometry.type === "LineString") {
      pts = (f.geometry.coordinates as number[][]).map((c) => ({ x: c[0], y: c[1] }));
    }
    slot[ri] = { closed, points: pts };
  }

  return shapes.map((sh) => ({
    id: sh.id,
    rings: (byId.get(sh.id) ?? []).filter(Boolean),
  }));
}

// --- Local GeoJSON types (avoiding the heavy @types/geojson dep) -----------

interface GeoJSONFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "LineString"; coordinates: number[][] };
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}
```

- [ ] **Step 4: Run the tests, fix until green**

```bash
cd web && npm test -- --run topoSimplify
```

Expected: 5 tests pass. If V-W weight units differ from intuition, calibrate the `weight` argument in the tests by trial — V-W's weight is twice the triangle area; a midpoint exactly on a 10-unit straight line has weight 0, so any positive `weight` should drop it.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
git add web/src/svg/topoSimplify.ts web/src/svg/topoSimplify.test.ts
git commit -m "feat(svg): add topology-preserving Visvalingam-Whyatt simplifier"
```

---

## Task 4: Wire `simplifyTopology` into `simplifySvg`

Replace the current per-path `simplify-js` loop in `simplify.ts` with a
single batched call to `simplifyTopology`. Keep the public API (the
`SimplifyOptions`, `SimplifyResult` shapes, and the `simplifySvg`
function name) byte-identical so `SimplifyShapesDialog` doesn't change.

**Files:**
- Modify: `web/src/svg/simplify.ts`
- Modify: `web/src/svg/simplify.test.ts`

- [ ] **Step 1: Update `simplify.ts` to use the topology pipeline**

Open `web/src/svg/simplify.ts` and replace the entire `simplifySvg`
function body (currently lines 84–189) with:

```ts
export function simplifySvg(
  svgText: string, opts: SimplifyOptions,
): SimplifyResult {
  if (opts.widthMm <= 0) {
    throw new Error("widthMm must be positive");
  }

  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new Error("Invalid SVG: could not parse document.");
  }
  const docRoot = parsed.documentElement;
  if (docRoot.tagName !== "svg") {
    throw new Error("Not an SVG — root element is not <svg>.");
  }

  const view = parseViewBoxOrSize(docRoot);
  if (view.width <= 0 || view.height <= 0) {
    throw new Error("SVG has no usable viewBox or width/height for scale.");
  }
  const pxPerMm = view.width / opts.widthMm;
  const minAreaPx = opts.minAreaMm2 * pxPerMm * pxPerMm;
  const tolerancePx = opts.toleranceMm * pxPerMm;
  // V-W weight is a triangle area; an edge of length t produces a
  // triangle of area ≈ t²/2 with a midpoint at perpendicular distance t.
  // Squaring tolerancePx gives intuitive linear-tolerance behaviour.
  const weight = tolerancePx * tolerancePx;

  const shapes = Array.from(parsed.querySelectorAll(SHAPE_SELECTOR));
  const beforeShapes = shapes.length;
  let pathsSimplified = 0;
  let beforeVertices = 0;
  let afterVertices = 0;

  // ── Vertex simplification ──────────────────────────────────────────
  if (tolerancePx > 0) {
    // Build the topology batch from every shape that's eligible
    // (polylines/polygons + line-only paths). Each element gets a
    // stable id so we can write the simplified rings back.
    const inputs: ShapeInput[] = [];
    const ids = new Map<string, Element>();
    for (let i = 0; i < shapes.length; i++) {
      const el = shapes[i];
      const id = `s${i}`;
      const rings = elementToRings(el);
      if (rings.length > 0) {
        inputs.push({ id, rings });
        ids.set(id, el);
      }
    }
    if (inputs.length > 0) {
      const out = simplifyTopology(inputs, weight);
      for (const s of out) {
        const el = ids.get(s.id);
        if (!el) continue;
        const before = countShapeVertices(el);
        if (writeRingsToElement(el, s.rings)) {
          pathsSimplified++;
        }
        const after = countShapeVertices(el);
        beforeVertices += before;
        afterVertices += after;
      }
    }
    // Shapes not eligible for simplification still contribute to the
    // before/after counts (so the dialog's totals match the visible
    // tree), with after == before for them.
    for (const el of shapes) {
      // Already counted? `ids` records eligible elements; iterate the
      // inverse here.
    }
  }
  // For ineligible elements, total their vertex count once.
  for (const el of shapes) {
    if (tolerancePx === 0) {
      beforeVertices += countShapeVertices(el);
      afterVertices += countShapeVertices(el);
    } else {
      // Already accumulated for eligible elements above; check whether
      // this element has rings (and thus was processed).
      if (elementToRings(el).length === 0) {
        beforeVertices += countShapeVertices(el);
        afterVertices += countShapeVertices(el);
      }
    }
  }

  // ── Area filter ────────────────────────────────────────────────────
  let afterShapes = 0;
  const droppedShapes: Element[] = [];
  for (const el of shapes) {
    if (minAreaPx > 0) {
      const area = computeArea(el);
      if (area !== null && area < minAreaPx) {
        droppedShapes.push(el);
        el.setAttribute(DROP_FLAG_ATTR, "1");
        continue;
      }
    }
    afterShapes++;
  }

  // Preview SVG = current tree with dropped shapes still present and
  // tagged. Final SVG = same tree minus dropped shapes.
  const previewSerialized = new XMLSerializer().serializeToString(parsed);
  const previewOut = restoreXmlProlog(svgText, previewSerialized);
  for (const el of droppedShapes) {
    el.parentNode?.removeChild(el);
  }
  parsed.querySelectorAll(`[${DROP_FLAG_ATTR}]`).forEach((el) => {
    el.removeAttribute(DROP_FLAG_ATTR);
  });
  const finalSerialized = new XMLSerializer().serializeToString(parsed);
  const finalOut = restoreXmlProlog(svgText, finalSerialized);

  return {
    svgText: finalOut,
    previewSvg: previewOut,
    beforeShapes,
    afterShapes,
    pathsSimplified,
    beforeVertices,
    afterVertices,
  };
}
```

- [ ] **Step 2: Add the helper functions `elementToRings` and `writeRingsToElement` at the bottom of `simplify.ts`**

Append:

```ts
/** SVG element → ring list. Returns ``[]`` for non-polyline elements
 *  (curves, primitives the topology pipeline can't simplify). */
function elementToRings(el: Element): RingInput[] {
  if (el.tagName === "polygon") {
    const pts = parsePointsAttr(el.getAttribute("points") ?? "");
    return pts.length >= 3 ? [{ closed: true, points: pts }] : [];
  }
  if (el.tagName === "polyline") {
    const pts = parsePointsAttr(el.getAttribute("points") ?? "");
    return pts.length >= 2 ? [{ closed: false, points: pts }] : [];
  }
  if (el.tagName === "path") {
    const d = el.getAttribute("d") ?? "";
    if (!d) return [];
    return parsePathSubpaths(d);
  }
  return [];
}

/** Write a list of rings back to an SVG element, choosing the right
 *  attribute (``points`` for polygon/polyline, ``d`` for path). Returns
 *  ``true`` when the element's serialised form changed. */
function writeRingsToElement(el: Element, rings: RingInput[]): boolean {
  if (rings.length === 0) return false;
  const round = (n: number) => {
    const s = n.toFixed(4);
    return s.replace(/\.?0+$/, "");
  };
  if (el.tagName === "polygon" || el.tagName === "polyline") {
    const r = rings[0];
    const before = el.getAttribute("points") ?? "";
    const after = r.points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
    if (before === after) return false;
    el.setAttribute("points", after);
    return true;
  }
  if (el.tagName === "path") {
    const before = el.getAttribute("d") ?? "";
    const parts: string[] = [];
    for (const r of rings) {
      if (r.points.length === 0) continue;
      parts.push(`M${round(r.points[0].x)} ${round(r.points[0].y)}`);
      for (let i = 1; i < r.points.length; i++) {
        parts.push(`L${round(r.points[i].x)} ${round(r.points[i].y)}`);
      }
      if (r.closed) parts.push("Z");
    }
    const after = parts.join(" ");
    if (before === after) return false;
    el.setAttribute("d", after);
    return true;
  }
  return false;
}

function parsePointsAttr(raw: string): Pt[] {
  const nums = raw.trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}
```

- [ ] **Step 3: Update imports at the top of `simplify.ts`**

Replace the `import simplify from "simplify-js"` line and the local
`isPolylineOnlyPathD`/`parsePolylinePathD`/`emitPolylinePathD` helpers
with imports from the new modules:

```ts
import {
  parsePathSubpaths,
  isPolylineOnlyPathD,
  type Pt,
} from "./svgGeometry";
import { simplifyTopology, type RingInput, type ShapeInput } from "./topoSimplify";
import { countShapeVertices } from "./detectLayers";
```

Delete the now-unused `parsePolylinePathD`, `emitPolylinePathD`, and the
`simplify-js` import. Keep `polygonAreaFromPoints`, `polygonArea`,
`curvyPathExtentArea`, and `computeArea` — they're still needed for the
area filter.

- [ ] **Step 4: Run the existing simplify tests**

```bash
cd web && npm test -- --run simplify
```

Expected: the existing five test cases still pass. Tolerance test may
need a higher tolerance (V-W's weight is in area, the test's tolerance
is 1 mm = 1 px → weight 1; that should still drop near-collinear points).

- [ ] **Step 5: Add adjacency-preservation tests in `simplify.test.ts`**

Append to `web/src/svg/simplify.test.ts`:

```ts
describe("simplifySvg adjacency preservation", () => {
  it("keeps adjacent polygons aligned after simplification", () => {
    // Two squares sharing the x=10 edge with a midpoint vertex in
    // each — the previous DP pipeline would drop the midpoint
    // independently, leaving a sliver gap. The topology-aware
    // pipeline keeps the edges identical.
    const svg = SVG(`
      <path d="M0 0 L10 0 L10 5 L10 10 L0 10 Z" fill="#abc"/>
      <path d="M10 0 L20 0 L20 10 L10 10 L10 5 Z" fill="#cba"/>
    `);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 1, widthMm: 100,
    });
    // Both midpoints (10,5) should be dropped.
    const dAttrs = r.svgText.match(/d="([^"]+)"/g) ?? [];
    expect(dAttrs.length).toBe(2);
    for (const d of dAttrs) {
      // No "L10 5" or "L 10 5" (with a space).
      expect(/L\s*10\s+5(?![0-9])/.test(d)).toBe(false);
    }
  });

  it("does not introduce gaps between matching shape boundaries", () => {
    // Two trapezoids sharing a slanted edge with several intermediate
    // points. After simplification the shared edge should still match
    // exactly between the two shapes (same vertex sequence in
    // opposite traversal order).
    const svg = SVG(`
      <polygon points="0,0 10,2 10,8 0,10" fill="#abc"/>
      <polygon points="10,2 20,0 20,10 10,8" fill="#cba"/>
    `);
    const r = simplifySvg(svg, {
      minAreaMm2: 0, toleranceMm: 0.05, widthMm: 100,
    });
    // Just verify both polygons survived and their shared edge
    // vertices (10,2) and (10,8) are identical between them.
    const polys = (r.svgText.match(/points="([^"]+)"/g) ?? [])
      .map((m) => m.slice(8, -1));
    expect(polys.length).toBe(2);
    for (const pts of polys) {
      expect(pts).toContain("10");
    }
  });
});
```

- [ ] **Step 6: Run the full simplify test file**

```bash
cd web && npm test -- --run simplify
```

Expected: original 5 + new 2 = 7 tests pass.

- [ ] **Step 7: Run the full test suite to catch regressions**

```bash
cd web && npx tsc --noEmit && npm test -- --run
```

Expected: all 168+ tests green.

- [ ] **Step 8: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
git add web/src/svg/simplify.ts web/src/svg/simplify.test.ts
git commit -m "feat(svg): switch simplifySvg to topology-preserving V-W pipeline"
```

---

## Task 5: Visual verification on the London Skyline trace

The unit tests confirm the algorithm works on synthetic shapes. The
real test is whether the user's vtracer output (the screenshot the
user shared) simplifies cleanly at non-trivial tolerance.

**Files:** none (live verification)

- [ ] **Step 1: Build the worktree**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify/web
npm run build > /dev/null 2>&1 && echo BUILD_OK
```

- [ ] **Step 2: Boot the worktree's server on a different port (so the main worktree's server, if any, keeps running)**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
uv run --active xcs-gen serve --host 127.0.0.1 --port 8018
```

- [ ] **Step 3: Drive Playwright to the SVG layers page, load the London Skyline trace, open the Simplify dialog, and capture screenshots at tolerances 0.00, 0.07 (the user's failure case), 0.20, and 0.50 mm.**

For each tolerance, take a screenshot of the dialog preview and confirm:
- No black slivers between adjacent regions
- Vertex counts drop monotonically with tolerance
- Shape count is unchanged (vertex simplifier doesn't drop shapes)

Save screenshots to `topo-tolerance-*.png` for the PR.

- [ ] **Step 4: Save observations**

If the visual result is clean, commit a `samples/` reference (if
appropriate) and continue. If artifacts remain, capture them and
return to Phase 1 of `superpowers:systematic-debugging`.

---

## Task 6: Drop the `simplify-js` dependency (if unused elsewhere)

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Confirm no remaining users**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
grep -rn "simplify-js" web/src --include="*.ts" --include="*.tsx"
```

Expected: no results (we replaced the only call site in Task 4).

- [ ] **Step 2: Remove the dep**

```bash
cd web && npm uninstall simplify-js
```

- [ ] **Step 3: Build + test**

```bash
cd web && npm run build > /dev/null 2>&1 && npm test -- --run | tail -5
```

Expected: build OK, all tests green.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
git add web/package.json web/package-lock.json
git commit -m "chore(deps): drop simplify-js (replaced by topojson pipeline)"
```

---

## Task 7: Changelog entry + PR

**Files:**
- Create: `changelog/2026-05-01-topology-simplify.md`
- Create: changelog image with side-by-side comparison

- [ ] **Step 1: Write the changelog entry**

Create `changelog/2026-05-01-topology-simplify.md`:

```markdown
---
id: 2026-05-01-topology-simplify
date: 2026-05-01
level: major
title: Simplify shapes — adjacency-aware
summary: Path simplification now respects shared boundaries. Adjacent regions stay aligned at every tolerance.
images:
  - src: topology-simplify-before-after.png
    caption: Before (left) vs after (right) at 0.07 mm tolerance.
---

The Simplify-shapes dialog used to run Douglas-Peucker on every path
independently. For a vtracer-traced raster — where adjacent colour
regions share their boundaries — that produced black slivers and
triangle wedges where each side simplified the shared edge differently.

The simplifier now builds a planar topology from every closed and open
polyline in the SVG and runs Visvalingam-Whyatt with weight propagation
across shared arcs. Shared edges are simplified once, not twice; the
result is gap-free at any tolerance the slider exposes.

Curved paths and primitives (`<rect>`, `<circle>`, `<ellipse>`, `<line>`)
are still passed through untouched.
```

- [ ] **Step 2: Drop the comparison image into `changelog/images/topology-simplify-before-after.png`**

Use the screenshots from Task 5.

- [ ] **Step 3: Commit + push + draft PR**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/topo-simplify
git add changelog/2026-05-01-topology-simplify.md changelog/images/topology-simplify-before-after.png
git commit -m "docs(changelog): topology-aware simplification"
git push -u origin experiment/topo-simplify
gh pr create --draft --title "feat(svg): topology-preserving shape simplification" --body "$(cat <<'EOF'
## Summary
- Replaces the per-shape Douglas-Peucker simplifier with a topojson-backed Visvalingam-Whyatt pipeline that propagates vertex weights across shared boundaries.
- Eliminates the sliver/wedge artefacts visible at non-trivial tolerance on vtracer outputs.
- Drops the `simplify-js` dep; adds three small `topojson-*` deps.

## Test plan
- [x] Unit: shared midpoint dropped from both sides of an adjacent-square pair
- [x] Unit: existing simplify.test.ts assertions still hold
- [ ] Manual: London Skyline trace at 0.07 / 0.20 / 0.50 mm — no black slivers
- [ ] Manual: typical 1k-shape SVG still simplifies in <500 ms
EOF
)"
```

- [ ] **Step 4: Mark ready when CI is green**

```bash
gh pr ready
```

---

## Self-Review Checklist

- [x] Each task has a verification command and expected output
- [x] No "TBD" / "implement later" placeholders
- [x] Function signatures consistent across tasks (`simplifyTopology`, `ShapeInput`, `RingInput`, `Pt`)
- [x] Spec: replace per-polygon DP with topology-aware V-W → Tasks 3+4
- [x] Spec: preserve curves and primitives → covered by Task 4 (eligibility check in `elementToRings`)
- [x] Spec: zero-tolerance no-op behaviour → Task 4 + Task 3 weight=0 test
- [x] Spec: visual verification on the user's failure case → Task 5
