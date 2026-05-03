import { useMemo, useRef, useState } from "react";
import type { Lab } from "../color/math";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import {
  AxisMeta,
  binHistogram,
  fmtTick,
  formatYValue,
  isDeltaAxis,
  niceBounds,
  niceTicks,
  seriesColour,
  SeriesInput,
  XAxis,
  YAxis,
} from "./stabilityChartMath";

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
  const connectorsActive = multiRun && hasAnySpread && showConnectors;

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

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
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
    setHoverIdx(bestI >= 0 ? bestI : null);
  };

  const hovered = hoverIdx != null ? rows[hoverIdx] : null;
  const hoveredAnchor =
    hovered != null
      ? { x: xToPx(hovered.x), y: yToPx(meanY(hovered)) }
      : null;
  const hoveredSpread = hoverIdx != null ? rowSpread[hoverIdx] : null;

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
        onMouseLeave={() => setHoverIdx(null)}
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

      {multiRun && hasAnySpread && (
        <div className="absolute top-2 right-2 z-10">
          <ConnectorsToggle
            on={showConnectors}
            onChange={setShowConnectors}
          />
        </div>
      )}

      {hovered && hoveredAnchor && (
        <HoverCard
          row={hovered}
          series={series}
          yMeta={yMeta}
          spread={multiRun ? hoveredSpread?.spread ?? null : null}
          anchorPx={hoveredAnchor}
          plotW={W}
          plotH={H}
        />
      )}
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

/** Spread is always non-negative (max - min); strip the formatter's
 *  leading "+" so the value reads as a magnitude, not a directional
 *  delta. */
function formatSpread(v: number, unit: string): string {
  return formatYValue(Math.abs(v), unit).replace(/^\+/, "");
}

/* ─── Toolbar ─────────────────────────────────────────────────────────── */

function ConnectorsToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={on ? "Hide spread connectors" : "Show spread connectors"}
      className={cn(
        "h-7 px-2.5 rounded-[6px] font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold tabular-nums border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        on
          ? "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]"
          : "bg-[color:var(--color-surface)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
      )}
    >
      Connectors
    </button>
  );
}

function HoverCard({
  row,
  series,
  yMeta,
  spread,
  anchorPx,
  plotW,
  plotH,
}: {
  row: ScatterRow;
  series: SeriesInput[];
  yMeta: AxisMeta;
  spread: number | null;
  anchorPx: { x: number; y: number };
  plotW: number;
  plotH: number;
}) {
  // Edge-aware: prefer right + below, flip on overflow. Anchor is
  // expressed in viewBox space so we use percent positioning to stay
  // honest under preserveAspectRatio="xMidYMid meet".
  const TOOLTIP_W = 280;
  const TOOLTIP_H = 56 + series.length * 22 + (spread != null ? 18 : 0);
  const leftPct = (anchorPx.x / plotW) * 100;
  const topPct = (anchorPx.y / plotH) * 100;
  const rightOverflow = leftPct > 60;
  const bottomOverflow = topPct > 60;
  const transform = `translate(${rightOverflow ? `calc(-100% - 14px)` : `14px`}, ${bottomOverflow ? `calc(-100% - 14px)` : `14px`})`;
  return (
    <div
      role="tooltip"
      className="absolute z-10 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] shadow-lg p-2.5 pointer-events-none"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: TOOLTIP_W,
        minHeight: TOOLTIP_H,
        transform,
      }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          cell #{row.cell.cell_index}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
          {row.cell.expected_hex}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div
          aria-hidden
          className="h-7 w-7 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ backgroundColor: row.cell.expected_hex }}
        />
        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
          expected
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {series.map((s, i) => {
          const p = row.perSeries[i];
          if (!p) return null;
          const colour = seriesColour(i);
          const measuredHex = s.cells.get(row.cell.cell_index)?.hex ?? null;
          return (
            <div
              key={s.resultId}
              className="flex items-center gap-2 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: colour }}
              />
              {measuredHex ? (
                <span
                  aria-hidden
                  className="h-4 w-4 rounded-[2px] border border-[color:var(--color-border-strong)] shrink-0"
                  style={{ background: measuredHex }}
                />
              ) : (
                <span
                  aria-hidden
                  className="h-4 w-4 rounded-[2px] border border-dashed border-[color:var(--color-border-strong)] shrink-0"
                />
              )}
              <span className="text-[color:var(--color-ink-subtle)] truncate flex-1">
                {s.label}
              </span>
              <span>
                {Number.isFinite(p.y) ? formatYValue(p.y, yMeta.unit) : "—"}
              </span>
            </div>
          );
        })}
        {spread != null && (
          <div className="mt-1 pt-1 border-t border-[color:var(--color-border)] flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
            <span>spread</span>
            <span className="tabular-nums normal-case tracking-normal text-[10.5px] text-[color:var(--color-ink-muted)]">
              {formatSpread(spread, yMeta.unit)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
