import * as React from "react";

/** A point already projected into SVG-pixel space, carrying the
 *  measured hex colour of the underlying palette entry. */
export interface ColourFieldPoint {
  readonly sx: number;
  readonly sy: number;
  readonly hex: string;
}

interface Props {
  /** Palette dots already projected to SVG-pixel space. The component
   *  doesn't know about indices/scales — it just paints what the
   *  caller projected. */
  points: readonly ColourFieldPoint[];
  /** Plot rectangle in SVG-viewport units (x0=left, y0=top, x1=right, y1=bottom). */
  plotRect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** Grid cell size in SVG units. Default 6 — gives ~100×55 cells over
   *  a typical 600×320 plot rectangle. Smaller = smoother but slower. */
  cellSize?: number;
  /** Number of nearest neighbours blended per cell. Default 12 —
   *  enough to smooth out single-point flicker without losing the
   *  colour-window shape. */
  k?: number;
  /** Backdrop opacity. Default 0.7 so the field reads strongly while
   *  still letting the dots above pop. */
  opacity?: number;
}

function parseHex(hex: string): readonly [number, number, number] {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (h.length !== 6) return [127, 127, 127];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

interface IndexedPoint {
  readonly sx: number;
  readonly sy: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function buildIndexedPoints(points: readonly ColourFieldPoint[]): IndexedPoint[] {
  return points.map((p) => {
    const [r, g, b] = parseHex(p.hex);
    return { sx: p.sx, sy: p.sy, r, g, b };
  });
}

/** kNN-weighted blend at the cell centre. Falloff: when the k-th
 *  neighbour is farther than `falloffStart * mean_spacing`, the cell
 *  fades to transparent so empty regions don't get hallucinated. */
function blendAt(
  cx: number, cy: number,
  pts: readonly IndexedPoint[],
  k: number,
  falloffStartPx: number,
  falloffEndPx: number,
): { hex: string; alpha: number } | null {
  if (pts.length === 0) return null;
  // Pick top-k by squared distance.
  const dists: { i: number; d2: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].sx - cx;
    const dy = pts[i].sy - cy;
    dists.push({ i, d2: dx * dx + dy * dy });
  }
  dists.sort((a, b) => a.d2 - b.d2);
  const top = dists.slice(0, Math.min(k, dists.length));
  // Weighted average, weight = 1 / (d² + ε).
  let wsum = 0;
  let rsum = 0;
  let gsum = 0;
  let bsum = 0;
  for (const { i, d2 } of top) {
    const w = 1 / (d2 + 4);  // ε=4px² so a dead-on hit doesn't dominate
    wsum += w;
    rsum += pts[i].r * w;
    gsum += pts[i].g * w;
    bsum += pts[i].b * w;
  }
  if (wsum === 0) return null;
  const hex = rgbToHex(rsum / wsum, gsum / wsum, bsum / wsum);

  // Distance to nearest neighbour drives the falloff.
  const nearest = Math.sqrt(top[0].d2);
  let alpha = 1;
  if (nearest > falloffStartPx) {
    const t = (nearest - falloffStartPx) / (falloffEndPx - falloffStartPx);
    alpha = Math.max(0, 1 - t);
  }
  return { hex, alpha };
}

export const ExposureColourField: React.FC<Props> = React.memo(({
  points, plotRect, cellSize = 6, k = 12, opacity = 0.7,
}) => {
  const { x0, y0, x1, y1 } = plotRect;
  const cells = React.useMemo(() => {
    if (points.length === 0) return [];
    const W = x1 - x0;
    const H = y1 - y0;
    if (W <= 0 || H <= 0) return [];

    // Auto-pick falloff thresholds from the data: median nearest-
    // neighbour distance among the visible points. Cells more than
    // ~3× that distance from any point fade out completely.
    const indexed = buildIndexedPoints(points);
    const sample = Math.min(64, indexed.length);
    const nnDists: number[] = [];
    for (let i = 0; i < sample; i++) {
      const a = indexed[i];
      let best = Infinity;
      for (let j = 0; j < indexed.length; j++) {
        if (i === j) continue;
        const dx = indexed[j].sx - a.sx;
        const dy = indexed[j].sy - a.sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
      if (Number.isFinite(best)) nnDists.push(Math.sqrt(best));
    }
    nnDists.sort((a, b) => a - b);
    const medianNN = nnDists.length > 0
      ? nnDists[Math.floor(nnDists.length / 2)]
      : 20;
    // Generous falloff — we want the field to fill the *reachable*
    // region, not just hug the dots. Empty zones (far from any data)
    // still fade out to nothing.
    const falloffStart = Math.max(16, medianNN * 3);
    const falloffEnd = Math.max(falloffStart + 10, medianNN * 8);

    const nx = Math.ceil(W / cellSize);
    const ny = Math.ceil(H / cellSize);
    const out: { sx: number; sy: number; w: number; h: number; hex: string; alpha: number }[] = [];
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        const sx = x0 + ix * cellSize;
        const sy = y0 + iy * cellSize;
        const cx = sx + cellSize / 2;
        const cy = sy + cellSize / 2;
        const v = blendAt(cx, cy, indexed, k, falloffStart, falloffEnd);
        if (v == null || v.alpha <= 0) continue;
        out.push({
          sx,
          sy,
          w: Math.min(cellSize, x1 - sx),
          h: Math.min(cellSize, y1 - sy),
          hex: v.hex,
          alpha: v.alpha,
        });
      }
    }
    return out;
  }, [points, x0, y0, x1, y1, cellSize, k]);

  if (cells.length === 0) return null;

  return (
    <g opacity={opacity} pointerEvents="none" aria-hidden>
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.sx}
          y={c.sy}
          width={c.w}
          height={c.h}
          fill={c.hex}
          fillOpacity={c.alpha}
        />
      ))}
    </g>
  );
});

ExposureColourField.displayName = "ExposureColourField";
