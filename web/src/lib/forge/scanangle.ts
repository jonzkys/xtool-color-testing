import type { Contour } from "./types";

/**
 * Speed-optimal raster scan angle (degrees, 0..179) for the given mm-space
 * contours: the angle that minimises the number of scan lines = the geometry's
 * extent PERPENDICULAR to the scan direction. Scanning along the longest axis
 * minimises lines (and turnarounds). Maps to xTool's `customize.processAngle`.
 *
 * NOTE: the exact processAngle convention (sign / 90° offset) is xTool's; this
 * returns the geometric optimum in the obvious convention and should be
 * validated empirically (that's what the UI toggle is for).
 */
export function optimalScanAngle(contours: Contour[], stepDeg = 1): number {
  let best = 0;
  let bestExtent = Infinity;
  for (let deg = 0; deg < 180; deg += stepDeg) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let min = Infinity;
    let max = -Infinity;
    for (const ct of contours) {
      for (const p of ct.points) {
        const v = -p.x * s + p.y * c; // coordinate ⟂ to scan direction
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const extent = max - min;
    if (Number.isFinite(extent) && extent < bestExtent - 1e-9) {
      bestExtent = extent;
      best = deg;
    }
  }
  return best;
}
