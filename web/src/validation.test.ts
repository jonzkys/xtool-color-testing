import { describe, it, expect } from "vitest";
import { validateProject, BEAM_WIDTH_MM } from "./validation";
import { defaultProject, defaultTest } from "./defaults";
import type { Project } from "./types";

function projectWithTest(mods: Partial<ReturnType<typeof defaultTest>>) {
  const project = defaultProject();
  project.tests[0].test = { ...project.tests[0].test, ...mods };
  return project;
}

describe("validateProject", () => {
  it("returns no issues for a default project", () => {
    const issues = validateProject(defaultProject());
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("errors when x_min equals x_max", () => {
    const project = projectWithTest({ x_min: 500, x_max: 500 });
    const issues = validateProject(project);
    expect(issues.some((i) => i.message.includes("x_min") && i.severity === "error")).toBe(true);
  });

  it("errors when x_steps < 2", () => {
    const project = projectWithTest({ x_steps: 1 });
    const issues = validateProject(project);
    expect(issues.some((i) => i.message.includes("x_steps") && i.severity === "error")).toBe(true);
  });

  it("errors when width or height is zero", () => {
    const project = projectWithTest({ width_mm: 0 });
    const issues = validateProject(project);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("errors when element width is below beam spot", () => {
    // 100 steps over 2mm = 0.02mm/element, below 0.03mm beam
    const project = projectWithTest({ x_steps: 100, width_mm: 2 });
    const issues = validateProject(project);
    expect(issues.some((i) => i.message.includes("beam") && i.severity === "error")).toBe(true);
  });

  it("warns when element width is close to beam spot (< 2x)", () => {
    // 100 steps over 4mm = 0.04mm/element, between 1x and 2x beam (0.03-0.06)
    const project = projectWithTest({ x_steps: 100, width_mm: 4 });
    const issues = validateProject(project);
    expect(issues.some((i) => i.message.includes("beam") && i.severity === "warning")).toBe(true);
  });

  it("errors on overlapping placements", () => {
    const project: Project = {
      name: "x",
      grid_gap_mm: 1,
      tests: [
        { test: defaultTest(), row: 0, col: 0, col_span: 1 },
        { test: defaultTest(), row: 0, col: 0, col_span: 1 },
      ],
    };
    const issues = validateProject(project);
    expect(issues.some((i) => i.message.toLowerCase().includes("overlap"))).toBe(true);
  });

  it("errors when y_param is set but y_min/max/steps are missing", () => {
    const project = projectWithTest({ y_param: "power" });
    const issues = validateProject(project);
    expect(issues.some((i) => i.message.toLowerCase().includes("y_"))).toBe(true);
  });

  it("exposes BEAM_WIDTH_MM constant", () => {
    expect(BEAM_WIDTH_MM).toBe(0.03);
  });
});

import { validateLayerSpec } from "./validation";

describe("validateLayerSpec — hatched", () => {
  function bp() {
    return {
      power: 50, speed: 1000, frequency: 65, density: 100,
      passes: 1, pulse_width: 200, laser: "red" as const,
    };
  }

  it("errors when HATCHED_LINES has zero passes", () => {
    const layer = {
      color: "#ffd73e", name: "yellow", enabled: true,
      processing_type: "HATCHED_LINES" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      material_id: null,
      hatch_passes: [],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.some(
      (i) => i.severity === "error" && i.field === "layers[0].hatch_passes"
    )).toBe(true);
  });

  it("errors when a pass spacing is <= 0", () => {
    const layer = {
      color: "#ffd73e", name: "yellow", enabled: true,
      processing_type: "HATCHED_LINES" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      material_id: null,
      hatch_passes: [{ angle: 0, spacing: 0, thickness: 0.1, ramps: [] }],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.some(
      (i) => i.severity === "error" && i.field === "layers[0].hatch_passes[0].spacing"
    )).toBe(true);
  });

  it("warns when ramp min equals max", () => {
    const layer = {
      color: "#ffd73e", name: "yellow", enabled: true,
      processing_type: "HATCHED_LINES" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      material_id: null,
      hatch_passes: [{
        angle: 0, spacing: 0.5, thickness: 0.1,
        ramps: [{ param: "power" as const, axis: "perp" as const, min: 50, max: 50 }],
      }],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.some(
      (i) => i.severity === "warning"
          && i.field === "layers[0].hatch_passes[0].ramps[0]"
    )).toBe(true);
  });

  it("does not flag non-hatched layer with empty hatch_passes", () => {
    const layer = {
      color: "#000000", name: "black", enabled: true,
      processing_type: "VECTOR_CUTTING" as const,
      scan_angle: 90, base_params: bp(),
      crosshatch_enabled: false, crosshatch_passes: 2, crosshatch_step_deg: 90,
      material_id: null,
      hatch_passes: [],
    };
    const issues = validateLayerSpec(layer, 0);
    expect(issues.filter((i) => i.field.startsWith("layers[0].hatch_passes")))
      .toEqual([]);
  });
});
