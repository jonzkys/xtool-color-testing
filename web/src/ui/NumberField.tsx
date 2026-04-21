import { useEffect, useRef, useState, type ReactNode } from "react";
import { Field } from "./Field";
import { Input } from "./Input";

export interface NumberFieldProps {
  label?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  /** Called only on blur / Enter (i.e. when the user finishes editing). */
  onCommit?: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Validation error message — shown in red under the input. */
  issue?: string;
  help?: ReactNode;
  /** Optional non-error hint shown under the input. Ignored if `issue` set. */
  hint?: ReactNode;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  inline?: boolean;
}

function formatNum(v: number): string {
  return Number.isFinite(v) ? String(v) : "";
}

/**
 * Controlled-but-friendly number input with clamp-on-blur semantics.
 *
 * Preserved verbatim from the pre-redesign implementation:
 *  - displayed text is local state so users can freely type / delete / paste
 *  - parent is notified on every valid keystroke (keeps live previews in sync)
 *  - min/max clamping happens only on blur or Enter, not mid-keystroke
 *  - external value changes (e.g. apply-preset) sync into the displayed text
 *    only when the user isn't actively editing
 *
 * Rewrapped visually with the new Field + Input primitives. The help tooltip
 * uses the new Radix-backed HelpTooltip; verify scroll-parent escape in a
 * dense page before relying on it (NumberField lives inside deeply nested
 * scroll containers on the SVG-Layers page).
 */
export function NumberField({
  label,
  value,
  onChange,
  onCommit,
  step,
  min,
  max,
  integer,
  issue,
  help,
  hint,
  placeholder,
  className,
  disabled,
  inline,
}: NumberFieldProps) {
  const [text, setText] = useState<string>(() => formatNum(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(formatNum(value));
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    if (raw === "") return;
    const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    if (parsed !== value) onChange(parsed);
  }

  function handleBlur() {
    focusedRef.current = false;
    if (text === "") {
      setText(formatNum(value));
      onCommit?.(value);
      return;
    }
    const parsed = integer ? parseInt(text, 10) : parseFloat(text);
    if (!Number.isFinite(parsed)) {
      setText(formatNum(value));
      onCommit?.(value);
      return;
    }
    let clamped = parsed;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    setText(formatNum(clamped));
    if (clamped !== value) onChange(clamped);
    onCommit?.(clamped);
  }

  return (
    <Field
      label={label}
      help={help}
      error={issue}
      hint={hint}
      inline={inline}
      className={className}
    >
      <Input
        type="number"
        mono
        value={text}
        step={step ?? (integer ? 1 : "any")}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        invalid={!!issue}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
    </Field>
  );
}
