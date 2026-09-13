import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TestCellInspector } from "./TestCellInspector";
import { defaultSpec } from "../defaults";
import type { GridLayout, TestSpec } from "../types";

// 13 × 16 cells, 50 px each — tall enough that every row gets a label.
const LAYOUT: GridLayout = {
  image_width_px: 900,
  image_height_px: 1000,
  grid_origin_x_px: 100,
  grid_origin_y_px: 100,
  cell_width_px: 50,
  cell_height_px: 50,
  row_stride_px: 50,
  cells_per_physical_row: 13,
  physical_rows: 16,
  is_2d: true,
  px_per_mm: 10,
};

const SPEC: TestSpec = {
  ...defaultSpec(),
  x_param: "frequency", x_min: 80, x_max: 900, x_steps: 13,
  y_param: "pulse_width", y_min: 2, y_max: 500, y_steps: 16,
};

function yAxisLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll("text")]
    .filter((t) => t.getAttribute("text-anchor") === "end")
    .map((t) => t.textContent ?? "");
}

describe("TestCellInspector axis labels", () => {
  it("labels a pulse_width axis with the presets the burn used", () => {
    const { container } = render(
      <TestCellInspector
        imageUrl="data:,"
        layout={LAYOUT}
        spec={SPEC}
        swatches={[]}
        onCellClick={() => {}}
      />,
    );
    // Not the linear ramp 2, 35.2, 68.4, … 500.
    expect(yAxisLabels(container)).toEqual([
      "2", "4", "6", "9", "13", "20", "30", "45",
      "60", "80", "100", "150", "200", "250", "350", "500",
    ]);
  });
});
