import { useMemo } from "react";
import type { ValidationCell } from "../types";
import { cn } from "../ui";
import { seriesColour } from "./StabilityChart";
import {
  AcrossRunsStats,
  PerResultStats,
  StatsSeriesEntry,
  computeAcrossRunsStats,
  computePerResultStats,
  signedNum,
} from "./stabilityStatsMath";

export type { StatsSeriesEntry } from "./stabilityStatsMath";

interface Props {
  cells: ValidationCell[];
  series: StatsSeriesEntry[];
  onFocusCell?: (cellIndex: number) => void;
}

/**
 * Right strip of the Stability page — one card per selected result
 * carrying mean ΔLab, median ΔE76, the worst-cell anchor, and a hue
 * rotation summary. When 2+ results are loaded an extra "across runs"
 * card surfaces the most-variable cells so the user can chase
 * disagreements down to specific patches.
 */
export function StabilityStats({ cells, series, onFocusCell }: Props) {
  const perResult = useMemo(
    () => series.map((s) => computePerResultStats(cells, s)),
    [cells, series],
  );

  const acrossRuns = useMemo(
    () => series.length >= 2 ? computeAcrossRunsStats(cells, series) : null,
    [cells, series],
  );

  return (
    <aside
      className={cn(
        "shrink-0 w-[260px] flex flex-col min-h-0",
        "border-l border-[color:var(--color-border)]",
        "bg-[color:var(--color-surface)]",
      )}
    >
      <div className="px-3 py-2 border-b border-[color:var(--color-border)]">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          Stats
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-3">
        {series.length === 0 ? (
          <div className="px-1 py-6 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
            No results selected
          </div>
        ) : (
          <>
            {perResult.map((stat, i) => (
              <ResultStatCard
                key={stat.resultId}
                stat={stat}
                colour={seriesColour(i)}
                onFocusCell={onFocusCell}
              />
            ))}
            {acrossRuns && (
              <AcrossRunsCard stats={acrossRuns} onFocusCell={onFocusCell} />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/* ─── Per-result card ──────────────────────────────────────────────────── */

function ResultStatCard({
  stat,
  colour,
  onFocusCell,
}: {
  stat: PerResultStats;
  colour: string;
  onFocusCell?: (cellIndex: number) => void;
}) {
  return (
    <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden">
      <header className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[color:var(--color-border)]/60">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ background: colour }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] truncate">
            {stat.label}
          </div>
          <div className="font-mono text-[9px] tracking-[0.06em] text-[color:var(--color-ink-subtle)] truncate">
            id {stat.resultId} · {stat.sampleCount}/{stat.totalCells} cells
          </div>
        </div>
      </header>
      {stat.sampleCount === 0 ? (
        <div className="px-2.5 py-3 text-center font-mono text-[9.5px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
          No matched cells
        </div>
      ) : (
        <dl className="flex flex-col">
          <StatRow
            label="Mean Δ"
            value={`ΔL ${signedNum(stat.meanDeltaL)} · Δa ${signedNum(stat.meanDeltaA)} · Δb ${signedNum(stat.meanDeltaB)}`}
          />
          <StatRow
            label="Median ΔE"
            value={stat.medianDeltaE.toFixed(2)}
          />
          <StatRow
            label="Max ΔE"
            value={
              <FocusButton
                cellIndex={stat.worstCellIndex}
                primary={stat.maxDeltaE.toFixed(2)}
                onFocusCell={onFocusCell}
              />
            }
          />
          <StatRow
            label="Δhue mean"
            value={`${signedNum(stat.meanDeltaHue, 1)}°`}
          />
        </dl>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 px-2.5 py-1.5",
        "border-t border-[color:var(--color-border)]/40 first:border-t-0",
      )}
    >
      <dt className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] shrink-0">
        {label}
      </dt>
      <dd className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] text-right truncate">
        {value}
      </dd>
    </div>
  );
}

/* ─── Across-runs card ─────────────────────────────────────────────────── */

function AcrossRunsCard({
  stats,
  onFocusCell,
}: {
  stats: AcrossRunsStats;
  onFocusCell?: (cellIndex: number) => void;
}) {
  return (
    <div className="rounded-[8px] border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]/40 overflow-hidden">
      <header className="px-2.5 py-1.5 border-b border-[color:var(--color-primary)]/30">
        <div className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
          σ across runs
        </div>
      </header>
      <dl className="flex flex-col">
        <StatRow label="Median σ" value={stats.medianSigma.toFixed(2)} />
        <StatRow
          label="Worst σ"
          value={
            <FocusButton
              cellIndex={stats.worstSigma.cellIndex}
              primary={stats.worstSigma.value.toFixed(2)}
              onFocusCell={onFocusCell}
            />
          }
        />
      </dl>
      {stats.topVariable.length > 0 && (
        <div className="px-2.5 pt-2 pb-2.5 border-t border-[color:var(--color-primary)]/30">
          <div className="font-mono text-[9px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)] mb-1">
            Top variable
          </div>
          <ul className="flex flex-col gap-0.5">
            {stats.topVariable.map((row) => (
              <li key={row.cellIndex}>
                <button
                  type="button"
                  onClick={() => onFocusCell?.(row.cellIndex)}
                  className={cn(
                    "w-full flex items-baseline justify-between gap-2",
                    "font-mono text-[10px] tabular-nums",
                    "text-[color:var(--color-ink)] hover:text-[color:var(--color-primary)]",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60 rounded-[3px]",
                  )}
                >
                  <span className="text-left">cell #{row.cellIndex}</span>
                  <span className="text-[color:var(--color-ink-subtle)]">
                    σ {row.sigma.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FocusButton({
  cellIndex,
  primary,
  onFocusCell,
}: {
  cellIndex: number | null;
  primary: string;
  onFocusCell?: (cellIndex: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => cellIndex != null && onFocusCell?.(cellIndex)}
      className={cn(
        "font-mono text-[10.5px] tabular-nums text-left",
        "text-[color:var(--color-primary)] hover:underline",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-primary)]/60 rounded-[3px]",
      )}
    >
      {primary}
      {cellIndex != null && (
        <span className="text-[color:var(--color-ink-subtle)]">
          {" "}(cell #{cellIndex})
        </span>
      )}
    </button>
  );
}
