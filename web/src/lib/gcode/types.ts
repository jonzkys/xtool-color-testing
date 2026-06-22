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

export interface Block {
  /** Line number in the source file where this block starts
   * (motion_start line). Useful for surfacing forensic detail. */
  startLine: number;
  config: BlockConfig;
  geometry: BlockGeometry;
  bbox: BBox;
  /** Maximum non-zero S (laser power) observed in the block's
   * burn segments. 0 if the block has no burn segments. Used to
   * detect cleanup passes — blocks whose peak S falls well below
   * the layer's configured peak power. */
  peakS: number;
  /** First F (feed rate, mm/min) seen on a G1 line in this block.
   * F is modal so the first value is representative. 0 if no F
   * appeared on a G1. (G0 Z-descent rapids use a slow F=600 that
   * would otherwise shadow the cutting feed; we skip those.) */
  feedF: number;
  /** Z-axis movements inside this block (xTool emits these as
   * `G0Z<abs>F<feed>` rapids between scan-strips to keep the head
   * focused). `z` is the absolute Z target; `delta` is the change
   * from the previous Z value (modal across the file). Empty array
   * when no Z movement happened in this block. */
  zMoves: Array<{ z: number; delta: number }>;
  /** Modal Z value at the end of this block — equals the last Z
   * seen so far in the file. Lets the UI surface the running head
   * position on every block, even ones without their own Z events. */
  zAtEnd: number;
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
