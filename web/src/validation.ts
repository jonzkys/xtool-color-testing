import type { LayerSpec, ValidationIssue } from "./types";

export function validateLayerSpec(layer: LayerSpec, idx: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (layer.processing_type === "HATCHED_LINES" && layer.hatch_passes.length === 0) {
    issues.push({
      field: `layers[${idx}].hatch_passes`,
      message: "Hatched layer requires at least one pass",
      severity: "error",
    });
  }

  layer.hatch_passes.forEach((hp, p) => {
    if (hp.spacing <= 0) {
      issues.push({
        field: `layers[${idx}].hatch_passes[${p}].spacing`,
        message: "Spacing must be greater than 0",
        severity: "error",
      });
    }
    if (hp.thickness <= 0) {
      issues.push({
        field: `layers[${idx}].hatch_passes[${p}].thickness`,
        message: "Thickness must be greater than 0",
        severity: "error",
      });
    }
    hp.ramps.forEach((r, ri) => {
      if (r.min === r.max) {
        issues.push({
          field: `layers[${idx}].hatch_passes[${p}].ramps[${ri}]`,
          message: "Ramp min equals max — value will be constant across the shape",
          severity: "warning",
        });
      }
    });
  });

  return issues;
}
