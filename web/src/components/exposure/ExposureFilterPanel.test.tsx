import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureFilterPanel } from "./ExposureFilterPanel";
import { DEFAULT_FILTERS, type ActiveFilters, type TestSummary } from "./exposureFilters";

const NOOP = () => undefined;

const TESTS: TestSummary[] = [
  { id: 10, name: "sweep-A", kind: "sweep",
    source_test_id: null, parent_test_id: null },
  { id: 20, name: "validate-A", kind: "validation",
    source_test_id: 10, parent_test_id: null },
];

describe("ExposureFilterPanel", () => {
  it("renders the six section headings", () => {
    render(
      <ExposureFilterPanel
        filters={DEFAULT_FILTERS}
        onChange={NOOP}
        tests={TESTS}
        dataRanges={{
          power: { min: 1, max: 100 }, speed: { min: 200, max: 1000 },
          frequency: { min: 30, max: 60 }, pulse_width: { min: 100, max: 400 },
          density: { min: 50, max: 5000 }, passes: { min: 1, max: 4 },
        }}
      />,
    );
    expect(screen.getByText(/source/i)).toBeInTheDocument();
    expect(screen.getByText(/test/i)).toBeInTheDocument();
    expect(screen.getByText(/range/i)).toBeInTheDocument();
    expect(screen.getByText(/family/i)).toBeInTheDocument();
    expect(screen.getByText(/outliers/i)).toBeInTheDocument();
    expect(screen.getByText(/clear all/i)).toBeInTheDocument();
  });

  it("Reset all calls onChange with DEFAULT_FILTERS", () => {
    const onChange = vi.fn();
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    render(
      <ExposureFilterPanel filters={f} onChange={onChange} tests={TESTS}
        dataRanges={{
          power: null, speed: null, frequency: null,
          pulse_width: null, density: null, passes: null,
        }} />,
    );
    fireEvent.click(screen.getByText(/clear all/i));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });

  it("toggling validated only calls onChange with validatedOnly=true", () => {
    const onChange = vi.fn();
    render(
      <ExposureFilterPanel filters={DEFAULT_FILTERS} onChange={onChange}
        tests={TESTS} dataRanges={{
          power: null, speed: null, frequency: null,
          pulse_width: null, density: null, passes: null,
        }} />,
    );
    fireEvent.click(screen.getByLabelText(/validated only/i));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS, validatedOnly: true,
    });
  });
});
