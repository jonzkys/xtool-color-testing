import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BaseParams } from "../types";

vi.mock("../state/machine", () => ({
  useCurrentMachine: () => ({
    registry: { machines: [], profiles: {} },
    machineId: "F2Ultra",
    machine: { id: "F2Ultra", modes: [{ id: "color_engrave", profile: "F2Ultra:color_engrave" }] },
    setMachineId: () => {},
  }),
  getValidationProfile: () => ({
    power: { kind: "range", min: 1, max: 100, step: 1 },
    laser: { kind: "enum", values: ["red", "blue"] },
  }),
  representativeMode: () => "color_engrave",
}));

import { BaseParamsEditor } from "./BaseParamsEditor";

const base: BaseParams = {
  power: 50, speed: 1000, frequency: 60, density: 100, passes: 1,
  pulse_width: 200, scan_angle: 90, laser: "red",
} as BaseParams;

describe("BaseParamsEditor", () => {
  it("renders the profile-driven form (power field present)", () => {
    render(<BaseParamsEditor value={base} onChange={() => {}} />);
    expect(screen.getByText(/power/i)).toBeTruthy();
  });

  it("does not fire onChange on mount", () => {
    const onChange = vi.fn();
    render(<BaseParamsEditor value={base} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});
