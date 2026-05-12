import type { TestSpec } from "../types";

const MARGIN = 1.5;
// Defaults must match xcs_gen/capture/layout.py {QR,ARUCO}_SIZE_DEFAULT_MM.
const QR_DEFAULT = 6;
const ARUCO_DEFAULT = 3;

// WB perimeter clean-pass strip — dimensions mirror
// xcs_gen.capture.layout.{PERIMETER_STRIP_WIDTH_MM, PERIMETER_STRIP_INSET_MM}.
const STRIP_WIDTH_MM = 3.0;
const STRIP_INSET_MM = 1.0;
// Vertical room reserved above the grid when the strip is on, mirroring
// the push-down generators.py applies to gradient_start_y.
const STRIP_RESERVATION_MM = STRIP_WIDTH_MM + MARGIN;

// Axis label font (in mm) and the vertical space the generator reserves between
// wrapped rows for tick + label. Mirrors the backend's _annotation_space_below
// so the preview reflects what actually gets burned when gap_mm is tight.
const LABEL_FONT_MM = 1.4;
const TICK_MM = 0.5;
const ROW_ANNOTATION_MM = TICK_MM + 0.1 + LABEL_FONT_MM + 0.1;

interface Cell {
  x: number; y: number; w: number; h: number;
  /** Row-major flat index across the whole grid. Matches the order
   *  the .xcs builder iterates cells in, so it's the right key for
   *  any per-cell payload (e.g. ``cellColors`` for validation tests). */
  idx: number;
}
interface Row { yMm: number; heightMm: number; cells: Cell[]; labelMin: string; labelMax: string; }

interface StripSegment { x: number; y: number; w: number; h: number }

export interface PreviewGeometry {
  viewW: number; viewH: number;
  gridX: number; gridY: number;
  gridW: number; gridH: number;
  rows: Row[];
  qr: { x: number; y: number; size: number } | null;
  arucos: { x: number; y: number; size: number; id: number }[];
  perimeterStrip: StripSegment[] | null;
  shape: "rect" | "circle";
}

/** Toggle the WB perimeter clean-pass strip overlay. Set to true when
 *  the test's material has a clean-pass recipe configured (and WB is
 *  not disabled) so the preview reflects what the burn will emit. */
export interface PreviewOverride {
  /** Render the 4 perimeter clean-pass strips around the grid edges
   *  and reserve the matching vertical room above the grid (4.5 mm)
   *  exactly like the generator does. Ignored when registration is
   *  off — the strip needs the corner markers as anchors. */
  wbStrip?: boolean;
  /** Override the cell count from `spec.x_steps`. Used for
   *  ``kind=validation`` tests where the cell list is the
   *  ``validation_cells`` length, not a swept axis. */
  cellCount?: number;
  /** Override how many cells per physical row. Defaults to
   *  ``spec.cells_per_row`` when set, else falls back to
   *  ``ceil(x_steps / spec.rows)``. */
  cellsPerRow?: number;
  /** Per-cell fill colours (#rrggbb), indexed by row-major cell
   *  position — same iteration order the preview uses to lay cells
   *  out. For validation tests, pass each cell's ``expected_hex``
   *  here so the preview reflects what the burn will actually look
   *  like. ``undefined`` entries fall back to the default substrate
   *  fill, so a partially-filled palette still draws cleanly. */
  cellColors?: (string | undefined)[];
}

export function computePreviewGeometry(
  spec: TestSpec, override?: PreviewOverride,
): PreviewGeometry {
  const regOn = spec.registration.mode === "on";
  const qrSize = spec.registration.qr_size_mm ?? QR_DEFAULT;
  const arucoSize = spec.registration.aruco_size_mm ?? ARUCO_DEFAULT;
  // The perimeter strip needs registration markers to anchor against;
  // ignored when registration is off.
  const stripOn = regOn && Boolean(override?.wbStrip);

  const xShift = regOn ? Math.max(qrSize, arucoSize) + MARGIN : 0;
  const yShift = regOn ? Math.max(qrSize, arucoSize) + MARGIN : 0;
  const gridX = xShift;
  // Push the grid down by the strip's reservation when it's enabled
  // so the top strip can sit between QR and the top-right ArUco
  // without overlapping the grid. Mirrors the push-down in
  // src/xcs_gen/generators.py::generate_gradient.
  const gridY = yShift + (stripOn ? STRIP_RESERVATION_MM : 0);
  const gridW = spec.width_mm;
  // height_mm follows the backend convention:
  //   2D (y_param + y_steps > 1): height_mm = total grid height across y_steps rows
  //   1D (single or wrapped):     height_mm = per-row cell height
  const ySteps = spec.y_steps ?? 1;
  const is2D = spec.y_param !== null && ySteps > 1;
  // ``effectiveSteps`` is the actual number of cells we need to lay
  // out. For sweep tests it's spec.x_steps; for validation tests it
  // comes from the override (count of picked palette swatches).
  const effectiveSteps = Math.max(1, override?.cellCount ?? spec.x_steps);
  const explicitCellsPerRow =
    override?.cellsPerRow ?? spec.cells_per_row;
  const rowCount = is2D
    ? ySteps
    : explicitCellsPerRow != null && explicitCellsPerRow > 0
      ? Math.max(1, Math.ceil(effectiveSteps / explicitCellsPerRow))
      : Math.max(1, spec.rows);
  const cellsPerRow = is2D
    ? effectiveSteps
    : explicitCellsPerRow ?? Math.ceil(effectiveSteps / rowCount);
  const cellW = (gridW - Math.max(0, cellsPerRow - 1) * spec.gap_mm) / cellsPerRow;
  const rowHeight = is2D
    ? (spec.height_mm - Math.max(0, ySteps - 1) * spec.gap_mm) / ySteps
    : spec.height_mm;
  // Wrapped 1D rows get stretched apart to fit per-row axis labels — same
  // expansion the generator applies via effective_row_gap. When the user
  // has ticked "hide axis labels" there's no label to reserve space for,
  // so the gap collapses back to `spec.gap_mm`. 2D has no per-row labels.
  const rowsAnnotated = !is2D && rowCount > 1 && !spec.hide_axis_labels;
  const interRowGap = rowsAnnotated
    ? Math.max(spec.gap_mm, ROW_ANNOTATION_MM)
    : spec.gap_mm;
  const gridH = is2D
    ? spec.height_mm
    : rowCount * rowHeight + Math.max(0, rowCount - 1) * interRowGap;

  const viewW = gridX + gridW + (regOn ? arucoSize + MARGIN : 0);
  const viewH = gridY + gridH + (regOn ? arucoSize + MARGIN : 0);

  const step = (spec.x_max - spec.x_min) / Math.max(1, effectiveSteps - 1);
  const rows: Row[] = [];
  // 2D: every row spans the full x range (no wrapping). 1D: cells come
  // from a single x_steps pool that we hand out row by row.
  let cellsLeft = effectiveSteps;
  let cellIdx = 0;
  let flatIdx = 0;
  for (let r = 0; r < rowCount; r++) {
    const take = is2D ? cellsPerRow : Math.min(cellsPerRow, cellsLeft);
    const cells: Cell[] = [];
    const rowY = gridY + r * (rowHeight + interRowGap);
    for (let c = 0; c < take; c++) {
      cells.push({
        x: gridX + c * (cellW + spec.gap_mm),
        y: rowY,
        w: cellW, h: rowHeight,
        idx: flatIdx++,
      });
    }
    // In 2D, every row shares the same x range. Only label the bottom
    // row so min/max appear once beneath the grid.
    // In 1D wrapped, each row covers a slice of the x range.
    const isLastRow = r === rowCount - 1;
    let labelMin = "";
    let labelMax = "";
    if (!spec.hide_axis_labels) {
      if (is2D) {
        if (isLastRow) {
          labelMin = spec.x_min.toFixed(0);
          labelMax = spec.x_max.toFixed(0);
        }
      } else {
        labelMin = (spec.x_min + cellIdx * step).toFixed(0);
        labelMax = (spec.x_min + (cellIdx + take - 1) * step).toFixed(0);
      }
    }
    rows.push({ yMm: rowY, heightMm: rowHeight, cells, labelMin, labelMax });
    if (!is2D) { cellIdx += take; cellsLeft -= take; }
  }

  const qr = regOn ? { x: MARGIN, y: MARGIN, size: qrSize } : null;
  const arucos = regOn ? [
    { x: gridX + gridW + MARGIN, y: MARGIN, size: arucoSize, id: 1 },
    { x: MARGIN, y: gridY + gridH + MARGIN, size: arucoSize, id: 2 },
    { x: gridX + gridW + MARGIN, y: gridY + gridH + MARGIN, size: arucoSize, id: 3 },
  ] : [];

  // 4 strip rects matching xcs_gen.capture.layout.compute_layout's
  // perimeter geometry: each centre-line sits ``width/2 + MARGIN``
  // outside the grid, with both endpoints inset from the adjacent
  // marker by ``STRIP_INSET_MM``.
  let perimeterStrip: StripSegment[] | null = null;
  if (stripOn && qr && arucos.length === 3) {
    const tr = arucos.find((a) => a.id === 1)!;
    const bl = arucos.find((a) => a.id === 2)!;
    const br = arucos.find((a) => a.id === 3)!;
    const offset = STRIP_WIDTH_MM / 2 + MARGIN;
    const top = {
      x: qr.x + qr.size + STRIP_INSET_MM,
      y: gridY - offset - STRIP_WIDTH_MM / 2,
      w: (tr.x - STRIP_INSET_MM) - (qr.x + qr.size + STRIP_INSET_MM),
      h: STRIP_WIDTH_MM,
    };
    const right = {
      x: gridX + gridW + offset - STRIP_WIDTH_MM / 2,
      y: tr.y + tr.size + STRIP_INSET_MM,
      w: STRIP_WIDTH_MM,
      h: (br.y - STRIP_INSET_MM) - (tr.y + tr.size + STRIP_INSET_MM),
    };
    const bottom = {
      x: bl.x + bl.size + STRIP_INSET_MM,
      y: gridY + gridH + offset - STRIP_WIDTH_MM / 2,
      w: (br.x - STRIP_INSET_MM) - (bl.x + bl.size + STRIP_INSET_MM),
      h: STRIP_WIDTH_MM,
    };
    const left = {
      x: gridX - offset - STRIP_WIDTH_MM / 2,
      y: qr.y + qr.size + STRIP_INSET_MM,
      w: STRIP_WIDTH_MM,
      h: (bl.y - STRIP_INSET_MM) - (qr.y + qr.size + STRIP_INSET_MM),
    };
    // Skip when any segment would render degenerate — matches the
    // backend's "grid too small" fallback.
    const segs = [top, right, bottom, left];
    if (segs.every((s) => s.w >= 5 && s.h > 0 || s.h >= 5 && s.w > 0)) {
      perimeterStrip = segs;
    }
  }

  return {
    viewW, viewH, gridX, gridY, gridW, gridH, rows, qr, arucos,
    perimeterStrip, shape: spec.cell_shape,
  };
}

export function TestPreview({
  spec, testId: _testId, compact = false, override,
}: {
  spec: TestSpec;
  testId: number | null;
  compact?: boolean;
  /** Optional cell-count override for ``kind=validation`` tests where
   *  the layout is driven by the picked palette subset rather than a
   *  swept axis. */
  override?: PreviewOverride;
}) {
  const g = computePreviewGeometry(spec, override);

  // Default substrate-tinted fill — used for sweep tests, and for
  // any validation cell whose ``cellColors`` entry is missing.
  const defaultCellFill = "#C78F3E";
  const cellStroke = "#7A5322";
  // When per-cell colours are provided, use a darker stroke so the
  // outline reads against any palette colour (the substrate-amber
  // stroke vanishes against warm-toned cells).
  const colours = override?.cellColors;
  const hasColours = Array.isArray(colours) && colours.some((c) => !!c);
  const strokeFor = (idx: number): string =>
    hasColours && colours?.[idx] ? "rgba(0,0,0,0.45)" : cellStroke;
  const fillFor = (idx: number): string =>
    colours?.[idx] ?? defaultCellFill;

  return (
    <div className="w-full flex flex-col gap-2">
      {!compact && (
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            Preview
          </div>
          <div className="font-mono text-[11px] text-[color:var(--color-ink-muted)] tabular-nums">
            {g.viewW.toFixed(1)}mm × {g.viewH.toFixed(1)}mm
          </div>
        </div>
      )}
      <div
        className={compact
          ? "relative h-[160px] w-full rounded-[12px] border border-[color:var(--color-border)] overflow-hidden p-2 bg-[color:var(--color-substrate)]"
          : "rounded-[12px] border border-[color:var(--color-border)] overflow-hidden p-4 bg-[color:var(--color-substrate)]"}
        style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04), var(--shadow-card)" }}
      >
        {compact && (
          <div className="pointer-events-none absolute top-1.5 left-2 font-mono text-[9px] tracking-[0.2em] uppercase font-semibold text-[color:var(--color-substrate-ink)]/50">
            Preview · {g.viewW.toFixed(1)}×{g.viewH.toFixed(1)}mm
          </div>
        )}
        <svg
          viewBox={`0 0 ${g.viewW} ${g.viewH}`}
          preserveAspectRatio={compact ? "xMidYMid meet" : undefined}
          style={compact
            ? { width: "100%", height: "100%", display: "block" }
            : { width: "100%", height: "auto", display: "block" }}
        >
          {g.rows.map((row, ri) => (
            <g key={`cells-${ri}`}>
              {row.cells.map((cell, ci) =>
                g.shape === "circle" ? (
                  <circle
                    key={ci}
                    cx={cell.x + cell.w / 2}
                    cy={cell.y + cell.h / 2}
                    r={Math.min(cell.w, cell.h) / 2}
                    fill={fillFor(cell.idx)}
                    stroke={strokeFor(cell.idx)}
                    strokeWidth={0.1}
                  />
                ) : (
                  <rect
                    key={ci}
                    x={cell.x}
                    y={cell.y}
                    width={cell.w}
                    height={cell.h}
                    fill={fillFor(cell.idx)}
                    stroke={strokeFor(cell.idx)}
                    strokeWidth={0.08}
                  />
                ),
              )}
            </g>
          ))}
          {g.rows.map((row, ri) => {
            if (!row.labelMin && !row.labelMax) return null;
            const labelY = row.yMm + row.heightMm + LABEL_FONT_MM;
            return (
              <g key={`labels-${ri}`}>
                {row.labelMin && (
                  <text
                    x={g.gridX}
                    y={labelY}
                    fontSize={LABEL_FONT_MM}
                    fill="var(--color-substrate-ink)"
                    fontFamily="monospace"
                  >
                    {row.labelMin}
                  </text>
                )}
                {row.labelMax && (
                  <text
                    x={g.gridX + g.gridW}
                    y={labelY}
                    fontSize={LABEL_FONT_MM}
                    fill="var(--color-substrate-ink)"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    {row.labelMax}
                  </text>
                )}
              </g>
            );
          })}
          {g.perimeterStrip && g.perimeterStrip.map((s, i) => (
            <rect
              key={`wb-${i}`}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              fill="rgba(180,180,180,0.55)"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={0.05}
            />
          ))}
          {g.qr && (
            <g>
              <rect
                x={g.qr.x}
                y={g.qr.y}
                width={g.qr.size}
                height={g.qr.size}
                fill="var(--color-substrate-ink)"
              />
              <rect
                x={g.qr.x + g.qr.size * 0.2}
                y={g.qr.y + g.qr.size * 0.2}
                width={g.qr.size * 0.2}
                height={g.qr.size * 0.2}
                fill="var(--color-substrate)"
              />
              <rect
                x={g.qr.x + g.qr.size * 0.6}
                y={g.qr.y + g.qr.size * 0.2}
                width={g.qr.size * 0.2}
                height={g.qr.size * 0.2}
                fill="var(--color-substrate)"
              />
              <rect
                x={g.qr.x + g.qr.size * 0.2}
                y={g.qr.y + g.qr.size * 0.6}
                width={g.qr.size * 0.2}
                height={g.qr.size * 0.2}
                fill="var(--color-substrate)"
              />
            </g>
          )}
          {g.arucos.map((a) => (
            <g key={a.id}>
              <rect x={a.x} y={a.y} width={a.size} height={a.size} fill="var(--color-substrate-ink)" />
              <rect
                x={a.x + a.size * 0.3}
                y={a.y + a.size * 0.3}
                width={a.size * 0.4}
                height={a.size * 0.4}
                fill="var(--color-substrate)"
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
