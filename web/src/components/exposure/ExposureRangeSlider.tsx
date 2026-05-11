import { useEffect, useRef, useState } from "react";
import type { FilterableParam, ParamRange } from "./exposureFilters";

interface Props {
  param: FilterableParam;
  domain: { min: number; max: number };
  value: ParamRange;
  onChange: (next: ParamRange) => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQUENCY",
  pulse_width: "PULSE WIDTH",
  density: "DENSITY",
  passes: "PASSES",
  scan_angle: "SCAN ANGLE",
};

const PARAM_UNIT: Record<FilterableParam, string> = {
  power: "%",
  speed: "mm/s",
  frequency: "kHz",
  pulse_width: "ns",
  density: "lpc",
  passes: "",
  scan_angle: "°",
};

function isLogScale(domain: { min: number; max: number }): boolean {
  return domain.min > 0 && domain.max / domain.min > 100;
}

function valueToFraction(
  v: number, domain: { min: number; max: number }, log: boolean,
): number {
  // Degenerate domain (single-value data, e.g. after a tight filter)
  // — both handles map to the start of the track instead of NaN.
  if (domain.max === domain.min) return 0;
  if (log) {
    const lo = Math.log10(domain.min);
    const hi = Math.log10(domain.max);
    return (Math.log10(Math.max(domain.min, v)) - lo) / (hi - lo);
  }
  return (v - domain.min) / (domain.max - domain.min);
}

function fractionToValue(
  f: number, domain: { min: number; max: number }, log: boolean,
): number {
  if (domain.max === domain.min) return domain.min;
  const clamped = Math.min(1, Math.max(0, f));
  if (log) {
    const lo = Math.log10(domain.min);
    const hi = Math.log10(domain.max);
    return Math.pow(10, lo + clamped * (hi - lo));
  }
  return domain.min + clamped * (domain.max - domain.min);
}

function fmt(n: number): string {
  if (Math.abs(n) >= 100 || Number.isInteger(n)) return n.toFixed(0);
  return n.toFixed(2);
}

interface BoundLabelProps {
  value: number;
  onCommit: (next: number) => void;
}

function BoundLabel({ value, onCommit }: BoundLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  if (editing) {
    return (
      <input
        type="number"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n)) onCommit(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = Number(draft);
            if (Number.isFinite(n)) onCommit(n);
            setEditing(false);
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="w-12 font-mono text-[10px] tabular-nums px-1 py-0.5 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
      />
    );
  }

  return (
    <button
      type="button"
      className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink)] cursor-text hover:text-[color:var(--color-primary)]"
      onClick={() => setEditing(true)}
    >
      {fmt(value)}
    </button>
  );
}

export function ExposureRangeSlider({ param, domain, value, onChange }: Props) {
  const log = isLogScale(domain);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<"min" | "max" | null>(null);

  const minVal = value.min ?? domain.min;
  const maxVal = value.max ?? domain.max;
  const minFrac = valueToFraction(minVal, domain, log);
  const maxFrac = valueToFraction(maxVal, domain, log);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!trackRef.current || !dragging.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const f = (e.clientX - rect.left) / rect.width;
      const v = fractionToValue(f, domain, log);
      if (dragging.current === "min") {
        onChange({ min: Math.min(v, maxVal), max: value.max });
      } else {
        onChange({ min: value.min, max: Math.max(v, minVal) });
      }
    };
    const up = () => { dragging.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [domain, log, minVal, maxVal, value.min, value.max, onChange]);

  const startDrag = (which: "min" | "max") => () => { dragging.current = which; };

  const unit = PARAM_UNIT[param];
  return (
    <div
      className="flex flex-col gap-1"
      data-log-scale={log ? "true" : "false"}
    >
      <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.14em] min-w-0">
        <span
          className="font-semibold text-[color:var(--color-ink-subtle)] truncate"
          title={`${PARAM_LABEL[param]} (data range ${fmt(domain.min)}–${fmt(domain.max)})`}
        >
          {PARAM_LABEL[param]}{unit ? ` ${unit}` : ""}
        </span>
        <button
          type="button"
          aria-label={`reset ${param}`}
          onClick={() => onChange({ min: null, max: null })}
          className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
        >
          ×
        </button>
      </div>

      <div className="relative h-5 px-2" ref={trackRef}>
        <div className="absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[color:var(--color-border)]" />
        <div
          className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[color:var(--color-primary)]"
          style={{ left: `calc(${minFrac * 100}% + 8px)`,
                   right: `calc(${(1 - maxFrac) * 100}% + 8px)` }}
        />
        <button
          type="button"
          aria-label={`${param} min handle`}
          onPointerDown={startDrag("min")}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--color-primary)] bg-[color:var(--color-surface)]"
          style={{ left: `calc(${minFrac * 100}% + 8px)` }}
        />
        <button
          type="button"
          aria-label={`${param} max handle`}
          onPointerDown={startDrag("max")}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--color-primary)] bg-[color:var(--color-surface)]"
          style={{ left: `calc(${maxFrac * 100}% + 8px)` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <BoundLabel
          value={minVal}
          onCommit={(n) => onChange({ min: n, max: value.max })}
        />
        <BoundLabel
          value={maxVal}
          onCommit={(n) => onChange({ min: value.min, max: n })}
        />
      </div>

    </div>
  );
}
