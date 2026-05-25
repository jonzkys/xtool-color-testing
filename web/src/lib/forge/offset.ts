// web/src/lib/forge/offset.ts
import { Clipper, JoinType, EndType, Path64, Paths64 } from "clipper2-js";
import type { Contour, Pt, SideMode } from "./types";
import { inferWindingAndOutside } from "./contour";

const SCALE = 1e4; // mm → integer units for clipper precision

function toPath64(c: Contour): Path64 {
  const path = new Path64();
  for (const p of c.points) {
    path.push({ x: Math.round(p.x * SCALE), y: Math.round(p.y * SCALE) });
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

/**
 * Offset a single contour by `distanceMm`. `outsideSign` is +1/-1 telling which
 * delta sign moves to the scrap side (from inferWindingAndOutside). Closed
 * contours use Polygon end type; open ones use Square. Returns the resulting
 * ring(s) as closed contours.
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
 * Build the loop set for an even-odd sliver-band of total width `widthMm`.
 *
 * INTAGLIO fills the enclosed area of a closed path, so a kerf is expressed as
 * a compound path of two concentric closed loops emitted with
 * `fillRule: "evenodd"`: even-odd fills only the thin band between them. We
 * always include the original `contour.points` loop, so a band is never a
 * single loop (which would flood-fill the whole interior).
 *
 * sideMode:
 *   outside / flip → outer offset loop(s) + original contour as the inner loop.
 *                    `flip` inverts the side sign (widen on the opposite side).
 *   inside         → original contour + inner offset loop(s).
 *   symmetric      → outer offset (w/2) + inner offset (w/2), split either side.
 *
 * Any offsetContour that returns [] (e.g. a small pocket shrunk to nothing) is
 * simply omitted. Loops with <3 points are filtered out.
 */
export function generateBand(contour: Contour, widthMm: number, sideMode: SideMode): Pt[][] {
  const winding = inferWindingAndOutside(contour);
  const outSign: 1 | -1 = sideMode === "flip" ? (winding.outsideSign === 1 ? -1 : 1) : winding.outsideSign;
  const inSign: 1 | -1 = outSign === 1 ? -1 : 1;

  let loops: Pt[][];
  if (sideMode === "outside" || sideMode === "flip") {
    loops = [...offsetContour(contour, widthMm, outSign).map((c) => c.points), contour.points];
  } else if (sideMode === "inside") {
    loops = [contour.points, ...offsetContour(contour, widthMm, inSign).map((c) => c.points)];
  } else {
    // symmetric: split the width either side of the contour
    loops = [
      ...offsetContour(contour, widthMm / 2, outSign).map((c) => c.points),
      ...offsetContour(contour, widthMm / 2, inSign).map((c) => c.points),
    ];
  }
  return loops.filter((r) => r.length >= 3);
}
