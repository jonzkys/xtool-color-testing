interface Props {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  issue?: string;
}

export function NumberField({ label, value, onChange, step, min, max, integer, issue }: Props) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>{label}</span>
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
