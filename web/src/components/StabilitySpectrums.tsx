import { useMemo, useRef, useState } from "react";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import {
  fmtTick,
  formatYValue,
  isComputedYAxis,
  isDeltaAxis,
  niceBounds,
  niceTicks,
  Y_AXES,
  type AxisMeta,
  type SeriesInput,
  type YAxis,
} from "./stabilityChartMath";
import {
  perCellRange,
  sortSpectrums,
  spectrumValueExtent,
  SPECTRUM_ORDERS,
  type CellSpectrum,
  type SpectrumOrder,
} from "./stabilitySpectrumsMath";
import { StabilitySpectrumHoverCard } from "./StabilitySpectrumsTooltip";
import type { FocusedCell } from "./StabilityChart";

/**
 * SPECTRUMS mode of the Stability page. One vertical mini-spectrum per
 * cell across the canvas: a thin bar from min(metric) to max(metric)
 * with a filled dot at the mean and an open tick at expected. Ordering
 * (X axis) is selectable — by expected hue / L* / chroma, cell number,
 * or per-cell range — so the user can scan for "saturated colours
 * drift more" or "the most-variable cells cluster left".
 *
 * Hover/click cross-link with the existing scatter and stats: the same
 * iter-4 focus halo lands on the bar, and clicking pins the cell so the
 * stats strip's TOP VARIABLE list highlights it.
 */
export interface StabilitySpectrumsProps {
  cells: ValidationCell[];
  series: SeriesInput[];
  metric: YAxis;
  onMetricChange: (m: YAxis) => void;
  order: SpectrumOrder;
  onOrderChange: (o: SpectrumOrder) => void;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  onBackgroundClear: () => void;
  /** Adds a ``· simulated`` suffix to the Y axis label so the user
   *  reads "this metric is post-correction". */
  simulationActive?: boolean;
}

export function StabilitySpectrums({
  cells,
  series,
  metric,
  order,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
  simulationActive,
}: StabilitySpectrumsProps) {
  const yMeta = Y_AXES.find((a) => a.id === metric)!;
  const orderMeta = SPECTRUM_ORDERS.find((o) => o.id === order)!;

  const spectrums = useMemo(
    () => perCellRange(cells, series, metric),
    [cells, series, metric],
  );
  const sorted = useMemo(
    () => sortSpectrums(spectrums, order),
    [spectrums, order],
  );

  const hasAnySeries = series.length > 0;
  const computed = isComputedYAxis(metric);
  // ``per_cell_sigma`` and burn-* axes need ≥2 runs.
  const needsMulti =
    metric === "per_cell_sigma" ||
    metric === "burn_delta_e" ||
    metric === "burn_delta_hue";
  const multiUnusable = needsMulti && series.length < 2;

  if (!hasAnySeries) {
    return <Empty message="Select one or more results to compare" />;
  }
  if (cells.length === 0) {
    return <Empty message="No swatches in this result" />;
  }
  if (multiUnusable) {
    return (
      <Empty
        message={
          metric === "per_cell_sigma"
            ? "σ across runs needs ≥ 2 results selected"
            : "Burn-true metrics need ≥ 2 results selected"
        }
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <SpectrumsCanvas
        sorted={sorted}
        yMeta={yMeta}
        orderMeta={orderMeta}
        order={order}
        computed={computed}
        focusedCell={focusedCell}
        onHover={onHover}
        onHoverLeave={onHoverLeave}
        onClick={onClick}
        onBackgroundClear={onBackgroundClear}
        series={series}
        simulationActive={simulationActive ?? false}
      />
    </div>
  );
}

/* ─── Canvas ───────────────────────────────────────────────────────────── */

const W = 760;
const H = 460;
const PADL = 56;
const PADR = 18;
const PADT = 36;   // legend strip
const PADB = 60;   // axis label band
const BAR_W = 6;
const BAR_GAP = 4;

function SpectrumsCanvas({
  sorted,
  yMeta,
  orderMeta,
  order,
  computed,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
  series,
  simulationActive,
}: {
  sorted: CellSpectrum[];
  yMeta: AxisMeta;
  orderMeta: { short: string; label: string };
  order: SpectrumOrder;
  computed: boolean;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  onBackgroundClear: () => void;
  series: SeriesInput[];
  simulationActive: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Y bounds across every visible spectrum.
  const ext = useMemo(() => spectrumValueExtent(sorted), [sorted]);
  let { min: yMin, max: yMax } = niceBounds(
    ext ? [ext.min, ext.max] : [],
    metricPreferredRange(yMeta.id as YAxis),
  );
  // Pad so dots aren't kissing the frame; for delta axes prefer a
  // symmetric range around 0 unless the data leans hard.
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  } else {
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }
  const yRange = yMax - yMin || 1;
  const plotTop = PADT;
  const plotBottom = H - PADB;
  const plotH = plotBottom - plotTop;
  const yToPx = (y: number) => plotTop + (1 - (y - yMin) / yRange) * plotH;

  // Bar geometry: each spectrum gets a fixed slot (BAR_W + BAR_GAP).
  // We compute the slot width to stretch across the available plot
  // area, falling back to BAR_W when there are too many cells to
  // afford the gap.
  const plotLeft = PADL;
  const plotRight = W - PADR;
  const plotW = plotRight - plotLeft;
  const slot = sorted.length > 0
    ? Math.max(BAR_W, Math.min(BAR_W + BAR_GAP, plotW / sorted.length))
    : BAR_W + BAR_GAP;
  const barW = Math.min(BAR_W, slot - 1);
  const totalContentW = sorted.length * slot;
  const offsetX = plotLeft + Math.max(0, (plotW - totalContentW) / 2);

  const xForIndex = (i: number) => offsetX + i * slot + slot / 2;

  // Hover hit-testing: nearest column.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const nearestIdx = (e: React.MouseEvent<SVGSVGElement>): number | null => {
    if (sorted.length === 0) return null;
    // Round-trip via getScreenCTM().inverse() so the cursor → viewBox
    // mapping respects ``preserveAspectRatio="xMidYMid meet"``.
    // Without this, the linear interp over the container's bounding
    // rect drifts horizontally on letterboxed viewports — cursor
    // lands in the wrong bar, with the bias growing toward the edges.
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (ctm == null) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const px = local.x;
    const py = local.y;
    if (py < plotTop || py > plotBottom) return null;
    if (px < offsetX - slot / 2 || px > offsetX + totalContentW + slot / 2) {
      return null;
    }
    const i = Math.floor((px - offsetX) / slot);
    if (i < 0 || i >= sorted.length) return null;
    return i;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const i = nearestIdx(e);
    if (i == null) {
      setHoverIdx(null);
      onHoverLeave();
      return;
    }
    setHoverIdx(i);
    onHover(sorted[i].cellIndex);
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const i = nearestIdx(e);
    if (i == null) {
      onBackgroundClear();
      return;
    }
    onClick(sorted[i].cellIndex);
  };

  // Tick marks for Y axis.
  const yTicks = niceTicks(yMin, yMax, 6);

  // X axis tick labels echo the chosen ordering. For numerical axes
  // (hue / L* / chroma / cell #), interpolate evenly across the
  // visible cells. For "range" we just show the cell-index labels at
  // both ends + middle.
  const xTickIndices = computeXTickIndices(sorted.length);

  const hovered = hoverIdx != null ? sorted[hoverIdx] : null;
  const hoveredAnchor = hovered != null
    ? { x: xForIndex(hoverIdx!), y: hovered.mean != null ? yToPx(hovered.mean) : (plotTop + plotBottom) / 2 }
    : null;

  return (
    <div className="relative flex-1 min-h-0">
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
        {/* Y gridlines. */}
        {yTicks.map((t) => (
          <line
            key={`gy-${t}`}
            x1={plotLeft}
            x2={plotRight}
            y1={yToPx(t)}
            y2={yToPx(t)}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.55}
          />
        ))}
        {/* Zero line for delta axes. */}
        {(isDeltaAxis(yMeta.id as YAxis) || yMeta.id === "burn_delta_hue") &&
          yMin < 0 && yMax > 0 && (
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={yToPx(0)}
              y2={yToPx(0)}
              stroke="var(--color-ink-subtle)"
              strokeDasharray="4 3"
              opacity={0.5}
            />
          )}

        {/* Y axis. */}
        <line
          x1={plotLeft}
          x2={plotLeft}
          y1={plotTop}
          y2={plotBottom}
          stroke="var(--color-border-strong)"
        />
        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          stroke="var(--color-border-strong)"
        />

        {/* Mini-spectrums. Each cell's bar + mean dot + expected tick. */}
        {sorted.map((s, i) => {
          const cx = xForIndex(i);
          const isFocused =
            focusedCell != null && focusedCell.cellIndex === s.cellIndex;
          const isHovered = i === hoverIdx;
          return (
            <SpectrumBar
              key={`sb-${s.cellIndex}`}
              cellSpectrum={s}
              cx={cx}
              barW={barW}
              yToPx={yToPx}
              isHovered={isHovered}
              isFocused={isFocused}
              focusedKind={isFocused ? focusedCell?.kind ?? null : null}
              computed={computed}
            />
          );
        })}

        {/* Vertical guide for hover. */}
        {hoveredAnchor && (
          <line
            x1={hoveredAnchor.x}
            x2={hoveredAnchor.x}
            y1={plotTop}
            y2={plotBottom}
            stroke="var(--color-primary)"
            strokeDasharray="3 3"
            opacity={0.45}
          />
        )}

        {/* Y tick labels. */}
        {yTicks.map((t) => (
          <text
            key={`yl-${t}`}
            x={plotLeft - 6}
            y={yToPx(t) + 3}
            textAnchor="end"
            className="fill-[color:var(--color-ink-muted)]"
            style={{ font: "10px var(--font-mono)" }}
          >
            {fmtTick(t)}
          </text>
        ))}

        {/* X axis tick labels — echo the chosen ordering. */}
        {xTickIndices.map((i) => {
          if (i < 0 || i >= sorted.length) return null;
          const cx = xForIndex(i);
          return (
            <g key={`xt-${i}`}>
              <line
                x1={cx}
                x2={cx}
                y1={plotBottom}
                y2={plotBottom + 4}
                stroke="var(--color-border-strong)"
                opacity={0.7}
              />
              <text
                x={cx}
                y={plotBottom + 16}
                textAnchor="middle"
                className="fill-[color:var(--color-ink-muted)]"
                style={{ font: "10px var(--font-mono)" }}
              >
                {formatXTick(order, sorted[i])}
              </text>
            </g>
          );
        })}

        {/* Y axis label. */}
        <text
          x={plotLeft - 42}
          y={plotTop + (plotBottom - plotTop) / 2}
          textAnchor="middle"
          className="fill-[color:var(--color-ink-subtle)]"
          transform={`rotate(-90, ${plotLeft - 42}, ${plotTop + (plotBottom - plotTop) / 2})`}
          style={{
            font: "600 9.5px var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {yMeta.label}{simulationActive ? " · simulated" : ""}
        </text>
        {/* X axis label band. */}
        <text
          x={(plotRight - plotLeft) / 2 + plotLeft}
          y={H - 14}
          textAnchor="middle"
          className="fill-[color:var(--color-ink-subtle)]"
          style={{
            font: "600 9.5px var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          ordered by · {orderMeta.label}
        </text>

        {/* Inline legend strip across the top. */}
        <Legend />
      </svg>

      {hovered && hoveredAnchor && (
        <StabilitySpectrumHoverCard
          spectrum={hovered}
          yMeta={yMeta}
          series={series}
          anchorPx={hoveredAnchor}
          plotW={W}
          plotH={H}
        />
      )}
    </div>
  );
}

/* ─── Per-cell bar render ─────────────────────────────────────────────── */

function SpectrumBar({
  cellSpectrum: s,
  cx,
  barW,
  yToPx,
  isHovered,
  isFocused,
  focusedKind,
  computed,
}: {
  cellSpectrum: CellSpectrum;
  cx: number;
  barW: number;
  yToPx: (y: number) => number;
  isHovered: boolean;
  isFocused: boolean;
  focusedKind: FocusedCell extends infer T
    ? T extends { kind: infer K }
      ? K
      : null
    : null;
  computed: boolean;
}) {
  const half = barW / 2;
  const hasRange =
    !computed && s.min != null && s.max != null && s.max > s.min + 1e-9;
  const meanY = s.mean != null ? yToPx(s.mean) : null;
  const expectedY = s.expected != null ? yToPx(s.expected) : null;

  // Bar fill: ink-subtle 50%; ink-muted on focus/hover.
  const barOpacity = isFocused ? 0.85 : isHovered ? 0.7 : 0.5;
  const barFill = "var(--color-ink-subtle)";

  return (
    <g>
      {/* Range bar — only visible when the cell has finite span. */}
      {hasRange && s.min != null && s.max != null && (
        <rect
          x={cx - half}
          y={yToPx(s.max)}
          width={barW}
          height={Math.max(1, yToPx(s.min) - yToPx(s.max))}
          fill={barFill}
          opacity={barOpacity}
          rx={1}
        />
      )}
      {/* Expected tick — open circle / horizontal tick mark. */}
      {expectedY != null && (
        <line
          x1={cx - half - 1.5}
          x2={cx + half + 1.5}
          y1={expectedY}
          y2={expectedY}
          stroke="var(--color-ink-muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
          opacity={0.7}
        />
      )}
      {/* Mean dot. */}
      {meanY != null && (
        <circle
          cx={cx}
          cy={meanY}
          r={isFocused ? 3.4 : isHovered ? 3.0 : 2.4}
          fill="var(--color-primary)"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={0.5}
        />
      )}
      {/* Focus outline — faint primary halo around the bar. */}
      {isFocused && (
        <rect
          x={cx - half - 2}
          y={Math.min(
            s.max != null ? yToPx(s.max) : yToPx(s.mean ?? 0),
            expectedY ?? yToPx(s.mean ?? 0),
          ) - 4}
          width={barW + 4}
          height={Math.abs(
            (s.min != null ? yToPx(s.min) : yToPx(s.mean ?? 0)) -
              Math.min(
                s.max != null ? yToPx(s.max) : yToPx(s.mean ?? 0),
                expectedY ?? yToPx(s.mean ?? 0),
              ),
          ) + 8}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={1.2}
          strokeDasharray={focusedKind === "transient" ? "3 3" : undefined}
          opacity={0.8}
          rx={2}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/* ─── Legend ──────────────────────────────────────────────────────────── */

function Legend() {
  // mono-uppercase 10px tracking-[0.16em] inline legend across the top.
  return (
    <g aria-hidden>
      <text
        x={PADL}
        y={20}
        className="fill-[color:var(--color-ink-subtle)]"
        style={{
          font: "600 9.5px var(--font-mono)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        <tspan>min</tspan>
        <tspan dx={4}>―</tspan>
        <tspan dx={6}>max</tspan>
        <tspan dx={10} fill="var(--color-primary)">●</tspan>
        <tspan dx={4}>mean</tspan>
        <tspan dx={10}>┄</tspan>
        <tspan dx={6}>expected</tspan>
      </text>
    </g>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function metricPreferredRange(metric: YAxis): [number, number] | null {
  if (metric === "measured_hue") return [0, 360];
  if (metric === "delta_hue" || metric === "burn_delta_hue") return [-30, 30];
  return null;
}

/** Pick up to 5 evenly-spaced indices to label on the X axis band. With
 *  ≤ 5 cells we label every one; otherwise four interior plus the
 *  endpoints. */
function computeXTickIndices(n: number): number[] {
  if (n === 0) return [];
  if (n <= 5) return Array.from({ length: n }, (_, i) => i);
  const desired = 5;
  const out = new Set<number>();
  for (let k = 0; k < desired; k++) {
    out.add(Math.round((k / (desired - 1)) * (n - 1)));
  }
  return [...out].sort((a, b) => a - b);
}

function formatXTick(order: SpectrumOrder, s: CellSpectrum): string {
  switch (order) {
    case "expected_hue":
      return `${Math.round(hueDegFromLab(s.expectedLab))}°`;
    case "expected_l":
      return s.expectedLab[0].toFixed(0);
    case "expected_chroma":
      return chromaFromLab(s.expectedLab).toFixed(0);
    case "cell_index":
      return `#${s.cellIndex}`;
    case "range":
      return `#${s.cellIndex}`;
  }
}

/** Tiny inlined helper to avoid pulling the whole color/math import in.
 *  Mirrors `hueDeg` semantics there. */
function hueDegFromLab(lab: readonly number[]): number {
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}

function chromaFromLab(lab: readonly number[]): number {
  return Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
}

/* ─── Empty state ─────────────────────────────────────────────────────── */

function Empty({ message }: { message: string }) {
  return (
    <div className={cn(
      "flex-1 min-h-0 rounded-[10px] border border-[color:var(--color-border)]",
      "bg-[color:var(--color-surface-elevated)] flex items-center justify-center",
    )}>
      <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] text-center">
        {message}
      </div>
    </div>
  );
}

/* ─── Order pill row ──────────────────────────────────────────────────── */

export function SpectrumOrderRow({
  order,
  onChange,
}: {
  order: SpectrumOrder;
  onChange: (o: SpectrumOrder) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 w-[64px] shrink-0">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          Order
        </span>
      </span>
      <div className="flex flex-wrap gap-1">
        {SPECTRUM_ORDERS.map((o) => {
          const active = o.id === order;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={active}
              className={cn(
                "h-7 px-2.5 rounded-[6px] font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold tabular-nums",
                "border transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
                active
                  ? "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]"
                  : "bg-[color:var(--color-surface)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
              )}
            >
              {o.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Format a per-cell metric value for the tooltip. Re-exported helpers
 *  from chart math keep formatting consistent. */
export { formatYValue };
