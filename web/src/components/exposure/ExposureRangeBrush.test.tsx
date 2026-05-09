import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { ExposureRangeBrush } from "./ExposureRangeBrush";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, surface: number): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_mm: 0.05,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: surface,
      total_exposure_index: surface,
      ablation_aggression_index: 0.02,
      delivery_smoothness_index: 1000,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureRangeBrush", () => {
  it("renders one tile per row, ordered by total_exposure_index", () => {
    const rows = [row(2, "#bbb", 100), row(1, "#aaa", 10), row(3, "#ccc", 1000)];
    const { container } = render(
      <ExposureRangeBrush rows={rows} range={null} onRangeChange={() => undefined} />,
    );
    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>('[data-role="brush-tile"]'),
    );
    expect(tiles.map((t) => t.dataset.entryId)).toEqual(["1", "2", "3"]);
  });

  it("renders without errors when a range prop is provided", () => {
    const onRangeChange = vi.fn();
    const { container } = render(
      <ExposureRangeBrush rows={[row(1, "#aaa", 10)]} range={[5, 50]} onRangeChange={onRangeChange} />,
    );
    expect(container.querySelector('[data-role="brush-tile"]')).not.toBeNull();
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
