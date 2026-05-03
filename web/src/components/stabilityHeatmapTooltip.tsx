import { deltaE76 } from "../color/math";
import {
  formatYValue,
  seriesColour,
  type AxisMeta,
  type SeriesInput,
} from "./stabilityChartMath";
import type { HeatmapCell, HeatmapMetric } from "./stabilityHeatmapMath";

/**
 * Hover card for the spatial heatmap. Pinned to the top-right of the
 * grid so the cursor doesn't drag a tooltip across 60+ cells — at this
 * density a tracked tooltip flickers and obscures the cells it's
 * describing. The card mirrors the scatter's tooltip register: mono
 * uppercase headers, expected swatch + per-result chips, ΔE per run,
 * metric value tail.
 */
export function StabilityHeatmapHoverCard({
  cell,
  series,
  metric,
  yMeta,
}: {
  cell: HeatmapCell;
  series: SeriesInput[];
  metric: HeatmapMetric;
  yMeta: AxisMeta;
}) {
  return (
    <div
      role="tooltip"
      className="absolute top-3 right-3 z-10 rounded-[6px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] shadow-lg p-2.5 pointer-events-none"
      style={{ width: 260 }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          cell #{cell.cellIndex}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
          r{cell.row} · c{cell.col}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div
          aria-hidden
          className="h-7 w-7 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ backgroundColor: cell.expectedHex }}
        />
        <div className="flex flex-col">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
            expected
          </div>
          <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">
            {cell.expectedHex}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {series.map((s, i) => {
          const m = cell.measured[i];
          const colour = seriesColour(i);
          const dE = m ? deltaE76(cell.expectedLab, m.lab) : null;
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
              {m ? (
                <span
                  aria-hidden
                  className="h-4 w-4 rounded-[2px] border border-[color:var(--color-border-strong)] shrink-0"
                  style={{ background: m.hex }}
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
              <span>{m && dE != null ? `ΔE ${dE.toFixed(1)}` : "—"}</span>
            </div>
          );
        })}
        <div className="mt-1 pt-1 border-t border-[color:var(--color-border)] flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
          <span>{yMeta.short}</span>
          <span className="tabular-nums normal-case tracking-normal text-[10.5px] text-[color:var(--color-ink-muted)]">
            {Number.isFinite(cell.value)
              ? formatYValue(cell.value, yMeta.unit)
              : "—"}
          </span>
        </div>
        {series.length >= 2 && (
          <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
            <span>σ across runs</span>
            <span className="tabular-nums normal-case tracking-normal text-[10.5px] text-[color:var(--color-ink-muted)]">
              {Number.isFinite(cell.sigma) ? cell.sigma.toFixed(1) : "—"}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-[color:var(--color-border)] font-mono text-[9.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
        heat = {metric.replace(/_/g, " ")}
      </div>
    </div>
  );
}
