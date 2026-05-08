import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExposureNeighboursPanel } from "./ExposureNeighboursPanel";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.001,
      total_exposure_index: 100,
      ablation_aggression_index: 0.1,
      delivery_smoothness_index: 100000,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
    params: { power: 10, speed: 1000, frequency: 65, density: 100, passes: 1, pulse_width: 200 },
  };
}

describe("ExposureNeighboursPanel", () => {
  const anchor = row(1, "#aaaaaa");
  const rows = [anchor, row(2, "#bbbbbb"), row(3, "#cccccc"), row(4, "#dddddd"), row(5, "#eeeeee"), row(6, "#ffffff")];

  it("shows two tab labels (colour and regime)", () => {
    render(<ExposureNeighboursPanel anchor={anchor} candidates={rows} onSelectNeighbour={() => undefined} />);
    expect(screen.getByText(/similar colour/i)).toBeInTheDocument();
    expect(screen.getByText(/similar regime/i)).toBeInTheDocument();
  });

  it("renders up to N neighbour rows (default 5)", () => {
    const { container } = render(
      <ExposureNeighboursPanel anchor={anchor} candidates={rows} onSelectNeighbour={() => undefined} />,
    );
    const items = container.querySelectorAll('[data-role="neighbour-row"]');
    expect(items.length).toBe(5);
  });

  it("clicking a neighbour calls onSelectNeighbour with its id", () => {
    const onSelectNeighbour = vi.fn();
    const { container } = render(
      <ExposureNeighboursPanel anchor={anchor} candidates={rows} onSelectNeighbour={onSelectNeighbour} />,
    );
    const items = container.querySelectorAll<HTMLElement>('[data-role="neighbour-row"]');
    fireEvent.click(items[0]);
    expect(onSelectNeighbour).toHaveBeenCalledOnce();
    expect(typeof onSelectNeighbour.mock.calls[0][0]).toBe("number");
  });
});
