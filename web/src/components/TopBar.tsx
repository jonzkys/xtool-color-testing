type Tab = "tests" | "svg" | "layers";

interface Props {
  title: string;
  generateDisabled: boolean;
  generating: boolean;
  onGenerate: () => void;
  errorMessage?: string;
  showGenerate?: boolean;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}

export function TopBar({
  title, generateDisabled, generating, onGenerate, errorMessage,
  showGenerate = true, tab, onTabChange,
}: Props) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 16px", background: "white", borderBottom: "1px solid #ddd",
    }}>
      <div style={{ fontWeight: 600, fontSize: 16 }}>xcs-gen</div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
        <TabButton active={tab === "tests"} onClick={() => onTabChange("tests")}>Param tests</TabButton>
        <TabButton active={tab === "svg"} onClick={() => onTabChange("svg")}>SVG stack</TabButton>
        <TabButton active={tab === "layers"} onClick={() => onTabChange("layers")}>SVG layers</TabButton>
      </div>

      <div style={{ color: "#888" }}>|</div>
      <div style={{ color: "#555" }}>{title}</div>
      <div style={{ flex: 1 }} />
      {errorMessage && (
        <div style={{ color: "#a02840", fontSize: 12, marginRight: 12 }}>
          {errorMessage}
        </div>
      )}
      {showGenerate && (
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
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        border: "1px solid " + (active ? "#336" : "#ddd"),
        background: active ? "#e8ecf3" : "white",
        color: active ? "#336" : "#555",
        borderRadius: 4,
        fontWeight: active ? 600 : 400,
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}
