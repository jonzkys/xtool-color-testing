interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  issue?: string;
  help?: string;
}

export function NumberField({ label, value, onChange, step, min, max, integer, issue, help }: Props) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#555", marginBottom: 2 }}>
        {label}
        {help && <HelpIcon text={help} />}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step ?? (integer ? 1 : "any")}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return;
          const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
          if (!Number.isFinite(parsed)) return;
          onChange(parsed);
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

import { useRef, useState } from "react";

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
