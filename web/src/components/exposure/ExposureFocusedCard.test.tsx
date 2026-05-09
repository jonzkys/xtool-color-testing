import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ExposureFocusedCard } from "./ExposureFocusedCard";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 20, 10],
    indices: {
      pulse_spacing_mm: 0.0154,
      line_spacing_mm: 0.05,
      pulse_energy_index: 0.769,
      pulse_intensity_index: 0.00385,
      surface_exposure_index: 195.0,
      total_exposure_index: 195.0,
      ablation_aggression_index: 0.02,
      delivery_smoothness_index: 1000,
      formula_version: 2,
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
  it("idle state shows the disc + an 'idle / hover' placeholder", () => {
    const rows = [row(1, "#a0522d"), row(2, "#704020")];
    render(<ExposureFocusedCard rows={rows} focusedId={null} />);
    // The idle copy includes "hover ... to inspect" as a hint.
    expect(screen.getByText(/hover/i)).toBeInTheDocument();
    // Active-state-only sections (recipe rows, hex readout) aren't rendered.
    expect(screen.queryByText("Hex")).toBeNull();
    expect(screen.queryByText(/TOTAL_EXPOSURE/i)).toBeNull();
  });

  it("active state shows hex, recipe section, indices section", () => {
    const rows = [row(1, "#a0522d"), row(2, "#704020")];
    render(<ExposureFocusedCard rows={rows} focusedId={1} />);
    expect(screen.getByText("#A0522D")).toBeInTheDocument();
    // Section labels are case-sensitive in the new design ("Recipe" /
    // "Indices"); use case-insensitive matchers so future copy tweaks
    // don't trip the suite.
    expect(screen.getByText(/^recipe$/i)).toBeInTheDocument();
    expect(screen.getByText(/^indices$/i)).toBeInTheDocument();
  });

  it("renders a 'Source test' link when focused entry has test_id", () => {
    const r = row(1, "#a0522d");
    r.test_id = 42;
    render(<ExposureFocusedCard rows={[r]} focusedId={1} />);
    const link = screen.getByText(/source test/i).closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain("/tests/42");
  });

  it("does not render a 'Source test' link for manual entries", () => {
    const r = row(1, "#a0522d");
    r.test_id = null;
    render(<ExposureFocusedCard rows={[r]} focusedId={1} />);
    expect(screen.queryByText(/source test/i)).toBeNull();
  });

  it("renders 'Member of N-entry [axis] sweep' when focusedFamily has 3+ members", () => {
    const r = row(1, "#a0522d");
    const fam = [
      { row: r, varyingAxis: "power" as const, varyingValue: 10 },
      { row: { ...r, id: 2 }, varyingAxis: "power" as const, varyingValue: 11 },
      { row: { ...r, id: 3 }, varyingAxis: "power" as const, varyingValue: 12 },
    ];
    render(<ExposureFocusedCard rows={[r]} focusedId={1} focusedFamily={fam} />);
    expect(screen.getByText(/member of 3-entry power sweep/i)).toBeInTheDocument();
  });

  it("does not render sweep badge when focusedFamily has fewer than 3 members", () => {
    const r = row(1, "#a0522d");
    const fam = [
      { row: r, varyingAxis: "power" as const, varyingValue: 10 },
      { row: { ...r, id: 2 }, varyingAxis: "power" as const, varyingValue: 11 },
    ];
    render(<ExposureFocusedCard rows={[r]} focusedId={1} focusedFamily={fam} />);
    expect(screen.queryByText(/member of.*sweep/i)).toBeNull();
  });

  it("renders filter-to-sweep buttons when availableFamilies has entries", () => {
    const r = row(1, "#a0522d");
    const fam = [
      { row: r, varyingAxis: "power" as const, varyingValue: 10 },
      { row: { ...r, id: 2 }, varyingAxis: "power" as const, varyingValue: 11 },
      { row: { ...r, id: 3 }, varyingAxis: "power" as const, varyingValue: 12 },
    ];
    render(
      <ExposureFocusedCard
        rows={[r]}
        focusedId={1}
        availableFamilies={[fam]}
      />,
    );
    expect(screen.getByText(/filter to sweep/i)).toBeInTheDocument();
    expect(screen.getByText(/power \(3\)/i)).toBeInTheDocument();
  });

  it("renders clear button when activeFilterAxis is set", () => {
    const r = row(1, "#a0522d");
    render(
      <ExposureFocusedCard
        rows={[r]}
        focusedId={1}
        activeFilterAxis="power"
      />,
    );
    expect(screen.getByText(/clear \(power\)/i)).toBeInTheDocument();
  });
});
