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
