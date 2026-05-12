/**
 * Auto-fit math: given a material's outline + a buffer, work out the
 * largest grid dimensions that fit inside it after the registration
 * markers have eaten their share of the burn area.
 *
 * The geometry mirrors what ``compute_layout`` (Python) and
 * ``computePreviewGeometry`` (TestPreview) already do — keep them in
 * sync if either side moves the QR / ArUco anchors.
 *
 *   ┌──────────── view (= burnable area) ────────────┐
 *   │  QR ─ MARGIN ─ ┌──── grid ────┐ ─ MARGIN ─ ARU │
 *   │  …             │              │              … │
 *   │  ARU ─ MARGIN ─└──────────────┘ ─ MARGIN ─ ARU │
 *   └─────────────────────────────────────────────────┘
 *
 * Edge widths (registration on):
 *   left  = max(qr, aruco) + MARGIN
 *   right = aruco + MARGIN
 *   top   = max(qr, aruco) + MARGIN
 *   bot   = aruco + MARGIN
 *
 * For a circle material we inscribe the largest *square* burn area
 * inside the buffered diameter (side = d / √2). v1 doesn't try to
 * solve for an arbitrary aspect rectangle inside the circle —
 * inscribing a square gives a sensible default and the user can
 * still nudge the dimensions afterwards. Could be revisited if real
 * use cases want non-square circle layouts.
 */

const MARGIN = 1.5;
// Defaults must match xcs_gen/capture/layout.py {QR,ARUCO}_SIZE_DEFAULT_MM.
const QR_DEFAULT = 6;
const ARUCO_DEFAULT = 3;

export interface AutoFitInput {
  shape: "circle" | "rect" | null;
  diameter_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  /** 0–100, e.g. 2 = 2% empty all sides. */
  buffer_pct: number;
  qr_size_mm?: number | null;
  aruco_size_mm?: number | null;
  /** When false, no marker margins are subtracted (registration off). */
  registration_on?: boolean;
}

export interface AutoFitGrid {
  /** Width of the cell-grid in mm — what spec.width_mm should hold. */
  grid_w: number;
  /** Total height of the cell-grid in mm. For 1D / wrapped-1D specs
   *  the caller divides this back into per-row cell height; for 2D
   *  this is spec.height_mm directly. */
  grid_h: number;
  /** When true the result is derived from a circle material — the
   *  caller may want to force square_cells on so the grid fills the
   *  inscribed square neatly. */
  inscribed_square: boolean;
}

/** Compute the grid bounds, or null when the inputs don't fit (e.g.
 *  diameter too small to host the markers, or shape unset). */
export function computeAutoFitGrid(input: AutoFitInput): AutoFitGrid | null {
  if (!input.shape) return null;

  const buffer = Math.max(0, Math.min(20, input.buffer_pct)) / 100;
  const regOn = input.registration_on ?? true;
  const qr = input.qr_size_mm ?? QR_DEFAULT;
  const aruco = input.aruco_size_mm ?? ARUCO_DEFAULT;

  // Edge-width subtractions for the cell-grid — see ASCII diagram.
  const x_chrome = regOn ? Math.max(qr, aruco) + MARGIN + (aruco + MARGIN) : 0;
  const y_chrome = x_chrome; // top + bottom edges sum to the same.

  if (input.shape === "circle") {
    const d = input.diameter_mm ?? 0;
    if (d <= 0) return null;
    // Inscribed square inside a circle of effective (post-buffer)
    // diameter. side = d × (1 - 2·buffer) / √2.
    const effD = d * (1 - 2 * buffer);
    const side = effD / Math.SQRT2;
    const grid = side - x_chrome;
    if (grid <= 0) return null;
    return { grid_w: grid, grid_h: grid, inscribed_square: true };
  }

  // shape === "rect"
  const w = input.width_mm ?? 0;
  const h = input.height_mm ?? 0;
  if (w <= 0 || h <= 0) return null;
  const effW = w * (1 - 2 * buffer);
  const effH = h * (1 - 2 * buffer);
  const grid_w = effW - x_chrome;
  const grid_h = effH - y_chrome;
  if (grid_w <= 0 || grid_h <= 0) return null;
  return { grid_w, grid_h, inscribed_square: false };
}

/** Translate the auto-fit total grid_h into spec.height_mm.
 *
 * spec.height_mm carries different semantics depending on the test
 * shape:
 *   - 2D (y_param set, y_steps > 1) → total grid height
 *   - wrapped 1D (rows > 1, y_param null) → per-row cell height
 *   - single-row 1D → cell height (= total)
 *
 * This helper handles all three so callers don't repeat the row-gap
 * math. ``rows`` defaults to 1 when not provided.
 */
const _LABEL_FONT_MM = 1.4;
const _TICK_MM = 0.5;
const _ROW_ANNOTATION_MM = _TICK_MM + 0.1 + _LABEL_FONT_MM + 0.1;

export function gridHeightToSpecHeight(args: {
  grid_h: number;
  rows: number;
  gap_mm: number;
  hide_axis_labels: boolean;
  is_2d: boolean;
}): number {
  if (args.is_2d) return args.grid_h;
  if (args.rows <= 1) return args.grid_h;
  // Wrapped 1D — total = N · cell_h + (N - 1) · interRowGap.
  // interRowGap honours hide_axis_labels (no annotation reservation
  // when axis labels are off) so the math matches what the generator
  // and TestPreview both compute.
  const interRowGap = args.hide_axis_labels
    ? args.gap_mm
    : Math.max(args.gap_mm, _ROW_ANNOTATION_MM);
  const cell_h = (args.grid_h - (args.rows - 1) * interRowGap) / args.rows;
  return Math.max(0.001, cell_h);
}

/** Co-existence of auto-fit + Square cells: pick the largest *square*
 *  cell that fits inside the auto-fit bounds, then derive the
 *  spec.width_mm / spec.height_mm to match. The grid may be smaller
 *  than the material outline on one axis — that's the price of
 *  squareness inside the available area.
 *
 *  Inputs assume `grid_w` / `grid_h` already have buffer + marker
 *  chrome subtracted (i.e. the AutoFitGrid output). */
export function squareCellAutoFit(args: {
  grid_w: number;
  grid_h: number;
  x_steps: number;
  y_steps: number;
  rows: number;
  gap_mm: number;
  hide_axis_labels: boolean;
  is_2d: boolean;
  /** Validation tests only — overrides ``ceil(x_steps / rows)`` so the
   *  cell-per-row count comes from the user's wrap setting rather than
   *  the placeholder ``x_steps=1`` we use for kind=validation. When
   *  set, ``rows`` is derived as ``ceil(cell_count / cells_per_row)``
   *  using ``cell_count`` (or ``x_steps`` if not set). */
  cells_per_row?: number;
  /** Validation tests only — actual cell count from
   *  ``validation_cells.length``. Defaults to ``x_steps``. */
  cell_count?: number;
}): { width_mm: number; height_mm: number } | null {
  const { grid_w, grid_h, x_steps, gap_mm, hide_axis_labels, is_2d } = args;
  const ySteps = Math.max(1, args.y_steps);
  const cellCount = args.cell_count != null && args.cell_count > 0
    ? args.cell_count
    : x_steps;
  // For validation tests with a wrap setting, derive rows from
  // (count / cells_per_row); otherwise fall back to the spec's ``rows``.
  const rows = args.cells_per_row != null && args.cells_per_row > 0
    ? Math.max(1, Math.ceil(cellCount / args.cells_per_row))
    : Math.max(1, args.rows);

  if (is_2d) {
    const cellW_max = (grid_w - Math.max(0, x_steps - 1) * gap_mm) / x_steps;
    const cellH_max = (grid_h - Math.max(0, ySteps - 1) * gap_mm) / ySteps;
    const cellSide = Math.min(cellW_max, cellH_max);
    if (cellSide <= 0) return null;
    const width_mm = cellSide * x_steps + Math.max(0, x_steps - 1) * gap_mm;
    const height_mm = cellSide * ySteps + Math.max(0, ySteps - 1) * gap_mm;
    return { width_mm, height_mm };
  }

  // 1D (single-row or wrapped).
  const perRow = args.cells_per_row != null && args.cells_per_row > 0
    ? args.cells_per_row
    : Math.max(1, Math.ceil(cellCount / rows));
  const cellW_max = (grid_w - Math.max(0, perRow - 1) * gap_mm) / perRow;
  let cellH_max: number;
  if (rows > 1) {
    const interRowGap = hide_axis_labels
      ? gap_mm
      : Math.max(gap_mm, _ROW_ANNOTATION_MM);
    cellH_max = (grid_h - (rows - 1) * interRowGap) / rows;
  } else {
    cellH_max = grid_h;
  }
  const cellSide = Math.min(cellW_max, cellH_max);
  if (cellSide <= 0) return null;
  const width_mm = cellSide * perRow + Math.max(0, perRow - 1) * gap_mm;
  const height_mm = cellSide; // per-row cell height for 1D
  return { width_mm, height_mm };
}
