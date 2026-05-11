import * as React from "react";

/** A point already projected into SVG-pixel space, carrying the scalar
 *  value to contour over. Today that's L* (lightness); the component
 *  is value-agnostic so the parent can swap in chroma / hue / etc.
 *  without changing the algorithm. */
export interface ContourPoint {
  readonly sx: number;
  readonly sy: number;
  readonly value: number;
}

interface Props {
  /** Palette dots projected to SVG-pixel space with their channel
   *  value. Same projection the dots themselves use, so contours
   *  line up exactly with the dots. */
  points: readonly ContourPoint[];
  /** Plot rectangle in SVG-viewport units (x0=left, y0=top, x1=right, y1=bottom). */
  plotRect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** Optional explicit contour levels. When omitted the component
   *  picks 5 nice round levels spanning the data range. */
  levels?: readonly number[];
  /** Grid resolution along X. Default 80 → ~6-pixel cells over a 600-
   *  pixel plot, smooth enough that contours don't look stair-stepped. */
  gridX?: number;
  /** Grid resolution along Y. Default 40. */
  gridY?: number;
  /** Number of nearest neighbours blended per grid point. Default 8. */
  k?: number;
  /** Stroke colour used for the contour lines. Defaults to the
   *  workshop-instrument ink colour. */
  stroke?: string;
  /** Opacity of the contour layer. Default 0.65. */
  opacity?: number;
  /** When true, render a short label of the contour value at the
   *  midpoint of the longest segment per level. Default true. */
  showLabels?: boolean;
  /** Label rendered next to the value (e.g. "L*"). */
  valueLabel?: string;
}

interface IndexedPoint {
  readonly sx: number;
  readonly sy: number;
  readonly value: number;
}

/** kNN-weighted scalar interpolation at a grid corner (sx, sy). */
function interpolateAt(
  sx: number, sy: number,
  pts: readonly IndexedPoint[],
  k: number,
): number {
  if (pts.length === 0) return NaN;
  const dists: { i: number; d2: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].sx - sx;
    const dy = pts[i].sy - sy;
    dists.push({ i, d2: dx * dx + dy * dy });
  }
  dists.sort((a, b) => a.d2 - b.d2);
  const top = dists.slice(0, Math.min(k, dists.length));
  let wsum = 0;
  let vsum = 0;
  for (const { i, d2 } of top) {
    const w = 1 / (d2 + 4);  // ε=4px² so a dead-on hit doesn't dominate
    wsum += w;
    vsum += pts[i].value * w;
  }
  return wsum === 0 ? NaN : vsum / wsum;
}

/** Pick "nice round" contour levels covering [vmin, vmax].
 *  Aims for ~5 levels at step sizes from {2, 5, 10, 20, 50, ...}. */
function pickLevels(vmin: number, vmax: number): number[] {
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) return [];
  const span = vmax - vmin;
  const rough = span / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  let step = candidates[0];
  let bestDiff = Math.abs(candidates[0] - rough);
  for (const c of candidates) {
    const d = Math.abs(c - rough);
    if (d < bestDiff) { bestDiff = d; step = c; }
  }
  const first = Math.ceil(vmin / step) * step;
  const out: number[] = [];
  for (let v = first; v <= vmax; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Marching-squares case table.
 *  Bits: TL=1, TR=2, BR=4, BL=8 (corners above the contour level).
 *  Each case lists 0 or 2 edges per segment to interpolate between.
 *  Edge ids: 0=top, 1=right, 2=bottom, 3=left.
 *  Saddles (5, 10) emit two segments; we link TL↔BR / TR↔BL by default. */
type Edge = 0 | 1 | 2 | 3;
const CASE_TABLE: ReadonlyArray<ReadonlyArray<readonly [Edge, Edge]>> = [
  [],                                // 0  - - - -
  [[0, 3]],                          // 1  TL
  [[0, 1]],                          // 2  TR
  [[1, 3]],                          // 3  TL TR
  [[1, 2]],                          // 4  BR
  [[0, 1], [2, 3]],                  // 5  TL BR (saddle)
  [[0, 2]],                          // 6  TR BR
  [[2, 3]],                          // 7  TL TR BR
  [[2, 3]],                          // 8  BL
  [[0, 2]],                          // 9  TL BL
  [[0, 3], [1, 2]],                  // 10 TR BL (saddle)
  [[1, 2]],                          // 11 TL TR BL
  [[1, 3]],                          // 12 BR BL
  [[0, 1]],                          // 13 TL BR BL
  [[0, 3]],                          // 14 TR BR BL
  [],                                // 15 all above
];

interface Segment {
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
}

function edgePoint(
  edge: Edge,
  cellX: number, cellY: number, cellW: number, cellH: number,
  vTL: number, vTR: number, vBR: number, vBL: number,
  level: number,
): readonly [number, number] {
  // Linear interp t along edge; clamp to [0,1] for safety.
  const t = (a: number, b: number) => {
    const denom = b - a;
    if (denom === 0) return 0.5;
    return Math.max(0, Math.min(1, (level - a) / denom));
  };
  switch (edge) {
    case 0: { const u = t(vTL, vTR); return [cellX + u * cellW, cellY]; }
    case 1: { const u = t(vTR, vBR); return [cellX + cellW, cellY + u * cellH]; }
    case 2: { const u = t(vBL, vBR); return [cellX + u * cellW, cellY + cellH]; }
    case 3: { const u = t(vTL, vBL); return [cellX, cellY + u * cellH]; }
  }
}

export const ExposureContours: React.FC<Props> = React.memo(({
  points, plotRect,
  levels,
  gridX = 80, gridY = 40,
  k = 8,
  stroke = "var(--color-ink)",
  opacity = 0.55,
  showLabels = true,
  valueLabel = "L*",
}) => {
  const { x0, y0, x1, y1 } = plotRect;

  const rendered = React.useMemo(() => {
    if (points.length < 4) return null;
    const W = x1 - x0;
    const H = y1 - y0;
    if (W <= 0 || H <= 0) return null;

    const indexed: IndexedPoint[] = points.map((p) => ({ ...p }));
    const cellW = W / gridX;
    const cellH = H / gridY;

    // Build (gridX+1) × (gridY+1) grid of interpolated values at corners.
    const cols = gridX + 1;
    const rows = gridY + 1;
    const grid = new Float32Array(cols * rows);
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const sx = x0 + ix * cellW;
        const sy = y0 + iy * cellH;
        grid[iy * cols + ix] = interpolateAt(sx, sy, indexed, k);
      }
    }

    // Auto-pick levels if not supplied.
    let vmin = Infinity, vmax = -Infinity;
    for (const p of indexed) {
      if (p.value < vmin) vmin = p.value;
      if (p.value > vmax) vmax = p.value;
    }
    const lvls = levels && levels.length > 0
      ? [...levels]
      : pickLevels(vmin, vmax);

    // Walk cells emitting segments per level.
    const segments: { level: number; seg: Segment }[] = [];
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const vTL = grid[iy * cols + ix];
        const vTR = grid[iy * cols + ix + 1];
        const vBL = grid[(iy + 1) * cols + ix];
        const vBR = grid[(iy + 1) * cols + ix + 1];
        if (!Number.isFinite(vTL) || !Number.isFinite(vTR)
            || !Number.isFinite(vBL) || !Number.isFinite(vBR)) continue;
        const cellX = x0 + ix * cellW;
        const cellY = y0 + iy * cellH;
        for (const level of lvls) {
          let code = 0;
          if (vTL >= level) code |= 1;
          if (vTR >= level) code |= 2;
          if (vBR >= level) code |= 4;
          if (vBL >= level) code |= 8;
          const pairs = CASE_TABLE[code];
          for (const [eA, eB] of pairs) {
            const [ax, ay] = edgePoint(eA, cellX, cellY, cellW, cellH, vTL, vTR, vBR, vBL, level);
            const [bx, by] = edgePoint(eB, cellX, cellY, cellW, cellH, vTL, vTR, vBR, vBL, level);
            segments.push({ level, seg: { x1: ax, y1: ay, x2: bx, y2: by } });
          }
        }
      }
    }

    // For labels, pick one segment per level: take the median-x of each
    // level's segments so labels distribute reasonably.
    const labels: { level: number; x: number; y: number }[] = [];
    if (showLabels) {
      const byLevel = new Map<number, Segment[]>();
      for (const { level, seg } of segments) {
        const arr = byLevel.get(level) ?? [];
        arr.push(seg);
        byLevel.set(level, arr);
      }
      for (const [level, segs] of byLevel) {
        if (segs.length === 0) continue;
        const sorted = [...segs].sort((a, b) => (a.x1 + a.x2) - (b.x1 + b.x2));
        const mid = sorted[Math.floor(sorted.length / 2)];
        labels.push({ level, x: (mid.x1 + mid.x2) / 2, y: (mid.y1 + mid.y2) / 2 });
      }
    }

    return { segments, labels };
  }, [points, x0, y0, x1, y1, gridX, gridY, k, levels, showLabels]);

  if (rendered === null || rendered.segments.length === 0) return null;

  return (
    <g opacity={opacity} pointerEvents="none" aria-hidden>
      {rendered.segments.map((s, i) => (
        <line
          key={i}
          x1={s.seg.x1} y1={s.seg.y1}
          x2={s.seg.x2} y2={s.seg.y2}
          stroke={stroke}
          strokeWidth={0.7}
          strokeLinecap="round"
        />
      ))}
      {rendered.labels.map((l, i) => (
        <g key={`lbl-${i}`}>
          <rect
            x={l.x - 11} y={l.y - 6}
            width={22} height={12}
            fill="var(--color-surface-elevated)"
            fillOpacity={0.85}
            rx={1.5}
          />
          <text
            x={l.x} y={l.y + 3}
            textAnchor="middle"
            style={{ font: "9px var(--font-mono)", fontWeight: 600 }}
            fill={stroke}
          >
            {valueLabel}{Math.round(l.level)}
          </text>
        </g>
      ))}
    </g>
  );
});

ExposureContours.displayName = "ExposureContours";
