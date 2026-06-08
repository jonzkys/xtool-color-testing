// Generic closed-ring geometry summaries. No Forge / domain coupling — any caller
// with `Pt[][]` (a set of closed loops in mm) can use these.
export interface Pt { x: number; y: number }

/** Shoelace signed area of one closed loop (mm²). */
function signedArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Closed perimeter of one loop (mm). */
function loopPerimeter(loop: Pt[]): number {
  let p = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/** Axis-aligned bounding box (width/height in mm) over every point in every ring. */
export function ringsBBox(rings: Pt[][]): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0 };
  return { w: maxX - minX, h: maxY - minY };
}

/**
 * Even-odd filled area (mm²). Forge rings are `[outer, inner]` (a band) or a
 * single solid loop (a pocket): area = |outer| − Σ|inner|, clamped ≥ 0.
 */
export function ringsFillArea(rings: Pt[][]): number {
  if (rings.length === 0) return 0;
  const areas = rings.map((r) => Math.abs(signedArea(r)));
  const [outer, ...inner] = areas;
  return Math.max(0, outer - inner.reduce((s, a) => s + a, 0));
}

/** Sum of every ring's closed perimeter (mm). */
export function ringsPerimeter(rings: Pt[][]): number {
  return rings.reduce((s, r) => s + loopPerimeter(r), 0);
}
