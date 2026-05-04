import {
  formatYValue,
  seriesColour,
  type AxisMeta,
  type SeriesInput,
} from "./stabilityChartMath";
import type { CellSpectrum } from "./stabilitySpectrumsMath";

/**
 * Hover card for a SPECTRUMS bar. Mirrors the shape of the scatter's
 * StabilityHoverCard so the visual register is identical: cell #, expected
 * chip, per-run measured chips, and a metric summary tail with min/max/
 * mean and σ.
 */
interface Props {
  spectrum: CellSpectrum;
  yMeta: AxisMeta;
  series: SeriesInput[];
  anchorPx: { x: number; y: number };
  plotW: number;
  plotH: number;
}

export function StabilitySpectrumHoverCard({
  spectrum: s,
  yMeta,
  series,
  anchorPx,
  plotW,
  plotH,
}: Props) {
  const TOOLTIP_W = 280;
  const TOOLTIP_H = 80 + series.length * 22 + 56;
  const leftPct = (anchorPx.x / plotW) * 100;
  const topPct = (anchorPx.y / plotH) * 100;
  const rightOverflow = leftPct > 60;
  const bottomOverflow = topPct > 60;
  const transform = `translate(${rightOverflow ? `calc(-100% - 14px)` : `14px`}, ${bottomOverflow ? `calc(-100% - 14px)` : `14px`})`;
  const range =
    s.min != null && s.max != null
      ? Math.abs(s.max - s.min)
      : null;

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
          cell #{s.cellIndex}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-subtle)]">
          {s.expectedHex}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div
          aria-hidden
          className="h-7 w-7 rounded-[3px] border border-[color:var(--color-border-strong)] shrink-0"
          style={{ backgroundColor: s.expectedHex }}
        />
        <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
          expected
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {series.map((srs, i) => {
          const m = srs.cells.get(s.cellIndex);
          const colour = seriesColour(i);
          return (
            <div
              key={srs.resultId}
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
                {srs.label}
              </span>
            </div>
          );
        })}
        <div className="mt-1 pt-1 border-t border-[color:var(--color-border)] grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
          <Row
            label="min"
            value={
              s.min != null
                ? formatYValue(s.min, yMeta.unit)
                : "—"
            }
          />
          <Row
            label="max"
            value={
              s.max != null
                ? formatYValue(s.max, yMeta.unit)
                : "—"
            }
          />
          <Row
            label="mean"
            value={
              s.mean != null
                ? formatYValue(s.mean, yMeta.unit)
                : "—"
            }
          />
          <Row
            label="range"
            value={range != null ? formatYValue(range, yMeta.unit).replace(/^\+/, "") : "—"}
          />
          <Row
            label="σ"
            value={Number.isFinite(s.sigma) ? s.sigma.toFixed(1) : "—"}
          />
          <Row
            label="runs"
            value={`${s.count}`}
          />
        </div>
        <div className="mt-1.5 pt-1.5 border-t border-[color:var(--color-border)] flex items-center justify-between font-mono text-[9.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
          <span>{yMeta.short}</span>
          <span className="tabular-nums normal-case tracking-normal text-[10.5px] text-[color:var(--color-ink-muted)]">
            {s.mean != null ? formatYValue(s.mean, yMeta.unit) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="tabular-nums normal-case tracking-normal text-[10.5px] text-[color:var(--color-ink-muted)]">
        {value}
      </span>
    </div>
  );
}
