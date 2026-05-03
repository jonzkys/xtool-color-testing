import {
  formatYValue,
  seriesColour,
  type AxisMeta,
  type SeriesInput,
} from "./stabilityChartMath";
import type { ScatterRow } from "./StabilityScatter";

/**
 * Hover-tooltip card for the stability scatter. Edge-aware: prefers
 * right+below, flips on overflow. Anchored in SVG viewBox space so the
 * caller passes percent positions that stay honest under the chart's
 * `preserveAspectRatio="xMidYMid meet"` setup.
 *
 * Lives in its own file so `StabilityScatter.tsx` can stay under its
 * line budget after iter 2's mean + trend layers landed.
 */

/** Per-series trend bin contributing to the tooltip's "· trend Y at X"
 *  row. `null` means the cursor is not over a populated bin for that
 *  series (so the row is omitted). */
export interface TooltipTrendRow {
  /** Bin centre in axis units (e.g. hue degrees). */
  center: number;
  /** Bin mean Y. */
  mean: number;
}

interface Props {
  row: ScatterRow;
  series: SeriesInput[];
  xMeta: AxisMeta;
  yMeta: AxisMeta;
  /** Spread (max - min Y across runs) for this cell. `null` when only
   *  one run sampled the cell or the spread row is hidden. */
  spread: number | null;
  /** One entry per series; `null` for series that don't contribute to
   *  the bin under the cursor. The whole prop is `null` when the trend
   *  layer is off — no rows render in that case. */
  trendRows: (TooltipTrendRow | null)[] | null;
  anchorPx: { x: number; y: number };
  plotW: number;
  plotH: number;
}

export function StabilityHoverCard({
  row,
  series,
  xMeta,
  yMeta,
  spread,
  trendRows,
  anchorPx,
  plotW,
  plotH,
}: Props) {
  const TOOLTIP_W = 280;
  const trendRowCount =
    trendRows != null ? trendRows.filter((t) => t != null).length : 0;
  const TOOLTIP_H =
    56 + series.length * 22 + (spread != null ? 18 : 0) + trendRowCount * 14;
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
          const trend = trendRows?.[i] ?? null;
          return (
            <div key={s.resultId} className="flex flex-col">
              <div className="flex items-center gap-2 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
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
              {trend && (
                <div className="ml-[26px] font-mono text-[9.5px] tabular-nums text-[color:var(--color-ink-subtle)]">
                  · trend {formatYValue(trend.mean, yMeta.unit)} at{" "}
                  {formatXForTrend(trend.center, xMeta.unit)}
                </div>
              )}
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

/** Spread is always non-negative (max - min); strip the formatter's
 *  leading "+" so the value reads as a magnitude, not a directional
 *  delta. */
function formatSpread(v: number, unit: string): string {
  return formatYValue(Math.abs(v), unit).replace(/^\+/, "");
}

/** Render a bin centre for the tooltip's per-series trend row.
 *  Examples: `h=180°`, `L=72.0`, `a=+8.5`. Unsigned for hue (it's an
 *  absolute position on the wheel), signed via formatYValue for the
 *  Lab axes. */
function formatXForTrend(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  if (unit === "deg") return `h=${v.toFixed(0)}°`;
  if (unit === "L*") return `L*=${v.toFixed(1)}`;
  if (unit === "a*") return `a*=${formatYValue(v, "a*")}`;
  if (unit === "b*") return `b*=${formatYValue(v, "b*")}`;
  if (unit === "C*") return `C*=${v.toFixed(1)}`;
  return v.toFixed(1);
}
