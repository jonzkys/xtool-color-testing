import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Called only on blur / Enter (i.e. when the user finishes editing). */
  onCommit?: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  issue?: string;
  help?: string;
}

function formatNum(v: number): string {
  return Number.isFinite(v) ? String(v) : "";
}

/**
 * Controlled-but-friendly number input.
 *
 * The input's displayed text is tracked as *local* state so the user can
 * freely delete, type, and paste without React snapping the value back to
 * the parent's committed number. The parent is updated on every valid
 * keystroke (so live previews stay in sync), but min/max clamping only
 * happens on blur — typing "500" starting from "100" doesn't get clamped
 * to "min" during intermediate keystrokes.
 */
export function NumberField({ label, value, onChange, onCommit, step, min, max, integer, issue, help }: Props) {
  const [text, setText] = useState<string>(() => formatNum(value));
  const focusedRef = useRef(false);

  // Sync the displayed text when the parent value changes externally
  // (e.g. after applying a palette match or a library preset) — but only
  // while the user isn't actively editing, so we don't stomp their input.
  useEffect(() => {
    if (!focusedRef.current) setText(formatNum(value));
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    if (raw === "") return;  // user mid-edit; don't commit until there's a value
    const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(parsed)) return;  // partial input like "-" or "1e"
    // Commit without clamping so the user can freely overshoot/undershoot
    // while typing. Clamping happens on blur.
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
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#555", marginBottom: 2 }}>
        {label}
        {help && <HelpIcon text={help} />}
      </span>
      <input
        type="number"
        value={text}
        step={step ?? (integer ? 1 : "any")}
        min={min}
        max={max}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        style={{
          width: "100%",
          padding: "6px 8px",
          border: issue ? "1px solid #d47" : "1px solid #ccc",
          borderRadius: 4,
          font: "inherit",
        }}
      />
      {issue && <div style={{ fontSize: 11, color: "#d47", marginTop: 2 }}>{issue}</div>}
    </label>
  );
}

// Inline ? icon that reveals a tooltip on hover/focus.
// Tooltip uses position:fixed with computed coords so it isn't clipped by
// scrollable parent containers (the SVG-Layers tab has narrow overflow:auto
// columns that would otherwise hide the tooltip).
export function HelpIcon({ text }: { text: string }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  function show() {
    const el = iconRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tipWidth = 260;
    // Center under the icon, but clamp so it stays inside the viewport.
    let left = rect.left + rect.width / 2 - tipWidth / 2;
    if (left + tipWidth > window.innerWidth - 8) {
      left = window.innerWidth - tipWidth - 8;
    }
    if (left < 8) left = 8;
    setPos({ left, top: rect.bottom + 6 });
  }

  return (
    <span
      ref={iconRef}
      tabIndex={0}
      onClick={(e) => e.preventDefault()}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
      className="help-icon"
    >
      ?
      {pos && (
        <span
          className="help-tip"
          style={{ position: "fixed", left: pos.left, top: pos.top }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
