/**
 * Relief — shared sidebar field primitives.
 *
 * The Cutout and Surface control panels share these. Descriptions are
 * surfaced as a ``?`` HelpTooltip next to the label (not an inline paragraph)
 * so the dense sidebar fits on one screen. Visual language matches the rest
 * of the workbench: JetBrains-mono numerics, ``--color-primary`` accents.
 */

import type { ReactNode } from "react";
import { HelpTooltip, Select } from "../../ui";

const LABEL_CLS =
  "text-[12.5px] font-medium text-[color:var(--color-ink-muted)]";

/** Label text with an optional ``?`` tooltip carrying the long-form hint. */
export function LabelHint({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      {hint != null && <HelpTooltip>{hint}</HelpTooltip>}
    </span>
  );
}

/** Format a slider value to a sensible precision for its step. */
function formatVal(value: number, step: number): string {
  if (step >= 1) return String(value);
  if (step >= 0.5) return value.toFixed(1);
  return value.toFixed(2);
}

/** Native range slider with a live mono value + ``?`` hint in the label. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  const isFloat = step < 1;
  // Plain divs (no <label>) so the ``?`` button can sit beside the text
  // without the wrapping <label> associating itself with the button instead
  // of the slider. The range carries its own aria-label.
  return (
    <div className="block">
      <div className={"mb-1 flex w-full items-baseline justify-between gap-3 " + LABEL_CLS}>
        <LabelHint hint={hint}>{label}</LabelHint>
        <span className="font-mono tabular-nums text-[12px] text-[color:var(--color-ink)]">
          {formatVal(value, step)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          onChange(isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10))
        }
        className="w-full accent-[color:var(--color-primary)]"
        aria-label={label}
      />
    </div>
  );
}

/** Checkbox toggle row. The ``?`` tooltip sits OUTSIDE the label so clicking
 *  it doesn't flip the checkbox. */
export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)] select-none cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-[color:var(--color-primary)]"
        />
        <span>{label}</span>
      </label>
      {hint != null && <HelpTooltip>{hint}</HelpTooltip>}
    </div>
  );
}

/** Labelled native ``Select`` with a ``?`` hint. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  ariaLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className="block">
      <div className={"mb-1 flex items-center gap-1 " + LABEL_CLS}>
        <LabelHint hint={hint}>{label}</LabelHint>
      </div>
      <Select
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Segmented radio control for a small fixed set of numeric choices. */
export function SegmentedChoice<T extends number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex overflow-hidden rounded-[7px] border border-[color:var(--color-border-strong)]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={
              "px-3 py-1 font-mono text-[11px] tabular-nums uppercase tracking-[0.06em] transition-colors " +
              (active
                ? "bg-[color:var(--color-primary)] text-white"
                : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
