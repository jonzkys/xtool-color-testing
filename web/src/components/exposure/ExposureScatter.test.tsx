import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import * as React from "react";

import { ExposureScatter } from "./ExposureScatter";
import type { ExposureRow } from "./exposureCorrelations";
import { __testing__ as HelpTipTesting } from "../HelpTip";

function row(id: number, hex: string, surface: number, l: number): ExposureRow {
  return {
    id, hex, lab: [l, 0, 0],
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
        xKey="total_exposure_index"
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
        xKey="total_exposure_index"
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
        xKey="total_exposure_index"
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
        xKey="total_exposure_index"
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
        xKey="total_exposure_index"
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

describe("ExposureScatter — family trace", () => {
  const rows = [
    row(1, "#aaa", 10, 80),
    row(2, "#bbb", 50, 60),
    row(3, "#ccc", 200, 40),
    row(4, "#ddd", 800, 20),
  ];

  it("renders a family-trace polyline when family prop is given", () => {
    const fam = [
      { row: rows[0], varyingAxis: "power" as const, varyingValue: 10 },
      { row: rows[1], varyingAxis: "power" as const, varyingValue: 11 },
      { row: rows[2], varyingAxis: "power" as const, varyingValue: 12 },
    ];
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="total_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
        family={fam}
      />,
    );
    expect(container.querySelector('[data-role="family-trace"]')).not.toBeNull();
  });

  it("does NOT render a family-trace polyline when family prop is absent", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="total_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelector('[data-role="family-trace"]')).toBeNull();
  });
});

describe("ExposureScatter — trimOutliers", () => {
  // Build a dataset with 200 tightly-clustered normal rows and 2 extreme outliers.
  // The outliers are at ranks 200 and 201 out of 202 total, placing them in the
  // top ~1% — they will be cut by the 99th-percentile clamp.
  function makeOutlierRows(): ExposureRow[] {
    const result: ExposureRow[] = [];
    for (let i = 0; i < 200; i++) {
      result.push(row(100 + i, "#aaa", 50 + i, 80));
    }
    result.push(row(9998, "#fff", 1e9, 50));
    result.push(row(9999, "#fff", 2e9, 50));
    return result;
  }

  it("hides out-of-percentile dots when trimOutliers is on", () => {
    const allRows = makeOutlierRows();
    const { container } = render(
      <ExposureScatter
        rows={allRows}
        mode="univariate"
        xKey="total_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
        trimOutliers={true}
      />,
    );
    const dots = container.querySelectorAll('[data-role="scatter-dot"]');
    // Outliers (last 2) should not render — their log values are far beyond the 99th percentile bound.
    expect(dots.length).toBeLessThan(allRows.length);
  });

  it("shows all dots when trimOutliers is off", () => {
    const allRows = makeOutlierRows();
    const { container } = render(
      <ExposureScatter
        rows={allRows}
        mode="univariate"
        xKey="total_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
        trimOutliers={false}
      />,
    );
    const dots = container.querySelectorAll('[data-role="scatter-dot"]');
    expect(dots.length).toBe(allRows.length);
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
          xKey="total_exposure_index"
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

// ─── Fixture for axis-label tests ─────────────────────────────────────────

const FIXTURE_ROW: ExposureRow = {
  id: 1,
  hex: "#000000",
  lab: [50, 0, 0],
  indices: {
    pulse_spacing_mm: 0.05,
    line_spacing_mm: 0.05,
    pulse_energy_index: 0.5,
    pulse_intensity_index: 0.0025,
    total_exposure_index: 6.0,
    ablation_aggression_index: 0.015,
    delivery_smoothness_index: 2400,
    formula_version: 2,
    density_model: "opaque",
    power_model: "controller_percent",
  },
  params: { speed: 600, power: 50, density: 12, mopa_frequency: 200, pulse_width: 100, repeat: 1 },
  test_id: null,
};

function MinimalScatter(props: Partial<React.ComponentProps<typeof ExposureScatter>>) {
  return (
    <ExposureScatter
      rows={[FIXTURE_ROW]}
      mode={props.mode ?? "univariate"}
      xKey={props.xKey ?? "total_exposure_index"}
      yKey={props.yKey ?? "L"}
      xScale={props.xScale ?? "linear"}
      yScale={props.yScale ?? "linear"}
      focusedId={props.focusedId ?? null}
      onHover={props.onHover ?? (() => undefined)}
      onLeave={props.onLeave ?? (() => undefined)}
      onClick={props.onClick ?? (() => undefined)}
      {...props}
    />
  );
}

describe("ExposureScatter axis labels", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("renders the X-axis name and the words formula on a second line", () => {
    const { container } = render(<MinimalScatter xKey="total_exposure_index" yKey="L" mode="univariate" />);
    expect(container.textContent).toContain("TOTAL EXPOSURE");
    expect(container.textContent).toContain("power × density × passes ÷ speed");
  });

  it("opens the index help card when the X axis label is hovered", () => {
    render(<MinimalScatter xKey="total_exposure_index" yKey="L" mode="univariate" />);
    const trigger = screen.getByText(/TOTAL EXPOSURE/);
    fireEvent.pointerEnter(trigger);
    act(() => { vi.advanceTimersByTime(HelpTipTesting.OPEN_DELAY_MS + 50); });
    expect(screen.getByRole("tooltip").textContent).toContain(
      "power × density × passes ÷ speed",
    );
  });
});
