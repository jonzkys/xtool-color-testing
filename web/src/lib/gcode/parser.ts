import type {
  BBox,
  Block,
  BlockConfig,
  GcodeFile,
  Job,
} from "./types";

/**
 * Parse an xTool Studio gcode export into a structured `GcodeFile`.
 * Pure function — no DOM, no I/O. Safe to run inside a Web Worker.
 *
 * Line-scan state machine: outside motion → inside motion → collecting
 * blockConfig + segments. Logical layers are formed by grouping
 * consecutive blocks with byte-identical `# blockConfig=` JSON.
 *
 * Vertices accumulate into per-block growable typed-array builders and
 * finalize to columnar `BlockGeometry` (Float32 x/y/s + Uint8 rapid) so a
 * multi-million-segment file stays small and its buffers can be transferred
 * zero-copy out of the worker.
 */

const GC_HEADER_RE = /^# gc=(\{.*\})\s*$/;
const JOB_HEAD_RE = /^# (\S+) HEAD$/;
const JOB_TAIL_RE = /^# (\S+) TAIL$/;
const COORD_TOKEN_RE = /([XYSFZ])(-?\d+(?:\.\d+)?)/g;

function emptyBbox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** Growable Float32 column: doubles capacity on overflow, finalizes to an
 *  exact-size copy (so the transferred buffer is tight, not the spare cap). */
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

function isInnerHeadTail(token: string): boolean {
  return token.includes(" ");
}

function mergeBbox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

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

function pushBlockToJob(job: Job, block: Block): void {
  const last = job.layers[job.layers.length - 1];
  if (last && last.config.raw === block.config.raw) {
    last.blocks.push(block);
    last.totalSegments += block.geometry.count;
    last.bbox = mergeBbox(last.bbox, block.bbox);
  } else {
    job.layers.push({
      index: job.layers.length,
      config: block.config,
      blocks: [block],
      bbox: { ...block.bbox },
      totalSegments: block.geometry.count,
    });
  }
  job.bbox = mergeBbox(job.bbox, block.bbox);
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
  /** Modal Z value, persisted across blocks. xTool emits Z commands
   * sparsely between scan-strips; we need to remember the last
   * absolute value so each Z movement's delta is correct relative
   * to the prior state, not the block's start. */
  let currentZ = 0;
  /** Distance-mode flag for xTool gcode. G90 = absolute (default).
   * G91 = relative. xTool wraps every Z descent in `G91 … G90` so
   * the Z value on those lines is a *delta*, not an absolute target.
   * X/Y are usually emitted in G90 but we apply the same rule
   * uniformly for correctness if Studio ever changes that. */
  let absoluteMode = true;
  let pendingBlock: PendingBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    if (line.startsWith("#")) {
      // File-level header
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

      // Job + block boundaries
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
        continue;
      }
      if (line === "# motion_end") {
        if (pendingBlock && currentJob) {
          pendingBlock.zAtEnd = currentZ;
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
      continue;
    }

    // Distance-mode switches — apply globally, regardless of whether
    // we're inside a motion block. xTool flips G91 → Z move → G90 to
    // express Z descents as deltas; without this, every relative Z
    // command would be misread as an absolute target.
    if (line === "G90") {
      absoluteMode = true;
      continue;
    }
    if (line === "G91") {
      absoluteMode = false;
      continue;
    }

    // Non-comment — G-code
    const isG0 = line.startsWith("G0") && (line.length === 2 || !/[0-9]/.test(line[2]));
    const isG1 = line.startsWith("G1") && (line.length === 2 || !/[0-9]/.test(line[2]));
    if (!isG0 && !isG1) continue;

    const hasPrev = pendingBlock != null && pendingBlock.count > 0;
    const prevX = hasPrev ? pendingBlock!.prevX : NaN;
    const prevY = hasPrev ? pendingBlock!.prevY : NaN;
    let curX = prevX;
    let curY = prevY;
    let curS = hasPrev ? pendingBlock!.prevS : 0;
    let sawXY = false;
    /** Z value extracted from this line, interpreted per absoluteMode
     * (absolute target vs delta). Resolved against `currentZ` below. */
    let rawZ: number | null = null;

    COORD_TOKEN_RE.lastIndex = 0;
    let tok: RegExpExecArray | null;
    while ((tok = COORD_TOKEN_RE.exec(line)) !== null) {
      const v = parseFloat(tok[2]);
      switch (tok[1]) {
        case "X":
          curX = absoluteMode ? v : (Number.isFinite(prevX) ? prevX + v : v);
          sawXY = true;
          break;
        case "Y":
          curY = absoluteMode ? v : (Number.isFinite(prevY) ? prevY + v : v);
          sawXY = true;
          break;
        case "S":
          curS = v;
          break;
        case "F":
          // Only capture F from G1 (cutting) lines. xTool's gcode sets
          // F on G0 Z-axis descents (e.g. `G0Z0F600` = 10 mm/s) which
          // would otherwise shadow the real cutting feed if it appears
          // earlier in the block.
          if (isG1 && pendingBlock && pendingBlock.feedF === 0 && v > 0) {
            pendingBlock.feedF = v;
          }
          break;
        case "Z":
          rawZ = v;
          break;
      }
    }

    // Z events update the global modal Z whether or not a block is
    // currently open. xTool brackets between-block Z resets with
    // G91/G90; skipping them would let `currentZ` drift across
    // multiple objects in the same file.
    if (rawZ !== null) {
      const newZ = absoluteMode ? rawZ : currentZ + rawZ;
      const delta = newZ - currentZ;
      if (pendingBlock) {
        pendingBlock.zMoves.push({ z: newZ, delta });
      }
      currentZ = newZ;
    }

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
  }

  return out;
}
