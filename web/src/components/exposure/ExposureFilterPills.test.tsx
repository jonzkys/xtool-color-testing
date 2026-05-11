import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureFilterPills } from "./ExposureFilterPills";
import { DEFAULT_FILTERS, type ActiveFilters } from "./exposureFilters";

describe("ExposureFilterPills", () => {
  it("renders nothing for default filters", () => {
    const { container } = render(
      <ExposureFilterPills
        filters={DEFAULT_FILTERS}
        entryCount={42}
        onClearOne={() => undefined}
        onClearAll={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per active param range", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS,
      paramRanges: {
        power: { min: 10, max: 40 },
        density: { min: 100, max: null },
      },
    };
    render(
      <ExposureFilterPills filters={f} entryCount={10}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/POWER 10–40/)).toBeInTheDocument();
    expect(screen.getByText(/DENSITY ≥100/)).toBeInTheDocument();
  });

  it("renders test pill with lineage suffix", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS, testIds: new Set([42]),
      testLineage: new Set(["source"]),
    };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/TEST #42 \(\+source\)/)).toBeInTheDocument();
  });

  it("renders entry count and Clear all link", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS, validatedOnly: true,
    };
    render(
      <ExposureFilterPills filters={f} entryCount={42}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/42 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Clear all/)).toBeInTheDocument();
  });

  it("clicking the x on a pill calls onClearOne with the dimension key", () => {
    const onClearOne = vi.fn();
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } },
    };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={onClearOne} onClearAll={() => undefined} />,
    );
    fireEvent.click(screen.getByLabelText(/clear power/i));
    expect(onClearOne).toHaveBeenCalledWith("range:power");
  });

  it("clicking Clear all calls onClearAll", () => {
    const onClearAll = vi.fn();
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={() => undefined} onClearAll={onClearAll} />,
    );
    fireEvent.click(screen.getByText(/Clear all/));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("trimOutliers is NOT shown as a pill", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS, trimOutliers: false };
    const { container } = render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
