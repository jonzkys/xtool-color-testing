import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PaletteIndicesChips } from "./PaletteIndicesChips";

const indices = {
  pulse_spacing_mm: 0.0154,
  line_spacing_index: 0.01,
  line_spacing_mm: null,
  pulse_energy_index: 0.769,
  pulse_intensity_index: 0.00385,
  surface_exposure_index: 5.0,
  formula_version: 1,
  density_model: "opaque",
  power_model: "controller_percent",
};

describe("PaletteIndicesChips", () => {
  it("renders all six chip labels", () => {
    render(<PaletteIndicesChips indices={indices} />);
    expect(screen.getByText(/pulse spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/line spacing index/i)).toBeInTheDocument();
    expect(screen.getByText(/line spacing \(mm\)/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse energy/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse intensity/i)).toBeInTheDocument();
    expect(screen.getByText(/surface exposure/i)).toBeInTheDocument();
  });

  it("shows '—' when line_spacing_mm is null", () => {
    render(<PaletteIndicesChips indices={indices} />);
    const chip = screen.getByText(/line spacing \(mm\)/i).closest("div")!;
    expect(chip.textContent).toContain("—");
  });

  it("renders a numeric line_spacing_mm when populated", () => {
    render(
      <PaletteIndicesChips
        indices={{ ...indices, line_spacing_mm: 0.123 }}
      />,
    );
    const chip = screen.getByText(/line spacing \(mm\)/i).closest("div")!;
    expect(chip.textContent).toMatch(/0\.123/);
  });

  it("shows the formula version badge", () => {
    render(<PaletteIndicesChips indices={indices} />);
    expect(screen.getByText(/v1/i)).toBeInTheDocument();
  });

  it("renders surface_exposure_index value", () => {
    render(<PaletteIndicesChips indices={indices} />);
    const chip = screen.getByText(/surface exposure/i).closest("div")!;
    expect(chip.textContent).toMatch(/5\.0|5(?!\d)/);
  });
});
