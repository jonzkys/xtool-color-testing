import type {
  BBox,
  Block,
  BlockConfig,
  GcodeFile,
  Job,
  Segment,
} from "./types";

/**
 * Parse an xTool Studio gcode export into a structured `GcodeFile`.
 * Pure function — no DOM, no I/O. Safe to run inside a Web Worker.
 *
 * Line-scan state machine: outside motion → inside motion → collecting
 * blockConfig + segments. Logical layers are formed by grouping
 * consecutive blocks with byte-identical `# blockConfig=` JSON.
 */

const GC_HEADER_RE = /^# gc=(\{.*\})\s*$/;
const JOB_HEAD_RE = /^# (\S+) HEAD$/;
const JOB_TAIL_RE = /^# (\S+) TAIL$/;
const COORD_TOKEN_RE = /([XYSF])(-?\d+(?:\.\d+)?)/g;

function emptyBbox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
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
  segments: Segment[];
  bbox: BBox;
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
    segments: block.segments,
    bbox: block.bbox,
  };
}

function pushBlockToJob(job: Job, block: Block): void {
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
      continue;
    }

    // Non-comment — G-code
    if (!pendingBlock) continue;
    const isG0 = line.startsWith("G0") && (line.length === 2 || !/[0-9]/.test(line[2]));
    const isG1 = line.startsWith("G1") && (line.length === 2 || !/[0-9]/.test(line[2]));
    if (!isG0 && !isG1) continue;

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
          break;
      }
    }

    if (!sawXY && lastSegment == null) continue;
    if (Number.isNaN(curX) || Number.isNaN(curY)) continue;

    pendingBlock.segments.push({ x: curX, y: curY, s: curS, rapid: isG0 });
    pendingBlock.bbox = {
      minX: Math.min(pendingBlock.bbox.minX, curX),
      minY: Math.min(pendingBlock.bbox.minY, curY),
      maxX: Math.max(pendingBlock.bbox.maxX, curX),
      maxY: Math.max(pendingBlock.bbox.maxY, curY),
    };
  }

  return out;
}
