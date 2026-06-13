// web/src/lib/forge/svgExport.ts
//
// Serialize generated spiral paths to a standalone SVG document. Pure string
// building over the mm-space polylines (no DOM), so it runs anywhere. Forge's
// y-down convention already matches SVG, so coords pass through unflipped.
import type { GeneratedPath } from "./types";
import { contourToDPath } from "./xcs";

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(paths: GeneratedPath[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    for (const ring of p.rings) {
      for (const pt of ring) {
        minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

const round = (v: number) => +v.toFixed(3);

/** Build an SVG document (mm units) for the generated cut paths — one
 *  `<path>` per arm, stroked, no fill. Returns "" when there's nothing to draw. */
export function buildSpiralSvg(paths: GeneratedPath[]): string {
  const drawable = paths.filter((p) => p.rings.some((r) => r.length >= 2));
  const bb = boundsOf(drawable);
  if (!bb) return "";

  const pad = 1; // 1mm margin so strokes aren't clipped at the edge
  const minX = round(bb.minX - pad);
  const minY = round(bb.minY - pad);
  const w = round(bb.maxX - bb.minX + 2 * pad);
  const h = round(bb.maxY - bb.minY + 2 * pad);

  const ds: string[] = [];
  for (const p of drawable) {
    for (const ring of p.rings) {
      if (ring.length < 2) continue;
      // mmPerUnit = 1 keeps the coords in mm; spiral arms are open polylines.
      ds.push(contourToDPath(ring, false, 1));
    }
  }

  const body = ds
    .map((d) => `  <path d="${d}" fill="none" stroke="#000000" stroke-width="0.1" />`)
    .join("\n");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" ` +
    `viewBox="${minX} ${minY} ${w} ${h}">\n${body}\n</svg>\n`
  );
}
