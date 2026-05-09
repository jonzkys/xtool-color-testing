import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { ExposureHueRibbon } from "./ExposureHueRibbon";
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

describe("ExposureHueRibbon", () => {
  it("renders one tile per row", () => {
    const rows = [row(1, "#aaa", 10), row(2, "#bbb", 20), row(3, "#ccc", 30)];
    const { container } = render(
      <ExposureHueRibbon rows={rows} orderBy="total_exposure_index" focusedId={null} />,
    );
    expect(container.querySelectorAll('[data-role="ribbon-tile"]').length).toBe(3);
  });

  it("orders tiles ascending by the orderBy index", () => {
    const rows = [row(3, "#ccc", 30), row(1, "#aaa", 10), row(2, "#bbb", 20)];
    const { container } = render(
      <ExposureHueRibbon rows={rows} orderBy="total_exposure_index" focusedId={null} />,
    );
    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>('[data-role="ribbon-tile"]'),
    );
    const ids = tiles.map((t) => Number(t.dataset.entryId));
    expect(ids).toEqual([1, 2, 3]);
  });

  it("renders a focused mark above the focused tile", () => {
    const rows = [row(1, "#aaa", 10), row(2, "#bbb", 20)];
    const { container } = render(
      <ExposureHueRibbon rows={rows} orderBy="total_exposure_index" focusedId={2} />,
    );
    expect(container.querySelector('[data-role="focus-mark"]')).not.toBeNull();
  });
});
