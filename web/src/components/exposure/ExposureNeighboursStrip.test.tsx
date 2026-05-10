import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ExposureNeighboursStrip } from "./ExposureNeighboursStrip";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
  };
}

const FOCUSED = row(1, "#888888");
const NEIGHBOURS = [
  { row: row(2, "#aaaaaa"), deltaE: 13.5 },
  { row: row(3, "#bbbbbb"), deltaE: 15.5 },
  { row: row(4, "#cccccc"), deltaE: 16.0 },
];

describe("ExposureNeighboursStrip", () => {
  it("renders nothing when focused is null", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={null} neighbours={[]}
        selectedId={null} onSelect={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 1 + N tiles (focused + neighbours)", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={null} onSelect={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="strip-tile"]').length).toBe(4);
  });

  it("focused tile has data-focused=true", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={null} onSelect={() => undefined}
      />,
    );
    const tiles = container.querySelectorAll('[data-role="strip-tile"]');
    expect(tiles[0].getAttribute("data-focused")).toBe("true");
  });

  it("clicking a tile calls onSelect with the row id", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={null} onSelect={onSelect}
      />,
    );
    const secondTile = container.querySelectorAll('[data-role="strip-tile"]')[1];
    fireEvent.click(secondTile);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("selected tile has data-selected=true", () => {
    const { container } = render(
      <ExposureNeighboursStrip
        focused={FOCUSED} neighbours={NEIGHBOURS}
        selectedId={3} onSelect={() => undefined}
      />,
    );
    const tiles = container.querySelectorAll('[data-role="strip-tile"]');
    // tiles[0] is focused, tiles[1]=id 2, tiles[2]=id 3, tiles[3]=id 4
    expect(tiles[2].getAttribute("data-selected")).toBe("true");
  });
});
