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
 * Build the offset stack for a deepen/seed width.
 * Width multiplier semantics (kerf = widthMultiplier × beamWidthMm):
 *   1x → centreline only
 *   2x → centreline + 1 ring
 *   4x → centreline + multiple rings
 *   8x → centreline + a wider ring stack
 * One ring per beam-width step out to the target half-kerf, scrap-side biased.
 * sideMode: outside (all outward), inside (all inward), symmetric (split),
 * flip (outward with the inverted side sign).
 */
export function generateOffsetStack(
  contour: Contour,
  widthMultiplier: number,
  beamWidthMm: number,
  sideMode: SideMode,
): Contour[] {
  const stack: Contour[] = [contour]; // index 0 = centreline
  if (widthMultiplier <= 1 || beamWidthMm <= 0) return stack;

  const winding = inferWindingAndOutside(contour);
  const outSign: 1 | -1 = sideMode === "flip" ? (winding.outsideSign === 1 ? -1 : 1) : winding.outsideSign;
  const inSign: 1 | -1 = outSign === 1 ? -1 : 1;

  // total widening beyond the centreline, in mm
  const totalWiden = (widthMultiplier - 1) * beamWidthMm;
  const steps = Math.max(1, Math.round(totalWiden / beamWidthMm));

  for (let i = 1; i <= steps; i++) {
    const d = i * beamWidthMm;
    if (sideMode === "outside" || sideMode === "flip") {
      stack.push(...offsetContour(contour, d, outSign));
    } else if (sideMode === "inside") {
      stack.push(...offsetContour(contour, d, inSign));
    } else {
      // symmetric: alternate outward/inward at half the distance
      const half = d / 2;
      stack.push(...offsetContour(contour, half, outSign));
      stack.push(...offsetContour(contour, half, inSign));
    }
  }
  return stack;
}
