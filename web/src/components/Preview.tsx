import type { Project, TestPlacement, ValidationIssue } from "../types";

interface Props {
  project: Project;
  issues: ValidationIssue[];
}

const PADDING_MM = 8;
const TEST_COLORS = ["#4a7aab", "#aa6a4a", "#4aab6a", "#aa4a8a", "#8a7a4a", "#4a8aaa"];

interface LayoutCell {
  placement: TestPlacement;
  x: number;
  y: number;
}

function layout(project: Project): { cells: LayoutCell[]; totalW: number; totalH: number } {
  const colWidths = new Map<number, number>();
  const rowHeights = new Map<number, number>();

  for (const p of project.tests) {
    const perColW = p.test.width_mm / p.col_span;
    for (let c = p.col; c < p.col + p.col_span; c += 1) {
      colWidths.set(c, Math.max(colWidths.get(c) ?? 0, perColW));
    }
    rowHeights.set(p.row, Math.max(rowHeights.get(p.row) ?? 0, p.test.height_mm));
  }

  const sortedCols = [...colWidths.keys()].sort((a, b) => a - b);
  const sortedRows = [...rowHeights.keys()].sort((a, b) => a - b);

  const colX = new Map<number, number>();
  let x = 0;
  for (const c of sortedCols) {
    colX.set(c, x);
    x += (colWidths.get(c) ?? 0) + project.grid_gap_mm;
  }
  const totalW = x > 0 ? x - project.grid_gap_mm : 0;

  const rowY = new Map<number, number>();
  let y = 0;
  for (const r of sortedRows) {
    rowY.set(r, y);
    y += (rowHeights.get(r) ?? 0) + project.grid_gap_mm;
  }
  const totalH = y > 0 ? y - project.grid_gap_mm : 0;

  const cells = project.tests.map((p) => ({
    placement: p,
    x: colX.get(p.col) ?? 0,
    y: rowY.get(p.row) ?? 0,
  }));

  return { cells, totalW, totalH };
}

export function Preview({ project, issues }: Props) {
  const { cells, totalW, totalH } = layout(project);
  const viewW = totalW + PADDING_MM * 2;
  const viewH = totalH + PADDING_MM * 2;

  const errorIds = new Set<string>();
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    const match = issue.field.match(/tests\[(\d+)\]/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const p = project.tests[idx];
      if (p) errorIds.add(p.test.id);
    }
  }

  return (
    <div style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
        Preview ({totalW.toFixed(1)}mm × {totalH.toFixed(1)}mm)
      </div>
      <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 4, background: "white", padding: 8, overflow: "auto" }}>
        {cells.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#999" }}>No tests yet.</div>
        ) : (
          <svg viewBox={`0 0 ${viewW} ${viewH}`} style={{ width: "100%", height: "100%" }} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={viewW} height={viewH} fill="#fafafa" />
            {cells.map(({ placement, x, y }, i) => {
              const color = TEST_COLORS[i % TEST_COLORS.length];
              const strokeColor = errorIds.has(placement.test.id) ? "#d43" : "#333";
              return (
                <g key={placement.test.id} transform={`translate(${PADDING_MM + x}, ${PADDING_MM + y})`}>
                  <rect
                    x={0}
                    y={0}
                    width={placement.test.width_mm}
                    height={placement.test.height_mm}
                    fill={color}
                    fillOpacity={0.3}
                    stroke={strokeColor}
                    strokeWidth={errorIds.has(placement.test.id) ? 0.4 : 0.2}
                  />
                  <text
                    x={1}
                    y={2.5}
                    fontSize={1.8}
                    fill="#333"
                  >
                    {placement.test.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
