import type { TestSpec } from "./types";

export function squareCellHeight(t: TestSpec): number {
  const ySteps = t.y_steps ?? 1;
  const is2D = t.y_param !== null && ySteps > 1;
  if (is2D) {
    const cellW = (t.width_mm - Math.max(0, t.x_steps - 1) * t.gap_mm) / t.x_steps;
    return cellW * ySteps + Math.max(0, ySteps - 1) * t.gap_mm;
  }
  // For 1D (sweep or validation), cell width is determined by
  // cells-per-row. Validation tests expose this directly; sweep tests
  // derive it from ceil(x_steps / rows). Either way the cell stays
  // square: height_mm = cell_w (since 1D height_mm is per-row).
  const perRow = t.cells_per_row != null && t.cells_per_row > 0
    ? t.cells_per_row
    : Math.ceil(t.x_steps / Math.max(1, t.rows));
  return (t.width_mm - Math.max(0, perRow - 1) * t.gap_mm) / perRow;
}

export function normalizeSpec(spec: TestSpec): TestSpec {
  if (!spec.square_cells) return spec;
  const target = Number(squareCellHeight(spec).toFixed(3));
  if (Math.abs(target - spec.height_mm) < 0.001) return spec;
  return { ...spec, height_mm: target };
}
