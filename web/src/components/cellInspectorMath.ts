/**
 * Pure geometry helpers for the cell inspector — kept in a separate
 * file from the component so they can be unit-tested without DOM /
 * RTL setup. The math here MUST agree with the backend's
 * ``grid_layout_payload`` numbers; the same payload is used for both
 * forward (cell → highlight rect) and reverse (mouse → cell)
 * directions, so the agreement holds by construction.
 */

import type { GridLayout } from "../types";

export interface PhysicalCell {
  physicalRow: number;
  displayedCol: number;
}

export interface CellRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SwatchIndex {
  row: number;
  col: number;
}

/** Image-pixel coords of a cell's bounding rect. Uses ``cell_height_px``
 *  (not ``row_stride_px``) for height so the rect doesn't bleed into
 *  the inter-row gutter on wrapped 1D tests. */
export function cellRectInImagePx(layout: GridLayout, cell: PhysicalCell): CellRect {
  return {
    left: layout.grid_origin_x_px + cell.displayedCol * layout.cell_width_px,
    top: layout.grid_origin_y_px + cell.physicalRow * layout.row_stride_px,
    width: layout.cell_width_px,
    height: layout.cell_height_px,
  };
}

/** Reverse-map an image-pixel coordinate to a (physical row, displayed
 *  col) cell. Returns ``null`` when the point lies outside the grid or
 *  in the inter-row gutter — strict in-cell-or-nothing.
 *
 *  Cells per row vary on wrapped 1D when the last row is partial; the
 *  rejection of wrapped-tail unused cells is the caller's job (use
 *  :func:`resolveSwatchIndex` with an ``x_steps`` argument). */
export function imagePxToCell(
  layout: GridLayout, imgX: number, imgY: number,
): PhysicalCell | null {
  const colF = (imgX - layout.grid_origin_x_px) / layout.cell_width_px;
  const rowF = (imgY - layout.grid_origin_y_px) / layout.row_stride_px;
  const displayedCol = Math.floor(colF);
  const physicalRow = Math.floor(rowF);

  // Out-of-bounds: above / left of grid, below / right of grid extent.
  if (displayedCol < 0 || displayedCol >= layout.cells_per_physical_row) return null;
  if (physicalRow < 0 || physicalRow >= layout.physical_rows) return null;

  // Gutter check: if cell_height < row_stride, the bottom slice of
  // each row's stride is the inter-row gap. Reject hits that fall
  // there.
  const cellHeightFraction = layout.cell_height_px / layout.row_stride_px;
  const fractionalY = rowF - physicalRow;
  if (fractionalY > cellHeightFraction) return null;

  return { physicalRow, displayedCol };
}

/** Translate a (physical row, displayed col) into the result's flat
 *  swatch index (the ``ResultSwatch.row`` / ``.col`` fields).
 *
 *  - 2D layouts are pass-through.
 *  - 1D wrapped layouts have ``row=0`` for every swatch and a ``col``
 *    that ranges [0, x_steps). Cells past the last real swatch
 *    (a partial trailing row) return ``null``.
 *
 *  ``totalCols`` is the test's ``x_steps`` when provided; pass it to
 *  catch the wrapped-tail case. Without it, the return value covers
 *  the full physical grid.  */
export function resolveSwatchIndex(
  layout: GridLayout,
  cell: PhysicalCell,
  totalCols?: number,
): SwatchIndex | null {
  if (layout.is_2d) {
    return { row: cell.physicalRow, col: cell.displayedCol };
  }
  // 1D (single-row or wrapped)
  const flatCol =
    cell.physicalRow * layout.cells_per_physical_row + cell.displayedCol;
  if (totalCols !== undefined && flatCol >= totalCols) return null;
  return { row: 0, col: flatCol };
}

/** Translate viewport coords → image-pixel coords using a rendered
 *  ``<img>``'s displayed (letterbox-aware) rect. Pure — extracted
 *  for testability. ``rect`` MUST be the actual displayed image
 *  rect, which for ``object-contain`` is smaller than the
 *  containing element's rect. Use :func:`displayedImageRect` to
 *  compute it. */
export function viewportToImagePx(
  layout: GridLayout, rect: { left: number; top: number; width: number; height: number },
  clientX: number, clientY: number,
): { imgX: number; imgY: number } {
  const scaleX = layout.image_width_px / rect.width;
  const scaleY = layout.image_height_px / rect.height;
  return {
    imgX: (clientX - rect.left) * scaleX,
    imgY: (clientY - rect.top) * scaleY,
  };
}

/** Compute the actual displayed image rect for an ``<img>`` rendered
 *  with ``object-contain``. The element's own bounding rect covers
 *  the container including any letterbox bands; the displayed image
 *  itself is scaled by ``min(cw/nw, ch/nh)`` and centred. Returns
 *  ``null`` until the image has loaded (natural dims are 0). */
export function displayedImageRect(
  imgEl: HTMLImageElement,
): { left: number; top: number; width: number; height: number } | null {
  const nw = imgEl.naturalWidth;
  const nh = imgEl.naturalHeight;
  if (!nw || !nh) return null;
  const cw = imgEl.clientWidth;
  const ch = imgEl.clientHeight;
  const scale = Math.min(cw / nw, ch / nh);
  const dispW = nw * scale;
  const dispH = nh * scale;
  const offsetX = (cw - dispW) / 2;
  const offsetY = (ch - dispH) / 2;
  const rect = imgEl.getBoundingClientRect();
  return {
    left: rect.left + offsetX,
    top: rect.top + offsetY,
    width: dispW,
    height: dispH,
  };
}
