import type { ValidationIssue } from "../../types";

interface Props {
  issues: ValidationIssue[];
}

export function WarningBanner({ issues }: Props) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <div style={{ padding: 8, borderRadius: 4, marginBottom: 12, background: errors.length ? "#fbe9ec" : "#fff4e0", border: errors.length ? "1px solid #f3c3cd" : "1px solid #f1d9a1" }}>
      {errors.length > 0 && (
        <div style={{ color: "#a02840", fontWeight: 600 }}>
          {errors.length} error{errors.length === 1 ? "" : "s"}:
        </div>
      )}
      {warnings.length > 0 && errors.length === 0 && (
        <div style={{ color: "#9a6600", fontWeight: 600 }}>
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}:
        </div>
      )}
      <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
        {[...errors, ...warnings].map((i, idx) => (
          <li key={idx} style={{ fontSize: 12 }}>{i.message}</li>
        ))}
      </ul>
    </div>
  );
}
