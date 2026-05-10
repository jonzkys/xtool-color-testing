import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExposureProposeRail } from "./ExposureProposeRail";
import type { ExposureRow } from "./exposureCorrelations";

const ANCHOR: ExposureRow = {
  id: 1,
  hex: "#cb7983",
  lab: [50, 20, 5],
  indices: {
    pulse_spacing_mm: 0.01, line_spacing_mm: 0.002,
    pulse_energy_index: 0.15, pulse_intensity_index: 0.0008,
    total_exposure_index: 65, ablation_aggression_index: 0.05,
    delivery_smoothness_index: 81000,
    formula_version: 3,
    density_model: "lpc",
    power_model: "controller_percent",
  },
  params: {
    power: 14.6, speed: 1152, frequency: 100, density: 5000,
    passes: 1, pulse_width: 200,
  },
};

describe("ExposureProposeRail", () => {
  it("renders the anchor hex and params", () => {
    render(
      <ExposureProposeRail
        anchor={ANCHOR}
        mode={{ mode: "curve", varyParam: "power" }}
        onModeChange={vi.fn()}
        cellCount={16}
        onCellCountChange={vi.fn()}
        rangeReadout={[
          { paramName: "POWER", min: 12.4, max: 18.8, unit: "%" },
        ]}
        canCreate={true}
        helperText={null}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/cb7983/i)).toBeTruthy();
    expect(screen.getByText(/POWER · 12.4 → 18.8 %/)).toBeTruthy();
  });

  it("disables CREATE when canCreate is false and shows helper text", () => {
    render(
      <ExposureProposeRail
        anchor={null}
        mode={{ mode: "curve", varyParam: "power" }}
        onModeChange={vi.fn()}
        cellCount={16}
        onCellCountChange={vi.fn()}
        rangeReadout={[]}
        canCreate={false}
        helperText="Polygon contains no entries"
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /create test/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Polygon contains no entries/i)).toBeTruthy();
  });

  it("calls onCellCountChange when slider moves", () => {
    const onCellCountChange = vi.fn();
    render(
      <ExposureProposeRail
        anchor={ANCHOR}
        mode={{ mode: "curve", varyParam: "power" }}
        onModeChange={vi.fn()}
        cellCount={16}
        onCellCountChange={onCellCountChange}
        rangeReadout={[]}
        canCreate={true}
        helperText={null}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const slider = screen.getByRole("slider", { name: /cells/i });
    fireEvent.change(slider, { target: { value: "32" } });
    expect(onCellCountChange).toHaveBeenCalledWith(32);
  });

  it("emits curve mode when curve toggle clicked while in fill", () => {
    const onModeChange = vi.fn();
    render(
      <ExposureProposeRail
        anchor={ANCHOR}
        mode={{ mode: "fill", varyParams: ["power", "speed"] }}
        onModeChange={onModeChange}
        cellCount={16}
        onCellCountChange={vi.fn()}
        rangeReadout={[]}
        canCreate={true}
        helperText={null}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const curveBtn = screen.getByRole("button", { name: /curve/i });
    fireEvent.click(curveBtn);
    expect(onModeChange).toHaveBeenCalled();
    const arg = (onModeChange as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.mode).toBe("curve");
  });
});
