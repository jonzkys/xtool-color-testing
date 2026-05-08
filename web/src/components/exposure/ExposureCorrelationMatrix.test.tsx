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
    [0.30, 0.35, 0.25, 0.45, 0.55],
    [0.12, 0.18, 0.22, 0.28, 0.35],
  ];

  it("renders 7 row labels and 5 column labels", () => {
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="total_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="row-label"]').length).toBe(7);
    expect(container.querySelectorAll('[data-role="col-label"]').length).toBe(5);
  });

  it("shows numeric labels on cells with |r| >= 0.1, padded to two digits", () => {
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="total_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    const labels = container.querySelectorAll('[data-role="cell-value"]');
    // 35 cells, all with |r| >= 0.1 in this fixture.
    expect(labels.length).toBe(35);
    // Strongest negative value renders as "84"; sign comes from the
    // SignBadge rendered separately.
    const texts = Array.from(labels).map((n) => n.textContent);
    expect(texts).toContain("84");
    expect(texts).toContain("10");
  });

  it("clicking a cell calls onSelect with that (index, channel) pair", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="total_exposure_index"
        selectedChannel="L"
        onSelect={onSelect}
      />,
    );
    const cells = container.querySelectorAll<HTMLElement>('[data-role="matrix-cell"]');
    fireEvent.click(cells[0]);
    expect(onSelect).toHaveBeenCalledWith(INDEX_ROWS[0], CHANNEL_COLS[0]);
  });
});
