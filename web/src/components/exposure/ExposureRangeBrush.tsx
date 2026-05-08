import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  /** Selected log-exposure range in raw exposure-index units, or
   *  null = "no filter" = all rows in scope. */
  range: readonly [number, number] | null;
  onRangeChange: (range: readonly [number, number] | null) => void;
  /** Strip pixel height. Default 28. */
  height?: number;
}

function fmtRange(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs < 1e-2 || abs >= 1e4) return v.toExponential(1);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * The bottom Exposure Brush. A wide tile strip showing every entry's
 * swatch ordered ascending by surface_exposure_index. Drag handles
 * select an [lo, hi] log-scale range. Pure pointer events.
 */
export const ExposureRangeBrush: React.FC<Props> = ({
  rows,
  range,
  onRangeChange,
  height = 28,
}) => {
  const ordered = React.useMemo(() => {
    return [...rows].sort(
      (a, b) =>
        (a.indices.surface_exposure_index as number) -
        (b.indices.surface_exposure_index as number),
    );
  }, [rows]);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const [exposureMin, exposureMax] = React.useMemo(() => {
    if (ordered.length === 0) return [1, 1] as const;
    return [
      Math.max(1e-3, ordered[0].indices.surface_exposure_index as number),
      Math.max(1e-2, ordered[ordered.length - 1].indices.surface_exposure_index as number),
    ] as const;
  }, [ordered]);

  const valueToFraction = React.useCallback(
    (v: number) => {
      const lo = Math.log10(Math.max(1e-3, exposureMin));
      const hi = Math.log10(Math.max(1e-3, exposureMax));
      if (hi === lo) return 0;
      return (Math.log10(Math.max(1e-3, v)) - lo) / (hi - lo);
    },
    [exposureMin, exposureMax],
  );

  const fractionToValue = React.useCallback(
    (f: number) => {
      const lo = Math.log10(Math.max(1e-3, exposureMin));
      const hi = Math.log10(Math.max(1e-3, exposureMax));
      return Math.pow(10, lo + (hi - lo) * Math.max(0, Math.min(1, f)));
    },
    [exposureMin, exposureMax],
  );

  const lo = range ? range[0] : exposureMin;
  const hi = range ? range[1] : exposureMax;
  const loF = valueToFraction(lo);
  const hiF = valueToFraction(hi);

  const onHandleDown = (which: "lo" | "hi") => (ev: React.PointerEvent) => {
    ev.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const f = (e.clientX - rect.left) / rect.width;
      const v = fractionToValue(f);
      const nextRange =
        which === "lo"
          ? ([Math.min(v, hi), hi] as [number, number])
          : ([lo, Math.max(v, lo)] as [number, number]);
      onRangeChange(nextRange);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClearRange = () => onRangeChange(null);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* Header strip — value readout + clear button */}
      <div className="flex items-baseline justify-between font-mono">
        <div className="flex items-baseline gap-3">
          <span className="text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
            Selected
          </span>
          <span className="text-[11px] tabular-nums text-[color:var(--color-ink)]">
            {range ? fmtRange(range[0]) : fmtRange(exposureMin)}
            <span className="text-[color:var(--color-ink-subtle)] mx-1.5">→</span>
            {range ? fmtRange(range[1]) : fmtRange(exposureMax)}
          </span>
          {!range && (
            <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
              · all
            </span>
          )}
        </div>
        {range && (
          <button
            type="button"
            className="px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-hover)]"
            onClick={onClearRange}
          >
            clear
          </button>
        )}
      </div>

      {/* The strip itself */}
      <div
        ref={containerRef}
        className="relative w-full rounded-[3px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden"
        style={{ height: `${height}px` }}
      >
        {ordered.map((row, i) => (
          <div
            key={row.id}
            data-role="brush-tile"
            data-entry-id={row.id}
            className="absolute top-0 bottom-0"
            style={{
              left: `${(i / ordered.length) * 100}%`,
              width: `${100 / ordered.length}%`,
              background: row.hex,
            }}
          />
        ))}

        {/* Range veil — subtle parchment-tone block over the muted ends */}
        {range && (
          <>
            <div
              className="absolute top-0 bottom-0 left-0 bg-[color:var(--color-bg)] opacity-78"
              style={{ width: `${loF * 100}%` }}
            />
            <div
              className="absolute top-0 bottom-0 right-0 bg-[color:var(--color-bg)] opacity-78"
              style={{ width: `${(1 - hiF) * 100}%` }}
            />
          </>
        )}

        {/* Range frame — when active, an amber bracket sits over the
            chosen window so its edges read at a glance. */}
        {range && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${loF * 100}%`,
              right: `${(1 - hiF) * 100}%`,
              borderLeft: "1px solid var(--color-primary)",
              borderRight: "1px solid var(--color-primary)",
              boxShadow: "inset 0 1px 0 var(--color-primary), inset 0 -1px 0 var(--color-primary)",
            }}
          />
        )}

        {/* Drag handles */}
        <div
          role="slider"
          aria-label="lower bound"
          aria-valuemin={exposureMin}
          aria-valuemax={exposureMax}
          aria-valuenow={lo}
          tabIndex={0}
          className="absolute top-[-5px] bottom-[-5px] w-1 bg-[color:var(--color-primary)] cursor-ew-resize shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
          style={{ left: `calc(${loF * 100}% - 2px)` }}
          onPointerDown={onHandleDown("lo")}
        />
        <div
          role="slider"
          aria-label="upper bound"
          aria-valuemin={exposureMin}
          aria-valuemax={exposureMax}
          aria-valuenow={hi}
          tabIndex={0}
          className="absolute top-[-5px] bottom-[-5px] w-1 bg-[color:var(--color-primary)] cursor-ew-resize shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
          style={{ left: `calc(${hiF * 100}% - 2px)` }}
          onPointerDown={onHandleDown("hi")}
        />
      </div>

      {/* Hint — only shown idle so the active state isn't cluttered */}
      {!range && (
        <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[color:var(--color-ink-subtle)]">
          drag a handle to dim entries outside the range
        </p>
      )}
    </div>
  );
};
