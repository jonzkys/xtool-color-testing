import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParamTestEditor } from "./ParamTestEditor";
import type { ValidationProfile } from "../types";

// ---------------------------------------------------------------------------
// Mock machine state so the DynamicParamForm path is exercised (not the
// "Loading constraints…" fallback which has no fieldOverrides support).
// ---------------------------------------------------------------------------

const MOCK_PROFILE: ValidationProfile = {
  power:       { kind: "range",  min: 1, max: 100, step: 1 },
  density:     { kind: "range",  min: 10, max: 500, step: 1 },
  frequency:   { kind: "range",  min: 30, max: 60, step: 1 },
  speed:       { kind: "range",  min: 2, max: 10000, step: 1 },
  passes:      { kind: "range",  min: 1, max: 99, step: 1 },
  pulse_width: { kind: "not_applicable" },
  laser:       { kind: "not_applicable" },
};

const MOCK_MACHINE = {
  id: "F1",
  modes: [{ id: "engrave", profile: "f1_engrave" }],
};

vi.mock("../state/machine", () => ({
  useCurrentMachine: () => ({
    registry: {
      machines: [MOCK_MACHINE],
      profiles: { f1_engrave: MOCK_PROFILE },
    },
    machineId: "F1",
    machine: MOCK_MACHINE,
    setMachineId: () => {},
  }),
  getValidationProfile: () => MOCK_PROFILE,
}));

// ---------------------------------------------------------------------------

const baseSpec: any = {
  x_param: "power",
  x_min: 10, x_max: 50, x_steps: 5,
  y_param: null,
  y_min: 0, y_max: 100, y_steps: 1,
  rows: 1,
  width_mm: 30, height_mm: 30, gap_mm: 0.5,
  cell_shape: "rect", square_cells: true,
  angle_mode: "fixed", unidirectional: false, hide_axis_labels: false,
  base_params: {
    power: 25, speed: 1000, frequency: 60,
    density: 200, passes: 1, pulse_width: 200,
    laser: "red", scan_angle: 90,
  },
  registration: { mode: "off" },
};

describe("ParamTestEditor — disabled-when-swept", () => {
  it("shows the 'Overridden by X-axis sweep' caption on the Base tab when x_param is power", () => {
    render(
      <ParamTestEditor
        spec={baseSpec}
        onChange={() => {}}
        locked={false}
        tab="base"
        materials={[]}
        materialId={null}
        onMaterialChange={() => {}}
      />,
    );
    expect(screen.getByText(/overridden by x-axis sweep/i)).toBeInTheDocument();
  });

  it("shows the caption for scan_angle too — it lives outside DynamicParamForm", () => {
    render(
      <ParamTestEditor
        spec={{ ...baseSpec, x_param: "scan_angle" }}
        onChange={() => {}}
        locked={false}
        tab="base"
        materials={[]}
        materialId={null}
        onMaterialChange={() => {}}
      />,
    );
    expect(screen.getByText(/overridden by x-axis sweep/i)).toBeInTheDocument();
  });
});
