import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureNeighboursPanel } from "./ExposureNeighboursPanel";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, lab: [number, number, number]): ExposureRow {
  return {
    id, hex, lab,
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      duty_cycle_index: 22.2,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    params: { power: 50, speed: 800, frequency: 100,
              pulse_width: 200, density: 1000, passes: 1 },
  };
}

const ANCHOR = row(1, "#888", [50, 0, 0]);
const CANDIDATES = [
  ANCHOR,
  row(2, "#aaa", [55, 0, 0]),
  row(3, "#bbb", [60, 0, 0]),
  row(4, "#ccc", [70, 0, 0]),
];

describe("ExposureNeighboursPanel", () => {
  it("renders the strip + detail composition", () => {
    const { container } = render(
      <ExposureNeighboursPanel
        anchor={ANCHOR}
        candidates={CANDIDATES}
        onSelectNeighbour={() => undefined}
      />,
    );
    // Strip tiles: focused (ANCHOR) + 3 neighbours.
    expect(container.querySelectorAll('[data-role="strip-tile"]').length).toBe(4);
    // Detail card defaults to the first neighbour, so its hex shows.
    expect(screen.getByText(/#AAA/i)).toBeInTheDocument();
  });

  it("preserves the colour / regime sort toggle", () => {
    render(
      <ExposureNeighboursPanel
        anchor={ANCHOR}
        candidates={CANDIDATES}
        onSelectNeighbour={() => undefined}
      />,
    );
    expect(screen.getByText(/similar colour/i)).toBeInTheDocument();
    expect(screen.getByText(/similar regime/i)).toBeInTheDocument();
  });

  it("Jump to in detail card calls onSelectNeighbour", () => {
    const onSelectNeighbour = vi.fn();
    render(
      <ExposureNeighboursPanel
        anchor={ANCHOR}
        candidates={CANDIDATES}
        onSelectNeighbour={onSelectNeighbour}
      />,
    );
    fireEvent.click(screen.getByText(/Jump to/i));
    expect(onSelectNeighbour).toHaveBeenCalled();
  });

  it("Filter from in detail card calls onFilterFromNeighbour", () => {
    const onFilterFromNeighbour = vi.fn();
    render(
      <ExposureNeighboursPanel
        anchor={ANCHOR}
        candidates={CANDIDATES}
        onSelectNeighbour={() => undefined}
        onFilterFromNeighbour={onFilterFromNeighbour}
      />,
    );
    fireEvent.click(screen.getByText(/Filter from/i));
    expect(onFilterFromNeighbour).toHaveBeenCalled();
  });
});
