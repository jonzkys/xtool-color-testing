// web/src/lib/forge/offset.ts
import { Clipper, JoinType, EndType, FillRule, Path64, Paths64, Point64 } from "clipper2-js";
import type { Contour, Pt, SideMode } from "./types";

const SCALE = 1e4; // mm → integer units for clipper precision

function toPath64(c: Contour): Path64 {
  const path = new Path64();
  for (const p of c.points) {
    path.push(new Point64(Math.round(p.x * SCALE), Math.round(p.y * SCALE)));
  }
  return path;
}

function fromPath64(path: ArrayLike<{ x: number | bigint; y: number | bigint }>): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    out.push({ x: Number(p.x) / SCALE, y: Number(p.y) / SCALE });
  }
  return out;
}

/** Convert a set of mm-space loops into a Paths64 in integer units. */
function toPaths64(loops: Pt[][]): Paths64 {
  const paths = new Paths64();
  for (const loop of loops) {
    paths.push(toPath64({ points: loop, closed: true }));
  }
  return paths;
}

/** Drop consecutive duplicate points (clipper can emit them on degenerate input). */
function dedupe(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) out.push(p);
  }
  // drop a closing duplicate of the first point
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) out.pop();
  }
  return out;
}

/** Convert a Paths64 result back to mm-space loops (rings of ≥3 points). */
function fromPaths64(paths: ArrayLike<ArrayLike<{ x: number | bigint; y: number | bigint }>>): Pt[][] {
  const out: Pt[][] = [];
  for (let i = 0; i < paths.length; i++) {
    const ring = dedupe(fromPath64(paths[i]));
    if (ring.length >= 3) out.push(ring);
  }
  return out;
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

/**
 * Offset a single contour by `distanceMm`. `outsideSign` is +1/-1 telling which
 * delta sign moves to the scrap side. Closed contours use Polygon end type; open
 * ones use Square. Returns the resulting ring(s) as closed contours.
 *
 * Kept for callers that still need single-loop offsets; the band machinery uses
 * the region functions below.
 */
export function offsetContour(c: Contour, distanceMm: number, outsideSign: 1 | -1): Contour[] {
  if (distanceMm === 0) return [c];
  const delta = distanceMm * outsideSign * SCALE;
  const endType = c.closed ? EndType.Polygon : EndType.Square;
  const paths = new Paths64();
  paths.push(toPath64(c));
  const solution = Clipper.InflatePaths(paths, delta, JoinType.Round, endType, 2.0);
  return Array.from(solution).map((path) => ({
    points: fromPath64(path),
    closed: true,
  }));
}

/**
 * Compute the nesting level of each subpath: the number of OTHER loops whose
 * polygon contains the subpath's first point. Level 0 loops are top-level
 * silhouettes; level 1 loops are the next ring in (the inside silhouette edge or
 * a hole outer); and so on.
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

/**
 * Reconstruct the part-solid region from the nested incise loops.
 *
 * A real incise contour is a compound kerf of nested loops (outer silhouette
 * edge, inner silhouette edge, hole-outer, hole-inner, …). The PART is the solid
 * material that survives: with nesting levels computed per loop,
 *   part = Difference(Union(odd-level loops), Union(even-level loops, level>0))
 * (odd levels are the material-bounding rings; even>0 levels are holes inside
 * them). When there are no odd-level loops — a simple single-outline incise —
 * we fall back to an even-odd Union of all loops.
 *
 * Returns the region as rings (Pt[][]) in clipper orientation: a positive-area
 * ring is an outer boundary, a negative-area ring is a hole. Rings with <3
 * points are dropped.
 */
export function buildPartRegion(subpaths: Contour[]): Pt[][] {
  const loops = subpaths.map((c) => c.points).filter((r) => r.length >= 3);
  if (loops.length === 0) return [];

  const levels = nestingLevels(loops);
  const odd: Pt[][] = [];
  const evenPos: Pt[][] = []; // even level but > 0 (holes inside material)
  loops.forEach((loop, i) => {
    const lvl = levels[i];
    if (lvl % 2 === 1) odd.push(loop);
    else if (lvl > 0) evenPos.push(loop);
  });

  const part =
    odd.length > 0
      ? Clipper.Difference(toPaths64(odd), toPaths64(evenPos), FillRule.NonZero)
      : Clipper.Union(toPaths64(loops), undefined, FillRule.EvenOdd);

  return fromPaths64(part);
}

/** Per-ring inward/outward offset by `deltaMm` along each vertex's angle bisector.
 *  Used for NEGATIVE (inward) offsets only: this clipper2-js build's
 *  InflatePaths is broken for negative deltas (concave-join handling produces
 *  self-intersecting garbage), so we shift each vertex along its bisector by the
 *  signed amount keyed to the ring's own winding. The result is exact for convex
 *  rings and degrades gracefully (sliver dropped if it self-collapses) for the
 *  rounded part silhouettes the inside/symmetric modes target. */
function offsetRingManual(ring: Pt[], deltaMm: number): Pt[] {
  const n = ring.length;
  if (n < 3) return [];
  // winding sign: +area ring shrinks for delta<0 by moving each vertex toward
  // the interior (which is on the left of the directed edges for +area).
  const wind = signedRingArea(ring) >= 0 ? 1 : -1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    // inward normals of the two incident edges
    const e1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const e2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(e1.x, e1.y) || 1;
    const l2 = Math.hypot(e2.x, e2.y) || 1;
    // left normal of a directed edge is (-dy, dx); interior is left for +area.
    const n1 = { x: (-e1.y / l1) * wind, y: (e1.x / l1) * wind };
    const n2 = { x: (-e2.y / l2) * wind, y: (e2.x / l2) * wind };
    // average the two edge normals (a cheap bisector); renormalise.
    let bx = n1.x + n2.x;
    let by = n1.y + n2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) {
      bx = n1.x;
      by = n1.y;
    } else {
      bx /= bl;
      by /= bl;
    }
    // (bx,by) is the inward unit normal; delta<0 → move inward by |delta|.
    const d = -deltaMm; // inward distance
    out.push({ x: cur.x + bx * d, y: cur.y + by * d });
  }
  return out;
}

/**
 * Offset a region by `deltaMm` (signed). Positive (outward) uses clipper's
 * InflatePaths (correct in this build). Negative (inward) uses a manual
 * per-vertex bisector offset because this clipper2-js build's negative
 * InflatePaths is broken. Returns rings; empty if everything collapsed.
 */
function inflateRegion(part: Pt[][], deltaMm: number): Pt[][] {
  if (deltaMm === 0) return part;
  if (deltaMm > 0) {
    const solution = Clipper.InflatePaths(
      toPaths64(part),
      deltaMm * SCALE,
      JoinType.Round,
      EndType.Polygon,
      2.0,
    );
    return fromPaths64(solution);
  }
  // inward: offset each ring manually, then re-clean self-intersections via a
  // positive-fill Union so overlapping slivers don't double up.
  const shrunk = part.map((r) => offsetRingManual(r, deltaMm)).filter((r) => r.length >= 3);
  if (shrunk.length === 0) return [];
  const cleaned = Clipper.Union(toPaths64(shrunk), undefined, FillRule.NonZero);
  return fromPaths64(cleaned);
}

/**
 * Scrap-side band of width `widthMm` (mm) around the part region.
 *
 * Clipper handles a polygon-with-holes correctly: inflating the region grows the
 * outer boundary outward and shrinks holes inward — both move toward scrap. The
 * band is the area between an OUTER boundary region and an INNER boundary region:
 *
 *   outside   → outer = Inflate(part, +w), inner = part
 *   inside    → outer = part,              inner = Inflate(part, -w)
 *   symmetric → outer = Inflate(part,+w/2), inner = Inflate(part,-w/2)
 *   flip      → treated as inside.
 *
 * We emit the union of the outer-boundary rings and the inner-boundary rings as
 * one compound ring set: even-odd / non-zero across them fills only the kerf,
 * with the inner region (the part body) left as a HOLE so the emboss is never
 * engraved. (We build the rings directly instead of a boolean Difference because
 * this clipper2-js build's PolyTree extraction is broken and a flat Difference
 * returns a single bridged "keyhole" path rather than separate outer/hole
 * rings.)
 *
 * Returns the band as rings (Pt[][]); empty if the outer boundary vanished.
 */
export function bandFromRegion(part: Pt[][], widthMm: number, sideMode: SideMode): Pt[][] {
  if (part.length === 0 || widthMm <= 0) return [];

  let outer: Pt[][];
  let inner: Pt[][];
  if (sideMode === "outside") {
    outer = inflateRegion(part, widthMm);
    inner = part;
  } else if (sideMode === "inside" || sideMode === "flip") {
    outer = part;
    inner = inflateRegion(part, -widthMm);
  } else {
    // symmetric: a band straddling the part edge, w/2 either side
    outer = inflateRegion(part, widthMm / 2);
    inner = inflateRegion(part, -widthMm / 2);
  }

  if (outer.length === 0) return [];
  // Even-odd fill of (outer ∪ inner) = the band. Drop a vanished inner so the
  // band degenerates to a solid region rather than throwing.
  return [...outer, ...inner];
}

/**
 * The outer boundary loop of the part — the largest positive-area ring. Used to
 * place perforations along the part's silhouette. Returns [] for an empty region.
 */
export function partOuterLoop(part: Pt[][]): Pt[] {
  let best: Pt[] = [];
  let bestArea = -Infinity;
  for (const ring of part) {
    const area = signedRingArea(ring);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
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
