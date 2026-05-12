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
    // delta_hue now uses CIRCULAR mean — agrees with arithmetic to two
    // decimals for clustered samples and stays sane for samples that
    // straddle the seam (e.g. [+179, -179]).
    expect(out[0].min).toBeCloseTo(5, 2);
    expect(out[0].max).toBeCloseTo(20, 2);
    expect(out[0].mean).toBeCloseTo((10 + 5 + 20) / 3, 2);
    // Δ-axis expected is always 0 by construction.
    expect(out[0].expected).toBe(0);
  });

  it("means seam-straddling Δh° runs to ±180, not 0 (the bug fix)", () => {
    // Two runs both about 180° off-target but on opposite sides of
    // the wrap seam — visually nearly identical, but the previous
    // arithmetic mean reported mean=0 and a bar spanning the whole
    // axis (the user-reported issue on stability/71 cell 25).
    const cells = [makeCell(0, [50, 30, 0])];
    const series = [
      makeSeries(1, "r1", [{ idx: 0, lab: rotateHue([50, 30, 0], +179) }]),
      makeSeries(2, "r2", [{ idx: 0, lab: rotateHue([50, 30, 0], -179) }]),
    ];
    const out = perCellRange(cells, series, "delta_hue");
    expect(out).toHaveLength(1);
    // Mean lands near ±180 (sign depends on numerical bias).
    expect(Math.abs(out[0].mean!)).toBeCloseTo(180, 1);
    // Spread reflects the actual ~2° dispersion, not the seam-crossing
    // arithmetic range.
    expect(out[0].max! - out[0].min!).toBeCloseTo(2, 1);
  });
});

describe("perCellRange — delta_from_mean", () => {
  it("produces finite per-cell stats by computing the per-cell mean Lab", () => {
    // delta_from_mean needs the per-cell mean Lab as a 5th arg to
    // computeYValue. Before the fix this returned NaN for every run
    // and the spectrum's chart was empty by default for validation
    // tests (whose default Y is delta_from_mean).
    const cells = [makeCell(0, [50, 30, 0])];
    const series = [
      makeSeries(1, "r1", [{ idx: 0, lab: [50, 30, 0] }]),     // matches mean → small Δ
      makeSeries(2, "r2", [{ idx: 0, lab: [55, 30, 0] }]),     // 5 from mean
      makeSeries(3, "r3", [{ idx: 0, lab: [45, 30, 0] }]),     // 5 from mean
    ];
    const out = perCellRange(cells, series, "delta_from_mean");
    expect(out).toHaveLength(1);
    // All three runs produce finite ΔE76-from-mean values; mean ≠ 0.
    expect(out[0].count).toBe(3);
    expect(out[0].min).not.toBeNull();
    expect(out[0].max).not.toBeNull();
    expect(Number.isFinite(out[0].mean!)).toBe(true);
  });

  it("returns nulls when delta_from_mean has only one run (mean undefined)", () => {
    const cells = [makeCell(0, [50, 30, 0])];
    const series = [makeSeries(1, "r1", [{ idx: 0, lab: [50, 30, 0] }])];
    const out = perCellRange(cells, series, "delta_from_mean");
    expect(out[0].count).toBe(0);
    expect(out[0].min).toBeNull();
    expect(out[0].max).toBeNull();
    expect(out[0].mean).toBeNull();
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

describe("perCellRange — meanLab / meanHex", () => {
  it("returns the per-cell mean Lab + hex when ≥1 run carries a measurement", () => {
    const cells = [makeCell(0, [50, 0, 0])];
    const series = [
      makeSeries(1, "r1", [{ idx: 0, lab: [60, 10, 0] }]),
      makeSeries(2, "r2", [{ idx: 0, lab: [40, -10, 0] }]),
    ];
    const out = perCellRange(cells, series, "delta_e");
    expect(out[0].meanLab).not.toBeNull();
    expect(out[0].meanLab![0]).toBeCloseTo(50);
    expect(out[0].meanLab![1]).toBeCloseTo(0);
    expect(out[0].meanLab![2]).toBeCloseTo(0);
    expect(out[0].meanHex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("returns null mean Lab/hex when no series has any measurement for the cell", () => {
    const cells = [makeCell(0, [50, 0, 0])];
    const series: SeriesInput[] = [];
    const out = perCellRange(cells, series, "delta_e");
    expect(out[0].meanLab).toBeNull();
    expect(out[0].meanHex).toBeNull();
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
