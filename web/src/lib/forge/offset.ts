// web/src/lib/forge/offset.ts
//
// Polygon offsetting + boolean ops for the band model, backed by `clipper-lib`
// (Angus Johnson's original Clipper, JS port). We switched to it from clipper2-js
// because that build's InflatePaths produced spike/sawtooth artifacts even on a
// clean ~58-point input; clipper-lib offsets the same input with zero spikes and
// handles negative (inward) offsets + polygons-with-holes correctly. It is
// synchronous, so no async/WASM plumbing in the worker/pipeline.
import ClipperLib, { type IntPoint } from "clipper-lib";
import type { Contour, Pt, SideMode } from "./types";

const SCALE = 1e4; // mm → integer units for clipper precision
const ARC_TOL = SCALE * 0.01; // 0.01mm arc tolerance — smooth round joins
const MITER_LIMIT = 2.0;

function toClipperPath(loop: Pt[]): IntPoint[] {
  return loop.map((p) => new ClipperLib.IntPoint(Math.round(p.x * SCALE), Math.round(p.y * SCALE)));
}
function toClipperPaths(loops: Pt[][]): IntPoint[][] {
  return loops.map(toClipperPath);
}

/** Drop consecutive duplicate points and a closing duplicate of the first. */
function dedupe(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) out.pop();
  }
  return out;
}

function fromClipperPaths(paths: IntPoint[][]): Pt[][] {
  const out: Pt[][] = [];
  for (const path of paths) {
    const ring = dedupe(path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })));
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}

/** Run a boolean op (NonZero unless evenOdd) over closed subject/clip rings. */
function clipExecute(clipType: number, subj: Pt[][], clip: Pt[][], evenOdd = false): Pt[][] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toClipperPaths(subj), ClipperLib.PolyType.ptSubject, true);
  if (clip.length > 0) c.AddPaths(toClipperPaths(clip), ClipperLib.PolyType.ptClip, true);
  const fill = evenOdd ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
  const solution: IntPoint[][] = new ClipperLib.Paths();
  c.Execute(clipType, solution, fill, fill);
  return fromClipperPaths(solution);
}

/**
 * Offset a region (polygon with holes) by `deltaMm` (signed). Positive grows the
 * outer boundary outward and shrinks holes inward; negative does the reverse.
 * clipper-lib handles both correctly and keeps holes consistent.
 */
export function offsetRegion(part: Pt[][], deltaMm: number): Pt[][] {
  if (deltaMm === 0) return part;
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOL);
  co.AddPaths(toClipperPaths(part), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution: IntPoint[][] = new ClipperLib.Paths();
  co.Execute(solution, deltaMm * SCALE);
  return fromClipperPaths(solution);
}

/** Douglas-Peucker simplification of a closed ring (mm space). De-densifies the
 *  bezier-flattened source so offsets stay light; `epsMm` is far below a beam
 *  width so the cut path isn't visibly altered. */
export function simplifyLoop(pts: Pt[], epsMm: number): Pt[] {
  const n = pts.length;
  if (n < 4 || epsMm <= 0) return pts;
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = pts[s];
    const b = pts[e];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1e-9;
    let dmax = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax > epsMm && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Ray-cast point-in-polygon test (mm space). */
export function pointInPolygon(poly: Pt[], pt: Pt): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Shoelace signed area of a single ring. */
function signedRingArea(ring: Pt[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  }
  return a / 2;
}

/**
 * Nesting level of each loop: how many OTHER loops contain its first point.
 * Level 0 = outermost silhouette edge; level 1 = the inner silhouette edge (part
 * boundary); level 2 = a hole's outer edge; and so on.
 */
function nestingLevels(loops: Pt[][]): number[] {
  return loops.map((loop, i) => {
    const probe = loop[0];
    let level = 0;
    for (let j = 0; j < loops.length; j++) {
      if (j === i) continue;
      if (pointInPolygon(loops[j], probe)) level++;
    }
    return level;
  });
}

/** DP tolerance for de-densifying flattened beziers — well below a beam width. */
const SIMPLIFY_EPS_MM = 0.02;

/**
 * Reconstruct the part-solid region from the nested incise loops.
 *
 * A real incise contour is a compound kerf of nested loops (outer silhouette
 * edge, inner silhouette edge, hole-outer, hole-inner, …). The PART is the solid
 * material that survives: with nesting levels per loop,
 *   part = Difference(odd-level loops, even-level loops with level>0)
 * (odd levels bound material; even>0 levels are holes inside it). With no
 * odd-level loops — a simple single-outline incise — we fall back to an even-odd
 * Union of all loops.
 *
 * Returns the region as rings (Pt[][]); positive/negative area distinguishes
 * outer boundaries from holes. Rings with <3 points are dropped.
 */
export function buildPartRegion(subpaths: Contour[]): Pt[][] {
  const loops = subpaths
    .map((c) => simplifyLoop(c.points, SIMPLIFY_EPS_MM))
    .filter((r) => r.length >= 3);
  if (loops.length === 0) return [];

  const levels = nestingLevels(loops);
  const odd: Pt[][] = [];
  const evenPos: Pt[][] = [];
  loops.forEach((loop, i) => {
    const lvl = levels[i];
    if (lvl % 2 === 1) odd.push(loop);
    else if (lvl > 0) evenPos.push(loop);
  });

  if (odd.length > 0) {
    return clipExecute(ClipperLib.ClipType.ctDifference, odd, evenPos, false);
  }
  return clipExecute(ClipperLib.ClipType.ctUnion, loops, [], true);
}

/**
 * Reconstruct a vector SHAPE's filled region using the canonical SVG even-odd
 * fill rule: a point is solid iff it lies inside an odd number of the loops.
 * A union under the even-odd fill type does exactly this in one step and is
 * winding-independent, so it is robust to imported geometry whose loop
 * orientation isn't guaranteed (e.g. an .svg routed through /api/svg-stack).
 *
 * This is the right region for the spiral cut, whose target is a shape outline
 * (outer boundary + counters), NOT a doubled-wall incise kerf. `buildPartRegion`
 * exists for the latter; do not conflate them. For a single-loop target both
 * produce the same solid, so simple shapes (the brass cut-test) are unaffected.
 *
 * Returns rings (Pt[][]); clipper normalises orientation, so positive/negative
 * area still distinguishes outer boundaries from holes for downstream banding.
 */
export function buildFillRegion(subpaths: Contour[]): Pt[][] {
  const loops = subpaths
    .map((c) => simplifyLoop(c.points, SIMPLIFY_EPS_MM))
    .filter((r) => r.length >= 3);
  if (loops.length === 0) return [];
  return clipExecute(ClipperLib.ClipType.ctUnion, loops, [], true);
}

/**
 * Group a flat ring set (outer loops + holes, as produced by offsetRegion /
 * clipExecute) into connected solid regions. Each component is
 * `[outerLoop, ...holeLoops]`. A loop's nesting level = how many OTHER loops
 * contain its first vertex; even levels are outer boundaries, odd levels are
 * holes. Each hole attaches to the smallest-area even-level loop containing it.
 */
export function regionComponents(rings: Pt[][]): Pt[][][] {
  const loops = rings.filter((r) => r.length >= 3);
  const level = loops.map((loop, i) =>
    loops.reduce((n, other, j) => (j !== i && pointInPolygon(other, loop[0]) ? n + 1 : n), 0),
  );
  const outerIdx = loops.map((_, i) => i).filter((i) => level[i] % 2 === 0);
  const comps: Pt[][][] = outerIdx.map((i) => [loops[i]]);
  loops.forEach((loop, i) => {
    if (level[i] % 2 === 0) return; // outer, already a component head
    let best = -1, bestArea = Infinity;
    outerIdx.forEach((oi, ci) => {
      if (pointInPolygon(loops[oi], loop[0])) {
        const a = Math.abs(signedRingArea(loops[oi]));
        if (a < bestArea) { bestArea = a; best = ci; }
      }
    });
    if (best >= 0) comps[best].push(loop);
  });
  return comps;
}

/**
 * Scrap-side band of width `widthMm` around the part region.
 *
 *   outside   → outer = offset(part, +w),  inner = part
 *   inside    → outer = part,              inner = offset(part, -w)
 *   symmetric → outer = offset(part, +w/2), inner = offset(part, -w/2)
 *   flip      → treated as inside.
 *
 * The band is the union of the outer-boundary rings and the inner-boundary rings
 * emitted as one compound ring set: even-odd across them fills only the kerf,
 * leaving the part body (the inner region) a HOLE, so only the kerf sliver is
 * engraved — not the whole part. Returns rings (Pt[][]); empty if a boundary
 * vanished.
 */
export function bandFromRegion(part: Pt[][], widthMm: number, sideMode: SideMode): Pt[][] {
  if (part.length === 0 || widthMm <= 0) return [];

  let outer: Pt[][];
  let inner: Pt[][];
  if (sideMode === "outside") {
    outer = offsetRegion(part, widthMm);
    inner = part;
  } else if (sideMode === "inside" || sideMode === "flip") {
    outer = part;
    inner = offsetRegion(part, -widthMm);
  } else {
    outer = offsetRegion(part, widthMm / 2);
    inner = offsetRegion(part, -widthMm / 2);
  }

  // A valid band needs BOTH boundaries: the part interior must remain a HOLE
  // between two concentric ring sets. If the inner boundary collapsed (thin part
  // / large width on inside|symmetric|flip), the band would degrade to a single
  // solid ring → even-odd flood-filling the whole part, engraves the whole part body.
  // Drop it instead. (outside mode keeps inner = part, so this only bites the
  // inward-offset modes.)
  if (outer.length === 0 || inner.length === 0) return [];
  return [...outer, ...inner];
}

/**
 * The outer boundary loop of the part — the ring with the largest ABSOLUTE area
 * (orientation-agnostic, since clipper's hole orientation can vary). Used to
 * place perforations along the silhouette. Returns [] for an empty region.
 */
export function partOuterLoop(part: Pt[][]): Pt[] {
  let best: Pt[] = [];
  let bestArea = -Infinity;
  for (const ring of part) {
    const area = Math.abs(signedRingArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

/** Reject detail fragments smaller than this (mm²) — clipper rounding noise. */
const MIN_DETAIL_AREA_MM2 = 0.02;

export interface NeckLobe {
  region: Pt[][];
  kind: "main" | "detail";
}

/**
 * Split a part region at necks narrower than `neckWidthMm`. Erodes by
 * neckWidthMm/2 so thin necks pinch off; each surviving core is recovered
 * (dilated back + overlap, clipped to the part) as a MAIN lobe, and thin
 * material no core covers becomes DETAIL lobes (grown by overlap so the join is
 * double-cut). Returns the part as a single main lobe when no neck is found.
 */
export function splitLobesAtNecks(part: Pt[][], neckWidthMm: number, overlapMm: number): NeckLobe[] {
  const whole: NeckLobe[] = [{ region: part, kind: "main" }];
  if (part.length === 0 || !(neckWidthMm > 0)) return whole;
  const r = neckWidthMm / 2;
  const ov = Math.max(0, overlapMm);

  const cores = regionComponents(offsetRegion(part, -r));
  const mains = cores
    .map((core) => clipExecute(ClipperLib.ClipType.ctIntersection, offsetRegion(core, r + ov), part))
    .filter((reg) => reg.length > 0);

  // Use r+ov (same as mains recovery) so round-corner roundtrip artifacts from
  // clipper don't leak through as spurious detail fragments.
  const thick = clipExecute(
    ClipperLib.ClipType.ctUnion,
    cores.flatMap((core) => offsetRegion(core, r + ov)),
    [],
  );
  const residual = clipExecute(ClipperLib.ClipType.ctDifference, part, thick);
  const details = regionComponents(residual)
    .filter((comp) => Math.abs(signedRingArea(comp[0])) >= MIN_DETAIL_AREA_MM2)
    .map((comp) => clipExecute(ClipperLib.ClipType.ctIntersection, offsetRegion(comp, ov), part))
    .filter((reg) => reg.length > 0);

  // No neck: a single thick core and no meaningful thin residual — leave whole
  // so the un-split spiral path is reproduced exactly.
  if (mains.length <= 1 && details.length === 0) return whole;

  return [
    ...mains.map((region) => ({ region, kind: "main" as const })),
    ...details.map((region) => ({ region, kind: "detail" as const })),
  ];
}

/** Walk a closed loop and emit a sample every `spacingMm` of arc length, each
 *  with the OUTWARD unit normal at that point (away from the part interior).
 *  Used to place perforation pockets on the scrap side of the part edge. */
export function sampleLoopWithNormals(
  loop: Pt[],
  spacingMm: number,
): Array<{ pt: Pt; nx: number; ny: number }> {
  const n = loop.length;
  if (n < 3 || spacingMm <= 0) return [];
  // interior is on the LEFT of directed edges for a +area (CCW) ring, so the
  // outward normal of edge dir (dx,dy) is the RIGHT normal (dy,-dx); flip for CW.
  const wind = signedRingArea(loop) >= 0 ? 1 : -1;
  const out: Array<{ pt: Pt; nx: number; ny: number }> = [];
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (dy / len) * wind;
    const ny = (-dx / len) * wind;
    let t = spacingMm - carry;
    while (t <= len + 1e-9) {
      const f = t / len;
      out.push({ pt: { x: a.x + dx * f, y: a.y + dy * f }, nx, ny });
      t += spacingMm;
    }
    carry = (carry + len) % spacingMm;
  }
  return out;
}

/** Outward unit normal at vertex `i` of a loop (bisector of incident edges). */
export function outwardNormalAt(loop: Pt[], i: number): { nx: number; ny: number } {
  const n = loop.length;
  const wind = signedRingArea(loop) >= 0 ? 1 : -1;
  const prev = loop[(i - 1 + n) % n];
  const cur = loop[i];
  const next = loop[(i + 1) % n];
  const e1 = { x: cur.x - prev.x, y: cur.y - prev.y };
  const e2 = { x: next.x - cur.x, y: next.y - cur.y };
  const l1 = Math.hypot(e1.x, e1.y) || 1;
  const l2 = Math.hypot(e2.x, e2.y) || 1;
  const n1 = { x: (e1.y / l1) * wind, y: (-e1.x / l1) * wind };
  const n2 = { x: (e2.y / l2) * wind, y: (-e2.x / l2) * wind };
  let bx = n1.x + n2.x;
  let by = n1.y + n2.y;
  const bl = Math.hypot(bx, by);
  if (bl < 1e-9) return { nx: n2.x, ny: n2.y };
  return { nx: bx / bl, ny: by / bl };
}
