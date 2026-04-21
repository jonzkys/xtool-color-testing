import type { TestSpec } from "../types";

const MARGIN = 1.5;
const QR_DEFAULT = 5;
const ARUCO_DEFAULT = 2;

// Axis label font (in mm) and the vertical space the generator reserves between
// wrapped rows for tick + label. Mirrors the backend's _annotation_space_below
// so the preview reflects what actually gets burned when gap_mm is tight.
const LABEL_FONT_MM = 1.4;
const TICK_MM = 0.5;
const ROW_ANNOTATION_MM = TICK_MM + 0.1 + LABEL_FONT_MM + 0.1;

interface Cell { x: number; y: number; w: number; h: number; }
interface Row { yMm: number; heightMm: number; cells: Cell[]; labelMin: string; labelMax: string; }

export interface PreviewGeometry {
  viewW: number; viewH: number;
  gridX: number; gridY: number;
  gridW: number; gridH: number;
  rows: Row[];
  qr: { x: number; y: number; size: number } | null;
  arucos: { x: number; y: number; size: number; id: number }[];
  shape: "rect" | "circle";
}

export function computePreviewGeometry(spec: TestSpec): PreviewGeometry {
  const regOn = spec.registration.mode === "on";
  const qrSize = spec.registration.qr_size_mm ?? QR_DEFAULT;
  const arucoSize = spec.registration.aruco_size_mm ?? ARUCO_DEFAULT;

  const xShift = regOn ? Math.max(qrSize, arucoSize) + MARGIN : 0;
  const yShift = regOn ? Math.max(qrSize, arucoSize) + MARGIN : 0;
  const gridX = xShift;
  const gridY = yShift;
  const gridW = spec.width_mm;
  // height_mm follows the backend convention:
  //   2D (y_param + y_steps > 1): height_mm = total grid height across y_steps rows
  //   1D (single or wrapped):     height_mm = per-row cell height
  const ySteps = spec.y_steps ?? 1;
  const is2D = spec.y_param !== null && ySteps > 1;
  const rowCount = is2D ? ySteps : Math.max(1, spec.rows);
  const cellsPerRow = is2D ? spec.x_steps : Math.ceil(spec.x_steps / rowCount);
  const cellW = (gridW - Math.max(0, cellsPerRow - 1) * spec.gap_mm) / cellsPerRow;
  const rowHeight = is2D
    ? (spec.height_mm - Math.max(0, ySteps - 1) * spec.gap_mm) / ySteps
    : spec.height_mm;
  // Wrapped 1D rows get stretched apart to fit per-row axis labels — same
  // expansion the generator applies via effective_row_gap. 2D has no
  // per-row labels.
  const interRowGap = !is2D && rowCount > 1
    ? Math.max(spec.gap_mm, ROW_ANNOTATION_MM)
    : spec.gap_mm;
  const gridH = is2D
    ? spec.height_mm
    : rowCount * rowHeight + Math.max(0, rowCount - 1) * interRowGap;

  const viewW = gridX + gridW + (regOn ? arucoSize + MARGIN : 0);
  const viewH = gridY + gridH + (regOn ? arucoSize + MARGIN : 0);

  const step = (spec.x_max - spec.x_min) / Math.max(1, spec.x_steps - 1);
  const rows: Row[] = [];
  let cellsLeft = spec.x_steps;
  let cellIdx = 0;
  for (let r = 0; r < rowCount; r++) {
    const take = Math.min(cellsPerRow, cellsLeft);
    const cells: Cell[] = [];
    const rowY = gridY + r * (rowHeight + interRowGap);
    for (let c = 0; c < take; c++) {
      cells.push({
        x: gridX + c * (cellW + spec.gap_mm),
        y: rowY,
        w: cellW, h: rowHeight,
      });
    }
    const minVal = spec.x_min + cellIdx * step;
    const maxVal = spec.x_min + (cellIdx + take - 1) * step;
    rows.push({
      yMm: rowY,
      heightMm: rowHeight,
      cells,
      labelMin: minVal.toFixed(0),
      labelMax: maxVal.toFixed(0),
    });
    cellIdx += take; cellsLeft -= take;
  }

  const qr = regOn ? { x: MARGIN, y: MARGIN, size: qrSize } : null;
  const arucos = regOn ? [
    { x: gridX + gridW + MARGIN, y: MARGIN, size: arucoSize, id: 1 },
    { x: MARGIN, y: gridY + gridH + MARGIN, size: arucoSize, id: 2 },
    { x: gridX + gridW + MARGIN, y: gridY + gridH + MARGIN, size: arucoSize, id: 3 },
  ] : [];

  return { viewW, viewH, gridX, gridY, gridW, gridH, rows, qr, arucos, shape: spec.cell_shape };
}

export function TestPreview({ spec, testId: _testId }: { spec: TestSpec; testId: number | null }) {
  const g = computePreviewGeometry(spec);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
                    color: "#666", marginBottom: 6 }}>
        Preview ({g.viewW.toFixed(1)}mm × {g.viewH.toFixed(1)}mm)
      </div>
      <svg viewBox={`0 0 ${g.viewW} ${g.viewH}`}
           style={{ width: "100%", height: "auto", background: "#f4e9d4",
                    border: "1px solid #bbb", display: "block" }}>
        {g.rows.map((row, ri) => (
          <g key={`cells-${ri}`}>
            {row.cells.map((cell, ci) => (
              g.shape === "circle" ? (
                <circle key={ci} cx={cell.x + cell.w / 2} cy={cell.y + cell.h / 2}
                        r={Math.min(cell.w, cell.h) / 2}
                        fill="#c7a46a" stroke="#8d6d3d" strokeWidth={0.1} />
              ) : (
                <rect key={ci} x={cell.x} y={cell.y} width={cell.w} height={cell.h}
                      fill="#c7a46a" stroke="#8d6d3d" strokeWidth={0.1} />
              )
            ))}
          </g>
        ))}
        {g.rows.map((row, ri) => {
          const labelY = row.yMm + row.heightMm + LABEL_FONT_MM;
          return (
            <g key={`labels-${ri}`}>
              <text x={g.gridX} y={labelY}
                    fontSize={LABEL_FONT_MM} fill="#444" fontFamily="monospace">{row.labelMin}</text>
              <text x={g.gridX + g.gridW} y={labelY}
                    fontSize={LABEL_FONT_MM} fill="#444" fontFamily="monospace"
                    textAnchor="end">{row.labelMax}</text>
            </g>
          );
        })}
        {g.qr && (
          <rect x={g.qr.x} y={g.qr.y} width={g.qr.size} height={g.qr.size}
                fill="#111" />
        )}
        {g.qr && (
          <rect x={g.qr.x + g.qr.size * 0.25} y={g.qr.y + g.qr.size * 0.25}
                width={g.qr.size * 0.15} height={g.qr.size * 0.15} fill="#f4e9d4" />
        )}
        {g.arucos.map(a => (
          <g key={a.id}>
            <rect x={a.x} y={a.y} width={a.size} height={a.size} fill="#111" />
            <rect x={a.x + a.size * 0.35} y={a.y + a.size * 0.35}
                  width={a.size * 0.3} height={a.size * 0.3} fill="#f4e9d4" />
          </g>
        ))}
      </svg>
    </div>
  );
}
