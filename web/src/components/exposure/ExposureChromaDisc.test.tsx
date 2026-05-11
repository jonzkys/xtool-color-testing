import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ExposureChromaDisc } from "./ExposureChromaDisc";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, lab: [number, number, number]): ExposureRow {
  return {
    id, hex, lab,
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_mm: 0.05,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: 100,
      total_exposure_index: 100,
      ablation_aggression_index: 0.02,
      delivery_smoothness_index: 1000,
      duty_cycle_index: 22.2,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureChromaDisc", () => {
  it("renders a dot per row", () => {
    const rows = [
      row(1, "#a0522d", [50, 30, 20]),
      row(2, "#704020", [40, 25, 15]),
      row(3, "#3a1e1a", [25, 18, 8]),
    ];
    const { container } = render(
      <ExposureChromaDisc rows={rows} focusedId={null} />,
    );
    expect(container.querySelectorAll('[data-role="entry-dot"]').length).toBe(3);
  });

  it("draws a focus ring + crosshair on the focused entry", () => {
    const rows = [row(1, "#a0522d", [50, 30, 20]), row(2, "#704020", [40, 25, 15])];
    const { container } = render(
      <ExposureChromaDisc rows={rows} focusedId={2} />,
    );
    expect(container.querySelector('[data-role="focus-ring"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-role="focus-crosshair"]').length).toBeGreaterThan(0);
  });

  it("renders axis labels +a/−a/+b/−b", () => {
    render(<ExposureChromaDisc rows={[]} focusedId={null} />);
    expect(screen.getByText("+a")).toBeInTheDocument();
    expect(screen.getByText("−a")).toBeInTheDocument();
    expect(screen.getByText("+b")).toBeInTheDocument();
    expect(screen.getByText("−b")).toBeInTheDocument();
  });
});
