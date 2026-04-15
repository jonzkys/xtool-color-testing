import type { BaseParams, ParamTest, Project, TestPlacement } from "./types";

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `test-${Date.now()}-${idCounter}`;
}

export function defaultBaseParams(): BaseParams {
  return {
    power: 14.6,
    speed: 1000,
    frequency: 125,
    density: 5000,
    passes: 1,
    pulse_width: 200,
    laser: "red",
  };
}

export function defaultTest(name = "New test"): ParamTest {
  return {
    id: newId(),
    name,
    x_param: "speed",
    x_min: 500,
    x_max: 2000,
    x_steps: 100,
    y_param: null,
    y_min: null,
    y_max: null,
    y_steps: null,
    rows: 1,
    width_mm: 30,
    height_mm: 5,
    gap_mm: 0,
    base_params: defaultBaseParams(),
    crosshatch_enabled: false,
    crosshatch_passes: 2,
    crosshatch_step_deg: 90,
  };
}

export function defaultPlacement(row = 0, col = 0): TestPlacement {
  return {
    test: defaultTest(),
    row,
    col,
    col_span: 1,
  };
}

export function defaultProject(): Project {
  return {
    name: "untitled",
    grid_gap_mm: 1,
    tests: [defaultPlacement()],
  };
}
