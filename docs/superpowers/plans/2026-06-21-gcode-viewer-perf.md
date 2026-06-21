# Gcode Viewer — large-file performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gcode Viewer open + interact smoothly with large `.gc` files (47 MB / 2.8 M segments) — drop memory ~13× (typed-array geometry), eliminate the worker→main clone (Transferable), kill a per-render full-segment rescan, and decimate sub-pixel render detail.

**Architecture:** Segments move from an object array (`Segment[]`) to columnar typed arrays (`BlockGeometry`: Float32 x/y/s + Uint8 rapid). The parser fills them via growable typed-array builders; the worker transfers the buffers zero-copy. The canvas iterates the columns and collapses sub-pixel runs via a pure decimation helper. `layerPeakPower` uses the precomputed `block.peakS`.

**Tech Stack:** TypeScript + Web Worker + Canvas 2D; vitest.

**Spec:** `docs/superpowers/specs/2026-06-21-gcode-viewer-perf-design.md`. Dir: `web/src/lib/gcode/`.

**Key facts (verified):**
- `web/src/lib/gcode/types.ts`: `Block.segments: Segment[]`; `Segment {x,y,s,rapid}`; `Block` also has `startLine, config, bbox, peakS, feedF, zMoves, zAtEnd`. `Layer.totalSegments`, `Layer.bbox`, `Job`, `GcodeFile` exist.
- `parser.ts`: single-pass `parseGcode(text)`. `PendingBlock` holds `segments: Segment[]`. The motion section reads `pendingBlock.segments[len-1]` for prev x/y/s, pushes `{x,y,s,rapid}`, and updates `bbox`/`peakS`. `finalizeBlock` copies fields to a `Block`.
- `parser.worker.ts`: `postMessage(resp)` (no transfer). `ParserResponse = {type:"parsed"; file; elapsedMs} | {type:"error"; message}`.
- `GcodeCanvas.tsx`: base-render `useEffect` builds a travels `Path2D`, 16 power-bucket `Path2D` + a cleanup `Path2D` by iterating `item.block.segments`; strokes them; caches to an offscreen canvas. A second `useEffect` blits the cache + draws the `highlight` block's segments. `computeTransform` → `{scale, ox, oy, bw, bh}`; `toX(x)=x*scale+ox`.
- `GcodeViewerPage.tsx`: `layerPeakPower(layer)` (line ~117) iterates `block.segments` → max s; called inline in `layers.map`. Params "SEGS" row (line ~734) uses `singleBlock.segments.length`. Everything else uses `block.peakS`/`feedF`/`zMoves` and `layer.totalSegments` (precomputed).
- `LayerPanel.tsx`: passes `blocks` to `GcodeCanvas`, reads only `peakS`/`feedF`/`zMoves` — **no segment access, no change**.
- `parser.test.ts`: asserts `block.segments` `toEqual([{x,y,s,rapid},…])` (line ~72) and a real-file test reads `samples/xcode/sampleEng.gc` (tracked) using `blocks[0].segments.filter(s => !s.rapid && s.s > 0)` + `burnSegs[0].x/y` (line ~142).

**Conventions:** Gate before commit: `cd web && npx tsc --noEmit && npm test -- --run`. Rebuild for browser: `cd web && npm run build`. Never `git commit --no-verify`.

**File structure:**
```
web/src/lib/gcode/decimate.ts          NEW  pure sub-pixel decimation (decimateIndices)
web/src/lib/gcode/decimate.test.ts     NEW
web/src/lib/gcode/types.ts             MOD  BlockGeometry; Block.geometry (retire Segment)
web/src/lib/gcode/parser.ts            MOD  growable typed builders; scalar prev-state; geometry
web/src/lib/gcode/parser.test.ts       MOD  columnar-geometry assertions
web/src/lib/gcode/parser.worker.ts     MOD  collect block buffers → postMessage(resp, transfer)
web/src/components/gcode/GcodeCanvas.tsx   MOD  typed iteration + decimation (base + highlight)
web/src/pages/GcodeViewerPage.tsx      MOD  layerPeakPower → block.peakS; SEGS → geometry.count
changelog/2026-06-21-gcode-viewer-perf.md  NEW  minor entry
```

---

## Task 1: Sub-pixel decimation helper (`decimate.ts`)

Pure, self-contained — no dependency on the type change.

**Files:** Create `web/src/lib/gcode/decimate.ts`, `web/src/lib/gcode/decimate.test.ts`.

- [ ] **Step 1: Write the failing test** — create `web/src/lib/gcode/decimate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decimateIndices } from "./decimate";

describe("decimateIndices", () => {
  it("keeps all vertices when they're spaced above the threshold", () => {
    // 4 points 10 units apart, scale 1 → 10px gaps, minPx 0.5 → keep all
    const x = new Float32Array([0, 10, 20, 30]);
    const y = new Float32Array([0, 0, 0, 0]);
    expect(decimateIndices(x, y, 4, 1, 0, 0, 0.5)).toEqual([0, 1, 2, 3]);
  });
  it("collapses a dense sub-pixel run, always keeping first + last", () => {
    // 100 points 0.001 units apart, scale 1 → 0.001px gaps, minPx 0.5
    const n = 100;
    const x = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = i * 0.001; y[i] = 0; }
    const keep = decimateIndices(x, y, n, 1, 0, 0, 0.5);
    expect(keep[0]).toBe(0);
    expect(keep[keep.length - 1]).toBe(n - 1);
    expect(keep.length).toBeLessThan(5); // collapsed to ~endpoints
  });
  it("respects the scale (same coords, larger scale keeps more)", () => {
    const x = new Float32Array([0, 0.4, 0.8, 1.2]); // 0.4-unit gaps
    const y = new Float32Array([0, 0, 0, 0]);
    // scale 1: each step is 0.4px (< 0.5) so idx 1 is skipped, but drift from
    // the last KEPT vertex (idx 0) reaches 0.8px at idx 2 (≥ 0.5) → idx 2 kept.
    expect(decimateIndices(x, y, 4, 1, 0, 0, 0.5)).toEqual([0, 2, 3]);
    // scale 10 → 4px gaps ≥ 0.5 → keep all
    expect(decimateIndices(x, y, 4, 10, 0, 0, 0.5)).toEqual([0, 1, 2, 3]);
  });
  it("measures drift from the last KEPT vertex, not the previous one", () => {
    // 11 points, each step 0.3 units (sub-pixel at scale 1, minPx 0.5). Drift
    // from the last kept vertex crosses 0.5 every other point → every other
    // vertex is retained. A previous-sequential metric would wrongly collapse
    // a shallow ramp to [0, 10] (a straight line), so this guards the shape.
    const x = new Float32Array([0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0]);
    const y = new Float32Array(11);
    const keep = decimateIndices(x, y, 11, 1, 0, 0, 0.5);
    expect(keep).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it("returns all indices for counts <= 2", () => {
    expect(decimateIndices(new Float32Array([0, 1]), new Float32Array([0, 0]), 2, 1, 0, 0, 0.5)).toEqual([0, 1]);
    expect(decimateIndices(new Float32Array([5]), new Float32Array([5]), 1, 1, 0, 0, 0.5)).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/gcode/decimate.test.ts`
Expected: FAIL — cannot find module `./decimate`.

- [ ] **Step 3: Implement `web/src/lib/gcode/decimate.ts`**:
```ts
// web/src/lib/gcode/decimate.ts
// Pure sub-pixel decimation for a vertex polyline. Given the x/y columns and a
// screen transform (scale, ox, oy with screenX = x*scale + ox), return the
// indices to draw — keeping a vertex only when it is >= minPx (screen space)
// from the last KEPT vertex. First and last vertices are always kept, so a
// dense run of sub-pixel moves collapses to one segment while the visible shape
// is preserved. O(count); no allocation beyond the result.
export function decimateIndices(
  x: Float32Array,
  y: Float32Array,
  count: number,
  scale: number,
  ox: number,
  oy: number,
  minPx: number,
): number[] {
  if (count <= 2) {
    const all: number[] = [];
    for (let i = 0; i < count; i++) all.push(i);
    return all;
  }
  const min2 = minPx * minPx;
  const keep: number[] = [0];
  let lastSx = x[0] * scale + ox;
  let lastSy = y[0] * scale + oy;
  const last = count - 1;
  for (let i = 1; i < last; i++) {
    const sx = x[i] * scale + ox;
    const sy = y[i] * scale + oy;
    const dx = sx - lastSx;
    const dy = sy - lastSy;
    if (dx * dx + dy * dy >= min2) {
      keep.push(i);
      lastSx = sx;
      lastSy = sy;
    }
  }
  keep.push(last);
  return keep;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/gcode/decimate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd web && npx tsc --noEmit` → clean.
```bash
git add web/src/lib/gcode/decimate.ts web/src/lib/gcode/decimate.test.ts
git commit -m "feat(gcode): pure sub-pixel decimation helper"
```

---

## Task 2: Typed-array geometry — data model, parser, worker, render, page

The `Block.segments → geometry` type change is cross-cutting (parser produces it; canvas + page consume it), so it lands as one tsc-green unit. `LayerPanel` is untouched.

**Files:** Modify `types.ts`, `parser.ts`, `parser.test.ts`, `parser.worker.ts`, `GcodeCanvas.tsx`, `GcodeViewerPage.tsx`.

- [ ] **Step 1: Update `web/src/lib/gcode/types.ts`** — replace the `Segment` interface and `Block.segments` field.

Replace:
```ts
export interface Segment {
  /** End-point of this move, in gcode mm. */
  x: number;
  y: number;
  /** Laser power 0–1000. 0 means "travel / non-burn". */
  s: number;
  /** True if the originating command was G0 (rapid). */
  rapid: boolean;
}
```
with:
```ts
/** Columnar geometry for one block — one entry per motion vertex. Typed arrays
 *  (not objects) so 2.8 M segments cost ~13 B each (~36 MB) instead of ~170 B,
 *  and the worker can transfer the buffers zero-copy. */
export interface BlockGeometry {
  /** Vertex X (gcode mm). */
  x: Float32Array;
  /** Vertex Y (gcode mm). */
  y: Float32Array;
  /** Laser power 0–1000 (0 = travel / non-burn). */
  s: Float32Array;
  /** 1 = G0 rapid, 0 = G1 cut. */
  rapid: Uint8Array;
  /** Number of vertices (length of each column). */
  count: number;
}
```
And in `Block`, replace `segments: Segment[];` with:
```ts
  geometry: BlockGeometry;
```

- [ ] **Step 2: Rewrite `web/src/lib/gcode/parser.ts`** — growable typed builders + scalar prev-state + geometry output.

(a) Add the builders + `Pt`-free helpers at the top (after the imports, before `emptyBbox`):
```ts
/** Growable Float32 column: doubles capacity, finalizes to an exact-size copy
 *  (so the transferred buffer is tight). */
class F32Builder {
  private buf = new Float32Array(64);
  len = 0;
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Float32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  toArray(): Float32Array {
    return this.buf.slice(0, this.len);
  }
}

/** Growable Uint8 column (same contract as F32Builder). */
class U8Builder {
  private buf = new Uint8Array(64);
  len = 0;
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  toArray(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
```

(b) Change `import type { ... Segment ... }` — remove `Segment` from the type import (it's gone). The import becomes:
```ts
import type {
  BBox,
  Block,
  BlockConfig,
  GcodeFile,
  Job,
} from "./types";
```

(c) Replace the `PendingBlock` interface:
```ts
interface PendingBlock {
  startLine: number;
  configRaw: string | null;
  xb: F32Builder;
  yb: F32Builder;
  sb: F32Builder;
  rb: U8Builder;
  count: number;
  /** Last pushed vertex (modal prev-state; replaces reading back the array). */
  prevX: number;
  prevY: number;
  prevS: number;
  bbox: BBox;
  peakS: number;
  feedF: number;
  zMoves: Array<{ z: number; delta: number }>;
  zAtEnd: number;
}
```

(d) Replace `finalizeBlock`:
```ts
function finalizeBlock(block: PendingBlock): Block | null {
  if (block.configRaw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.configRaw);
  } catch {
    parsed = null;
  }
  const config: BlockConfig = { raw: block.configRaw, parsed };
  return {
    startLine: block.startLine,
    config,
    geometry: {
      x: block.xb.toArray(),
      y: block.yb.toArray(),
      s: block.sb.toArray(),
      rapid: block.rb.toArray(),
      count: block.count,
    },
    bbox: block.bbox,
    peakS: block.peakS,
    feedF: block.feedF,
    zMoves: block.zMoves,
    zAtEnd: block.zAtEnd,
  };
}
```

(e) In `pushBlockToJob`, the `totalSegments` line reads `block.segments.length` — change to `block.geometry.count`:
```ts
    last.totalSegments += block.geometry.count;
```
and the new-layer branch:
```ts
      totalSegments: block.geometry.count,
```

(f) In the `# motion_start` handler, build the pending block with builders:
```ts
        pendingBlock = {
          startLine: i + 1,
          configRaw: null,
          xb: new F32Builder(),
          yb: new F32Builder(),
          sb: new F32Builder(),
          rb: new U8Builder(),
          count: 0,
          prevX: NaN,
          prevY: NaN,
          prevS: 0,
          bbox: emptyBbox(),
          peakS: 0,
          feedF: 0,
          zMoves: [],
          zAtEnd: currentZ,
        };
```

(g) Replace the motion-line prev-state block (the `const lastSegment = … prevX = … curS = …` section) with scalar reads:
```ts
    const hasPrev = pendingBlock != null && pendingBlock.count > 0;
    const prevX = hasPrev ? pendingBlock!.prevX : NaN;
    const prevY = hasPrev ? pendingBlock!.prevY : NaN;
    let curX = prevX;
    let curY = prevY;
    let curS = hasPrev ? pendingBlock!.prevS : 0;
    let sawXY = false;
    let rawZ: number | null = null;
```
(The `COORD_TOKEN_RE` loop and the Z-handling block are unchanged.)

(h) Replace the final push section (`if (!pendingBlock) continue; … pendingBlock.peakS = curS;`) — keep the guards, push to builders, update prev + bbox + peakS:
```ts
    // X/Y segments only attach to an open block.
    if (!pendingBlock) continue;

    if (!sawXY && pendingBlock.count === 0) continue;
    if (Number.isNaN(curX) || Number.isNaN(curY)) continue;

    pendingBlock.xb.push(curX);
    pendingBlock.yb.push(curY);
    pendingBlock.sb.push(curS);
    pendingBlock.rb.push(isG0 ? 1 : 0);
    pendingBlock.count++;
    pendingBlock.prevX = curX;
    pendingBlock.prevY = curY;
    pendingBlock.prevS = curS;
    pendingBlock.bbox = {
      minX: Math.min(pendingBlock.bbox.minX, curX),
      minY: Math.min(pendingBlock.bbox.minY, curY),
      maxX: Math.max(pendingBlock.bbox.maxX, curX),
      maxY: Math.max(pendingBlock.bbox.maxY, curY),
    };
    if (!isG0 && curS > pendingBlock.peakS) {
      pendingBlock.peakS = curS;
    }
```

- [ ] **Step 3: Update `web/src/lib/gcode/parser.test.ts`** — the two spots that read `block.segments`.

(a) The `extracts G0/G1 segments…` test — replace the `expect(block.segments).toEqual([...])` assertion (and keep the bbox/totalSegments ones) with columnar reads:
```ts
    expect(block.geometry.count).toBe(4);
    expect(Array.from(block.geometry.x)).toEqual([10, 15, 15, 12]);
    expect(Array.from(block.geometry.y)).toEqual([20, 20, 25, 25]);
    expect(Array.from(block.geometry.s)).toEqual([0, 900, 900, 0]);
    expect(Array.from(block.geometry.rapid)).toEqual([1, 0, 0, 0]); // first is G0
    expect(block.geometry.x).toBeInstanceOf(Float32Array);
    expect(block.geometry.rapid).toBeInstanceOf(Uint8Array);
```
(Keep the existing `block.bbox`, `layer.totalSegments`, `job.bbox` assertions immediately after — they're unchanged.)

(b) The real-file test (lines 142-145) — replace these three `burnSegs` lines:
```ts
    const burnSegs = vectorLayer!.blocks[0].segments.filter(s => !s.rapid && s.s > 0);
    expect(burnSegs).toHaveLength(1);
    expect(burnSegs[0].x).toBeCloseTo(117.040, 3);
    expect(burnSegs[0].y).toBeCloseTo(106.439, 3);
```
with the columnar equivalent (keep the exactly-one-burn-vertex assertion):
```ts
    const geo = vectorLayer!.blocks[0].geometry;
    const burn: number[] = [];
    for (let k = 0; k < geo.count; k++) {
      if (geo.rapid[k] === 0 && geo.s[k] > 0) burn.push(k);
    }
    expect(burn).toHaveLength(1);
    expect(geo.x[burn[0]]).toBeCloseTo(117.040, 3);
    expect(geo.y[burn[0]]).toBeCloseTo(106.439, 3);
```

- [ ] **Step 4: Update `web/src/lib/gcode/parser.worker.ts`** — transfer the geometry buffers. Replace the success branch:
```ts
    const file = parseGcode(e.data.text);
    const elapsedMs = performance.now() - t0;
    const resp: ParserResponse = { type: "parsed", file, elapsedMs };
    (self as unknown as Worker).postMessage(resp);
```
with:
```ts
    const file = parseGcode(e.data.text);
    const elapsedMs = performance.now() - t0;
    const resp: ParserResponse = { type: "parsed", file, elapsedMs };
    // Transfer every block's geometry buffers zero-copy (they're distinct
    // ArrayBuffers — slice() in the builders makes tight, unshared copies).
    const transfer: Transferable[] = [];
    for (const job of file.jobs) {
      for (const layer of job.layers) {
        for (const block of layer.blocks) {
          const g = block.geometry;
          transfer.push(g.x.buffer, g.y.buffer, g.s.buffer, g.rapid.buffer);
        }
      }
    }
    (self as unknown as Worker).postMessage(resp, transfer);
```

- [ ] **Step 5: Update `web/src/components/gcode/GcodeCanvas.tsx`** — typed iteration + decimation.

(a) Add the import (top of file):
```ts
import { decimateIndices } from "../../lib/gcode/decimate";
```
and a threshold constant near `POWER_BANDS`:
```ts
/** Collapse vertices closer than this (CSS px, screen space) to the last drawn
 *  vertex — sub-pixel detail you can't see, removed for speed. */
const MIN_DRAW_PX = 0.5;
```

(b) Replace the base-render build block — i.e. the whole `if (items.length > 0) { … }` body that builds travels + buckets + cleanup (the section from `if (showTravels) { const travels = new Path2D(); … }` through the cleanup stroke) — with a single decimated pass per block that routes each drawn segment:
```ts
    if (items.length > 0) {
      const travels = new Path2D();
      const buckets: Path2D[] = Array.from({ length: POWER_BANDS }, () => new Path2D());
      const cleanupPath = new Path2D();
      let cleanupSegCount = 0;

      for (const item of items) {
        const cleanup = isCleanup(item);
        const g = item.block.geometry;
        const keep = decimateIndices(g.x, g.y, g.count, t.scale, t.ox, t.oy, MIN_DRAW_PX);
        for (let k = 1; k < keep.length; k++) {
          const i = keep[k];
          const pI = keep[k - 1];
          const px = toX(g.x[pI]);
          const py = toY(g.y[pI]);
          const cx = toX(g.x[i]);
          const cy = toY(g.y[i]);
          if (g.rapid[i] === 1 || g.s[i] === 0) {
            if (showTravels) {
              travels.moveTo(px, py);
              travels.lineTo(cx, cy);
            }
            continue;
          }
          if (cleanup) {
            cleanupPath.moveTo(px, py);
            cleanupPath.lineTo(cx, cy);
            cleanupSegCount++;
          } else {
            let b = Math.floor((g.s[i] / 1000) * POWER_BANDS);
            if (b < 0) b = 0;
            if (b >= POWER_BANDS) b = POWER_BANDS - 1;
            buckets[b].moveTo(px, py);
            buckets[b].lineTo(cx, cy);
          }
        }
      }

      // Travels first (under), then the power ramp, then cleanup on top.
      if (showTravels) {
        ctx.strokeStyle = "rgba(150,150,150,0.30)";
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 4]);
        ctx.stroke(travels);
        ctx.setLineDash([]);
      }
      ctx.lineWidth = 1;
      for (let b = 0; b < POWER_BANDS; b++) {
        const t2 = (b + 0.5) / POWER_BANDS;
        const r = Math.round(t2 * 255);
        const gg = Math.round(t2 * 80);
        const bl = Math.round(t2 * 16);
        ctx.strokeStyle = `rgb(${r}, ${gg}, ${bl})`;
        ctx.stroke(buckets[b]);
      }
      if (cleanupSegCount > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = 1.2;
        ctx.stroke(cleanupPath);
        ctx.lineWidth = 1;
      }
    }
```
(This preserves the visual layering — travels under, ramp, cleanup on top — while iterating each block's decimated vertices once. Note the bucket green var is renamed `gg` to avoid clashing with `g` = geometry.)

(c) Replace the highlight pass's segment loop (the `const segs = highlight.segments; for (…) { path.moveTo/lineTo }`) with a decimated typed version:
```ts
    const path = new Path2D();
    const g = highlight.geometry;
    const keep = decimateIndices(g.x, g.y, g.count, t.scale, t.ox, t.oy, MIN_DRAW_PX);
    for (let k = 1; k < keep.length; k++) {
      const i = keep[k];
      const pI = keep[k - 1];
      path.moveTo(toX(g.x[pI]), toY(g.y[pI]));
      path.lineTo(toX(g.x[i]), toY(g.y[i]));
    }
```
(`highlight: Block | null` — `highlight.geometry`. The cyan-glow + white-stroke painting after this stays unchanged.)

- [ ] **Step 6: Update `web/src/pages/GcodeViewerPage.tsx`**

(a) Replace `layerPeakPower`:
```ts
function layerPeakPower(layer: Layer): number | null {
  let max = 0;
  for (const block of layer.blocks) {
    if (block.peakS > max) max = block.peakS;
  }
  return max > 0 ? max : null;
}
```

(b) The params "SEGS" row for a single block — change `singleBlock.segments.length` to `singleBlock.geometry.count`:
```ts
                        ["SEGS", singleBlock.geometry.count.toLocaleString(), "ok"],
```
(The "all blocks" SEGS row already uses `currentLayer.totalSegments` — unchanged.)

- [ ] **Step 7: Typecheck, test, build**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass (incl. the updated `parser.test.ts` + the real-file test). Confirm no stale refs: `grep -rn "\.segments\b\|: Segment\b\|Segment\[\]" web/src/lib/gcode web/src/components/gcode web/src/pages/GcodeViewerPage.tsx` → only `totalSegments`/`geometry`/comments remain (no `block.segments`, no `Segment` type).
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/gcode/types.ts web/src/lib/gcode/parser.ts web/src/lib/gcode/parser.test.ts \
        web/src/lib/gcode/parser.worker.ts web/src/components/gcode/GcodeCanvas.tsx web/src/pages/GcodeViewerPage.tsx
git commit -m "perf(gcode): columnar typed-array geometry + zero-copy transfer + render decimation"
```

---

## Task 3: Changelog + browser verification

**Files:** Create `changelog/2026-06-21-gcode-viewer-perf.md`.

- [ ] **Step 1: Write the changelog** — create `changelog/2026-06-21-gcode-viewer-perf.md`:
```markdown
---
id: 2026-06-21-gcode-viewer-perf
date: 2026-06-21
level: minor
title: Gcode Viewer — handles large files
summary: Big Studio .gc exports (tens of MB / millions of segments) now open fast and stay smooth — segments are stored as typed arrays and transferred zero-copy from the parser worker, the layer list no longer rescans every segment, and the canvas decimates sub-pixel detail.
---
```

- [ ] **Step 2: Full suites**

Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean; all pass.

- [ ] **Step 3: Browser golden path**

Restart/refresh the dev server, open `http://127.0.0.1:8017/#/gcode`, and open the real file `~/Documents/XTools/demo-files/GCode/F2 Ultra-2026-06-21 17-57-58.gc` (47 MB). Verify:
- It opens in a few seconds (not tens), and the tab doesn't balloon to ~1 GB — check DevTools Memory (expect tens of MB for the geometry, not ~900 MB).
- The layer list, block slider, "show travels" toggle, and window resize are all smooth (no multi-second stalls — the `layerPeakPower` rescan is gone).
- The render looks correct: warm power ramp, dashed grey travels, white cleanup highlight, bbox + scale-bar chrome. Selecting a block highlights it.
- Compare a small file (e.g. `samples/xcode/sampleEng.gc`) renders identically to before (decimation is invisible at normal zoom). Screenshot and review critically.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-21-gcode-viewer-perf.md
git commit -m "docs(gcode): changelog for large-file viewer performance"
```

---

## Execution notes

- Branch: `feat/gcode-viewer-perf` (off `main`). Push + draft PR when done; ready when CI is green.
- The `Block.segments → geometry` rename is the cross-cutting boundary, so Task 2 touches 6 files as one tsc-green unit; `LayerPanel.tsx` is intentionally untouched (it reads only precomputed block fields).
- Scope is the ~50 MB target; 200 MB+ files (the 214 MB `samples/xcode` ones) load but aren't optimized here.
- Don't change the offscreen-cache / 16-bucket batching / highlight-overlay structure of `GcodeCanvas` beyond the typed-iteration + decimation edits.
```
