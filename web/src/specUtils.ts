import type { TestSpec } from "./types";

export function squareCellHeight(t: TestSpec): number {
  const ySteps = t.y_steps ?? 1;
  const is2D = t.y_param !== null && ySteps > 1;
  if (is2D) {
    const cellW = (t.width_mm - Math.max(0, t.x_steps - 1) * t.gap_mm) / t.x_steps;
    return cellW * ySteps + Math.max(0, ySteps - 1) * t.gap_mm;
  }
  const perRow = Math.ceil(t.x_steps / Math.max(1, t.rows));
  return (t.width_mm - Math.max(0, perRow - 1) * t.gap_mm) / perRow;
}

export function normalizeSpec(spec: TestSpec): TestSpec {
  if (!spec.square_cells) return spec;
  const target = Number(squareCellHeight(spec).toFixed(3));
  if (Math.abs(target - spec.height_mm) < 0.001) return spec;
  return { ...spec, height_mm: target };
}
