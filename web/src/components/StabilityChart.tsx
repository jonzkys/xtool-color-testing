import { useMemo } from "react";
import type { Lab } from "../color/math";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import { ScatterRow, StabilityScatter } from "./StabilityScatter";
import { StabilityHeatmap } from "./StabilityHeatmap";
import {
  AxisMeta,
  computeXValue,
  computeYValue,
  perCellSigmaFor,
  seriesColour,
  SeriesInput,
  X_AXES,
  XAxis,
  Y_AXES,
  YAxis,
} from "./stabilityChartMath";
import { isHeatmapMetric } from "./stabilityHeatmapMath";

// Re-export public surface so the page only needs to import from
// `StabilityChart`.
export type { SeriesInput, XAxis, YAxis } from "./stabilityChartMath";
export { seriesColour } from "./stabilityChartMath";

export type ChartMode = "scatter" | "spatial";

/** Surface a hover/click came from. Drives the page-level "should this
 *  view's mouse-leave clear the transient focus?" decision so a
 *  transient hover in one view never wipes a pinned focus in another. */
export type FocusSource = "scatter" | "heatmap" | "stats";

/** Page-level focus state shared between the scatter, the heatmap, and
 *  the stats strip. ``transient`` is a hover; ``pinned`` is a click
 *  that survives until cleared. ``null`` means no cell is in focus. */
export type FocusedCell =
  | { kind: "transient"; cellIndex: number; source: FocusSource }
  | { kind: "pinned"; cellIndex: number; source: FocusSource }
  | null;

interface Props {
  cells: ValidationCell[];
  series: SeriesInput[];
  xAxis: XAxis;
  yAxis: YAxis;
  onXAxisChange: (a: XAxis) => void;
  onYAxisChange: (a: YAxis) => void;
  /** Active visualisation. ``scatter`` keeps the existing colour-space
   *  view; ``spatial`` swaps to a (row, col) heatmap. */
  mode: ChartMode;
  onModeChange: (m: ChartMode) => void;
  /** Width of the test's physical row, used by the spatial heatmap.
   *  ``null`` when the test malformed; the heatmap mode then renders
   *  empty. */
  cellsPerRow: number | null;
  /** Page-level focus state — see ``FocusedCell`` above. */
  focusedCell: FocusedCell;
  onHover: (cellIndex: number, source: FocusSource) => void;
  onHoverLeave: (source: FocusSource) => void;
  onClick: (cellIndex: number, source: FocusSource) => void;
  /** Click on the chart background (not on a cell). Page decides
   *  whether the source matches. */
  onBackgroundClear: (source: FocusSource) => void;
}

/**
 * Centre column of the Stability page — axis selectors plus an SVG
 * scatter that draws one coloured series per selected result. The
 * scatter implementation lives in StabilityScatter; this component
 * owns the axis-pill row, the legend strip, and the empty-state
 * fallback that mirrors the loaded chart's grid layout.
 */
export function StabilityChart({
  cells,
  series,
  xAxis,
  yAxis,
  onXAxisChange,
  onYAxisChange,
  mode,
  onModeChange,
  cellsPerRow,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
}: Props) {
  const xMeta = X_AXES.find((a) => a.id === xAxis)!;
  const yMeta = Y_AXES.find((a) => a.id === yAxis)!;

  const rows = useMemo<ScatterRow[]>(() => {
    const out: ScatterRow[] = [];
    for (const c of cells) {
      const expectedLab = c.expected_lab as Lab | number[];
      if (!Array.isArray(expectedLab) || expectedLab.length !== 3) continue;
      const exp: Lab = [expectedLab[0], expectedLab[1], expectedLab[2]];
      const x = computeXValue(xAxis, c.cell_index, exp);
      if (!Number.isFinite(x)) continue;
      const perSeries: { measured: Lab | null; y: number }[] = series.map(
        (s) => {
          const m = s.cells.get(c.cell_index);
          if (!m) return { measured: null, y: NaN };
          const y = computeYValue(
            yAxis,
            exp,
            m.lab,
            perCellSigmaFor(c.cell_index, series),
          );
          return { measured: m.lab, y };
        },
      );
      out.push({ cell: c, expected: exp, x, perSeries });
    }
    return out;
  }, [cells, series, xAxis, yAxis]);

  const hasAnySeries = series.length > 0;
  const hasAnyData = hasAnySeries && rows.some((r) =>
    r.perSeries.some((p) => Number.isFinite(p.y)),
  );

  // In spatial mode, only metrics that aggregate per-cell make sense.
  // If the user's chosen yAxis isn't one of those, fall back to ΔE for
  // the heatmap render — but don't mutate the page's stored axis, so a
  // toggle back to scatter restores their original choice.
  const heatmapMetric = isHeatmapMetric(yAxis) ? yAxis : "delta_e";

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <ChartHeader
        xAxis={xAxis}
        yAxis={yAxis}
        onXAxisChange={onXAxisChange}
        onYAxisChange={onYAxisChange}
        series={series}
        mode={mode}
        onModeChange={onModeChange}
      />
      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        {mode === "scatter" ? (
          hasAnySeries && hasAnyData ? (
            <StabilityScatter
              rows={rows}
              series={series}
              xMeta={xMeta}
              yMeta={yMeta}
              xAxis={xAxis}
              yAxis={yAxis}
              focusedCell={focusedCell}
              onHover={(idx) => onHover(idx, "scatter")}
              onHoverLeave={() => onHoverLeave("scatter")}
              onClick={(idx) => onClick(idx, "scatter")}
              onBackgroundClear={() => onBackgroundClear("scatter")}
            />
          ) : (
            <EmptyChart xMeta={xMeta} yMeta={yMeta} hasSeries={hasAnySeries} />
          )
        ) : cellsPerRow == null ? (
          <EmptyChart xMeta={xMeta} yMeta={yMeta} hasSeries={hasAnySeries} />
        ) : (
          <StabilityHeatmap
            cells={cells}
            series={series}
            metric={heatmapMetric}
            cellsPerRow={cellsPerRow}
            focusedCell={focusedCell}
            onHover={(idx) => onHover(idx, "heatmap")}
            onHoverLeave={() => onHoverLeave("heatmap")}
            onClick={(idx) => onClick(idx, "heatmap")}
            onBackgroundClear={() => onBackgroundClear("heatmap")}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Header (axis pills + legend) ────────────────────────────────────── */

function ChartHeader({
  xAxis,
  yAxis,
  onXAxisChange,
  onYAxisChange,
  series,
  mode,
  onModeChange,
}: {
  xAxis: XAxis;
  yAxis: YAxis;
  onXAxisChange: (a: XAxis) => void;
  onYAxisChange: (a: YAxis) => void;
  series: SeriesInput[];
  mode: ChartMode;
  onModeChange: (m: ChartMode) => void;
}) {
  // In spatial mode the X axis is meaningless (no abscissa to vary
  // along); the Y axis row keeps its segmented look but its options
  // narrow to per-cell-aggregable metrics, and the row label switches
  // from "Y axis" to "metric" so the visual register matches the
  // actual mental model.
  const yLegend = mode === "spatial" ? "Metric" : "Y axis";
  const yAxes = mode === "spatial"
    ? Y_AXES.filter((a) => isHeatmapMetric(a.id as YAxis))
    : Y_AXES;
  return (
    <div className="px-4 pt-4 pb-3 border-b border-[color:var(--color-border)]">
      <div className="flex flex-col gap-2">
        <ModeToggleRow mode={mode} onChange={onModeChange} />
        <AxisRow
          legend={yLegend}
          axes={yAxes}
          value={yAxis}
          onChange={(v) => onYAxisChange(v as YAxis)}
        />
        {mode === "scatter" && (
          <AxisRow
            legend="X axis"
            axes={X_AXES}
            value={xAxis}
            onChange={(v) => onXAxisChange(v as XAxis)}
          />
        )}
      </div>
      {series.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            Series
          </span>
          {series.map((s, i) => (
            <span
              key={s.resultId}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-2 py-0.5"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: seriesColour(i) }}
              />
              <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
                {s.label}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeToggleRow({
  mode,
  onChange,
}: {
  mode: ChartMode;
  onChange: (m: ChartMode) => void;
}) {
  const options: { id: ChartMode; label: string }[] = [
    { id: "scatter", label: "Scatter" },
    { id: "spatial", label: "Spatial" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] w-[44px] shrink-0">
        Mode
      </span>
      <div className="inline-flex rounded-[6px] border border-[color:var(--color-border)] overflow-hidden">
        {options.map((o, i) => {
          const active = o.id === mode;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={active}
              className={cn(
                "h-7 px-3 font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold tabular-nums",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
                i > 0 && "border-l border-[color:var(--color-border)]",
                active
                  ? "bg-[color:var(--color-primary)] text-white"
                  : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AxisRow({
  legend,
  axes,
  value,
  onChange,
}: {
  legend: string;
  axes: readonly AxisMeta[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] w-[44px] shrink-0">
        {legend}
      </span>
      <div className="flex flex-wrap gap-1">
        {axes.map((a) => {
          const active = a.id === value;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onChange(a.id)}
              aria-pressed={active}
              className={cn(
                "h-7 px-2.5 rounded-[6px] font-mono text-[10.5px] tracking-[0.12em] uppercase font-semibold tabular-nums",
                "border transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
                active
                  ? "bg-[color:var(--color-primary)] text-white border-[color:var(--color-primary)]"
                  : "bg-[color:var(--color-surface)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
              )}
              title={a.label}
            >
              {a.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Empty state ──────────────────────────────────────────────────────── */

function EmptyChart({
  xMeta,
  yMeta,
  hasSeries,
}: {
  xMeta: AxisMeta;
  yMeta: AxisMeta;
  hasSeries: boolean;
}) {
  const W = 720;
  const H = 440;
  const PADL = 56;
  const PADR = 18;
  const PADT = 18;
  const PADB = 44;
  return (
    <div className="relative h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]"
        aria-hidden
      >
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line
            key={`gy-${f}`}
            x1={PADL}
            x2={W - PADR}
            y1={PADT + f * (H - PADT - PADB)}
            y2={PADT + f * (H - PADT - PADB)}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.45}
          />
        ))}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line
            key={`gx-${f}`}
            x1={PADL + f * (W - PADL - PADR)}
            x2={PADL + f * (W - PADL - PADR)}
            y1={PADT}
            y2={H - PADB}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.3}
          />
        ))}
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
          y={H - 10}
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
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
            {hasSeries
              ? "No comparable cells in the selected results"
              : "Select one or more results to compare"}
          </div>
        </div>
      </div>
    </div>
  );
}
