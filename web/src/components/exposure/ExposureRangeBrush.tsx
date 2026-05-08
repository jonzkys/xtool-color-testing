import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  /** Selected log-exposure range in raw exposure-index units, or
   *  null = "no filter" = all rows in scope. */
  range: readonly [number, number] | null;
  onRangeChange: (range: readonly [number, number] | null) => void;
  /** Strip pixel height. Default 24. */
  height?: number;
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
  height = 24,
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
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] font-mono text-[color:var(--color-ink-subtle)]">
        <span>Exposure brush · drag handles</span>
        {range && (
          <button
            type="button"
            className="px-2 py-0.5 text-[color:var(--color-primary)] hover:underline"
            onClick={onClearRange}
          >
            clear
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative w-full border border-[color:var(--color-border)]"
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
        {range && (
          <>
            <div
              className="absolute top-0 bottom-0 left-0 bg-[color:var(--color-bg)] opacity-70"
              style={{ width: `${loF * 100}%` }}
            />
            <div
              className="absolute top-0 bottom-0 right-0 bg-[color:var(--color-bg)] opacity-70"
              style={{ width: `${(1 - hiF) * 100}%` }}
            />
          </>
        )}
        <div
          role="slider"
          aria-label="lower bound"
          className="absolute top-[-4px] bottom-[-4px] w-1 bg-[color:var(--color-primary)] cursor-ew-resize"
          style={{ left: `calc(${loF * 100}% - 2px)` }}
          onPointerDown={onHandleDown("lo")}
        />
        <div
          role="slider"
          aria-label="upper bound"
          className="absolute top-[-4px] bottom-[-4px] w-1 bg-[color:var(--color-primary)] cursor-ew-resize"
          style={{ left: `calc(${hiF * 100}% - 2px)` }}
          onPointerDown={onHandleDown("hi")}
        />
      </div>
    </div>
  );
};
