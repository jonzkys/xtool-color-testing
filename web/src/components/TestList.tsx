import type { Project } from "../types";
import { NumberField } from "./fields/NumberField";

interface Props {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onProjectChange: (patch: Partial<Project>) => void;
}

export function TestList({ project, selectedId, onSelect, onAdd, onProjectChange }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 12, gap: 16 }}>
      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          Tests
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {project.tests.map((p) => {
            const isSelected = selectedId === p.test.id;
            return (
              <li key={p.test.id}>
                <button
                  onClick={() => onSelect(p.test.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "1px solid " + (isSelected ? "#336" : "#ddd"),
                    background: isSelected ? "#e8ecf3" : "white",
                    borderRadius: 4,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{p.test.name}</div>
                  <div style={{ fontSize: 11, color: "#777" }}>
                    {p.test.x_param} {p.test.x_min}–{p.test.x_max}
                    {p.test.y_param && ` × ${p.test.y_param} ${p.test.y_min}–${p.test.y_max}`}
                  </div>
                  <div style={{ fontSize: 10, color: "#999" }}>
                    r{p.row} c{p.col}{p.col_span > 1 ? ` (span ${p.col_span})` : ""}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          onClick={onAdd}
          style={{
            marginTop: 8, width: "100%", padding: 8,
            border: "1px dashed #999", background: "transparent",
            borderRadius: 4, color: "#555",
          }}
        >
          + Add test
        </button>
      </div>

      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          Project
        </div>
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Name</span>
          <input
            value={project.name}
            onChange={(e) => onProjectChange({ name: e.target.value })}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, font: "inherit" }}
          />
        </label>
        <NumberField
          label="Grid gap (mm)"
          value={project.grid_gap_mm}
          onChange={(v) => onProjectChange({ grid_gap_mm: v })}
        />
        <NumberField
          label="Focus / thickness (mm)"
          value={project.focus_mm}
          onChange={(v) => onProjectChange({ focus_mm: v })}
          min={0}
          max={50}
          help="Material thickness written to XCS's auto-focus. Rechecked in XCS Studio before burning, but nice to seed."
        />
      </div>
    </div>
  );
}
