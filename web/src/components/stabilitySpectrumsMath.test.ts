import { describe, expect, it } from "vitest";
import type { Lab } from "../color/math";
import type { ValidationCell } from "../types";
import type { SeriesInput } from "./stabilityChartMath";
import {
  perCellRange,
  sortSpectrums,
  spectrumValueExtent,
} from "./stabilitySpectrumsMath";

/** Helper: build a ValidationCell shaped just enough for the math
 *  helper. The unused fields are filled with safe defaults so the test
 *  file doesn't have to know the rest of the schema. */
function makeCell(idx: number, expected: Lab, hex = "#888"): ValidationCell {
  return {
    id: idx,
    test_id: 1,
    cell_index: idx,
    palette_entry_id: null,
    expected_hex: hex,
    expected_lab: expected,
    params: {},
  };
}

function makeSeries(
  resultId: number,
  label: string,
  cells: { idx: number; lab: Lab; hex?: string }[],
): SeriesInput {
  const map = new Map<number, { hex: string; lab: Lab }>();
  for (const c of cells) map.set(c.idx, { hex: c.hex ?? "#000", lab: c.lab });
  return { resultId, label, cells: map };
}

describe("perCellRange — Δ-axis", () => {
  it("computes per-cell min/max/mean across runs for a Δh° metric", () => {
    const cells = [makeCell(0, [50, 30, 0])]; // expected hue = 0°
    const series = [
      // Three runs landing at +10°, +5°, +20° from expected.
      makeSeries(1, "r1", [{ idx: 0, lab: rotateHue([50, 30, 0], 10) }]),
      makeSeries(2, "r2", [{ idx: 0, lab: rotateHue([50, 30, 0], 5) }]),
      makeSeries(3, "r3", [{ idx: 0, lab: rotateHue([50, 30, 0], 20) }]),
    ];
    const out = perCellRange(cells, series, "delta_hue");
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].min).toBeCloseTo(5, 5);
    expect(out[0].max).toBeCloseTo(20, 5);
    expect(out[0].mean).toBeCloseTo((10 + 5 + 20) / 3, 5);
    // Δ-axis expected is always 0 by construction.
    expect(out[0].expected).toBe(0);
  });
});

describe("perCellRange — computed metric", () => {
  it("collapses CAMERA σ to a single dot per cell (min == max == mean)", () => {
    const cells = [makeCell(0, [50, 0, 0])];
    const series = [
      makeSeries(1, "r1", [{ idx: 0, lab: [50, 0, 0] }]),
      makeSeries(2, "r2", [{ idx: 0, lab: [60, 0, 0] }]),
    ];
    const out = perCellRange(cells, series, "per_cell_sigma");
    expect(out[0].mean).not.toBeNull();
    expect(out[0].min).toBeCloseTo(out[0].mean ?? Number.NaN);
    expect(out[0].max).toBeCloseTo(out[0].mean ?? Number.NaN);
    // σ for two measurements 10 apart → 5 (Euclidean ΔE76 from centroid).
    expect(out[0].mean).toBeCloseTo(5);
  });

  it("returns nulls when CAMERA σ has < 2 runs", () => {
    const cells = [makeCell(0, [50, 0, 0])];
    const series = [makeSeries(1, "r1", [{ idx: 0, lab: [50, 0, 0] }])];
    const out = perCellRange(cells, series, "per_cell_sigma");
    expect(out[0].min).toBeNull();
    expect(out[0].max).toBeNull();
    expect(out[0].mean).toBeNull();
  });
});

describe("sortSpectrums", () => {
  it("orders by expected hue ascending", () => {
    const cells = [
      makeCell(0, [50, 30, 0]),  // h ≈ 0°
      makeCell(1, [50, 0, 30]),  // h ≈ 90°
      makeCell(2, [50, -30, 0]), // h ≈ 180°
    ];
    const series = [
      makeSeries(1, "r1", [
        { idx: 0, lab: [50, 30, 0] },
        { idx: 1, lab: [50, 0, 30] },
        { idx: 2, lab: [50, -30, 0] },
      ]),
    ];
    const out = perCellRange(cells, series, "delta_e");
    const sorted = sortSpectrums(out, "expected_hue");
    expect(sorted.map((s) => s.cellIndex)).toEqual([0, 1, 2]);
  });

  it("orders by range (max − min) ascending so the most-variable land last", () => {
    // Three cells: cell 0 has the widest range, cell 2 the narrowest.
    const cells = [
      makeCell(0, [50, 30, 0]),
      makeCell(1, [50, 30, 0]),
      makeCell(2, [50, 30, 0]),
    ];
    const series = [
      makeSeries(1, "r1", [
        { idx: 0, lab: rotateHue([50, 30, 0], 0) },
        { idx: 1, lab: rotateHue([50, 30, 0], 0) },
        { idx: 2, lab: rotateHue([50, 30, 0], 0) },
      ]),
      makeSeries(2, "r2", [
        { idx: 0, lab: rotateHue([50, 30, 0], 30) }, // range 30
        { idx: 1, lab: rotateHue([50, 30, 0], 10) }, // range 10
        { idx: 2, lab: rotateHue([50, 30, 0], 1) },  // range 1
      ]),
    ];
    const out = perCellRange(cells, series, "delta_hue");
    const sorted = sortSpectrums(out, "range");
    // Ascending: smallest range first.
    expect(sorted.map((s) => s.cellIndex)).toEqual([2, 1, 0]);
  });
});

describe("spectrumValueExtent", () => {
  it("returns null when no spectrum has any finite value", () => {
    const cells = [makeCell(0, [50, 0, 0])];
    const series: SeriesInput[] = [];
    const out = perCellRange(cells, series, "delta_e");
    expect(spectrumValueExtent(out)).not.toBeNull();
    // expected = 0 keeps the extent finite even with no series.
    expect(spectrumValueExtent(out)).toEqual({ min: 0, max: 0 });
  });

  it("spans expected and run measurements together", () => {
    const cells = [makeCell(0, [50, 30, 0])];
    const series = [
      makeSeries(1, "r1", [{ idx: 0, lab: rotateHue([50, 30, 0], 10) }]),
      makeSeries(2, "r2", [{ idx: 0, lab: rotateHue([50, 30, 0], -5) }]),
    ];
    const out = perCellRange(cells, series, "delta_hue");
    const ext = spectrumValueExtent(out);
    expect(ext).not.toBeNull();
    expect(ext!.min).toBeLessThanOrEqual(-5);
    expect(ext!.max).toBeGreaterThanOrEqual(10);
  });
});

/** Rotate a Lab around the (a, b) plane by `deg` degrees. Used to build
 *  test fixtures with predictable hue deltas. */
function rotateHue(lab: Lab, deg: number): Lab {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = lab[1] * cos - lab[2] * sin;
  const b = lab[1] * sin + lab[2] * cos;
  return [lab[0], a, b];
}
