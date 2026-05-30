# Gcode Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new workbench page (`#/gcode`) that lets the user drop an xTool Studio `.gc` export into the browser, parses it client-side, and renders the geometry per logical layer with a slider, blockConfig param box, and auto-fit cropping — so we can forensically inspect what Studio actually emitted without uploading 33 MB files to the server.

**Architecture:** Pure frontend. A Web Worker parses the gcode text into a typed `GcodeFile` structure; the page renders one selected layer onto an HTML5 canvas, with a slider scrubbing through logical layers (groups of consecutive blocks that share the same `# blockConfig=` JSON). One job in the sample, but the data model supports N jobs to absorb future Studio output without rework.

**Tech Stack:** TypeScript, React, Vite (Web Worker via `?worker` import), HTML5 Canvas 2D, vitest. No new npm dependencies.

---

## Format reminder — what the parser is consuming

A `.gc` file looks like this (from `samples/xcode/sampleEng.gc`):

```
# date=2026_05_18_12_46_40
# version=1.6.8
# gc={"size":{"w":220,"h":220}}
# gc={"offset":{"x":0,"y":0}}
# gc={"start":{"x":0,"y":0.0000}}
G90
G0 F3000
...
# GS004-4 HEAD                                ← outer job
# GS004-4 BITMAP HEAD                         ← one block (scan-strip)
# motion_start
G4P1
G22
G0H500
G0Q60
# blockConfig={"powerFactor":0.64,...}        ← params for this block
G1F90000S0
G0X116.647Y37.405                             ← rapid (G0)
G1X118.297S640                                ← linear at power 640
G1Y37.455S0                                   ← rapid via S=0
...
# motion_end
# GS004-4 BITMAP TAIL
# GS004-4 VECTOR HEAD                         ← another block — vector this time
# motion_start
...
# blockConfig={"powerFactor":0.9,"isVector":true,"crossDot":false}
G0X117.040Y59.696
G1X117.040Y106.439S900F144000
# motion_end
# GS004-4 VECTOR TAIL
... 360 more blocks ...
# GS004-4 TAIL
# END
```

Confirmed empirically on the sample:
- **Y axis** in the gcode is screen-down (Y=37 is near the top of the bed, Y=106 is below it). The canvas2D default is also Y-down, so **do not flip**.
- **S** ("laser power") runs 0–1000. `S=0` on a G1 is effectively a non-burn travel; treat it like a G0 rapid for rendering.
- **`X` and `Y` are modal** — a `G1X118.297S640` with no `Y` keeps the previous Y. Same for S.
- Codes other than `G0`/`G1` (`G4P1`, `G22`, `G90`, `G0H500`, `G0Q60`, `M523P40`, `M9064 B3`, `M4 S0`, `M9039 C3`, `G198 P78 …`, `G104 P2`, `G0Z0/Z1`) carry no X/Y so they're safely ignored for a 2D path view. They're only present outside or at the start of motion blocks.
- **Block boundary** = `# motion_start` … `# motion_end`. Each motion block contains exactly one `# blockConfig=` line.
- **Logical layer** = a maximal run of consecutive blocks whose `blockConfig` JSON is byte-identical. The sample's 363 blocks collapse to 4 logical layers (one circle bitmap, one vector line, then two large groups of dog-engraving blocks at different powers).

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `web/src/lib/gcode/types.ts` | Shared types: `GcodeFile`, `Job`, `Layer`, `Block`, `Segment`, `BBox`, `BlockConfig` |
| `web/src/lib/gcode/parser.ts` | Pure parser: `parseGcode(text: string): GcodeFile`. No DOM, no Worker — directly unit-testable. |
| `web/src/lib/gcode/parser.test.ts` | vitest unit + integration tests (small inline fixtures + one pass over the real `sampleEng.gc`) |
| `web/src/lib/gcode/parser.worker.ts` | Tiny Web Worker shell that calls `parseGcode` and posts the result back. ~15 lines. |
| `web/src/components/gcode/GcodeCanvas.tsx` | Stateless canvas renderer: takes a `Layer` + viewport size, draws segments scaled to the layer's bbox. |
| `web/src/pages/GcodeViewerPage.tsx` | The page itself: file picker, worker invocation, layout, job select, layer slider, params box. Everything else inline. |

### Modified files

| Path | Change |
|---|---|
| `web/src/router.ts` | Add `\| { name: "gcode" }` to the `Route` union; one `if (h === "gcode")` line in `parseRoute`; `"#/gcode"` arm in `formatRoute`. |
| `web/src/App.tsx` | `const GcodeViewerPage = lazy(...)` import; route arm in the title ternary; route arm in the `<Suspense>` block. |
| `web/src/components/TopBar.tsx` | Add a "Gcode" nav entry near the existing nav items. |

### Not creating

- A separate `LayerList.tsx`/`LayerSlider.tsx`/`ParamsBox.tsx`/`JobList.tsx`. The page is small enough that splitting it across five components is premature decomposition. Inline as JSX in `GcodeViewerPage.tsx`; extract later if any block sprouts non-trivial logic.

---

## Data model (locked here so all tasks reference the same shapes)

```ts
// web/src/lib/gcode/types.ts

export interface BBox {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

export interface BlockConfig {
  /** Raw JSON string — what Studio actually wrote. Use this as the
   * grouping key for logical layers (byte-identity grouping). */
  raw: string;
  /** Parsed JSON (best-effort). Shape varies between bitmap and
   * vector blocks, so it's `unknown`. The viewer renders this verbatim. */
  parsed: unknown;
}

export interface Segment {
  /** End-point of this move, in gcode mm. */
  x: number;
  y: number;
  /** Laser power 0–1000. 0 means "travel / non-burn". */
  s: number;
  /** True if the originating command was G0 (rapid). */
  rapid: boolean;
}

export interface Block {
  /** Line number in the source file where this block starts
   * (motion_start line). Useful for surfacing forensic detail. */
  startLine: number;
  config: BlockConfig;
  segments: Segment[];
  bbox: BBox;
}

export interface Layer {
  /** Index within the parent job. */
  index: number;
  /** Identical to every block's config in this layer (that's how
   * we grouped them). */
  config: BlockConfig;
  blocks: Block[];
  bbox: BBox;
  /** Sum of segment counts across all blocks — surfaced in the
   * layer list so the user can spot suspiciously large/small layers. */
  totalSegments: number;
}

export interface Job {
  /** GS004-4 or whatever the HEAD/TAIL token was. */
  name: string;
  layers: Layer[];
  bbox: BBox;
}

export interface GcodeFile {
  canvas: { w: number; h: number };
  offset: { x: number; y: number };
  jobs: Job[];
  /** Diagnostic — number of lines we couldn't classify. Should be
   * "small" (file-header preamble + xTool M-codes). Surface in the
   * UI so a parser regression is visible. */
  unknownLineCount: number;
  /** Total lines in the source — used by the page to show a loading
   * progress hint and to sanity-check that we parsed everything. */
  totalLines: number;
}
```

---

## Task 1: Scaffold types + empty parser

**Files:**
- Create: `web/src/lib/gcode/types.ts`
- Create: `web/src/lib/gcode/parser.ts`
- Create: `web/src/lib/gcode/parser.test.ts`

- [ ] **Step 1: Create the types file**

Write `web/src/lib/gcode/types.ts` with the exact contents from the "Data model" section above.

- [ ] **Step 2: Create the parser skeleton**

Write `web/src/lib/gcode/parser.ts`:

```ts
import type { GcodeFile } from "./types";

/**
 * Parse an xTool Studio gcode export into a structured `GcodeFile`.
 * Pure function — no DOM, no I/O. Safe to run inside a Web Worker.
 *
 * The input is the full text body of a `.gc` file. We line-scan
 * with a small state machine: outside motion → inside motion →
 * collecting blockConfig + segments.
 */
export function parseGcode(text: string): GcodeFile {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Write the first failing test**

Write `web/src/lib/gcode/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGcode } from "./parser";

describe("parseGcode", () => {
  it("returns an empty file for an empty input", () => {
    const result = parseGcode("");
    expect(result.jobs).toEqual([]);
    expect(result.canvas).toEqual({ w: 0, h: 0 });
    expect(result.offset).toEqual({ x: 0, y: 0 });
    expect(result.totalLines).toBe(0);
    expect(result.unknownLineCount).toBe(0);
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run:
```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 1 failed — `Error: not implemented`.

- [ ] **Step 5: Implement the empty-input case**

Replace `parser.ts` body:

```ts
import type { GcodeFile } from "./types";

export function parseGcode(text: string): GcodeFile {
  const lines = text === "" ? [] : text.split("\n");
  return {
    canvas: { w: 0, h: 0 },
    offset: { x: 0, y: 0 },
    jobs: [],
    unknownLineCount: 0,
    totalLines: lines.length,
  };
}
```

- [ ] **Step 6: Run the test, confirm it passes**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/gcode/types.ts web/src/lib/gcode/parser.ts web/src/lib/gcode/parser.test.ts
git commit -m "feat(gcode): scaffold gcode parser types + empty-input test"
```

---

## Task 2: Parse file-level header (`# gc={...}`)

**Files:**
- Modify: `web/src/lib/gcode/parser.ts`
- Modify: `web/src/lib/gcode/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `parser.test.ts`:

```ts
it("parses the canvas size and offset from # gc= header lines", () => {
  const text = [
    "# date=2026_05_18_12_46_40",
    "# version=1.6.8",
    `# gc={"size":{"w":220,"h":220}}`,
    `# gc={"offset":{"x":1,"y":2}}`,
    `# gc={"start":{"x":0,"y":0.0000}}`,
    `# gc={"keys":["x","y"],"rm":1,"is3DMode":false}`,
  ].join("\n");
  const result = parseGcode(text);
  expect(result.canvas).toEqual({ w: 220, h: 220 });
  expect(result.offset).toEqual({ x: 1, y: 2 });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 1 fail (canvas still `{w:0,h:0}`).

- [ ] **Step 3: Implement header parsing**

Replace `parser.ts`:

```ts
import type { GcodeFile } from "./types";

const GC_HEADER_RE = /^# gc=(\{.*\})\s*$/;

export function parseGcode(text: string): GcodeFile {
  const lines = text === "" ? [] : text.split("\n");
  const out: GcodeFile = {
    canvas: { w: 0, h: 0 },
    offset: { x: 0, y: 0 },
    jobs: [],
    unknownLineCount: 0,
    totalLines: lines.length,
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;

    if (line.startsWith("#")) {
      const m = line.match(GC_HEADER_RE);
      if (m) {
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(m[1]);
        } catch {
          continue;
        }
        if (obj && typeof obj === "object") {
          const size = (obj as { size?: { w?: number; h?: number } }).size;
          if (size && typeof size.w === "number" && typeof size.h === "number") {
            out.canvas = { w: size.w, h: size.h };
          }
          const off = (obj as { offset?: { x?: number; y?: number } }).offset;
          if (off && typeof off.x === "number" && typeof off.y === "number") {
            out.offset = { x: off.x, y: off.y };
          }
        }
      }
      continue;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/gcode/parser.ts web/src/lib/gcode/parser.test.ts
git commit -m "feat(gcode): parse canvas size + offset from # gc= header"
```

---

## Task 3: Track job + block boundaries

**Files:**
- Modify: `web/src/lib/gcode/parser.ts`
- Modify: `web/src/lib/gcode/parser.test.ts`

We use the outer `GS004-X HEAD` / `GS004-X TAIL` pair as the job boundary, and `# motion_start` / `# motion_end` as the block boundary. Inside-block `BITMAP HEAD`/`BITMAP TAIL` and `VECTOR HEAD`/`VECTOR TAIL` are *not* boundaries we care about — the motion-start/end pair always falls inside one of them, and `blockConfig` is the source of truth for "what kind of block this was".

- [ ] **Step 1: Write the failing test**

Append:

```ts
it("identifies one job with two empty blocks (motion_start/motion_end pairs)", () => {
  const text = [
    "# GS004-4 HEAD",
    "# GS004-4 BITMAP HEAD",
    "# motion_start",
    "# motion_end",
    "# GS004-4 BITMAP TAIL",
    "# GS004-4 VECTOR HEAD",
    "# motion_start",
    "# motion_end",
    "# GS004-4 VECTOR TAIL",
    "# GS004-4 TAIL",
    "# END",
  ].join("\n");
  const result = parseGcode(text);
  expect(result.jobs).toHaveLength(1);
  expect(result.jobs[0].name).toBe("GS004-4");
  // Two blocks were opened, but each has no blockConfig and no
  // segments — so they collapse into zero layers (groups only form
  // around blocks with config and at least one move).
  expect(result.jobs[0].layers).toHaveLength(0);
});
```

- [ ] **Step 2: Confirm fail**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 1 fail (jobs empty).

- [ ] **Step 3: Implement job + block state machine**

Replace `parser.ts`:

```ts
import type {
  BBox,
  Block,
  BlockConfig,
  GcodeFile,
  Job,
  Layer,
  Segment,
} from "./types";

const GC_HEADER_RE = /^# gc=(\{.*\})\s*$/;
const JOB_HEAD_RE = /^# (\S+) HEAD$/;
const JOB_TAIL_RE = /^# (\S+) TAIL$/;

function emptyBbox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function isInnerHeadTail(token: string): boolean {
  // Inner section markers — not the outer GS job. e.g. "GS004-4 BITMAP".
  return token.includes(" ");
}

function finalizeBlock(
  block: { startLine: number; configRaw: string | null; segments: Segment[]; bbox: BBox },
): Block | null {
  if (block.configRaw === null) return null;
  if (block.segments.length === 0) return null;
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
    segments: block.segments,
    bbox: block.bbox,
  };
}

function pushBlockToJob(job: Job, block: Block): void {
  // Group consecutive blocks with identical config.raw into a Layer.
  const last = job.layers[job.layers.length - 1];
  if (last && last.config.raw === block.config.raw) {
    last.blocks.push(block);
    last.totalSegments += block.segments.length;
    last.bbox = mergeBbox(last.bbox, block.bbox);
  } else {
    job.layers.push({
      index: job.layers.length,
      config: block.config,
      blocks: [block],
      bbox: { ...block.bbox },
      totalSegments: block.segments.length,
    });
  }
  job.bbox = mergeBbox(job.bbox, block.bbox);
}

function mergeBbox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function parseGcode(text: string): GcodeFile {
  const lines = text === "" ? [] : text.split("\n");
  const out: GcodeFile = {
    canvas: { w: 0, h: 0 },
    offset: { x: 0, y: 0 },
    jobs: [],
    unknownLineCount: 0,
    totalLines: lines.length,
  };

  let currentJob: Job | null = null;
  let pendingBlock: {
    startLine: number;
    configRaw: string | null;
    segments: Segment[];
    bbox: BBox;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    if (line.startsWith("#")) {
      // ── File header ─────────────────────────────────────────────
      const gcMatch = line.match(GC_HEADER_RE);
      if (gcMatch) {
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(gcMatch[1]);
        } catch {
          continue;
        }
        const size = (obj as { size?: { w?: number; h?: number } }).size;
        if (size && typeof size.w === "number" && typeof size.h === "number") {
          out.canvas = { w: size.w, h: size.h };
        }
        const off = (obj as { offset?: { x?: number; y?: number } }).offset;
        if (off && typeof off.x === "number" && typeof off.y === "number") {
          out.offset = { x: off.x, y: off.y };
        }
        continue;
      }

      // ── Job + block boundaries ──────────────────────────────────
      const headMatch = line.match(JOB_HEAD_RE);
      if (headMatch && !isInnerHeadTail(headMatch[1])) {
        currentJob = { name: headMatch[1], layers: [], bbox: emptyBbox() };
        out.jobs.push(currentJob);
        continue;
      }
      const tailMatch = line.match(JOB_TAIL_RE);
      if (tailMatch && !isInnerHeadTail(tailMatch[1])) {
        currentJob = null;
        continue;
      }
      if (line === "# motion_start") {
        pendingBlock = {
          startLine: i + 1, // 1-indexed for human-friendly source refs
          configRaw: null,
          segments: [],
          bbox: emptyBbox(),
        };
        continue;
      }
      if (line === "# motion_end") {
        if (pendingBlock && currentJob) {
          const finalized = finalizeBlock(pendingBlock);
          if (finalized) pushBlockToJob(currentJob, finalized);
        }
        pendingBlock = null;
        continue;
      }
      if (line.startsWith("# blockConfig=") && pendingBlock) {
        pendingBlock.configRaw = line.slice("# blockConfig=".length).trim();
        continue;
      }
      // Other `#` comments (motion section markers, MUST, END, etc.)
      // carry no payload — skip silently.
      continue;
    }

    // ── G-code (non-comment) ─────────────────────────────────────
    // Task 4 wires this up; for now just count unknowns to keep the
    // metric meaningful.
    out.unknownLineCount++;
  }

  return out;
}
```

- [ ] **Step 4: Confirm test passes**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/gcode/parser.ts web/src/lib/gcode/parser.test.ts
git commit -m "feat(gcode): track job + block boundaries from HEAD/TAIL + motion markers"
```

---

## Task 4: Parse G0/G1 segments (X, Y, S — modal)

**Files:**
- Modify: `web/src/lib/gcode/parser.ts`
- Modify: `web/src/lib/gcode/parser.test.ts`

Studio emits both X-only and Y-only lines (modal), so we have to carry forward the last seen X, Y, and S between G1 lines within a block. The starting point of a block comes from a G0 with both X and Y.

- [ ] **Step 1: Write the failing test**

Append:

```ts
it("extracts G0/G1 segments with modal X/Y/S; computes bbox; groups into one layer", () => {
  const text = [
    "# GS004-4 HEAD",
    "# GS004-4 BITMAP HEAD",
    "# motion_start",
    `# blockConfig={"powerFactor":0.9,"power":[0,900],"isVector":false}`,
    "G1F90000S0",
    "G0X10Y20",        // rapid to (10, 20)
    "G1X15S900",       // burn to (15, 20) at S=900
    "G1Y25",           // burn to (15, 25) — S still 900
    "G1X12S0",         // travel (S=0) to (12, 25)
    "# motion_end",
    "# GS004-4 BITMAP TAIL",
    "# GS004-4 TAIL",
  ].join("\n");
  const result = parseGcode(text);
  expect(result.jobs).toHaveLength(1);
  const job = result.jobs[0];
  expect(job.layers).toHaveLength(1);
  const layer = job.layers[0];
  expect(layer.blocks).toHaveLength(1);
  const block = layer.blocks[0];
  expect(block.segments).toEqual([
    { x: 10, y: 20, s: 0,   rapid: true  },
    { x: 15, y: 20, s: 900, rapid: false },
    { x: 15, y: 25, s: 900, rapid: false },
    { x: 12, y: 25, s: 0,   rapid: false },
  ]);
  expect(block.bbox).toEqual({ minX: 10, minY: 20, maxX: 15, maxY: 25 });
  expect(layer.totalSegments).toBe(4);
  expect(job.bbox).toEqual({ minX: 10, minY: 20, maxX: 15, maxY: 25 });
});
```

- [ ] **Step 2: Confirm fail**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 1 fail.

- [ ] **Step 3: Implement G0/G1 line parsing**

Add this helper at the top of `parser.ts` (after the existing constants):

```ts
const COORD_TOKEN_RE = /([XYSF])(-?\d+(?:\.\d+)?)/g;
```

In the main `parseGcode` loop, replace the `// ── G-code (non-comment) ──` block:

```ts
    // ── G-code (non-comment) ─────────────────────────────────────
    if (!pendingBlock) {
      // Movement outside an open block is bookkeeping (machine
      // setup before the first motion section). Ignore for the 2D
      // view; do not count as unknown.
      continue;
    }
    const isG0 = line.startsWith("G0") && (line.length === 2 || !/[0-9]/.test(line[2]));
    const isG1 = line.startsWith("G1") && (line.length === 2 || !/[0-9]/.test(line[2]));
    if (!isG0 && !isG1) {
      // Other G-codes inside the block (G4, G22, etc.) carry no
      // X/Y — leave the modal state alone.
      continue;
    }

    // Modal state survives across lines within a block. Initialise
    // lazily on the first time we see this block.
    const lastSegment = pendingBlock.segments[pendingBlock.segments.length - 1];
    let curX = lastSegment ? lastSegment.x : NaN;
    let curY = lastSegment ? lastSegment.y : NaN;
    let curS = lastSegment ? lastSegment.s : 0;
    let sawXY = false;

    COORD_TOKEN_RE.lastIndex = 0;
    let tok: RegExpExecArray | null;
    while ((tok = COORD_TOKEN_RE.exec(line)) !== null) {
      const v = parseFloat(tok[2]);
      switch (tok[1]) {
        case "X":
          curX = v;
          sawXY = true;
          break;
        case "Y":
          curY = v;
          sawXY = true;
          break;
        case "S":
          curS = v;
          break;
        case "F":
          // Feed rate — no effect on geometry.
          break;
      }
    }

    if (!sawXY && lastSegment == null) {
      // A G1 that only sets S/F before the first XY — skip.
      continue;
    }
    if (Number.isNaN(curX) || Number.isNaN(curY)) {
      // No position established yet — skip until a G0 with X+Y arrives.
      continue;
    }

    pendingBlock.segments.push({ x: curX, y: curY, s: curS, rapid: isG0 });
    pendingBlock.bbox = {
      minX: Math.min(pendingBlock.bbox.minX, curX),
      minY: Math.min(pendingBlock.bbox.minY, curY),
      maxX: Math.max(pendingBlock.bbox.maxX, curX),
      maxY: Math.max(pendingBlock.bbox.maxY, curY),
    };
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/gcode/parser.ts web/src/lib/gcode/parser.test.ts
git commit -m "feat(gcode): parse G0/G1 segments with modal X/Y/S; compute bbox"
```

---

## Task 5: Logical-layer grouping across multiple blocks

**Files:**
- Modify: `web/src/lib/gcode/parser.test.ts`

The grouping logic was already implemented in Task 3 (`pushBlockToJob`). This task adds the test that pins the contract — particularly that **non-consecutive** runs of the same config form **separate layers**, not one merged layer. (This is important forensically: if Studio interleaves two configs, the user wants to see that, not have us paper over it.)

- [ ] **Step 1: Write the failing test**

Append:

```ts
it("groups consecutive same-config blocks but splits across config changes", () => {
  const cfgA = `{"powerFactor":0.9,"power":[0,900],"isVector":false}`;
  const cfgB = `{"powerFactor":1,"power":[0,1000],"isVector":false}`;
  const makeBlock = (cfg: string, x: number) => [
    "# GS004-4 BITMAP HEAD",
    "# motion_start",
    `# blockConfig=${cfg}`,
    `G0X${x}Y0`,
    `G1X${x + 1}S900`,
    "# motion_end",
    "# GS004-4 BITMAP TAIL",
  ].join("\n");

  const text = [
    "# GS004-4 HEAD",
    makeBlock(cfgA, 0),
    makeBlock(cfgA, 5),     // same config as previous → same layer
    makeBlock(cfgB, 10),    // config change → new layer
    makeBlock(cfgA, 15),    // config-A again, but not contiguous → separate layer
    "# GS004-4 TAIL",
  ].join("\n");

  const result = parseGcode(text);
  expect(result.jobs).toHaveLength(1);
  const layers = result.jobs[0].layers;
  expect(layers.map(l => l.config.raw)).toEqual([cfgA, cfgB, cfgA]);
  expect(layers.map(l => l.blocks.length)).toEqual([2, 1, 1]);
  expect(layers.map(l => l.index)).toEqual([0, 1, 2]);
});
```

- [ ] **Step 2: Confirm pass**

This should already pass — the test pins existing behaviour.

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 5 passed.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/gcode/parser.test.ts
git commit -m "test(gcode): pin layer-grouping contract — split on non-contiguous configs"
```

---

## Task 6: Integration test against the real sample

**Files:**
- Modify: `web/src/lib/gcode/parser.test.ts`

We want one test that loads `samples/xcode/sampleEng.gc` and validates the aggregate shape. This is the single source of truth that the parser doesn't regress against real Studio output.

- [ ] **Step 1: Write the failing-then-passing test**

Append:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("parses the real sampleEng.gc end-to-end", () => {
  const path = resolve(__dirname, "../../../../samples/xcode/sampleEng.gc");
  const text = readFileSync(path, "utf-8");
  const result = parseGcode(text);

  expect(result.canvas).toEqual({ w: 220, h: 220 });
  expect(result.offset).toEqual({ x: 0, y: 0 });
  expect(result.jobs).toHaveLength(1);

  const job = result.jobs[0];
  expect(job.name).toBe("GS004-4");

  // The sample has 4 distinct `blockConfig` JSON strings (one
  // tiny bitmap circle, one vector line, plus two large bitmap
  // groups for the dog at different powers). Logical layers can
  // be MORE than 4 if the bitmap configs interleave — pin the
  // count here for whichever number the parser actually finds,
  // but assert the structural invariants:
  expect(job.layers.length).toBeGreaterThanOrEqual(4);

  // Every layer's config.raw is unique compared to the layer
  // immediately before it.
  for (let i = 1; i < job.layers.length; i++) {
    expect(job.layers[i].config.raw).not.toBe(job.layers[i - 1].config.raw);
  }

  // Sum of blocks across all layers equals the count of
  // `# blockConfig=` lines in the file (363 at last count — but
  // we don't hard-code so future Studio versions don't break us).
  const totalBlocks = job.layers.reduce((n, l) => n + l.blocks.length, 0);
  const blockConfigLines = text
    .split("\n")
    .filter(l => l.startsWith("# blockConfig=")).length;
  expect(totalBlocks).toBe(blockConfigLines);

  // The vector line block — there's exactly one `isVector: true`
  // config — has exactly 1 burn segment (the line itself).
  const vectorLayer = job.layers.find(l => {
    const p = l.config.parsed as { isVector?: boolean } | null;
    return p?.isVector === true;
  });
  expect(vectorLayer).toBeDefined();
  expect(vectorLayer!.blocks).toHaveLength(1);
  const burnSegs = vectorLayer!.blocks[0].segments.filter(s => !s.rapid && s.s > 0);
  expect(burnSegs).toHaveLength(1);
  // The burn ends at the documented end point (117.040, 106.439).
  expect(burnSegs[0].x).toBeCloseTo(117.040, 3);
  expect(burnSegs[0].y).toBeCloseTo(106.439, 3);

  // Job bbox lives inside the 220×220 canvas.
  expect(job.bbox.minX).toBeGreaterThanOrEqual(0);
  expect(job.bbox.minY).toBeGreaterThanOrEqual(0);
  expect(job.bbox.maxX).toBeLessThanOrEqual(220);
  expect(job.bbox.maxY).toBeLessThanOrEqual(220);
}, 30_000); // 33 MB parse + assertions — generous timeout
```

- [ ] **Step 2: Run the test**

```bash
cd web && npx vitest run src/lib/gcode/parser.test.ts
```
Expected: 6 passed. If any assertion fails, treat that as a parser bug and fix in this task before committing.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/gcode/parser.test.ts
git commit -m "test(gcode): integration parse of real sampleEng.gc"
```

---

## Task 7: Web Worker shell

**Files:**
- Create: `web/src/lib/gcode/parser.worker.ts`

The page will instantiate this worker via Vite's `?worker` import (works out of the box in Vite — no config). Posting the full 33 MB text through `postMessage` is the simple path; the structured-clone hit is ~1 second on a fast laptop, which is acceptable for a forensic tool. Optimise to `Transferable` `ArrayBuffer` later if it bites.

- [ ] **Step 1: Create the worker file**

Write `web/src/lib/gcode/parser.worker.ts`:

```ts
import { parseGcode } from "./parser";
import type { GcodeFile } from "./types";

export interface ParserRequest {
  type: "parse";
  /** The full text body of the .gc file. */
  text: string;
}

export type ParserResponse =
  | { type: "parsed"; file: GcodeFile; elapsedMs: number }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<ParserRequest>) => {
  if (e.data.type !== "parse") return;
  const t0 = performance.now();
  try {
    const file = parseGcode(e.data.text);
    const elapsedMs = performance.now() - t0;
    const resp: ParserResponse = { type: "parsed", file, elapsedMs };
    (self as unknown as Worker).postMessage(resp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const resp: ParserResponse = { type: "error", message };
    (self as unknown as Worker).postMessage(resp);
  }
};
```

- [ ] **Step 2: Typecheck**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/gcode/parser.worker.ts
git commit -m "feat(gcode): web-worker shell wrapping parseGcode"
```

---

## Task 8: Route + lazy page wiring + nav entry

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`
- Create: `web/src/pages/GcodeViewerPage.tsx` (stub only — real page in Task 10)

We wire the route first so the rest of the work has a place to render. The page renders "Gcode viewer (coming up)" until Task 10.

- [ ] **Step 1: Add the route to the Route union**

In `web/src/router.ts`, find the `Route` type union and add `\| { name: "gcode" }` after `\| { name: "changelog" }`. Then add a branch in `parseRoute`:

```ts
  if (h === "gcode") return { name: "gcode" };
```

…placed alongside the other single-token routes (next to the `changelog` line).

Then add a `formatRoute` arm:

```ts
    case "gcode":       return "#/gcode";
```

- [ ] **Step 2: Create the page stub**

Write `web/src/pages/GcodeViewerPage.tsx`:

```tsx
import { PageContainer, Section } from "../ui";

export function GcodeViewerPage() {
  return (
    <PageContainer>
      <Section title="Gcode viewer">
        <p className="text-[12px] text-[color:var(--color-foreground-muted)]">
          Drop a Studio-exported <code>.gc</code> file to inspect its
          layers. (Wired in Task 10.)
        </p>
      </Section>
    </PageContainer>
  );
}
```

- [ ] **Step 3: Lazy-load in App.tsx**

In `web/src/App.tsx`, after the existing `const ChangelogPage = lazy(...)` import group:

```tsx
const GcodeViewerPage = lazy(() =>
  import("./pages/GcodeViewerPage").then((m) => ({ default: m.GcodeViewerPage })),
);
```

Add the title arm in the title ternary (after the `changelog` arm):

```tsx
    : route.name === "gcode"      ? "Gcode"
```

Add the route arm in the Suspense block (after the `changelog` line):

```tsx
          {gate === "ready" && route.name === "gcode"        && <GcodeViewerPage />}
```

- [ ] **Step 4: Add the nav entry to TopBar**

In `web/src/components/TopBar.tsx`, locate the nav entry for "Guide" (`onNavigate({ name: "guide" })`). Insert a "Gcode" entry alongside it using the same nav-item pattern that exists in the file (the helper / component / `<button>` shape varies — use whatever the neighbouring entries already use; do **not** introduce a new style).

- [ ] **Step 5: Build + typecheck + visit the page**

```bash
cd web && npx tsc --noEmit && npm run build > /tmp/gcode-build.log 2>&1
```
Expected: no errors. (If `npm run build` is too verbose, redirect to a file as above.)

Then start the backend (see `CLAUDE.md` — `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`) and visit `http://127.0.0.1:8017/#/gcode`. Expected: the page header reads "Gcode" and the stub copy is visible.

- [ ] **Step 6: Commit**

```bash
git add web/src/router.ts web/src/App.tsx web/src/components/TopBar.tsx web/src/pages/GcodeViewerPage.tsx
git commit -m "feat(gcode): route + lazy page stub + nav entry"
```

---

## Task 9: GcodeCanvas renderer component

**Files:**
- Create: `web/src/components/gcode/GcodeCanvas.tsx`

Stateless renderer. Takes a single `Layer` + viewport size; draws all of that layer's segments scaled to the layer's bbox (auto-fit cropping — *per layer*, not per file, since that's what the user asked for). Burn segments (`s > 0` and `!rapid`) are coloured by power; travel segments (`rapid` or `s === 0`) are faint grey, toggleable.

- [ ] **Step 1: Create the component**

Write `web/src/components/gcode/GcodeCanvas.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { Layer } from "../../lib/gcode/types";

interface GcodeCanvasProps {
  layer: Layer | null;
  /** Render footprint in CSS pixels. Component upscales the
   * backing-store by devicePixelRatio for crisp lines. */
  width: number;
  height: number;
  /** Show faint grey lines for G0 rapids + S=0 G1 moves. */
  showTravels?: boolean;
}

export function GcodeCanvas({ layer, width, height, showTravels = true }: GcodeCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, height);

    if (!layer) return;
    const bbox = layer.bbox;
    const bw = bbox.maxX - bbox.minX;
    const bh = bbox.maxY - bbox.minY;
    if (bw <= 0 || bh <= 0) return;

    const pad = 12;
    const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
    const ox = pad + (width - pad * 2 - bw * scale) / 2 - bbox.minX * scale;
    const oy = pad + (height - pad * 2 - bh * scale) / 2 - bbox.minY * scale;

    const toX = (x: number) => x * scale + ox;
    const toY = (y: number) => y * scale + oy;

    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    // Draw travels first so burns sit on top.
    if (showTravels) {
      ctx.strokeStyle = "rgba(120,120,120,0.35)";
      ctx.setLineDash([2, 3]);
      for (const block of layer.blocks) {
        const segs = block.segments;
        for (let i = 1; i < segs.length; i++) {
          const s = segs[i];
          if (!(s.rapid || s.s === 0)) continue;
          const p = segs[i - 1];
          ctx.beginPath();
          ctx.moveTo(toX(p.x), toY(p.y));
          ctx.lineTo(toX(s.x), toY(s.y));
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // Burn segments — colour by power.
    for (const block of layer.blocks) {
      const segs = block.segments;
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i];
        if (s.rapid || s.s === 0) continue;
        const p = segs[i - 1];
        const intensity = Math.min(255, Math.round((s.s / 1000) * 255));
        ctx.strokeStyle = `rgb(${intensity}, ${Math.round(intensity * 0.4)}, ${Math.round(intensity * 0.2)})`;
        ctx.beginPath();
        ctx.moveTo(toX(p.x), toY(p.y));
        ctx.lineTo(toX(s.x), toY(s.y));
        ctx.stroke();
      }
    }
  }, [layer, width, height, showTravels]);

  return <canvas ref={ref} aria-label="Gcode layer preview" />;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/gcode/GcodeCanvas.tsx
git commit -m "feat(gcode): canvas renderer with auto-fit, travel toggle, power-coloured burns"
```

---

## Task 10: Page wiring — file picker, layout, slider, params box

**Files:**
- Modify: `web/src/pages/GcodeViewerPage.tsx`

- [ ] **Step 1: Implement the page**

Replace `web/src/pages/GcodeViewerPage.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, PageContainer, Section, Select } from "../ui";
import { GcodeCanvas } from "../components/gcode/GcodeCanvas";
import type { GcodeFile } from "../lib/gcode/types";
import type { ParserResponse } from "../lib/gcode/parser.worker";
import ParserWorker from "../lib/gcode/parser.worker?worker";

type State =
  | { kind: "idle" }
  | { kind: "loading"; fileName: string }
  | { kind: "ready"; fileName: string; file: GcodeFile; elapsedMs: number }
  | { kind: "error"; fileName: string; message: string };

export function GcodeViewerPage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [jobIdx, setJobIdx] = useState(0);
  const [layerIdx, setLayerIdx] = useState(0);
  const [showTravels, setShowTravels] = useState(true);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ w: 800, h: 600 });

  // Track the canvas host's size so the renderer fills the available area.
  useEffect(() => {
    const el = canvasHostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cr = entry.contentRect;
      setViewport({ w: Math.max(200, cr.width), h: Math.max(200, cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleFile = async (file: File) => {
    setState({ kind: "loading", fileName: file.name });
    setJobIdx(0);
    setLayerIdx(0);
    const text = await file.text();
    const worker = new ParserWorker();
    worker.onmessage = (e: MessageEvent<ParserResponse>) => {
      if (e.data.type === "parsed") {
        setState({ kind: "ready", fileName: file.name, file: e.data.file, elapsedMs: e.data.elapsedMs });
      } else {
        setState({ kind: "error", fileName: file.name, message: e.data.message });
      }
      worker.terminate();
    };
    worker.postMessage({ type: "parse", text });
  };

  const job = state.kind === "ready" ? state.file.jobs[jobIdx] : null;
  const layer = job ? job.layers[layerIdx] : null;

  const layerSummary = useMemo(() => {
    if (!job) return [];
    return job.layers.map((l) => {
      const p = l.config.parsed as Record<string, unknown> | null;
      const isVector = !!p && p["isVector"] === true;
      const power = p && Array.isArray((p as { power?: unknown }).power)
        ? ((p as { power: number[] }).power[1] ?? "?")
        : isVector ? "vec" : "?";
      const density = p ? ((p as { density?: number }).density ?? "—") : "—";
      return {
        index: l.index,
        kind: isVector ? "vector" : "bitmap",
        power,
        density,
        blockCount: l.blocks.length,
        segCount: l.totalSegments,
      };
    });
  }, [job]);

  return (
    <PageContainer>
      <Section title="Gcode viewer">
        <div className="flex items-center gap-3 mb-3">
          <Button asChild>
            <label className="cursor-pointer">
              Open .gc file…
              <input
                type="file"
                accept=".gc,.gcode,.nc,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
          {state.kind === "loading" && (
            <span className="text-[12px] font-mono">parsing {state.fileName}…</span>
          )}
          {state.kind === "ready" && (
            <span className="text-[12px] font-mono">
              {state.fileName} · {state.file.totalLines.toLocaleString()} lines
              {" · "}parsed in {Math.round(state.elapsedMs)} ms
            </span>
          )}
          {state.kind === "error" && (
            <span className="text-[12px] font-mono text-red-500">
              parser error: {state.message}
            </span>
          )}
        </div>

        {state.kind === "ready" && state.file.jobs.length === 0 && (
          <p className="text-[12px]">No jobs found in this file.</p>
        )}

        {state.kind === "ready" && state.file.jobs.length > 0 && (
          <>
            {state.file.jobs.length > 1 && (
              <div className="mb-3">
                <label className="text-[12px] font-mono mr-2">Job:</label>
                <Select
                  value={String(jobIdx)}
                  onChange={(e) => {
                    setJobIdx(Number(e.target.value));
                    setLayerIdx(0);
                  }}
                >
                  {state.file.jobs.map((j, i) => (
                    <option key={i} value={i}>{j.name}</option>
                  ))}
                </Select>
              </div>
            )}

            <div className="grid grid-cols-[200px_minmax(0,1fr)_280px] gap-3 min-h-[500px]">
              {/* Layer list */}
              <div className="border border-[color:var(--color-border)] rounded-[6px] p-2 overflow-auto text-[12px] font-mono">
                {layerSummary.map((l) => (
                  <button
                    key={l.index}
                    onClick={() => setLayerIdx(l.index)}
                    className={`w-full text-left py-1 px-2 rounded-[4px] ${
                      l.index === layerIdx ? "bg-[color:var(--color-accent)]/20" : "hover:bg-[color:var(--color-surface-2)]"
                    }`}
                  >
                    <div>#{l.index} · {l.kind} · S={l.power}</div>
                    <div className="opacity-60">
                      d={l.density} · {l.blockCount} blk · {l.segCount.toLocaleString()} seg
                    </div>
                  </button>
                ))}
              </div>

              {/* Canvas */}
              <div
                ref={canvasHostRef}
                className="border border-[color:var(--color-border)] rounded-[6px] overflow-hidden bg-black flex items-center justify-center"
              >
                <GcodeCanvas layer={layer} width={viewport.w} height={viewport.h} showTravels={showTravels} />
              </div>

              {/* Params box */}
              <div className="border border-[color:var(--color-border)] rounded-[6px] p-3 overflow-auto text-[11px] font-mono whitespace-pre-wrap">
                {layer ? (
                  <>
                    <div className="mb-2 opacity-70">
                      bbox: ({layer.bbox.minX.toFixed(2)}, {layer.bbox.minY.toFixed(2)}) → ({layer.bbox.maxX.toFixed(2)}, {layer.bbox.maxY.toFixed(2)})
                    </div>
                    <div className="mb-2 opacity-70">
                      blocks: {layer.blocks.length} · segments: {layer.totalSegments.toLocaleString()}
                    </div>
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(layer.config.raw), null, 2);
                      } catch {
                        return layer.config.raw;
                      }
                    })()}
                  </>
                ) : "(no layer)"}
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <span className="text-[12px] font-mono whitespace-nowrap">
                Layer {layerIdx + 1} / {job!.layers.length}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, job!.layers.length - 1)}
                value={layerIdx}
                onChange={(e) => setLayerIdx(Number(e.target.value))}
                className="flex-1"
                disabled={job!.layers.length <= 1}
              />
              <label className="text-[12px] font-mono whitespace-nowrap flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={showTravels}
                  onChange={(e) => setShowTravels(e.target.checked)}
                />
                travels
              </label>
            </div>
          </>
        )}
      </Section>
    </PageContainer>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd web && npx tsc --noEmit && npm run build > /tmp/gcode-build.log 2>&1
```
Expected: no errors. If `Button asChild` is not supported by the local `Button`, replace the file picker shell with a plain `<label>` styled to match.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/GcodeViewerPage.tsx
git commit -m "feat(gcode): page wiring — file picker, layer list, canvas, params, slider"
```

---

## Task 11: Browser verification with `sampleEng.gc`

**Files:** none

This is the manual smoke test that catches everything unit tests don't — render output, axis orientation, slider behaviour, perf on the real file.

- [ ] **Step 1: Start the backend**

```bash
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017
```
Leave it running.

- [ ] **Step 2: Rebuild the frontend (since this is the production-served bundle)**

```bash
cd web && npm run build > /dev/null 2>&1
```

- [ ] **Step 3: Open the page**

Navigate to `http://127.0.0.1:8017/#/gcode` in Chrome. Expected: page header reads "Gcode"; "Open .gc file…" button is visible; no console errors.

- [ ] **Step 4: Load `samples/xcode/sampleEng.gc`**

Click the button, pick `samples/xcode/sampleEng.gc`. Expected within a few seconds: "parsed in NNN ms" appears, layer list populates with ~4+ entries, canvas renders the first layer.

- [ ] **Step 5: Verify orientation**

The blue circle from your reference photo should appear in the *upper* half of the canvas (Y≈37–60), the line should hang *below* it (Y up to 106), and the dog engraving should appear *off to the side* relative to the circle. If the image is flipped vertically (circle on the bottom), the Y axis is being mirrored — fix by removing any inverting transform from `GcodeCanvas.tsx`. (Default canvas2D Y-down is correct here; this step exists to confirm we didn't accidentally flip it.)

- [ ] **Step 6: Scrub the slider**

Drag the layer slider across all layers. Expected: each layer auto-fits its own bbox in the canvas (so a small vector line zooms in tightly, while a large bitmap zooms out); the params box on the right updates to show that layer's `blockConfig` JSON.

- [ ] **Step 7: Toggle travels**

Toggle the "travels" checkbox. Expected: faint grey dashed lines for G0/S=0 segments appear/disappear.

- [ ] **Step 8: Sanity-check forensic detail**

In the params box for the vector layer, confirm:
- `isVector: true`
- `powerFactor: 0.9`
- blocks: 1, segments: 3

(The 3 segments are the two G0 rapids that establish the start + the single G1 burn — visible from `samples/xcode/sampleEng.gc` lines 1322–1325.)

- [ ] **Step 9: Capture a screenshot for the PR**

Use Chrome DevTools (Cmd+Shift+P → "Capture full size screenshot") with one bitmap layer loaded. Drop it in the PR description. No need to add it to `changelog/` — this is a developer tool, not user-facing polish (yet).

- [ ] **Step 10: Open a draft PR**

```bash
git push -u origin $(git rev-parse --abbrev-ref HEAD)
gh pr create --draft --title "feat(gcode): web-based viewer for Studio .gc exports" --body "$(cat <<'EOF'
## Summary
- New `#/gcode` page: drop a Studio `.gc` export, parses client-side in a Web Worker, renders per-layer geometry.
- Logical layer = consecutive blocks with identical `# blockConfig=` JSON. Sample `sampleEng.gc` resolves to a vector line + 3 bitmap layers.
- Auto-fit cropping per layer. Slider scrubs layers. Params box shows the raw blockConfig the parser pulled out.

## Test plan
- [ ] `cd web && npx vitest run src/lib/gcode/parser.test.ts` — 6 passed (incl. integration parse of real `sampleEng.gc`).
- [ ] `cd web && npx tsc --noEmit && npm run build` — green.
- [ ] Load `samples/xcode/sampleEng.gc` in the page; circle is in the upper half, line below it, slider scrubs through all layers, travels toggle works.
EOF
)"
```

- [ ] **Step 11: Mark ready when CI is green**

```bash
gh pr ready
```

---

## Out of scope (deferred — separate plans if/when needed)

- **Drill-down to individual blocks within a logical layer.** Useful for the forensic case of "did Studio's strip #147 differ from its neighbours?" — needs a second slider within the page.
- **Two-file diff mode.** Load two `.gc` files; overlay or side-by-side; highlight layers/blocks that differ in config or geometry. This is the actual answer to "what did Studio change when I tweaked one param" — but it depends on the v1 viewer being solid first.
- **Workshop Instrument styling pass.** The user explicitly deferred appearance to v2. Use the `frontend-design` agent then.
- **WebGL renderer.** Canvas2D will handle the sample at 30 fps. If a future file has 5–10× more segments, swap to a typed-array path + WebGL line shader.
- **Persistence.** No reason to upload to the server. If users want to come back to a file later, they re-open it.
- **`.fcode` (binary) support.** Different format, weeks of work, irrelevant if Studio is always able to emit text gcode.

---

## Self-review notes (audit before handing off)

- **Spec coverage:** web-based ✓ (everything client-side), per-layer ✓ (logical-layer grouping), slider ✓, static params per layer ✓ (params box), auto-fit crop per layer ✓, jobs list ✓ (Select shows up only when jobs.length > 1).
- **No placeholders:** every step has runnable code or an exact command.
- **Type consistency:** `Layer`, `Block`, `BlockConfig`, `Segment`, `BBox` defined in Task 1 and referenced unchanged through Tasks 3, 4, 9, 10. Worker request/response types defined once in Task 7 and consumed in Task 10.
- **Risks called out:**
  - `Button asChild` may not exist (Task 10 step 2 includes the fallback).
  - 33 MB string transferred to/from worker is a 1-ish-second hit (acknowledged; optimisation deferred).
  - `Y` axis is empirically Y-down in this sample (verified in Task 11 step 5).
