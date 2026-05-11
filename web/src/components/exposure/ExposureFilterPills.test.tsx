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
        onChange={() => undefined}
        onClearAll={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per clause across params", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS,
      paramClauses: {
        power: [
          { kind: "range", value: 10, valueHi: 40 },
          { kind: "neq", value: 50 },
        ],
        density: [{ kind: "gte", value: 100 }],
      },
    };
    render(
      <ExposureFilterPills filters={f} entryCount={10}
        onChange={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/POWER 10–40/)).toBeInTheDocument();
    expect(screen.getByText(/POWER ≠ 50/)).toBeInTheDocument();
    expect(screen.getByText(/DENSITY ≥ 100/)).toBeInTheDocument();
  });

  it("renders test pill with lineage suffix", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS, testIds: new Set([42]),
      testLineage: new Set(["source"]),
    };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onChange={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/TEST #42 \(\+source\)/)).toBeInTheDocument();
  });

  it("renders entry count and Clear all link", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    render(
      <ExposureFilterPills filters={f} entryCount={42}
        onChange={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/42 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Clear all/)).toBeInTheDocument();
  });

  it("clicking the x on a clause pill removes that clause via onChange", () => {
    const onChange = vi.fn();
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS,
      paramClauses: { power: [{ kind: "eq", value: 14.6 }] },
    };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onChange={onChange} onClearAll={() => undefined} />,
    );
    fireEvent.click(screen.getByLabelText(/clear clause:power:0/i));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next: ActiveFilters = onChange.mock.calls[0][0];
    expect(next.paramClauses.power).toBeUndefined();
  });

  it("clicking Clear all calls onClearAll", () => {
    const onClearAll = vi.fn();
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onChange={() => undefined} onClearAll={onClearAll} />,
    );
    fireEvent.click(screen.getByText(/Clear all/));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("trimOutliers is NOT shown as a pill", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS, trimOutliers: false };
    const { container } = render(
      <ExposureFilterPills filters={f} entryCount={1}
        onChange={() => undefined} onClearAll={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
