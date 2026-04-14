interface Props {
  title: string;
  generateDisabled: boolean;
  generating: boolean;
  onGenerate: () => void;
  errorMessage?: string;
}

export function TopBar({ title, generateDisabled, generating, onGenerate, errorMessage }: Props) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 16px", background: "white", borderBottom: "1px solid #ddd",
    }}>
      <div style={{ fontWeight: 600, fontSize: 16 }}>xcs-gen</div>
      <div style={{ color: "#888" }}>|</div>
      <div style={{ color: "#555" }}>{title}</div>
      <div style={{ flex: 1 }} />
      {errorMessage && (
        <div style={{ color: "#a02840", fontSize: 12, marginRight: 12 }}>
          {errorMessage}
        </div>
      )}
      <button
        onClick={onGenerate}
        disabled={generateDisabled || generating}
        style={{
          padding: "8px 16px",
          background: generateDisabled || generating ? "#ccc" : "#336",
          color: "white",
          border: "none",
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        {generating ? "Generating..." : "Generate .xcs"}
      </button>
    </div>
  );
}
