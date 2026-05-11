import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureNeighbourDetail } from "./ExposureNeighbourDetail";
import type { ExposureRow } from "./exposureCorrelations";

function makeRow(id: number, hex: string, params: Record<string, number>): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0, line_spacing_mm: 0,
      pulse_energy_index: 0, pulse_intensity_index: 0,
      total_exposure_index: 0, ablation_aggression_index: 0,
      delivery_smoothness_index: 0,
      duty_cycle_index: 22.2,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    params,
  };
}

const FOCUSED = makeRow(1, "#888", {
  power: 14.6, speed: 800, frequency: 125,
  pulse_width: 200, density: 5000, passes: 1,
});

describe("ExposureNeighbourDetail", () => {
  it("renders the neighbour hex and ΔE", () => {
    const neighbour = makeRow(2, "#cac0a9", {
      power: 14.6, speed: 840, frequency: 125,
      pulse_width: 200, density: 5000, passes: 1,
    });
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={13.5}
        onJumpTo={() => undefined} onFilterFrom={() => undefined}
      />,
    );
    expect(screen.getByText(/#CAC0A9/i)).toBeInTheDocument();
    expect(screen.getByText(/ΔE.*13\.5/)).toBeInTheDocument();
  });

  it("annotates differing params with delta", () => {
    const neighbour = makeRow(2, "#aaa", {
      power: 14.6, speed: 840, frequency: 125,
      pulse_width: 200, density: 5000, passes: 1,
    });
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={5}
        onJumpTo={() => undefined} onFilterFrom={() => undefined}
      />,
    );
    // speed delta: +40 abs, +5%
    expect(screen.getByText(/\+5/)).toBeInTheDocument();
  });

  it("hides ΔE and disables actions when selected === focused", () => {
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={FOCUSED} deltaE={null}
        onJumpTo={() => undefined} onFilterFrom={() => undefined}
      />,
    );
    expect(screen.queryByText(/ΔE/)).toBeNull();
    const jumpBtn = screen.getByText(/Jump to/i) as HTMLButtonElement;
    const filterBtn = screen.getByText(/Filter from/i) as HTMLButtonElement;
    expect(jumpBtn.disabled).toBe(true);
    expect(filterBtn.disabled).toBe(true);
  });

  it("Jump to calls onJumpTo with neighbour id", () => {
    const neighbour = makeRow(99, "#aaa", { power: 50 });
    const onJumpTo = vi.fn();
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={5}
        onJumpTo={onJumpTo} onFilterFrom={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText(/Jump to/i));
    expect(onJumpTo).toHaveBeenCalledWith(99);
  });

  it("Filter from calls onFilterFrom with the neighbour row", () => {
    const neighbour = makeRow(99, "#aaa", { power: 50 });
    const onFilterFrom = vi.fn();
    render(
      <ExposureNeighbourDetail
        focused={FOCUSED} selected={neighbour} deltaE={5}
        onJumpTo={() => undefined} onFilterFrom={onFilterFrom}
      />,
    );
    fireEvent.click(screen.getByText(/Filter from/i));
    expect(onFilterFrom).toHaveBeenCalledWith(neighbour);
  });
});
