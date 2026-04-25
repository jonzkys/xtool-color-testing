import { useEffect, useRef, useState } from "react";
import { Field, Select } from "../../ui";

interface Props {
  label: string;
  unit?: string;
  values: (number | string)[];
  value: number | string;
  onChange: (v: number | string) => void;
  disabled?: boolean;
}

/** Renders a stepped (quantised) control.
 *
 * Short lists (≤ 16 options): native `<select>` — compact, keyboard-friendly.
 * Long lists (> 16 options): discrete range slider that snaps the thumb to
 * the nearest allowed value on release.
 *
 * In both cases the active value is shown in JetBrains Mono to the right.
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
    // If the stored value isn't in the allowed list (legacy data), prepend a
    // synthetic option so the select displays the as-stored value rather than
    // silently falling back to the first legal option.  onChange still snaps to
    // a legal value — only the initial display is preserved.
    const strValue = String(value);
    const inList = values.some((v) => String(v) === strValue);

    return (
      <Field label={label}>
        <Select
          value={strValue}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            // Preserve numeric type if the values array contains numbers.
            if (values.length > 0 && typeof values[0] === "number") {
              onChange(Number(raw));
            } else {
              onChange(raw);
            }
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
        </Select>
      </Field>
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

/** Discrete slider for stepped fields with > 16 values.
 *
 * The slider index (0…n-1) drives position; the component snaps
 * to the nearest allowed value on each change.
 */
function SteppedSlider({
  label,
  unit,
  values,
  value,
  onChange,
  disabled,
}: Props) {
  // Find current index — fall back to 0 if not found.
  const currentIndex = Math.max(
    0,
    values.findIndex((v) => v === value),
  );

  // Track text-input separately so the user can type freely.
  const [text, setText] = useState(String(value));
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
    // Snap typed value to nearest allowed.
    const typed =
      typeof values[0] === "number" ? parseFloat(text) : text.trim();
    if (typeof typed === "number" && !Number.isFinite(typed)) {
      setText(String(value));
      return;
    }
    // Find nearest by index.
    let bestIdx = 0;
    let bestDist = Infinity;
    values.forEach((v, i) => {
      const dist =
        typeof typed === "number" && typeof v === "number"
          ? Math.abs(v - typed)
          : v === typed
            ? 0
            : Infinity;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    });
    onChange(values[bestIdx]);
  }

  const pct =
    values.length > 1 ? (currentIndex / (values.length - 1)) * 100 : 0;

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-5 flex items-center">
          <div
            className="absolute inset-x-0 h-[3px] rounded-full"
            style={{ background: "var(--color-border-strong)" }}
          />
          <div
            className="absolute left-0 h-[3px] rounded-full"
            style={{
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

        <div className="flex items-center gap-1 shrink-0">
          <input
            type="text"
            value={text}
            disabled={disabled}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleTextBlur}
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
          {/* Always reserve the unit slot so adjacent rows column-align. */}
          <span className="text-[11px] font-mono text-[color:var(--color-ink-subtle)] w-[34px] shrink-0">
            {unit || " "}
          </span>
        </div>
      </div>

      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] font-mono text-[color:var(--color-ink-subtle)] tabular-nums">
          {values[0]}
        </span>
        <span className="text-[10px] font-mono text-[color:var(--color-ink-subtle)] tabular-nums">
          {values[values.length - 1]}
        </span>
      </div>
    </Field>
  );
}
