import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ExposureFocusedCard } from "./ExposureFocusedCard";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 20, 10],
    indices: {
      pulse_spacing_mm: 0.0154,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.769,
      pulse_intensity_index: 0.00385,
      surface_exposure_index: 195.0,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
    params: {
      power: 65,
      speed: 800,
      frequency: 60,
      density: 120,
      passes: 2,
      pulse_width: 100,
    },
  };
}

describe("ExposureFocusedCard", () => {
  it("idle state shows the disc + 'hover any dot to inspect' placeholder", () => {
    const rows = [row(1, "#a0522d"), row(2, "#704020")];
    render(<ExposureFocusedCard rows={rows} focusedId={null} />);
    expect(screen.getByText(/hover/i)).toBeInTheDocument();
    expect(screen.queryByText(/RECIPE/i)).toBeNull();
  });

  it("active state shows hex, recipe section, indices section", () => {
    const rows = [row(1, "#a0522d"), row(2, "#704020")];
    render(<ExposureFocusedCard rows={rows} focusedId={1} />);
    expect(screen.getByText("#A0522D")).toBeInTheDocument();
    expect(screen.getByText(/RECIPE/i)).toBeInTheDocument();
    expect(screen.getByText(/INDICES/i)).toBeInTheDocument();
  });
});
