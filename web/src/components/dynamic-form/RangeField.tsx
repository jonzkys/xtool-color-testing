import { useEffect, useRef, useState } from "react";
import { clampToConstraint } from "../../lib/constraints";

interface Props {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** When true, renders at slightly larger scale (power field treatment). */
  prominent?: boolean;
}

/** Format a numeric value for the value badge — at most 1 decimal place,
 *  trailing zero stripped (so 10.0 → "10", 14.6 → "14.6", 14.65 → "14.7"). */
function formatValue(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return parseFloat(v.toFixed(1)).toString();
}

/**
 * Redesigned range field: a compact "instrument readout" tile.
 *
 * Layout: label row (name | value badge + unit) above a fat slider track.
 * Min/max appear as tick annotations at track ends.
 *
 * The value badge is a click-to-edit button. When editing, it becomes
 * an inline number input. The input is always rendered in the DOM
 * (with data-testid="range-number") so tests and screen readers can
 * reach it; visually it is hidden until the edit state is active.
 */
export function RangeField({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  disabled,
  prominent,
}: Props) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const focusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function coerce(n: number): number {
    return clampToConstraint(n, { kind: "range", min, max, step }) as number;
  }

  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  // Clamp on mount / min-max change.
  useEffect(() => {
    const num = Number(value);
    const fixed = coerce(num);
    if (!isNaN(num) && fixed !== num) {
      onChange(fixed);
    }
  }, [value, min, max, step]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTextChange(raw: string) {
    setText(raw);
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onChange(coerce(n));
  }

  function handleBlur() {
    focusedRef.current = false;
    setEditing(false);
    const n = parseFloat(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const fixed = coerce(n);
    setText(String(fixed));
    if (fixed !== value) onChange(fixed);
  }

  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const valueFontSize = prominent ? "13px" : "12px";

  return (
    <div
      className="flex flex-col gap-1"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      {/* Label + value row */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono font-semibold uppercase tracking-[0.1em] shrink-0"
          style={{ fontSize: "9.5px", color: "var(--color-ink-subtle)" }}
        >
          {label}
        </span>

        {/* Value display + edit area */}
        <div className="flex items-baseline gap-1 min-w-0">
          {/* Display button — hidden when editing */}
          <button
            type="button"
            onClick={() => {
              if (!disabled) {
                setEditing(true);
                setTimeout(() => {
                  inputRef.current?.select();
                  inputRef.current?.focus();
                }, 0);
              }
            }}
            disabled={disabled}
            title="Click to edit value"
            aria-hidden={editing}
            className="font-mono tabular-nums rounded-[3px] px-1 text-right hover:opacity-70 transition-opacity focus:outline-none focus-visible:ring-1 shrink-0"
            style={{
              fontSize: valueFontSize,
              height: "20px",
              color: "var(--color-ink)",
              minWidth: "30px",
              display: editing ? "none" : undefined,
            }}
          >
            {formatValue(value)}
          </button>

          {/* Numeric input — always in DOM for data-testid; visually shown only when editing */}
          <input
            ref={inputRef}
            data-testid="range-number"
            type="number"
            min={min}
            max={max}
            step={step ?? "any"}
            value={text}
            disabled={disabled}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => handleTextChange(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className="rounded-[3px] px-1 text-right font-mono tabular-nums focus:outline-none border"
            style={{
              fontSize: valueFontSize,
              height: "20px",
              width: editing ? "60px" : "1px",
              opacity: editing ? 1 : 0,
              pointerEvents: editing ? "auto" : "none",
              position: editing ? "static" : "absolute",
              background: "var(--color-surface)",
              color: "var(--color-ink)",
              borderColor: "var(--color-primary)",
              border: editing ? undefined : "none",
              overflow: "hidden",
            }}
          />

          {unit && (
            <span
              className="font-mono uppercase tracking-[0.06em] shrink-0"
              style={{ fontSize: "9px", color: "var(--color-ink-subtle)" }}
            >
              {unit}
            </span>
          )}
        </div>
      </div>

      {/* Slider track */}
      <div className="relative flex items-center" style={{ height: "18px" }}>
        {/* Unfilled track */}
        <div
          className="absolute inset-x-0 rounded-full pointer-events-none"
          style={{ height: "4px", background: "var(--color-border-strong)" }}
        />
        {/* Filled track */}
        <div
          className="absolute left-0 rounded-full pointer-events-none"
          style={{
            height: "4px",
            width: `${pct}%`,
            background: "var(--color-primary)",
            transition: "width 0ms",
          }}
        />
        <input
          data-testid="range-slider"
          type="range"
          min={min}
          max={max}
          step={step ?? "any"}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(coerce(n));
          }}
          className="relative w-full appearance-none bg-transparent cursor-pointer disabled:cursor-default
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-[15px]
            [&::-webkit-slider-thumb]:h-[15px]
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-[color:var(--color-surface)]
            [&::-webkit-slider-thumb]:border-[2.5px]
            [&::-webkit-slider-thumb]:border-[color:var(--color-primary)]
            [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.22)]
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb:hover]:scale-110
            [&::-moz-range-thumb]:w-[15px]
            [&::-moz-range-thumb]:h-[15px]
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-[color:var(--color-surface)]
            [&::-moz-range-thumb]:border-[2.5px]
            [&::-moz-range-thumb]:border-[color:var(--color-primary)]
            [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.22)]
          "
        />
      </div>

      {/* Min/max tick annotations */}
      <div className="flex justify-between">
        <span
          className="font-mono tabular-nums"
          style={{ fontSize: "9px", color: "var(--color-ink-subtle)", opacity: 0.7 }}
        >
          {min}
        </span>
        <span
          className="font-mono tabular-nums"
          style={{ fontSize: "9px", color: "var(--color-ink-subtle)", opacity: 0.7 }}
        >
          {max}
        </span>
      </div>
    </div>
  );
}
