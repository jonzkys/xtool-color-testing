// web/src/lib/forge/spiral.ts
// Continuous-spiral VECTOR_CUTTING path generator. A spiral is a single open
// polyline that sweeps a venting-width channel along the part boundary by
// walking concentric offsets and bridging them — the vectorised open trench.
import { offsetRegion } from "./offset";
import { STAGE_GROUPS } from "./config";
import type { ForgeConfig, GeneratedPath, Pt } from "./types";

export interface SpiralOptions {
  channelWidthMm: number;
  pitchMm: number;
  side: "outside" | "inside";
  minChannelMm: number;
}
export interface SpiralResult { arms: Pt[][]; warnings: string[]; }

/** Total polyline length (mm). */
export function spiralPathLength(arm: Pt[]): number {
  let L = 0;
  for (let i = 1; i < arm.length; i++) L += Math.hypot(arm[i].x - arm[i - 1].x, arm[i].y - arm[i - 1].y);
  return L;
}

/** Index in `loop` of the point nearest `target`. */
function nearestIndex(loop: Pt[], target: Pt): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const d = (loop[i].x - target.x) ** 2 + (loop[i].y - target.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Rotate a closed ring to start at index `start`, returned as an OPEN walk
 * (the seam stays open — the bridge to the next level closes the gap).
 */
function rotateOpen(loop: Pt[], start: number): Pt[] {
  return loop.map((_, i) => loop[(start + i) % loop.length]);
}

/** Per-level offset rings for one side; stops when an offset collapses. Level 0 = innermost. */
function offsetLevels(part: Pt[][], opts: SpiralOptions, sign: 1 | -1): Pt[][][] {
  const levels: Pt[][][] = [];
  const n = Math.max(1, Math.ceil(opts.channelWidthMm / opts.pitchMm));
  for (let k = 1; k <= n; k++) {
    const rings = offsetRegion(part, sign * k * opts.pitchMm);
    if (rings.length === 0) break;
    levels.push(rings);
  }
  return levels;
}

/** Centroid of a loop. */
function centroid(loop: Pt[]): Pt {
  let sx = 0, sy = 0;
  for (const p of loop) { sx += p.x; sy += p.y; }
  return { x: sx / loop.length, y: sy / loop.length };
}

/** Squared distance between two points. */
function dist2(a: Pt, b: Pt): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Group loops across levels into strands, then stitch each into one open polyline.
 *
 * Containment-direction-agnostic: for each child loop we find the nearest
 * parent loop by centroid–centroid distance. This works for both outside
 * (growing rings) and inside (shrinking rings) offsets — the nearest-centroid
 * parent is always the geometrically adjacent one regardless of which direction
 * the offsets expand.
 *
 * Topology-split detection: a continuing strand's centroid moves by less than
 * one pitch between adjacent offset levels.  When a region pinches and splits,
 * the child centroid jumps to its new sub-region centre — typically many mm
 * away. We only attach a child to the nearest strand if `bestDist < (2×pitch)²`;
 * otherwise it is a genuine new branch and we seed a fresh strand.
 *
 * @param pitchMm  Offset step size (mm) — used as the continuity threshold.
 */
function buildStrands(levels: Pt[][][], pitchMm: number): Pt[][] {
  if (levels.length === 0) return []; // FIX 4: guard against empty input

  // strands[i].loopsByLevel: the rings in traversal order (innermost first)
  // strands[i].centroids: centroid of each ring, cached
  const strands: { loopsByLevel: Pt[][]; centroids: Pt[] }[] = levels[0].map((loop) => ({
    loopsByLevel: [loop],
    centroids: [centroid(loop)],
  }));

  const maxDist2 = (2 * pitchMm) ** 2; // FIX 1: continuity threshold

  for (let i = 1; i < levels.length; i++) {
    for (const child of levels[i]) {
      const cc = centroid(child);
      // Find the strand whose LAST loop centroid is nearest this child's centroid.
      let bestStrand = -1;
      let bestDist = Infinity;
      for (let s = 0; s < strands.length; s++) {
        const sc = strands[s].centroids[strands[s].centroids.length - 1];
        const d = dist2(cc, sc);
        if (d < bestDist) { bestDist = d; bestStrand = s; }
      }
      // FIX 1: only attach if within continuity threshold; else fork a new strand.
      if (bestStrand >= 0 && bestDist < maxDist2) {
        strands[bestStrand].loopsByLevel.push(child);
        strands[bestStrand].centroids.push(cc);
      } else {
        strands.push({ loopsByLevel: [child], centroids: [cc] }); // topology split → new strand
      }
    }
  }

  return strands
    .filter((s) => s.loopsByLevel.length > 0)
    .map((s) => {
      const out: Pt[] = [];
      for (const loop of s.loopsByLevel) {
        const start = out.length ? nearestIndex(loop, out[out.length - 1]) : 0;
        out.push(...rotateOpen(loop, start)); // open walk; the gap to the next level's start is the bridge
      }
      return out;
    });
}

export function spiralFromRegion(part: Pt[][], opts: SpiralOptions): SpiralResult {
  const warnings: string[] = [];
  if (part.length === 0 || !(opts.pitchMm > 0) || !(opts.channelWidthMm > 0)) {
    return { arms: [], warnings };
  }
  const sign: 1 | -1 = opts.side === "inside" ? -1 : 1;
  // FIX 2: compute levels once; the first offset is always ±pitchMm regardless
  // of channelWidthMm, so halving the channel and retrying is identical — drop
  // the no-op fallback loop entirely.
  const levels = offsetLevels(part, opts, sign);
  if (levels.length === 0) {
    return { arms: [], warnings: ["spiral: region too thin to fit a pass — skipped (re-enable incise here)"] };
  }
  return { arms: buildStrands(levels, opts.pitchMm), warnings };
}

export function generateSpiralPaths(part: Pt[][], cfg: ForgeConfig, sourceObjectId: string): GeneratedPath[] {
  if (!cfg.spiral.enabled) return [];
  const { channelWidthMm, pitchMm, side, minChannelMm } = cfg.spiral;
  const result = spiralFromRegion(part, { channelWidthMm, pitchMm, side, minChannelMm });
  return result.arms.map((arm, i) => ({
    sourceObjectId,
    generatedClass: "spiral" as const,
    groupName: STAGE_GROUPS.spiral,
    layerStart: 0,
    layerEnd: cfg.spiral.passes,
    widthMultiplier: channelWidthMm / cfg.beamWidthMm,
    offsetMm: channelWidthMm,
    sideMode: side === "inside" ? "inside" : "outside",
    operationOrder: i,
    enabled: true,
    rings: [arm], // open polyline carried as the sole "ring"
  }));
}
