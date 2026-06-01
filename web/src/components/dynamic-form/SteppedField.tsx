import { useEffect, useRef, useState } from "react";
import { clampToConstraint } from "../../lib/constraints";

interface Props {
  label: string;
  unit?: string;
  values: (number | string)[];
  value: number | string;
  onChange: (v: number | string) => void;
  disabled?: boolean;
}

/**
 * Renders a stepped (quantised) control.
 *
 * Short lists (≤ 16 options): styled button-grid — compact, scannable.
 * Long lists (> 16 options): discrete range slider that snaps the thumb
 * to the nearest allowed value on release.
 */
export function SteppedField({
  label,
  unit,
  values,
  value,
  onChange,
  disabled,
}: Props) {
  if (values.length <= 16) {
    const strValue = String(value);
    const inList = values.some((v) => String(v) === strValue);

    return (
      <SteppedSelect
        label={label}
        unit={unit}
        values={values}
        value={value}
        strValue={strValue}
        inList={inList}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  // Long list: discrete slider
  return (
    <SteppedSlider
      label={label}
      unit={unit}
      values={values}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

/**
 * Compact select control styled to match the instrument-panel aesthetic.
 * Shows the value prominently above a native select.
 */
function SteppedSelect({
  label,
  unit,
  values,
  value: _value,
  strValue,
  inList,
  onChange,
  disabled,
}: Props & { strValue: string; inList: boolean }) {
  return (
    <div
      className="flex flex-col gap-1"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      {/* Label + current value */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono font-semibold uppercase tracking-[0.1em] shrink-0"
          style={{ fontSize: "9.5px", color: "var(--color-ink-subtle)" }}
        >
          {label}
        </span>
        <div className="flex items-baseline gap-1">
          <span
            className="font-mono tabular-nums font-semibold"
            style={{
              fontSize: "12px",
              color: inList ? "var(--color-ink)" : "var(--color-primary)",
            }}
          >
            {strValue}
          </span>
          {unit && (
            <span
              className="font-mono uppercase tracking-[0.06em]"
              style={{ fontSize: "9px", color: "var(--color-ink-subtle)" }}
            >
              {unit}
            </span>
          )}
          {!inList && (
            <span
              className="font-mono uppercase tracking-[0.06em]"
              style={{ fontSize: "8.5px", color: "var(--color-primary)" }}
            >
              legacy
            </span>
          )}
        </div>
      </div>

      {/* Native select — full width, styled to match the design */}
      <select
        value={strValue}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (values.length > 0 && typeof values[0] === "number") {
            onChange(Number(raw));
          } else {
            onChange(raw);
          }
        }}
        className="w-full h-8 rounded-[5px] px-2 font-mono text-[12px] appearance-none cursor-pointer focus:outline-none border"
        style={{
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          borderColor: "var(--color-border-strong)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23807A72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
          paddingRight: "24px",
        }}
      >
        {!inList && (
          <option key="__legacy__" value={strValue}>
            {strValue}
            {unit ? ` ${unit}` : ""} (legacy)
          </option>
        )}
        {values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
            {unit ? ` ${unit}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Discrete slider for stepped fields with > 16 values.
 * Matches the RangeField visual treatment.
 */
function SteppedSlider({
  label,
  unit,
  values,
  value,
  onChange,
  disabled,
}: Props) {
  const currentIndex = Math.max(
    0,
    values.findIndex((v) => v === value),
  );

  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  function handleSliderChange(idx: number) {
    const next = values[Math.max(0, Math.min(idx, values.length - 1))];
    onChange(next);
  }

  function handleTextBlur() {
    focusedRef.current = false;
    setEditing(false);
    const typed =
      typeof values[0] === "number" ? parseFloat(text) : text.trim();
    if (typeof typed === "number" && !Number.isFinite(typed)) {
      setText(String(value));
      return;
    }
    onChange(clampToConstraint(typed as number | string, { kind: "stepped", values }));
  }

  const pct =
    values.length > 1 ? (currentIndex / (values.length - 1)) * 100 : 0;

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
        <div className="flex items-baseline gap-1">
          {/* Display button — hidden when editing */}
          <button
            type="button"
            onClick={() => { if (!disabled) setEditing(true); }}
            disabled={disabled}
            title="Click to edit"
            aria-hidden={editing}
            className="font-mono tabular-nums rounded-[3px] px-1 text-right hover:opacity-70 transition-opacity focus:outline-none focus-visible:ring-1"
            style={{
              fontSize: "12px",
              height: "20px",
              color: "var(--color-ink)",
              minWidth: "30px",
              display: editing ? "none" : undefined,
            }}
          >
            {String(value)}
          </button>

          {/* Text input — always in DOM; visually shown only when editing */}
          <input
            type="text"
            value={text}
            disabled={disabled}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleTextBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape")
                (e.currentTarget as HTMLInputElement).blur();
            }}
            className="rounded-[3px] px-1 text-right font-mono tabular-nums focus:outline-none border"
            style={{
              fontSize: "12px",
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
              className="font-mono uppercase tracking-[0.06em]"
              style={{ fontSize: "9px", color: "var(--color-ink-subtle)" }}
            >
              {unit}
            </span>
          )}
        </div>
      </div>

      {/* Slider track */}
      <div className="relative flex items-center" style={{ height: "18px" }}>
        <div
          className="absolute inset-x-0 rounded-full pointer-events-none"
          style={{ height: "4px", background: "var(--color-border-strong)" }}
        />
        <div
          className="absolute left-0 rounded-full pointer-events-none"
          style={{
            height: "4px",
            width: `${pct}%`,
            background: "var(--color-primary)",
          }}
        />
        <input
          data-testid="stepped-slider"
          type="range"
          min={0}
          max={values.length - 1}
          step={1}
          value={currentIndex}
          disabled={disabled}
          onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
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

      {/* Min/max */}
      <div className="flex justify-between">
        <span
          className="font-mono tabular-nums"
          style={{ fontSize: "9px", color: "var(--color-ink-subtle)", opacity: 0.7 }}
        >
          {values[0]}
        </span>
        <span
          className="font-mono tabular-nums"
          style={{ fontSize: "9px", color: "var(--color-ink-subtle)", opacity: 0.7 }}
        >
          {values[values.length - 1]}
        </span>
      </div>
    </div>
  );
}
