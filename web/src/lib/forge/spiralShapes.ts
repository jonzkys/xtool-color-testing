// web/src/lib/forge/spiralShapes.ts
// Cell-shape region generators for the Spiral Test. Each returns a closed region
// (Pt[][]) bounded by ~sizeMm and centred at (cx,cy), fed to spiralFromRegion as
// the part to sever. Pure; the letter shape reuses the baked glyph table.
import type { Pt } from "./types";
import { renderText } from "./textPaths";

export type CellShape =
  | "circle" | "square" | "diamond" | "hexagon" | "octagon" | "star" | "letterJ";

/** One closed loop of `segments` points on a circle of diameter `d` at (cx,cy). */
export function circleRegion(cx: number, cy: number, d: number, segments = 96): Pt[][] {
  const r = d / 2;
  const loop: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    loop.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return [loop];
}

/** A regular n-gon of circumradius `r` at (cx,cy), first vertex at `rotRad`. */
function regularPolygon(cx: number, cy: number, r: number, n: number, rotRad: number): Pt[] {
  const loop: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotRad + (2 * Math.PI * i) / n;
    loop.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return loop;
}

/** A `points`-pointed star (outer radius `ro`, inner `ri`) at (cx,cy), first
 *  outer point up. */
function starLoop(cx: number, cy: number, ro: number, ri: number, points: number): Pt[] {
  const loop: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / points;
    const r = i % 2 === 0 ? ro : ri;
    loop.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return loop;
}

function bbox(rings: Pt[][]): { minX: number; minY: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { minX: x0, minY: y0, w: x1 - x0, h: y1 - y0 };
}

/** A glyph as a region: the baked outline, uniformly scaled so its larger
 *  dimension is `sizeMm`, centred at (cx,cy). */
function letterRegion(ch: string, cx: number, cy: number, sizeMm: number): Pt[][] {
  const raw = renderText(ch, sizeMm, { x: 0, y: 0 });
  const b = bbox(raw);
  const s = sizeMm / (Math.max(b.w, b.h) || 1);
  const bcx = b.minX + b.w / 2, bcy = b.minY + b.h / 2;
  return raw.map((ring) => ring.map((p) => ({ x: cx + (p.x - bcx) * s, y: cy + (p.y - bcy) * s })));
}

/** A closed region (Pt[][]) for one test cell, bounded by ~`sizeMm`, centred at
 *  (cx,cy). The part fed to spiralFromRegion. */
export function shapeRegion(shape: CellShape, cx: number, cy: number, sizeMm: number): Pt[][] {
  const r = sizeMm / 2;
  switch (shape) {
    case "circle": return circleRegion(cx, cy, sizeMm);
    case "square": return [regularPolygon(cx, cy, r, 4, Math.PI / 4)];
    case "diamond": return [regularPolygon(cx, cy, r, 4, -Math.PI / 2)];
    case "hexagon": return [regularPolygon(cx, cy, r, 6, -Math.PI / 2)];
    case "octagon": return [regularPolygon(cx, cy, r, 8, Math.PI / 8)];
    case "star": return [starLoop(cx, cy, r, r * 0.4, 5)];
    case "letterJ": return letterRegion("J", cx, cy, sizeMm);
  }
}
