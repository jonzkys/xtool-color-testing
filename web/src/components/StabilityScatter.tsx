import { useMemo, useRef, useState } from "react";
import type { Lab } from "../color/math";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import {
  computeTrendBins,
  MeanLineLayer,
  QuadrantGuides,
  TrendLineLayer,
  trendApplicable,
  trendBinCount,
  type TrendBinSummary,
} from "./stabilityChartLayers";
import {
  AxisMeta,
  binHistogram,
  fmtTick,
  isBurnAxis,
  isComputedXAxis,
  isComputedYAxis,
  isDeltaAxis,
  medianCross,
  niceBounds,
  niceTicks,
  seriesColour,
  SeriesInput,
  XAxis,
  YAxis,
} from "./stabilityChartMath";
import { StabilityHoverCard } from "./stabilityChartTooltip";
import { HelpTip } from "./StabilityHelpTip";
import { TOOLBAR_HELP } from "./stabilityHelpCopy";
import { ScatterFocusHalos } from "./stabilityScatterFocusOverlay";
import type { FocusedCell } from "./StabilityChart";

export interface ScatterRow {
  cell: ValidationCell;
  expected: Lab;
  x: number;
  perSeries: { measured: Lab | null; y: number }[];
}

interface Props {
  rows: ScatterRow[];
  series: SeriesInput[];
  xMeta: AxisMeta;
  yMeta: AxisMeta;
  xAxis: XAxis;
  yAxis: YAxis;
  /** Page-wide focused cell. Drives halos + (when pinned) a sticky
   *  tooltip; null = no focus. */
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  /** Click on the SVG outside any dot. */
  onBackgroundClear: () => void;
}

/**
 * SVG scatter with one coloured series per selected result. Mirrors
 * SpectrumPage's PlotSvg vocabulary (dashed grid, mono ticks,
 * primary-tinted axes). Adds an identity diagonal when the X and Y
 * dimensions match (e.g. expected hue vs. measured hue) so users can
 * read distance-from-perfect at a glance, and a zero line for signed
 * delta axes. Hover crosshair + tooltip card live alongside.
 *
 * Two extra layers when more than one run is selected:
 *  - Spread connectors: vertical bars per cell from min(y) to max(y)
 *    of the runs at that cell, behind the dots. Long bars flag noisy
 *    cells; short bars flag repeatable burns. Toggleable from the
 *    top-right toolbar.
 *  - Marginal histograms: muted density strips outside the plot area
 *    (bottom = X distribution, right = Y distribution). Always on
 *    once 1+ runs is selected.
 */
export function StabilityScatter({
  rows,
  series,
  xMeta,
  yMeta,
  xAxis,
  yAxis,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
}: Props) {
  // Padding grew on the right + bottom by 28 px (4 gap + 24 strip) to
  // host the marginal histograms outside the data area without
  // shrinking the plot grid.
  const W = 748;
  const H = 468;
  const PADL = 56;
  const PADR = 28;
  const PADT = 18;
  const PADB = 72;
  const STRIP = 24;
  const STRIP_GAP = 4;

  const allXs = rows.map((r) => r.x);
  const allYs: number[] = [];
  for (const r of rows) {
    for (const p of r.perSeries) {
      if (Number.isFinite(p.y)) allYs.push(p.y);
    }
  }

  let { min: xMin, max: xMax } = niceBounds(
    allXs,
    xAxis === "expected_hue" ? [0, 360] : null,
  );
  let { min: yMin, max: yMax } = niceBounds(allYs, null);

  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  } else {
    const pad = (xMax - xMin) * 0.025;
    xMin -= pad;
    xMax += pad;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  } else {
    const pad = (yMax - yMin) * 0.05;
    yMin -= pad;
    yMax += pad;
  }
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const xToPx = (x: number) =>
    PADL + ((x - xMin) / xRange) * (W - PADL - PADR);
  const yToPx = (y: number) =>
    PADT + (1 - (y - yMin) / yRange) * (H - PADT - PADB);

  const xTicks = niceTicks(xMin, xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 6);

  // Identity diagonal helps the eye read distance-from-perfect when X
  // and Y are the same dimension family (expected hue × measured hue,
  // etc.). The iter-6 computed axes (burn ΔE / burn Δh° / camera σ)
  // never match a measured-* Y, so they fall through to "no diagonal"
  // automatically — including the degenerate same-axis case.
  const showDiagonal =
    (xAxis === "expected_hue" && yAxis === "measured_hue") ||
    (xAxis === "expected_l" && yAxis === "measured_l") ||
    (xAxis === "expected_a" && yAxis === "measured_a") ||
    (xAxis === "expected_b" && yAxis === "measured_b") ||
    (xAxis === "expected_chroma" && yAxis === "measured_chroma");

  // Spread per row: min..max of finite y across the runs at this
  // cell. null when fewer than 2 runs sampled it (no bar to draw).
  // Shared by the connector layer and the tooltip footer.
  const rowSpread = useMemo(() => {
    return rows.map((r) => {
      let lo = Infinity;
      let hi = -Infinity;
      let n = 0;
      for (const p of r.perSeries) {
        if (!Number.isFinite(p.y)) continue;
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
        n += 1;
      }
      if (n < 2) return null;
      return { lo, hi, spread: hi - lo };
    });
  }, [rows]);

  const multiRun = series.length >= 2;
  const hasAnySpread = rowSpread.some((s) => s != null);
  const [showConnectors, setShowConnectors] = useState(true);
  const [showTrend, setShowTrend] = useState(false);
  const connectorsActive = multiRun && hasAnySpread && showConnectors;

  // Per-series flat list of finite (x, y) + projected pixels. Reused by
  // the mean line layer, the trend line layer, and the tooltip's
  // "trend at h=B°" lookup so we only walk `rows` once.
  const perSeriesPoints = useMemo(() => {
    return series.map((_, sIdx) => {
      const points: { x: number; y: number; xPx: number; yPx: number }[] = [];
      for (const r of rows) {
        const p = r.perSeries[sIdx];
        if (!p || !Number.isFinite(p.y)) continue;
        points.push({
          x: r.x,
          y: p.y,
          xPx: xToPx(r.x),
          yPx: yToPx(p.y),
        });
      }
      return { points };
    });
    // xToPx/yToPx are pure projections of the scale state — refreshing
    // when bounds or rows change is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, rows, xMin, xMax, yMin, yMax]);

  const trendBins = useMemo<TrendBinSummary[][]>(() => {
    if (!trendApplicable(xAxis)) return [];
    return computeTrendBins(
      perSeriesPoints,
      xMin,
      xMax,
      trendBinCount(xAxis, rows.length),
    );
  }, [perSeriesPoints, xAxis, xMin, xMax, rows.length]);

  const trendActive = showTrend && trendApplicable(xAxis) && rows.length > 0;
  const trendBinTotal = trendApplicable(xAxis)
    ? trendBinCount(xAxis, rows.length)
    : 0;

  // Marginal histograms project onto the same axis bounds as the
  // scatter so bars align with the plot grid.
  const xHist = useMemo(
    () => binHistogram(allXs, xMin, xMax, 24),
    [allXs, xMin, xMax],
  );
  const yHist = useMemo(
    () => binHistogram(allYs, yMin, yMax, 24),
    [allYs, yMin, yMax],
  );

  // Median-cross fires whenever Y is computed-per-cell — at that
  // point each cell ladders to a single Y value. Burn-Y axes already
  // overlay a mean + trend reference, so the cross is suppressed
  // there. Corner labels need both axes computed and the canonical
  // BURN ΔE × CAMERA σ pair to read cleanly.
  const computedX = isComputedXAxis(xAxis);
  const computedY = isComputedYAxis(yAxis);
  const showMedianCross = computedY && !isBurnAxis(yAxis);
  const median = useMemo(() => {
    if (!showMedianCross) return { medianX: null, medianY: null, count: 0 };
    // De-dupe by (x, y) — when X is per-run-expected and Y is the
    // per-cell σ, every run at a cell carries the same Y at the same
    // X, so collapsing keeps the median honest.
    const pairs: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const p = r.perSeries.find((q) => Number.isFinite(q.y));
      if (!p || !Number.isFinite(r.x)) continue;
      const key = `${r.x.toFixed(6)}|${p.y.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ x: r.x, y: p.y });
    }
    return medianCross(pairs);
  }, [showMedianCross, rows]);
  const showQuadrantLabels =
    computedX && computedY &&
    xAxis === "burn_delta_e" && yAxis === "per_cell_sigma";

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Threshold (squared, in viewBox px) for treating a cursor as "on" a
  // dot. Tightened to ~14 px because at 22 px the threshold reached
  // farther than the typical inter-cell gap on a dense scatter — the
  // cursor would "snap" onto cell B while pointing at empty space
  // between B and C, and the cross-view halo would jump confusingly.
  // 14 px is roughly the dot's own radius + a small forgiving margin,
  // small enough that empty-space hovers stay empty.
  const HIT_RADIUS_SQ = 14 * 14;

  // Cursor → nearest-dot lookup. Returns the row index (or -1) plus
  // the squared distance so callers can decide whether the cursor was
  // close enough for focus dispatch (HIT_RADIUS_SQ) versus the looser
  // tooltip selection (always nearest).
  const nearestRow = (e: React.MouseEvent<SVGSVGElement>) => {
    // Use the SVG's screen-CTM inverse so we get viewBox coordinates
    // that respect ``preserveAspectRatio="xMidYMid meet"`` — without
    // this, the previous linear-interp mapping over the container's
    // bounding rect treats the letterbox bands as part of the chart
    // and the resulting viewBox X drifts: cursor on the left half
    // resolves to a viewBox-X further right than the actual dot under
    // it (so selection appears to shift right), and vice versa on the
    // right half. Most visible at wide aspect ratios where the
    // horizontal letterbox is largest. ``getScreenCTM().inverse()`` is
    // the canonical way to round-trip a screen point through any
    // SVG with letterboxing or transforms.
    const svg = svgRef.current;
    if (!svg) return { i: -1, d: Infinity };
    const ctm = svg.getScreenCTM();
    if (ctm == null) return { i: -1, d: Infinity };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const inv = ctm.inverse();
    const local = pt.matrixTransform(inv);
    const px = local.x;
    const py = local.y;
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const rx = xToPx(rows[i].x);
      for (const p of rows[i].perSeries) {
        if (!Number.isFinite(p.y)) continue;
        const ry = yToPx(p.y);
        const d = (rx - px) ** 2 + (ry - py) ** 2;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    }
    return { i: bestI, d: bestD };
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const { i, d } = nearestRow(e);
    // Local hover (drives the tooltip + crosshair) honours the same
    // hit radius the cross-view dispatch uses. The previous version
    // set hoverIdx unconditionally on the nearest dot — even when the
    // cursor was 50 px out in empty space — which made the tooltip
    // appear to "follow" your cursor with stale data and caused the
    // user-reported "snapping from too far away" feel.
    if (i >= 0 && d <= HIT_RADIUS_SQ) {
      setHoverIdx(i);
      onHover(rows[i].cell.cell_index);
    } else {
      setHoverIdx(null);
      onHoverLeave();
    }
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const { i, d } = nearestRow(e);
    if (i >= 0 && d <= HIT_RADIUS_SQ) {
      onClick(rows[i].cell.cell_index);
    } else {
      onBackgroundClear();
    }
  };

  const hovered = hoverIdx != null ? rows[hoverIdx] : null;
  const hoveredAnchor =
    hovered != null
      ? { x: xToPx(hovered.x), y: yToPx(meanY(hovered)) }
      : null;
  const hoveredSpread = hoverIdx != null ? rowSpread[hoverIdx] : null;

  // Focused cell projection. Looked up once per render so the halos /
  // pinned tooltip / vertical guide all draw from the same arithmetic.
  const focusInfo = useMemo(() => {
    if (focusedCell == null) return null;
    const rowIdx = rows.findIndex(
      (r) => r.cell.cell_index === focusedCell.cellIndex,
    );
    if (rowIdx < 0) return null;
    const r = rows[rowIdx];
    const points: ({ x: number; y: number; sIdx: number } | null)[] = r
      .perSeries.map((p, sIdx) => {
        if (!Number.isFinite(p.y)) return null;
        return { x: xToPx(r.x), y: yToPx(p.y), sIdx };
      });
    let topAnchor: { x: number; y: number } | null = null;
    for (const p of points) {
      if (p == null) continue;
      if (topAnchor == null || p.y < topAnchor.y) topAnchor = { x: p.x, y: p.y };
    }
    return { rowIdx, points, topAnchor, spread: rowSpread[rowIdx] };
  // xToPx/yToPx project from current bounds — same dependency set as
  // the perSeriesPoints memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCell, rows, rowSpread, xMin, xMax, yMin, yMax]);
  // Resolve which bin the hover sits inside so the tooltip can echo
  // each series' trend value at that X. Returns null when trend is off
  // or the cursor lands outside the binned range.
  const hoveredBinIdx = useMemo(() => {
    if (!trendActive || hovered == null) return null;
    if (trendBinTotal <= 0) return null;
    const range = xMax - xMin;
    if (range <= 0) return null;
    let idx = Math.floor(((hovered.x - xMin) / range) * trendBinTotal);
    if (idx >= trendBinTotal) idx = trendBinTotal - 1;
    if (idx < 0) idx = 0;
    return idx;
  }, [trendActive, hovered, xMin, xMax, trendBinTotal]);

  // Bottom strip baseline sits at the bottom edge of the strip; bars
  // grow upward toward the plot area.
  const xStripBottom = H;
  // Right strip baseline sits at its left edge; bars grow rightward.
  const yStripLeft = W - STRIP;
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;

  return (
    <div className="relative h-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHoverIdx(null);
          onHoverLeave();
        }}
        onClick={onSvgClick}
      >
        {yTicks.map((t) => (
          <line
            key={`gy-${t}`}
            x1={PADL}
            x2={W - PADR}
            y1={yToPx(t)}
            y2={yToPx(t)}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.6}
          />
        ))}
        {xTicks.map((t) => (
          <line
            key={`gx-${t}`}
            x1={xToPx(t)}
            x2={xToPx(t)}
            y1={PADT}
            y2={H - PADB}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.4}
          />
        ))}

        {showDiagonal && (
          <line
            x1={xToPx(Math.max(xMin, yMin))}
            y1={yToPx(Math.max(xMin, yMin))}
            x2={xToPx(Math.min(xMax, yMax))}
            y2={yToPx(Math.min(xMax, yMax))}
            stroke="var(--color-primary)"
            strokeDasharray="6 4"
            strokeWidth={1}
            opacity={0.45}
          />
        )}
        {isDeltaAxis(yAxis) && yMin < 0 && yMax > 0 && (
          <line
            x1={PADL}
            x2={W - PADR}
            y1={yToPx(0)}
            y2={yToPx(0)}
            stroke="var(--color-ink-subtle)"
            strokeDasharray="4 3"
            opacity={0.5}
          />
        )}

        {/* Median-cross + (canonical) quadrant labels. */}
        {showMedianCross && (
          <QuadrantGuides
            median={median}
            xMeta={xMeta}
            yMeta={yMeta}
            xToPx={xToPx}
            yToPx={yToPx}
            plotLeft={PADL}
            plotRight={W - PADR}
            plotTop={PADT}
            plotBottom={H - PADB}
            showCanonicalLabels={showQuadrantLabels}
          />
        )}

        <line
          x1={PADL}
          x2={PADL}
          y1={PADT}
          y2={H - PADB}
          stroke="var(--color-border-strong)"
        />
        <line
          x1={PADL}
          x2={W - PADR}
          y1={H - PADB}
          y2={H - PADB}
          stroke="var(--color-border-strong)"
        />

        {/* Spread connectors live under the dots so dots stay legible. */}
        {connectorsActive &&
          rows.map((r, ri) => {
            const sp = rowSpread[ri];
            if (!sp) return null;
            const cx = xToPx(r.x);
            return (
              <line
                key={`sp-${ri}`}
                x1={cx}
                x2={cx}
                y1={yToPx(sp.lo)}
                y2={yToPx(sp.hi)}
                stroke="var(--color-ink-subtle)"
                strokeWidth={1}
                opacity={0.35}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

        {/* Per-series mean line. Always on; sits below dots so a faint
            reference doesn't outshout the cell-level cloud. Caption is
            suppressed when it would land on the right marginal strip. */}
        <MeanLineLayer
          series={series}
          perSeriesPoints={perSeriesPoints}
          yMeta={yMeta}
          yToPx={yToPx}
          plotLeft={PADL}
          plotRight={W - PADR}
          captionMaxX={yStripLeft - 2}
        />

        {series.map((s, sIdx) => {
          const colour = seriesColour(sIdx);
          return (
            <g key={s.resultId}>
              {rows.map((r, ri) => {
                const p = r.perSeries[sIdx];
                if (!p || !Number.isFinite(p.y)) return null;
                const cx = xToPx(r.x);
                const cy = yToPx(p.y);
                const focused = ri === hoverIdx;
                return (
                  <circle
                    key={`${s.resultId}-${ri}`}
                    cx={cx}
                    cy={cy}
                    r={focused ? 5.2 : 3.4}
                    fill={colour}
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth={0.6}
                    opacity={focused ? 1 : 0.85}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Smoothed binned-mean trend line — sits above dots so the line
            reads as the answer to "where is each run going on average?". */}
        {trendActive && trendBinTotal > 0 && (
          <TrendLineLayer
            series={series}
            perSeriesPoints={perSeriesPoints}
            xMin={xMin}
            xMax={xMax}
            binCount={trendBinTotal}
            xToPx={xToPx}
            yToPx={yToPx}
          />
        )}

        {/* Focus halos + vertical guide. Sit above dots so the primary
            ring stays visible; pinned vs. transient is encoded in the
            stroke opacity / dash inside the helper. */}
        {focusInfo && (
          <ScatterFocusHalos
            rows={rows}
            series={series}
            xMeta={xMeta}
            yMeta={yMeta}
            focusedCell={focusedCell}
            perSeriesPx={focusInfo.points}
            topAnchor={focusInfo.topAnchor}
            plotTop={PADT}
            plotBottom={H - PADB}
            plotLeft={PADL}
            plotRight={W - PADR}
            W={W}
            H={H}
            focusedSpread={
              multiRun ? focusInfo.spread?.spread ?? null : null
            }
          />
        )}

        {hoveredAnchor && (
          <line
            x1={hoveredAnchor.x}
            x2={hoveredAnchor.x}
            y1={PADT}
            y2={H - PADB}
            stroke="var(--color-primary)"
            strokeDasharray="3 3"
            opacity={0.45}
          />
        )}

        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={PADL - 6}
            y={yToPx(t) + 3}
            textAnchor="end"
            className="fill-[color:var(--color-ink-muted)]"
            style={{ font: "10px var(--font-mono)" }}
          >
            {fmtTick(t)}
          </text>
        ))}
        {xTicks.map((t) => (
          <text
            key={`xl-${t}`}
            x={xToPx(t)}
            y={H - PADB + 16}
            textAnchor="middle"
            className="fill-[color:var(--color-ink-muted)]"
            style={{ font: "10px var(--font-mono)" }}
          >
            {fmtTick(t)}
          </text>
        ))}

        {/* Marginal histograms — visual texture, no labels. Y strip
            flips bin index so it reads in the same direction as the
            axis (bin 0 = lowest Y). */}
        {xHist.maxCount > 0 && (
          <g aria-hidden>
            <line
              x1={PADL}
              x2={W - PADR}
              y1={xStripBottom}
              y2={xStripBottom}
              stroke="var(--color-border)"
            />
            {xHist.counts.map((c, i) =>
              c <= 0 ? null : (
                <rect
                  key={`xh-${i}`}
                  x={PADL + i * (plotW / xHist.counts.length) + 0.5}
                  y={xStripBottom - (c / xHist.maxCount) * STRIP}
                  width={Math.max(0, plotW / xHist.counts.length - 1)}
                  height={(c / xHist.maxCount) * STRIP}
                  fill="var(--color-ink-subtle)"
                  opacity={0.5}
                />
              ),
            )}
          </g>
        )}
        {yHist.maxCount > 0 && (
          <g aria-hidden>
            <line
              x1={yStripLeft}
              x2={yStripLeft}
              y1={PADT}
              y2={H - PADB}
              stroke="var(--color-border)"
            />
            {yHist.counts.map((c, i) =>
              c <= 0 ? null : (
                <rect
                  key={`yh-${i}`}
                  x={yStripLeft}
                  y={
                    PADT +
                    (yHist.counts.length - 1 - i) *
                      (plotH / yHist.counts.length) +
                    0.5
                  }
                  width={(c / yHist.maxCount) * STRIP}
                  height={Math.max(0, plotH / yHist.counts.length - 1)}
                  fill="var(--color-ink-subtle)"
                  opacity={0.5}
                />
              ),
            )}
          </g>
        )}

        <text
          x={PADL - 42}
          y={PADT + (H - PADT - PADB) / 2}
          textAnchor="middle"
          className="fill-[color:var(--color-ink-subtle)]"
          transform={`rotate(-90, ${PADL - 42}, ${PADT + (H - PADT - PADB) / 2})`}
          style={{
            font: "600 9.5px var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {yMeta.label}
        </text>
        <text
          x={(W - PADL - PADR) / 2 + PADL}
          y={H - STRIP - STRIP_GAP - 2}
          textAnchor="middle"
          className="fill-[color:var(--color-ink-subtle)]"
          style={{
            font: "600 9.5px var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {xMeta.label}
        </text>
      </svg>

      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        {trendActive && (
          <span
            aria-hidden
            className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]"
          >
            Trend · {trendBinTotal} bins
          </span>
        )}
        {trendApplicable(xAxis) && rows.length > 0 && (
          <HelpTip help={TOOLBAR_HELP.trend}>
            <ToolbarPill
              label="Trend"
              on={showTrend}
              onChange={setShowTrend}
              titleOn="Hide hue-binned trend"
              titleOff="Show hue-binned trend"
            />
          </HelpTip>
        )}
        {multiRun && hasAnySpread && (
          <HelpTip help={TOOLBAR_HELP.connectors}>
            <ToolbarPill
              label="Connectors"
              on={showConnectors}
              onChange={setShowConnectors}
              titleOn="Hide spread connectors"
              titleOff="Show spread connectors"
            />
          </HelpTip>
        )}
      </div>

      {hovered && hoveredAnchor && (
        <StabilityHoverCard
          row={hovered}
          series={series}
          xMeta={xMeta}
          yMeta={yMeta}
          spread={multiRun ? hoveredSpread?.spread ?? null : null}
          trendRows={
            trendActive && hoveredBinIdx != null
              ? series.map((_, sIdx) => {
                  const bin = trendBins[sIdx]?.[hoveredBinIdx];
                  if (!bin || !Number.isFinite(bin.mean)) return null;
                  return { center: bin.center, mean: bin.mean };
                })
              : null
          }
          anchorPx={hoveredAnchor}
          plotW={W}
          plotH={H}
        />
      )}

      {/* The chart's only tooltip is the cursor-tracked
          ``StabilityHoverCard`` above. Pinned focus is already
          communicated by the on-chart halo + vertical guide AND the
          deep ``StabilityFocusedCellPanel`` in the right strip — the
          previous ``ScatterFocusPinnedCard`` here was a third copy of
          the same info that anchored to the cursor, producing the
          user-reported "two tooltips, content drifts off the dot"
          confusion. The focused-cell panel is the place to read deep
          per-cell data; the chart tooltip is purely hover-preview. */}
    </div>
  );
}

function meanY(row: ScatterRow): number {
  let n = 0;
  let s = 0;
  for (const p of row.perSeries) {
    if (Number.isFinite(p.y)) {
      s += p.y;
      n++;
    }
  }
  return n > 0 ? s / n : 0;
}

/* ─── Toolbar ─────────────────────────────────────────────────────────── */

function ToolbarPill({
  label,
  on,
  onChange,
  titleOn,
  titleOff,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  titleOn: string;
  titleOff: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? titleOn : titleOff}
      className={cn(
        "h-7 px-2.5 rounded-[6px] font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold tabular-nums border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        on
          ? "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]"
          : "bg-[color:var(--color-surface)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
      )}
    >
      {label}
    </button>
  );
}

