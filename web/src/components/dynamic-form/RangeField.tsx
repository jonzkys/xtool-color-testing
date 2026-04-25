import { useEffect, useRef, useState } from "react";
import { Field } from "../../ui";

interface Props {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

/** Continuous slider + numeric text input pair.
 *
 * Both controls are kept in sync: dragging the slider updates the number
 * input live; typing in the number input moves the thumb. Clamp-on-blur
 * matches the NumberField semantics used elsewhere in the Workbench.
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
}: Props) {
  const [text, setText] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  // Clamp the parent value once when it falls outside [min, max].
  // This fires when min/max change (e.g. mode switch) or on mount with a
  // stale stored value. We intentionally omit onChange from deps to avoid
  // a re-fire loop if the parent re-creates the callback each render.
  useEffect(() => {
    const num = Number(value);
    const clamped = Math.max(min, Math.min(max, num));
    if (!isNaN(num) && clamped !== num) {
      onChange(clamped);
    }
  }, [value, min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTextChange(raw: string) {
    setText(raw);
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  }

  function handleBlur() {
    focusedRef.current = false;
    const n = parseFloat(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  // Fraction along the range — used to draw the filled track.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        {/* Slider track */}
        <div className="relative flex-1 h-5 flex items-center">
          {/* Unfilled track */}
          <div
            className="absolute inset-x-0 h-[3px] rounded-full"
            style={{ background: "var(--color-border-strong)" }}
          />
          {/* Filled track — primary accent colour */}
          <div
            className="absolute left-0 h-[3px] rounded-full"
            style={{
              width: `${pct}%`,
              background: "var(--color-primary)",
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
              if (Number.isFinite(n)) onChange(n);
            }}
            className="relative w-full appearance-none bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-default
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-[14px]
              [&::-webkit-slider-thumb]:h-[14px]
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-[color:var(--color-surface)]
              [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-[color:var(--color-primary)]
              [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.20)]
              [&::-webkit-slider-thumb]:transition-transform
              [&::-webkit-slider-thumb:hover]:scale-110
              [&::-moz-range-thumb]:w-[14px]
              [&::-moz-range-thumb]:h-[14px]
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-[color:var(--color-surface)]
              [&::-moz-range-thumb]:border-2
              [&::-moz-range-thumb]:border-[color:var(--color-primary)]
            "
          />
        </div>

        {/* Numeric text input */}
        <div className="flex items-center gap-1 shrink-0">
          <input
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
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            className="
              w-[68px] h-8 rounded-[5px] px-2 text-[12px] font-mono tabular-nums text-right
              bg-[color:var(--color-surface)] text-[color:var(--color-ink)]
              border border-[color:var(--color-border-strong)]
              hover:border-[color:var(--color-ink-subtle)]
              focus:outline-none focus:border-[color:var(--color-primary)]
              focus:ring-2 focus:ring-[color:var(--color-primary-tint)]
              disabled:opacity-50 disabled:bg-[color:var(--color-bg)]
            "
          />
          {unit && (
            <span className="text-[11px] font-mono text-[color:var(--color-ink-subtle)] w-[28px]">
              {unit}
            </span>
          )}
        </div>
      </div>
      {/* tick-mark min/max legend */}
      <div className="flex justify-between mt-0.5 px-0">
        <span className="text-[10px] font-mono text-[color:var(--color-ink-subtle)] tabular-nums">
          {min}
        </span>
        <span className="text-[10px] font-mono text-[color:var(--color-ink-subtle)] tabular-nums">
          {max}
        </span>
      </div>
    </Field>
  );
}
