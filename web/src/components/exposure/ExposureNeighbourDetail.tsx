import type { ExposureRow } from "./exposureCorrelations";
import { FILTERABLE_PARAMS, type FilterableParam } from "./exposureFilters";
import { recipeDelta } from "./recipeDelta";

interface Props {
  focused: ExposureRow;
  selected: ExposureRow;
  deltaE: number | null;
  onJumpTo: (id: number) => void;
  onFilterFrom: (row: ExposureRow) => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER", speed: "SPEED", frequency: "FREQUENCY",
  pulse_width: "PULSE_WIDTH", density: "DENSITY", passes: "PASSES",
};

const PARAM_SUFFIX: Record<FilterableParam, string> = {
  power: "%", speed: "", frequency: "", pulse_width: "", density: "", passes: "",
};

function fmtDelta(abs: number | null, pct: number | null): string {
  if (abs == null || abs === 0) return "";
  if (pct == null) {
    const sign = abs > 0 ? "+" : "";
    return `${sign}${abs}`;
  }
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

export function ExposureNeighbourDetail({
  focused, selected, deltaE, onJumpTo, onFilterFrom,
}: Props) {
  const isFocused = selected.id === focused.id;

  return (
    <div className="flex flex-col gap-2 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2">
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className="uppercase tracking-[0.16em] font-semibold text-[color:var(--color-ink)]">
          {selected.hex.toUpperCase()}
        </span>
        {!isFocused && deltaE != null && (
          <span className="text-[color:var(--color-primary)] font-semibold tabular-nums">
            ΔE {deltaE.toFixed(1)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px]">
        {FILTERABLE_PARAMS.map((p) => {
          const d = recipeDelta(focused, selected, p);
          if (d.value == null) return null;
          const deltaText = fmtDelta(d.abs, d.pct);
          return (
            <div key={p} className="flex items-baseline gap-1">
              <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.14em]">
                {PARAM_LABEL[p]}
              </span>
              <span className="tabular-nums text-[color:var(--color-ink)]">
                {d.value}{PARAM_SUFFIX[p]}
              </span>
              {deltaText && (
                <span className="tabular-nums text-[color:var(--color-primary)] text-[9px]">
                  {deltaText}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-1.5 pt-1 border-t border-[color:var(--color-border)]">
        <button
          type="button"
          disabled={isFocused}
          onClick={() => onJumpTo(selected.id)}
          className={
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
            (isFocused
              ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed"
              : "border-[color:var(--color-primary)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-surface)]")
          }
        >
          → Jump to
        </button>
        <button
          type="button"
          disabled={isFocused}
          onClick={() => onFilterFrom(selected)}
          className={
            "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
            (isFocused
              ? "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]")
          }
        >
          Filter from
        </button>
      </div>
    </div>
  );
}
