import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ExposurePage } from "./ExposurePage";

vi.mock("../api/library", () => ({
  listMaterials: vi.fn().mockResolvedValue([
    { id: 1, name: "Stainless Steel", machine_id: "F2Ultra" },
    { id: 2, name: "Brass", machine_id: "F2Ultra" },
  ]),
}));

vi.mock("../api/palette", () => ({
  listPaletteEntries: vi.fn().mockResolvedValue([
    {
      id: 100,
      hex: "#5d2e1f",
      lab: [28, 16, 18],
      params: { power: 65, speed: 800, frequency: 60, density: 120, passes: 2, pulse_width: 100 },
      indices: {
        pulse_spacing_mm: 0.0154,
        line_spacing_index: 0.0083,
        line_spacing_mm: null,
        pulse_energy_index: 1.083,
        pulse_intensity_index: 0.0181,
        surface_exposure_index: 195.0,
        total_exposure_index: 195.0,
        ablation_aggression_index: 0.02,
        delivery_smoothness_index: 1000,
        formula_version: 1,
        density_model: "opaque",
        power_model: "controller_percent",
      },
      source: "averaged",
      sigma: 0.1,
      notes: "",
      created_at: "2026-05-01T00:00:00+00:00",
      owner_id: 1,
      visibility: "private",
      machine_id: "F2Ultra",
      material_id: 1,
      is_validated: false,
    },
  ]),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ExposurePage", () => {
  it("mounts and lists materials", async () => {
    render(<ExposurePage materialId={null} />);
    // Material name appears in both the rail (picker) and the header
    // (current-material breadcrumb), so allow either.
    await waitFor(() =>
      expect(screen.getAllByText(/Stainless Steel/i).length).toBeGreaterThan(0),
    );
  });

  it("loads palette entries for the selected material", async () => {
    render(<ExposurePage materialId={1} />);
    const { listPaletteEntries } = await import("../api/palette");
    await waitFor(() => expect(listPaletteEntries).toHaveBeenCalled());
  });
});
