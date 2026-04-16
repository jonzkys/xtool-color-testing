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

// Inline ? icon that reveals a tooltip on hover/focus. Pure CSS via :hover/:focus-within.
export function HelpIcon({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      // Keep interactive (hover / keyboard focus) without turning the parent label into a form target
      onClick={(e) => e.preventDefault()}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        fontSize: 10,
        fontWeight: 700,
        color: "#888",
        border: "1px solid #bbb",
        borderRadius: "50%",
        cursor: "help",
        userSelect: "none",
      }}
      className="help-icon"
    >
      ?
      <span
        className="help-tip"
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translate(-50%, 6px)",
          background: "#2b2b2b",
          color: "white",
          padding: "6px 10px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 400,
          lineHeight: 1.4,
          width: 240,
          zIndex: 10,
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 80ms linear",
          whiteSpace: "normal",
          textAlign: "left",
        }}
      >
        {text}
      </span>
    </span>
  );
}
