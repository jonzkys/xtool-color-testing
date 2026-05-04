import { Fragment, type CSSProperties } from "react";
import {
  binnedMean,
  formatYValue,
  seriesColour,
  seriesMeanY,
  type AxisMeta,
  type MedianCrossResult,
  type SeriesInput,
  type XAxis,
} from "./stabilityChartMath";

/**
 * Reference-line overlays for the stability scatter:
 *  - `MeanLineLayer` draws one faint dashed horizontal per series at
 *    that series' mean Y value, with a mono caption pinned to the
 *    right edge.
 *  - `TrendLineLayer` slices X into equal-width bins, averages Y per
 *    bin per series, and renders a smoothed Catmull-Rom-as-cubic-Bezier
 *    polyline through the bin centres. Sparse bins (n<2) break the line
 *    rather than triggering an extrapolation.
 *
 * Lives outside `StabilityScatter.tsx` so the scatter file stays under
 * its 700-line budget. The layers are pure SVG — they take pre-projected
 * coordinates from the scatter's scales and emit `<g>` fragments.
 */

/* ─── Trend bin counts ────────────────────────────────────────────────── */

const HUE_AXES: ReadonlySet<XAxis> = new Set(["expected_hue"]);

/** Pick the bin count for a given X axis + sample size. Hue families
 *  prefer 18 bins (20° each on a wrapped wheel reads naturally), other
 *  numeric axes go to 24. Below 60 cells we drop to 12 so each bin keeps
 *  enough samples to clear the n≥2 floor. Capped at 24. */
export function trendBinCount(xAxis: XAxis, cellCount: number): number {
  const base = HUE_AXES.has(xAxis) ? 18 : 24;
  if (cellCount < 60) return Math.min(12, base);
  return Math.min(24, base);
}

/** Trend layer is hidden when the X axis is `cell index` — averaging
 *  over a pure index isn't meaningful (each cell is its own bin). */
export function trendApplicable(xAxis: XAxis): boolean {
  return xAxis !== "cell_index";
}

/* ─── Mean line ───────────────────────────────────────────────────────── */

interface SeriesPoints {
  /** Pre-projected (xPx, yPx) and the underlying Y value, one entry per
   *  finite point in the series. */
  points: { x: number; y: number; xPx: number; yPx: number }[];
}

interface MeanLineProps {
  series: SeriesInput[];
  perSeriesPoints: SeriesPoints[];
  yMeta: AxisMeta;
  /** Project a Y value to pixel space. */
  yToPx: (y: number) => number;
  /** Plot rectangle in viewBox units; mean line spans this horizontally. */
  plotLeft: number;
  plotRight: number;
  /** Right-edge caption is suppressed past this X (so it doesn't sit on
   *  top of the right marginal histogram strip). */
  captionMaxX: number;
}

export function MeanLineLayer({
  series,
  perSeriesPoints,
  yMeta,
  yToPx,
  plotLeft,
  plotRight,
  captionMaxX,
}: MeanLineProps) {
  return (
    <g aria-hidden>
      {series.map((s, sIdx) => {
        const pts = perSeriesPoints[sIdx];
        if (!pts) return null;
        const mean = seriesMeanY(pts.points.map((p) => p.y));
        if (mean == null) return null;
        const colour = seriesColour(sIdx);
        const yPx = yToPx(mean);
        const captionX = plotRight - 4;
        const showCaption = captionX <= captionMaxX;
        return (
          <Fragment key={`mean-${s.resultId}`}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={yPx}
              y2={yPx}
              stroke={colour}
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
            {showCaption && (
              <text
                x={captionX}
                y={yPx - 4}
                textAnchor="end"
                fill={colour}
                opacity={0.7}
                style={{
                  font: "600 9px var(--font-mono)",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                }}
              >
                MEAN {formatYValue(mean, yMeta.unit)}
              </text>
            )}
          </Fragment>
        );
      })}
    </g>
  );
}

/* ─── Trend line ──────────────────────────────────────────────────────── */

interface TrendLineProps {
  series: SeriesInput[];
  perSeriesPoints: SeriesPoints[];
  xMin: number;
  xMax: number;
  binCount: number;
  xToPx: (x: number) => number;
  yToPx: (y: number) => number;
}

/** Per-series trend bins exposed to the scatter for tooltip lookups. */
export interface TrendBinSummary {
  center: number;
  n: number;
  mean: number;
}

export function computeTrendBins(
  perSeriesPoints: SeriesPoints[],
  xMin: number,
  xMax: number,
  binCount: number,
): TrendBinSummary[][] {
  return perSeriesPoints.map((sp) =>
    binnedMean(
      sp.points.map((p) => ({ x: p.x, y: p.y })),
      xMin,
      xMax,
      binCount,
    ),
  );
}

export function TrendLineLayer({
  series,
  perSeriesPoints,
  xMin,
  xMax,
  binCount,
  xToPx,
  yToPx,
}: TrendLineProps) {
  const binsPerSeries = computeTrendBins(
    perSeriesPoints,
    xMin,
    xMax,
    binCount,
  );
  return (
    <g aria-hidden>
      {series.map((s, sIdx) => {
        const bins = binsPerSeries[sIdx];
        if (!bins) return null;
        const colour = seriesColour(sIdx);
        // Walk left-to-right collecting contiguous runs of populated
        // bins; each run becomes its own smoothed path so empty bins
        // create real gaps in the line.
        const runs: { x: number; y: number }[][] = [];
        let current: { x: number; y: number }[] = [];
        for (const b of bins) {
          if (Number.isFinite(b.mean)) {
            current.push({ x: xToPx(b.center), y: yToPx(b.mean) });
          } else if (current.length > 0) {
            runs.push(current);
            current = [];
          }
        }
        if (current.length > 0) runs.push(current);
        return (
          <Fragment key={`trend-${s.resultId}`}>
            {runs.map((run, ri) => (
              <path
                key={`trend-${s.resultId}-${ri}`}
                d={smoothPath(run)}
                fill="none"
                stroke={colour}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </Fragment>
        );
      })}
    </g>
  );
}

/** Catmull-Rom spline expressed as a series of cubic Bezier `C` segments,
 *  with tension fixed at the standard 0.5. Single-point runs degenerate
 *  to a tiny "M" so they remain invisible-but-valid; two-point runs
 *  become a straight line. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M${p.x},${p.y}`;
  }
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  }
  const segs: string[] = [`M${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(`C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`);
  }
  return segs.join(" ");
}

/* ─── Quadrant guides ─────────────────────────────────────────────────────
 *
 * When BOTH the X and Y axes are computed-per-cell metrics, the
 * scatter draws a faint median-cross at (median X, median Y) so the
 * user can see at a glance which cells fall into each quadrant. For
 * the canonical BURN ΔE × CAMERA σ pair, four corner labels add a
 * one-glance verdict. Both layers sit between the grid and the dots
 * so the dot cloud always reads as the primary signal.
 */

interface QuadrantGuidesProps {
  median: MedianCrossResult;
  xMeta: AxisMeta;
  yMeta: AxisMeta;
  xToPx: (x: number) => number;
  yToPx: (y: number) => number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** When ``true``, renders the canonical BURN/CAMERA/OK/BOTH labels
   *  in each quadrant corner. Other computed-vs-computed pairs hide
   *  them — the four-way verdict only reads cleanly here. */
  showCanonicalLabels: boolean;
}

export function QuadrantGuides({
  median,
  xMeta,
  yMeta,
  xToPx,
  yToPx,
  plotLeft,
  plotRight,
  plotTop,
  plotBottom,
  showCanonicalLabels,
}: QuadrantGuidesProps) {
  const drawCross = median.medianX != null && median.medianY != null;
  if (!drawCross && !showCanonicalLabels) return null;
  return (
    <g aria-hidden>
      {drawCross && (
        <g>
          <line
            x1={xToPx(median.medianX!)}
            x2={xToPx(median.medianX!)}
            y1={plotTop}
            y2={plotBottom}
            stroke="var(--color-ink-subtle)"
            strokeDasharray="6 4"
            opacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={plotLeft}
            x2={plotRight}
            y1={yToPx(median.medianY!)}
            y2={yToPx(median.medianY!)}
            stroke="var(--color-ink-subtle)"
            strokeDasharray="6 4"
            opacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={xToPx(median.medianX!) + 4}
            y={plotTop + 10}
            className="fill-[color:var(--color-ink-subtle)]"
            opacity={0.6}
            style={QUADRANT_MED_STYLE}
          >
            MED {stripPlus(formatYValue(median.medianX!, xMeta.unit))}
          </text>
          <text
            x={plotRight - 4}
            y={yToPx(median.medianY!) - 4}
            textAnchor="end"
            className="fill-[color:var(--color-ink-subtle)]"
            opacity={0.6}
            style={QUADRANT_MED_STYLE}
          >
            MED {stripPlus(formatYValue(median.medianY!, yMeta.unit))}
          </text>
        </g>
      )}
      {showCanonicalLabels && (
        <g>
          <text
            x={plotRight - 8}
            y={plotTop + 12}
            textAnchor="end"
            className="fill-[color:var(--color-ink-subtle)]"
            opacity={0.5}
            style={QUADRANT_LABEL_STYLE}
          >
            BOTH ↗
          </text>
          <text
            x={plotLeft + 8}
            y={plotTop + 12}
            className="fill-[color:var(--color-ink-subtle)]"
            opacity={0.5}
            style={QUADRANT_LABEL_STYLE}
          >
            CAMERA ↖
          </text>
          <text
            x={plotRight - 8}
            y={plotBottom - 6}
            textAnchor="end"
            className="fill-[color:var(--color-ink-subtle)]"
            opacity={0.5}
            style={QUADRANT_LABEL_STYLE}
          >
            BURN ↘
          </text>
          <text
            x={plotLeft + 8}
            y={plotBottom - 6}
            className="fill-[color:var(--color-ink-subtle)]"
            opacity={0.5}
            style={QUADRANT_LABEL_STYLE}
          >
            OK ↙
          </text>
        </g>
      )}
    </g>
  );
}

const QUADRANT_MED_STYLE: CSSProperties = {
  font: "600 9.5px var(--font-mono)",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

const QUADRANT_LABEL_STYLE: CSSProperties = {
  font: "600 10px var(--font-mono)",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

function stripPlus(s: string): string {
  return s.replace(/^\+/, "");
}
