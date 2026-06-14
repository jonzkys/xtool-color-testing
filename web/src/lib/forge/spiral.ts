// web/src/lib/forge/spiral.ts
// Continuous-spiral VECTOR_CUTTING path generator. A spiral is a single open
// polyline that sweeps a venting-width channel along the part boundary by
// walking concentric offsets and bridging them — the vectorised open trench.
import { offsetRegion, splitLobesAtNecks, unionRegions, subtractRegion, regionComponents } from "./offset";
import { STAGE_GROUPS } from "./config";
import type { ForgeConfig, GeneratedPath, Pt } from "./types";

/** An arm is External when it grows from the single largest body's outer
 *  silhouette; Internal for that body's holes/counters, every other
 *  disconnected component, and neck-split pieces. */
export type ArmClass = "external" | "internal";

/** Absolute shoelace area of one closed ring (orientation-agnostic). */
function ringArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[i].x * loop[j].y - loop[j].x * loop[i].y;
  }
  return Math.abs(a) / 2;
}

/**
 * Classify each loop in a flat ring set (one offset level): the largest
 * connected component's OUTER loop is "external"; every other loop — that
 * body's holes and all loops of every smaller component — is "internal".
 * Identity-based: regionComponents returns the same loop refs, so the largest
 * component's outer is matched by reference.
 */
export function classifyLevel0(loops: Pt[][]): ArmClass[] {
  if (loops.length === 0) return [];
  const comps = regionComponents(loops); // [outer, ...holes][]
  let bestOuter: Pt[] | null = null;
  let bestArea = -Infinity;
  for (const comp of comps) {
    const a = ringArea(comp[0]);
    if (a > bestArea) { bestArea = a; bestOuter = comp[0]; }
  }
  return loops.map((loop) => (loop === bestOuter ? "external" : "internal"));
}

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

/**
 * Per-level offset rings for one side; stops when an offset collapses.
 * Level 0 = the part CONTOUR itself (k=0), so the spiral starts on the actual
 * boundary and walks outward. This is what guarantees severance: in tight scrap
 * the +pitch (and beyond) offsets merge/vanish across the narrow gap and never
 * reach the boundary, leaving it uncut — but the contour ring always traces the
 * exact edge, so every part feature gets a through-cut. The outer offsets add
 * the venting channel where the scrap is wide enough to hold one.
 */
function offsetLevels(part: Pt[][], opts: SpiralOptions, sign: 1 | -1, exclude?: Pt[][]): Pt[][][] {
  // `exclude` is a keep-out region (the detail lobes' venting zone): every level
  // is clipped against it so this lobe's spiral never re-cuts ground a sibling
  // lobe already owns. Without it the +offsets would bloom into carved detail
  // holes and double-draw on top of the detail spiral.
  const clip = (rings: Pt[][]) => (exclude && exclude.length ? subtractRegion(rings, exclude) : rings);
  const levels: Pt[][][] = [clip(part)];
  const n = Math.max(1, Math.ceil(opts.channelWidthMm / opts.pitchMm));
  for (let k = 1; k <= n; k++) {
    // Break on the RAW offset collapsing (geometry exhausted), not the clipped
    // result — a clipped level can be empty while a larger one still reaches
    // past the keep-out, so keep walking until the unclipped offset vanishes.
    const raw = offsetRegion(part, sign * k * opts.pitchMm);
    if (raw.length === 0) break;
    const lvl = clip(raw);
    if (lvl.length > 0) levels.push(lvl); // an all-clipped level adds nothing; skip it
  }
  return levels;
}

/** Up to `n` evenly-spaced representative points of a loop (by index stride). */
function sampleLoop(loop: Pt[], n: number): Pt[] {
  if (loop.length <= n) return loop;
  const step = loop.length / n;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(loop[Math.floor(i * step)]);
  return out;
}

/** Axis-aligned bounding box for a loop. */
interface Bbox { minX: number; minY: number; maxX: number; maxY: number; }
function loopBbox(loop: Pt[]): Bbox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Squared distance from point p to the line segment (a→b). */
function ptSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

/**
 * Accurate loop-to-loop proximity: sample CHILD to ~CHILD_SAMPLES points and,
 * for each child sample, compute the minimum point-to-SEGMENT distance against
 * the STRAND's full frontier polygon (treating it as closed). Returns the
 * minimum over all child samples.
 *
 * This replaces the old sampled point-to-point measure which underestimated
 * proximity on large loops: two parallel offset rings of a big contour are
 * genuinely ~pitch apart, but their 24-sample grids rarely align, so the
 * sampled nearest-point distance could be several times pitch — triggering
 * false forks.
 */
const CHILD_SAMPLES = 16;
function loopToStrandDist2(childSamples: Pt[], strandFrontier: Pt[]): number {
  const n = strandFrontier.length;
  let best = Infinity;
  for (const p of childSamples) {
    for (let j = 0; j < n; j++) {
      const a = strandFrontier[j], b = strandFrontier[(j + 1) % n];
      const d = ptSegDist2(p.x, p.y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Group the per-level offset loops into strands, then stitch each strand into one
 * open polyline (inner→outer, bridged at the seam).
 *
 * Matching uses a two-criterion score: for each (child, strand) pair, compute
 *   score = dist/pitch + SIZE_WEIGHT * |log(childSize/strandSize)|
 * The child is assigned to the strand with the minimum score, subject to
 * dist ≤ DIST_GATE×pitch. SIZE_WEIGHT biases assignment toward morphologically
 * similar rings (same-size → same region), preventing a tiny hole-ring from
 * stealing a large outer-boundary strand's continuation when both happen to be
 * ~pitch away from the strand's frontier.
 *
 * Candidate strands are pre-filtered by bounding box (expanded by ~4×pitch)
 * so the O(segments) segment scan runs only against nearby strands — keeps
 * the generator fast even on 22-loop name parts.
 *
 * Per level, each child loop is assigned to the best-scoring ACTIVE strand within
 * DIST_GATE×pitch, then resolved:
 *  - merge  (several strands → one child): the child continues the nearest strand;
 *    the others get no child and go inactive (they stay as finished arms).
 *  - split  (one strand → several children): the best-scoring child continues the
 *    strand; the rest fork into new strands.
 *  - new branch (a child near no strand): seeds a fresh strand.
 * Every loop lands in exactly one strand, so the whole offset band is covered.
 *
 * BRIDGE CAP: when the ring-to-ring bridge (distance from strand endpoint to
 * child's nearest point) exceeds MAX_BRIDGE (4×pitch), the match is rejected —
 * the strand terminates cleanly and the child seeds a new strand. This prevents
 * the laser from cutting across the part at topology-merge seams where the stitcher
 * would otherwise jump from a small inner ring to a distant outer ring.
 *
 * No persistence-grace: a strand that has no adjacent continuation terminates
 * immediately rather than "waiting" one extra level for a match. This is what
 * prevents the classic long-bridge bug where a small inner-ring strand grabs
 * the distant outer ring after the inner ring collapses.
 */
export function buildStrands(levels: Pt[][][], pitchMm: number): Pt[][] {
  if (levels.length === 0) return [];
  // Gate: distance must be within DIST_GATE×pitch to even consider a match.
  const DIST_GATE = 2.5; // generous enough to survive multi-level topology transients
  const maxDist2 = (DIST_GATE * pitchMm) ** 2;
  const bboxExpand = 4 * pitchMm; // pre-filter expansion
  // Size mismatch weight in the combined score: |log(childSize/strandSize)|.
  // Prevents tiny rings from outcompeting same-region rings for a large strand
  // when both happen to be ~pitch apart spatially. 0.3 works well empirically
  // for named letter contours (22 loops, 20 offset levels).
  const SIZE_WEIGHT = 0.3;
  // Centroid proximity — mild additional tiebreaker for very close scores.
  const CENTROID_WEIGHT = 0.05;
  // Hard bridge cap: the laser can only make a short (≤4×pitch) connection between
  // consecutive ring walks. Larger gaps produce a SEPARATE arm (travel move, not cut).
  // Only the RING-TO-RING bridge is checked (not within-ring edges which are
  // legitimate cut paths along the material edge).
  const MAX_BRIDGE = 4 * pitchMm;

  // Compute bbox centroid for a loop.
  function bboxCentroid(b: Bbox): { cx: number; cy: number } {
    return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
  }

  // Incremental stitching: each strand carries its accumulated open polyline.
  interface Strand {
    out: Pt[];          // accumulated stitched polyline points
    frontier: Pt[];     // current outermost loop (for proximity matching)
    frontierBbox: Bbox;
    active: boolean;
  }

  const strands: Strand[] = levels[0].map((loop) => {
    const loopBb = loopBbox(loop);
    return { out: rotateOpen(loop, 0), frontier: loop, frontierBbox: loopBb, active: true };
  });

  for (let i = 1; i < levels.length; i++) {
    const children = levels[i].map((loop) => ({
      loop,
      samples: sampleLoop(loop, CHILD_SAMPLES),
      bbox: loopBbox(loop),
      assigned: -1,
      score: Infinity,
    }));

    // Helper: score a child vs a strand. Returns Infinity if outside gates.
    const scoreChild = (c: typeof children[0], s: number): number => {
      if (!strands[s].active) return Infinity;
      const sb = strands[s].frontierBbox;
      if (
        c.bbox.maxX < sb.minX - bboxExpand || c.bbox.minX > sb.maxX + bboxExpand ||
        c.bbox.maxY < sb.minY - bboxExpand || c.bbox.minY > sb.maxY + bboxExpand
      ) return Infinity;
      const d2 = loopToStrandDist2(c.samples, strands[s].frontier);
      if (d2 > maxDist2) return Infinity;
      const d = Math.sqrt(d2);
      const sizeRatio = (c.loop.length + 1) / (strands[s].frontier.length + 1);
      const sizePenalty = Math.abs(Math.log(sizeRatio));
      const cc = bboxCentroid(c.bbox);
      const sc = bboxCentroid(sb);
      const centroidDist = Math.hypot(cc.cx - sc.cx, cc.cy - sc.cy);
      return d / pitchMm + SIZE_WEIGHT * sizePenalty + CENTROID_WEIGHT * centroidDist / pitchMm;
    };

    // Greedy bipartite matching by score.
    const pairs: { ci: number; si: number; score: number }[] = [];
    for (let ci = 0; ci < children.length; ci++) {
      const c = children[ci];
      for (let s = 0; s < strands.length; s++) {
        const sc = scoreChild(c, s);
        if (sc < Infinity) pairs.push({ ci, si: s, score: sc });
      }
    }
    pairs.sort((a, b) => a.score - b.score);

    const childMatched = new Uint8Array(children.length);
    const strandMatched = new Map<number, number>();
    for (const p of pairs) {
      if (childMatched[p.ci] || strandMatched.has(p.si)) continue;
      childMatched[p.ci] = 1;
      strandMatched.set(p.si, p.ci);
      children[p.ci].assigned = p.si;
      children[p.ci].score = p.score;
    }

    // New strands spawned during this level.
    const newStrands: Strand[] = [];

    // Build continuations: matched children extend their strand's stitched polyline.
    // Before appending, measure the ring-to-ring bridge. If the bridge exceeds
    // MAX_BRIDGE, the match is REJECTED: the strand terminates cleanly and the child
    // is treated as unmatched (seeds a fresh strand below).
    for (const c of children) {
      if (c.assigned >= 0) {
        const strand = strands[c.assigned];
        const endpoint = strand.out[strand.out.length - 1];
        const startIdx = nearestIndex(c.loop, endpoint);
        const bridge = Math.hypot(
          c.loop[startIdx].x - endpoint.x,
          c.loop[startIdx].y - endpoint.y,
        );
        if (bridge > MAX_BRIDGE) {
          // Bridge too long: reject match, terminate strand, re-seed child fresh.
          strand.active = false;
          c.assigned = -1;
        } else {
          // Bridge is acceptable: append the ring walk to the strand.
          const walked = rotateOpen(c.loop, startIdx);
          strand.out.push(...walked);
          strand.frontier = c.loop;
          strand.frontierBbox = c.bbox;
        }
      }
    }

    // Strands with no match go inactive immediately (no persistence-grace).
    for (let s = 0; s < strands.length; s++) {
      if (!strands[s].active) continue;
      if (!strandMatched.has(s)) strands[s].active = false;
    }

    // Unmatched children (including bridge-rejected): seed fresh strands.
    for (const c of children) {
      if (c.assigned < 0) {
        const loopBb = loopBbox(c.loop);
        newStrands.push({ out: rotateOpen(c.loop, 0), frontier: c.loop, frontierBbox: loopBb, active: true });
      }
    }

    strands.push(...newStrands);
  }

  return strands.filter((s) => s.out.length > 0).map((s) => s.out);
}

export function spiralFromRegion(part: Pt[][], opts: SpiralOptions, exclude?: Pt[][]): SpiralResult {
  const warnings: string[] = [];
  if (part.length === 0 || !(opts.pitchMm > 0) || !(opts.channelWidthMm > 0)) {
    return { arms: [], warnings };
  }
  const sign: 1 | -1 = opts.side === "inside" ? -1 : 1;
  // levels[0] is ALWAYS the part contour (see offsetLevels), so the boundary is
  // always cut — even where no venting offset fits. The first offset is always
  // ±pitchMm regardless of channelWidthMm, so there is no channel-halving retry.
  // `exclude` keeps this lobe's spiral out of a sibling lobe's territory.
  const levels = offsetLevels(part, opts, sign, exclude);
  // Only the contour fit (no offset ring on top): the scrap is too thin for a
  // venting channel. We still cut the contour so the feature severs, but warn —
  // thick brass may not fully vent in a contour-only kerf.
  if (levels.length <= 1) {
    warnings.push(
      "spiral: scrap too thin for a venting channel — cutting the contour only here (may not fully sever thick brass; consider incise for this region)",
    );
  }
  return { arms: buildStrands(levels, opts.pitchMm), warnings };
}

export function generateSpiralPaths(part: Pt[][], cfg: ForgeConfig, sourceObjectId: string): GeneratedPath[] {
  if (!cfg.spiral.enabled) return [];
  const { channelWidthMm, pitchMm, side, minChannelMm } = cfg.spiral;
  const opts: SpiralOptions = { channelWidthMm, pitchMm, side, minChannelMm };

  // Split thin features off into their own lobes (and group) when enabled;
  // otherwise a single main lobe reproduces the un-split spiral exactly.
  const lobes = cfg.spiral.splitNecks
    ? splitLobesAtNecks(part, (cfg.spiral.neckThresholdPct / 100) * channelWidthMm, cfg.spiral.neckOverlapMm ?? channelWidthMm)
    : [{ region: part, kind: "main" as const }];

  // Detail lobes own their region AND the venting channel they sweep outward
  // (~channelWidth). Keep the main spiral out of that zone so it doesn't bloom
  // back over the detail — each region is cut once, not twice.
  const detailUnion = unionRegions(lobes.filter((l) => l.kind === "detail").map((l) => l.region));
  const detailKeepOut = detailUnion.length > 0 ? offsetRegion(detailUnion, channelWidthMm) : [];

  // Collect every arm with its lobe kind first, so we can order the whole set
  // before stamping operationOrder (which the emitter turns into display/cut
  // sequence). Default order = main lobe then detail lobes, each in strand order.
  const collected: { kind: "main" | "detail"; arm: Pt[] }[] = [];
  for (const lobe of lobes) {
    const exclude = lobe.kind === "main" ? detailKeepOut : undefined;
    for (const arm of spiralFromRegion(lobe.region, opts, exclude).arms) {
      collected.push({ kind: lobe.kind, arm });
    }
  }

  // Cut-shortest-first: small detail features punch through first (venting +
  // relief for the long passes), then the main perimeter — each block ascending
  // by arm length. The export sets user-defined path planning so the machine
  // honours this order instead of auto-optimising it.
  const sequence = cfg.spiral.cutShortestFirst
    ? (() => {
        const byLen = (a: { arm: Pt[] }, b: { arm: Pt[] }) => spiralPathLength(a.arm) - spiralPathLength(b.arm);
        return [
          ...collected.filter((c) => c.kind === "detail").sort(byLen),
          ...collected.filter((c) => c.kind === "main").sort(byLen),
        ];
      })()
    : collected;

  const out: GeneratedPath[] = [];
  let order = 0;
  for (const { kind, arm } of sequence) {
    const group = kind === "detail" ? STAGE_GROUPS.spiralDetail : STAGE_GROUPS.spiral;
    out.push({
      sourceObjectId,
      generatedClass: "spiral",
      groupName: group,
      layerStart: 0,
      layerEnd: cfg.spiral.passes,
      widthMultiplier: channelWidthMm / cfg.beamWidthMm,
      offsetMm: channelWidthMm,
      sideMode: side === "inside" ? "inside" : "outside",
      operationOrder: order++,
      enabled: true,
      rings: [arm],
    });
  }
  return out;
}
