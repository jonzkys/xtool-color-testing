import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExposureFocusedIndices } from "./ExposureFocusedIndices";
import type { ExposureRow } from "./exposureCorrelations";

const ROW: ExposureRow = {
  id: 1, hex: "#000",
  lab: [50, 0, 0],
  indices: {
    pulse_spacing_mm: 0.05, line_spacing_mm: 0.1,
    pulse_energy_index: 1.67, pulse_intensity_index: 0.0083,
    total_exposure_index: 8.33, ablation_aggression_index: 0.069,
    delivery_smoothness_index: 1004,
    formula_version: 3, density_model: "lpc",
    power_model: "controller_percent",
  },
};

describe("ExposureFocusedIndices", () => {
  it("renders a placeholder when no row is focused", () => {
    render(<ExposureFocusedIndices row={null} />);
    expect(screen.getByText(/focus an entry/i)).toBeInTheDocument();
  });

  it("renders all 7 index labels when a row is focused", () => {
    render(<ExposureFocusedIndices row={ROW} />);
    expect(screen.getByText(/pulse spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/line spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse energy/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse intensity/i)).toBeInTheDocument();
    expect(screen.getByText(/total exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/ablation aggression/i)).toBeInTheDocument();
    expect(screen.getByText(/delivery smoothness/i)).toBeInTheDocument();
  });

  it("renders the line_spacing_mm value with a mm suffix", () => {
    render(<ExposureFocusedIndices row={ROW} />);
    // formatted value contains "0.1" and "mm"
    const candidates = screen.getAllByText(/0\.1.*mm/);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
