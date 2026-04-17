import type { LayerSpec, Project, ValidationIssue } from "./types";

export const BEAM_WIDTH_MM = 0.03;

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  project.tests.forEach((placement, i) => {
    const t = placement.test;
    const prefix = `tests[${i}].test`;

    if (t.x_min === t.x_max) {
      issues.push({
        field: `${prefix}.x_min`,
        message: "x_min must differ from x_max",
        severity: "error",
      });
    }
    if (t.x_steps < 2) {
      issues.push({
        field: `${prefix}.x_steps`,
        message: "x_steps must be at least 2",
        severity: "error",
      });
    }
    if (t.width_mm <= 0) {
      issues.push({
        field: `${prefix}.width_mm`,
        message: "width_mm must be positive",
        severity: "error",
      });
    }
    if (t.height_mm <= 0) {
      issues.push({
        field: `${prefix}.height_mm`,
        message: "height_mm must be positive",
        severity: "error",
      });
    }

    // Y axis completeness
    if (t.y_param) {
      if (t.y_min === null || t.y_min === undefined ||
          t.y_max === null || t.y_max === undefined ||
          t.y_steps === null || t.y_steps === undefined) {
        issues.push({
          field: `${prefix}.y_param`,
          message: "y_min, y_max and y_steps are required when y_param is set",
          severity: "error",
        });
      } else if (t.y_min === t.y_max) {
        issues.push({
          field: `${prefix}.y_min`,
          message: "y_min must differ from y_max",
          severity: "error",
        });
      }
    }

    // Beam width check: each gradient element must be wider than the beam spot.
    // Sub-beam widths cause adjacent elements to merge (no visible gradient).
    // Crosshatch makes this worse since each pass also has short scan lines.
    const perRow = Math.ceil(t.x_steps / t.rows);
    const elemW = (t.width_mm - Math.max(0, perRow - 1) * t.gap_mm) / perRow;
    if (elemW > 0 && elemW < BEAM_WIDTH_MM) {
      issues.push({
        field: `${prefix}.width_mm`,
        message: `Element width ${elemW.toFixed(4)}mm is below beam spot ${BEAM_WIDTH_MM}mm - adjacent elements will merge`,
        severity: "error",
      });
    } else if (elemW > 0 && elemW < BEAM_WIDTH_MM * 2) {
      issues.push({
        field: `${prefix}.width_mm`,
        message: `Element width ${elemW.toFixed(4)}mm is close to beam spot (${BEAM_WIDTH_MM}mm) - may have limited contrast`,
        severity: "warning",
      });
    }
  });

  // Overlap detection
  const occupied = new Map<string, string>();
  for (const placement of project.tests) {
    for (let c = placement.col; c < placement.col + placement.col_span; c += 1) {
      const key = `${placement.row},${c}`;
      if (occupied.has(key)) {
        issues.push({
          field: "tests",
          message: `Placements overlap at row=${placement.row} col=${c}`,
          severity: "error",
        });
      } else {
        occupied.set(key, placement.test.name);
      }
    }
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

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
