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

  it("warns when element width is below beam spot", () => {
    // 100 steps over 2mm = 0.02mm/element, below 0.03mm beam
    const project = projectWithTest({ x_steps: 100, width_mm: 2 });
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
