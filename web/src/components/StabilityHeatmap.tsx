import { useMemo, useState } from "react";
import {
  formatYValue,
  Y_AXES,
  type AxisMeta,
  type SeriesInput,
  type YAxis,
} from "./stabilityChartMath";
import {
  buildHeatmapCells,
  cellTintCss,
  computeHeatmapRange,
  defaultFloor,
  inferPhysicalRows,
  isDivergingMetric,
  isHeatmapMetric,
  requiresMultiRun,
  type HeatmapCell,
  type HeatmapMetric,
} from "./stabilityHeatmapMath";
import { StabilityHeatmapHoverCard } from "./stabilityHeatmapTooltip";
import { HeatmapCellRect } from "./stabilityHeatmapCell";
import type { ValidationCell } from "../types";
import type { FocusedCell } from "./StabilityChart";

interface Props {
  cells: ValidationCell[];
  series: SeriesInput[];
  metric: YAxis;
  cellsPerRow: number;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  onBackgroundClear: () => void;
}

/**
 * Spatial mode of the Stability page. Shows a `cellsPerRow ×
 * physicalRows` grid mirroring the workpiece; each cell is tinted by
 * the active metric (ΔE / ΔL / Δa / Δb / Δh° / σ) so spatial bias —
 * a corner that always burns hot, a row with high run-to-run noise —
 * reads at a glance.
 *
 * Empty grid positions render as a hatched stripe so the user can see
 * the layout's edge. Inside each populated cell, an 8 px expected-hex
 * bar along the bottom anchors the eye to "this cell is meant to be
 * this colour" without crowding the heat with text.
 */
export function StabilityHeatmap({
  cells,
  series,
  metric,
  cellsPerRow,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
}: Props) {
  const safeMetric: HeatmapMetric = isHeatmapMetric(metric)
    ? metric
    : "delta_e";

  const physicalRows = inferPhysicalRows(cells.length, cellsPerRow);

  const data = useMemo<HeatmapCell[]>(
    () => buildHeatmapCells(cells, series, safeMetric, cellsPerRow),
    [cells, series, safeMetric, cellsPerRow],
  );

  const range = useMemo(
    () =>
      computeHeatmapRange(
        data.map((d) => d.value),
        safeMetric,
        defaultFloor(safeMetric),
      ),
    [data, safeMetric],
  );

  const yMeta = Y_AXES.find((a) => a.id === safeMetric);
  const hasAnyData = data.some((d) => Number.isFinite(d.value));
  const hasAnySeries = series.length > 0;
  const needsMultiRun = requiresMultiRun(safeMetric);
  const tooFewRunsForSigma = needsMultiRun && series.length < 2;

  if (!hasAnySeries) {
    return <EmptyHeatmap message="Select one or more results to compare" />;
  }
  if (cells.length === 0) {
    return <EmptyHeatmap message="No swatches in this result" />;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <Grid
        cells={data}
        cellsPerRow={cellsPerRow}
        physicalRows={physicalRows}
        metric={safeMetric}
        yMeta={yMeta}
        range={range}
        series={series}
        hasAnyData={hasAnyData && !tooFewRunsForSigma}
        tooFewRunsForSigma={tooFewRunsForSigma}
        focusedCell={focusedCell}
        onHover={onHover}
        onHoverLeave={onHoverLeave}
        onClick={onClick}
        onBackgroundClear={onBackgroundClear}
      />
      {hasAnyData && !tooFewRunsForSigma && (
        <RampLegend metric={safeMetric} range={range} yMeta={yMeta} />
      )}
    </div>
  );
}

/* ─── Grid ─────────────────────────────────────────────────────────────── */

function Grid({
  cells,
  cellsPerRow,
  physicalRows,
  metric,
  yMeta,
  range,
  series,
  hasAnyData,
  tooFewRunsForSigma,
  focusedCell,
  onHover,
  onHoverLeave,
  onClick,
  onBackgroundClear,
}: {
  cells: HeatmapCell[];
  cellsPerRow: number;
  physicalRows: number;
  metric: HeatmapMetric;
  yMeta: AxisMeta | undefined;
  range: { min: number; max: number };
  series: SeriesInput[];
  hasAnyData: boolean;
  tooFewRunsForSigma: boolean;
  focusedCell: FocusedCell;
  onHover: (cellIndex: number) => void;
  onHoverLeave: () => void;
  onClick: (cellIndex: number) => void;
  onBackgroundClear: () => void;
}) {
  // Index by (row, col) so render is a single sweep.
  const grid = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of cells) m.set(`${c.row}.${c.col}`, c);
    return m;
  }, [cells]);

  // Auto-fit cells to the available canvas while staying square. Cap at
  // 56 px so a sparse 6×3 doesn't blow up to fill the screen.
  const PAD_LEFT = 32;
  const PAD_TOP = 22;
  const PAD_RIGHT = 16;
  const PAD_BOTTOM = 16;
  // Container width drives the SVG viewBox; we lock it to a base width
  // and let preserveAspectRatio handle scaling. The aspect ratio of
  // the SVG follows the grid's natural ratio so cells render as
  // squares regardless of column count.
  const CELL = 40;
  const W = PAD_LEFT + cellsPerRow * CELL + PAD_RIGHT;
  const H = PAD_TOP + physicalRows * CELL + PAD_BOTTOM;

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hovered = hoverKey ? grid.get(hoverKey) ?? null : null;

  // Tooltip prefers the focused cell when one is set so the right
  // info card mirrors the same cell the halo / outline is on. Falls
  // back to the iter-3 hover behaviour (last cell the cursor brushed)
  // when nothing is focused.
  const focusedHeatmapCell =
    focusedCell != null
      ? cells.find((c) => c.cellIndex === focusedCell.cellIndex) ?? null
      : null;
  const tooltipCell = focusedHeatmapCell ?? hovered;

  return (
    <div className="relative flex-1 min-h-0 rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block"
        onMouseLeave={() => {
          setHoverKey(null);
          onHoverLeave();
        }}
        onClick={(e) => {
          // Only fire background-clear when the click landed on the
          // SVG itself (not on a child <g>); per-cell <g> handles
          // stop propagation by re-firing onClick before this fires.
          if (e.target === e.currentTarget) onBackgroundClear();
        }}
      >
        <defs>
          <pattern
            id="heatmap-empty-hatch"
            patternUnits="userSpaceOnUse"
            width={6}
            height={6}
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={6}
              stroke="var(--color-border)"
              strokeWidth={1}
              opacity={0.6}
            />
          </pattern>
        </defs>

        {/* Column labels along the top edge. */}
        {Array.from({ length: cellsPerRow }, (_, c) => (
          <text
            key={`cl-${c}`}
            x={PAD_LEFT + c * CELL + CELL / 2}
            y={PAD_TOP - 7}
            textAnchor="middle"
            className="fill-[color:var(--color-ink-subtle)]"
            style={{
              font: "600 9.5px var(--font-mono)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            c{c}
          </text>
        ))}
        {/* Row labels along the left edge. */}
        {Array.from({ length: physicalRows }, (_, r) => (
          <text
            key={`rl-${r}`}
            x={PAD_LEFT - 6}
            y={PAD_TOP + r * CELL + CELL / 2 + 3}
            textAnchor="end"
            className="fill-[color:var(--color-ink-subtle)]"
            style={{
              font: "600 9.5px var(--font-mono)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            r{r}
          </text>
        ))}

        {/* One rect per (row, col); empty positions get the hatch.
            Per-cell rendering + hover/click handlers live in the
            `HeatmapCellRect` helper to keep this file under budget. */}
        {Array.from({ length: physicalRows }, (_, r) =>
          Array.from({ length: cellsPerRow }, (_, c) => {
            const key = `${r}.${c}`;
            return (
              <HeatmapCellRect
                key={`g-${key}`}
                row={r}
                col={c}
                cell={grid.get(key) ?? null}
                x={PAD_LEFT + c * CELL}
                y={PAD_TOP + r * CELL}
                size={CELL}
                metric={metric}
                range={range}
                hasAnyData={hasAnyData}
                tooFewRunsForSigma={tooFewRunsForSigma}
                isHovered={hoverKey === key}
                focusedCell={focusedCell}
                onHover={onHover}
                onClick={onClick}
                onBackgroundClear={onBackgroundClear}
                onSetHoverKey={setHoverKey}
              />
            );
          }),
        )}
      </svg>

      {tooFewRunsForSigma && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] bg-[color:var(--color-surface)]/85 px-3 py-2 rounded-[6px] border border-[color:var(--color-border)]">
            {metric === "per_cell_sigma"
              ? "σ across runs needs ≥ 2 results selected"
              : "Burn-true metrics need ≥ 2 results selected"}
          </div>
        </div>
      )}

      {tooltipCell && yMeta && (
        <StabilityHeatmapHoverCard
          cell={tooltipCell}
          series={series}
          metric={metric}
          yMeta={yMeta}
        />
      )}
    </div>
  );
}

/* ─── Ramp legend ──────────────────────────────────────────────────────── */

function RampLegend({
  metric,
  range,
  yMeta,
}: {
  metric: HeatmapMetric;
  range: { min: number; max: number };
  yMeta: AxisMeta | undefined;
}) {
  const stops = useMemo(() => {
    const n = 16;
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const value = isDivergingMetric(metric)
        ? range.min + t * (range.max - range.min)
        : t * range.max;
      const tint = cellTintCss(metric, value, range);
      return { tint, value };
    });
  }, [metric, range]);

  return (
    <div className="shrink-0 flex items-center gap-3 px-1">
      <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {yMeta ? yMeta.short : metric}
      </span>
      <div className="flex h-3 flex-1 overflow-hidden rounded-[2px] border border-[color:var(--color-border)]">
        {stops.map((s, i) => (
          <div
            key={i}
            className="flex-1"
            style={{ background: s.tint ?? "var(--color-surface)" }}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">
        <span>{formatLegendValue(range.min, yMeta?.unit ?? "")}</span>
        {isDivergingMetric(metric) && (
          <span className="text-[color:var(--color-ink-subtle)]">0</span>
        )}
        <span>{formatLegendValue(range.max, yMeta?.unit ?? "")}</span>
      </div>
    </div>
  );
}

function formatLegendValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  return formatYValue(v, unit);
}

/* ─── Empty state ──────────────────────────────────────────────────────── */

function EmptyHeatmap({ message }: { message: string }) {
  return (
    <div className="flex-1 min-h-0 rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] flex items-center justify-center">
      <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] text-center">
        {message}
      </div>
    </div>
  );
}
