import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ExposureCorrelationMatrix } from "./ExposureCorrelationMatrix";
import { INDEX_ROWS, CHANNEL_COLS } from "./exposureCorrelations";

describe("ExposureCorrelationMatrix", () => {
  const matrix: number[][] = [
    [0.10, 0.20, 0.30, 0.40, 0.50],
    [0.15, 0.25, 0.35, 0.45, 0.55],
    [0.20, 0.30, 0.40, 0.50, 0.60],
    [0.25, 0.35, 0.45, 0.55, 0.65],
    [-0.84, 0.40, 0.30, 0.40, 0.50],
  ];

  it("renders 5 row labels and 5 column labels", () => {
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="surface_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="row-label"]').length).toBe(5);
    expect(container.querySelectorAll('[data-role="col-label"]').length).toBe(5);
  });

  it("shows numeric labels only on cells with |r| >= 0.7", () => {
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="surface_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    const labels = container.querySelectorAll('[data-role="cell-value"]');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toContain("84");
  });

  it("clicking a cell calls onSelect with that (index, channel) pair", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="surface_exposure_index"
        selectedChannel="L"
        onSelect={onSelect}
      />,
    );
    const cells = container.querySelectorAll<HTMLElement>('[data-role="matrix-cell"]');
    fireEvent.click(cells[0]);
    expect(onSelect).toHaveBeenCalledWith(INDEX_ROWS[0], CHANNEL_COLS[0]);
  });
});
