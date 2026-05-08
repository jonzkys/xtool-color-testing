import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ExposureScatter } from "./ExposureScatter";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, surface: number, l: number): ExposureRow {
  return {
    id, hex, lab: [l, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
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

describe("ExposureScatter", () => {
  const rows = [
    row(1, "#aaa", 10, 80),
    row(2, "#bbb", 50, 60),
    row(3, "#ccc", 200, 40),
    row(4, "#ddd", 800, 20),
  ];

  it("renders one dot per row in univariate mode", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="surface_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="scatter-dot"]').length).toBe(4);
  });

  it("draws a regression overlay in univariate mode", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="surface_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelector('[data-role="regression-line"]')).not.toBeNull();
  });

  it("does NOT draw a regression overlay in bivariate mode", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="bivariate"
        xKey="surface_exposure_index"
        yKey="pulse_intensity_index"
        xScale="log"
        yScale="log"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelector('[data-role="regression-line"]')).toBeNull();
  });

  it("clicking a dot fires onClick with the id", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="surface_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={onClick}
      />,
    );
    const dots = container.querySelectorAll<SVGElement>('[data-role="scatter-dot"]');
    fireEvent.click(dots[0]);
    expect(onClick).toHaveBeenCalledOnce();
    expect(typeof onClick.mock.calls[0][0]).toBe("number");
  });

  it("focused dot gets a halo", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="surface_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={2}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelector('[data-role="focus-halo"]')).not.toBeNull();
  });
});

describe("ExposureScatter — event propagation", () => {
  it("dot click does not bubble to a parent click handler", () => {
    const parentClick = vi.fn();
    const dotClick = vi.fn();
    const singleRow = [row(1, "#aaa", 100, 50)];

    const { container } = render(
      <div onClick={parentClick}>
        <ExposureScatter
          rows={singleRow}
          mode="univariate"
          xKey="surface_exposure_index"
          yKey="L"
          xScale="log"
          yScale="linear"
          focusedId={null}
          onHover={() => undefined}
          onLeave={() => undefined}
          onClick={dotClick}
        />
      </div>,
    );
    const dot = container.querySelector<SVGElement>('[data-role="scatter-dot"]')!;
    fireEvent.click(dot);
    expect(dotClick).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
