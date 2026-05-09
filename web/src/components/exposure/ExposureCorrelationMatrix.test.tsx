import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ExposureCorrelationMatrix } from "./ExposureCorrelationMatrix";
import { INDEX_ROWS, CHANNEL_COLS, type IndexRow, type ChannelCol } from "./exposureCorrelations";

const INDEX_ROW_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_index: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  total_exposure_index: "TEx",
  ablation_aggression_index: "AAg",
  delivery_smoothness_index: "DSm",
};

const COL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "h°",
  chroma: "C*",
};

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
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey="total_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="row-label"]').length).toBe(7);
    expect(container.querySelectorAll('[data-role="col-label"]').length).toBe(5);
  });

  it("shows numeric labels on cells with |r| >= 0.1, padded to two digits", () => {
    const { container } = render(
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey="total_exposure_index"
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
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey="total_exposure_index"
        selectedChannel="L"
        onSelect={onSelect}
      />,
    );
    const cells = container.querySelectorAll<HTMLElement>('[data-role="matrix-cell"]');
    fireEvent.click(cells[0]);
    expect(onSelect).toHaveBeenCalledWith(INDEX_ROWS[0], CHANNEL_COLS[0]);
  });

  it("renders read-only cells as divs (not buttons) when onSelect is null", () => {
    const { container } = render(
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey={null}
        selectedChannel={null}
        onSelect={null}
      />,
    );
    const cells = container.querySelectorAll('[data-role="matrix-cell"]');
    expect(cells.length).toBe(35);
    // In read-only mode cells are divs not buttons
    const buttons = container.querySelectorAll('button[data-role="matrix-cell"]');
    expect(buttons.length).toBe(0);
  });

  it("renders correct col labels", () => {
    const { container } = render(
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey="total_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    const colLabels = Array.from(container.querySelectorAll('[data-role="col-label"]')).map(
      (el) => el.textContent,
    );
    expect(colLabels).toEqual(CHANNEL_COLS.map((c) => COL_LABELS[c]));
  });

  it("invokes renderRowLabel for each row when supplied, with rowKey + label", () => {
    const rendered: { rowKey: string; label: string }[] = [];
    render(
      <ExposureCorrelationMatrix<IndexRow>
        matrix={matrix}
        rowKeys={INDEX_ROWS}
        rowLabels={INDEX_ROW_LABELS}
        selectedRowKey="total_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
        renderRowLabel={(rowKey, label) => {
          rendered.push({ rowKey, label });
          return <span data-testid={`hooked-${rowKey}`}>{label}</span>;
        }}
      />,
    );
    expect(rendered).toHaveLength(7);
    expect(rendered.map((r) => r.rowKey)).toEqual([...INDEX_ROWS]);
  });
});
