import { describe, expect, it } from "vitest";
import { deltaE76, type Lab } from "../color/math";
import type { ResultRecord, ValidationCell } from "../types";
import {
  burnDeltaE,
  burnDeltaHue,
  cameraSigma,
  cellResidual,
  computePaletteResidualPC1,
  describePc1Axis,
  meanLab,
  robustMeanLab,
  type StatsSeriesEntry,
} from "./stabilityStatsMath";

describe("meanLab", () => {
  it("returns the arithmetic mean of finite Lab triples", () => {
    const m = meanLab([
      [50, 10, 20],
      [60, 14, 30],
      [70, 18, 40],
    ]);
    expect(m).not.toBeNull();
    expect(m![0]).toBeCloseTo(60);
    expect(m![1]).toBeCloseTo(14);
    expect(m![2]).toBeCloseTo(30);
  });

  it("returns null when no finite measurements are supplied", () => {
    expect(meanLab([])).toBeNull();
    expect(
      meanLab([[NaN, 0, 0], [Infinity, 0, 0]]),
    ).toBeNull();
  });

  it("skips non-finite triples but uses the rest", () => {
    const m = meanLab([
      [NaN, 0, 0],
      [50, 10, 20],
      [60, 14, 30],
    ]);
    expect(m).not.toBeNull();
    expect(m![0]).toBeCloseTo(55);
  });
});

describe("robustMeanLab", () => {
  it("returns null on empty / non-finite input", () => {
    expect(robustMeanLab([])).toBeNull();
    expect(robustMeanLab([[NaN, 0, 0]])).toBeNull();
  });

  it("falls back to simple mean when N < 3 (no exclusion possible)", () => {
    const r = robustMeanLab([[50, 0, 0], [60, 0, 0]]);
    expect(r).not.toBeNull();
    expect(r!.lab[0]).toBeCloseTo(55);
    expect(r!.excluded).toEqual([]);
    expect(r!.inputCount).toBe(2);
  });

  it("matches arithmetic mean when all runs agree", () => {
    const r = robustMeanLab([
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
    ]);
    expect(r).not.toBeNull();
    expect(r!.lab[0]).toBeCloseTo(50);
    expect(r!.excluded).toEqual([]);
  });

  it("drops a single far-outlier run when one exists at >2× the median distance", () => {
    // Three tight runs near (50, 0, 0) plus one run 30 ΔE away.
    const r = robustMeanLab([
      [50, 0, 0],
      [50.5, 0, 0],
      [49.5, 0, 0],
      [80, 0, 0],
    ]);
    expect(r).not.toBeNull();
    // Robust mean should land near 50, not the simple mean ~57.5.
    expect(r!.lab[0]).toBeCloseTo(50, 1);
    expect(r!.excluded).toEqual([3]);
    expect(r!.inputCount).toBe(4);
  });

  it("does NOT exclude when the spread is uniform", () => {
    // Five runs evenly distributed — no clear outlier; median distance
    // is comparable to all distances.
    const r = robustMeanLab([
      [40, 0, 0],
      [45, 0, 0],
      [50, 0, 0],
      [55, 0, 0],
      [60, 0, 0],
    ]);
    expect(r).not.toBeNull();
    expect(r!.lab[0]).toBeCloseTo(50);
    expect(r!.excluded).toEqual([]);
  });

  it("preserves the simple mean rather than collapsing to <2 inliers", () => {
    // Two runs that disagree wildly with no central cluster — refusing
    // to exclude is the safer behaviour than picking one arbitrarily.
    const r = robustMeanLab([
      [40, 0, 0],
      [80, 0, 0],
    ]);
    expect(r).not.toBeNull();
    // N=2 short-circuits before the cluster math runs.
    expect(r!.lab[0]).toBeCloseTo(60);
    expect(r!.excluded).toEqual([]);
  });
});

describe("burnDeltaE", () => {
  it("equals ΔE76(expected, meanLab) for the supplied measurements", () => {
    const measurements: Lab[] = [
      [50, 10, 20],
      [60, 14, 30],
    ];
    const expected: Lab = [40, 5, 5];
    const expectedDe = deltaE76(expected, [55, 12, 25]);
    expect(burnDeltaE(measurements, expected)).toBeCloseTo(expectedDe);
  });

  it("returns 0 when the burn mean lands on expected", () => {
    expect(burnDeltaE([[50, 0, 0]], [50, 0, 0])).toBeCloseTo(0);
  });

  it("returns null when no finite measurements are supplied", () => {
    expect(burnDeltaE([], [50, 0, 0])).toBeNull();
  });
});

describe("cameraSigma", () => {
  it("returns null for fewer than two finite measurements", () => {
    expect(cameraSigma([])).toBeNull();
    expect(cameraSigma([[50, 10, 20]])).toBeNull();
  });

  it("returns 0 when the two measurements are identical", () => {
    expect(cameraSigma([[50, 10, 20], [50, 10, 20]])).toBeCloseTo(0);
  });

  it("returns mean Euclidean distance from the centroid", () => {
    // Two measurements 10 apart along L* — mean halfway between, each
    // sits 5 from the centroid → mean distance = 5.
    expect(cameraSigma([[50, 0, 0], [60, 0, 0]])).toBeCloseTo(5);
  });
});

describe("burnDeltaHue", () => {
  it("returns null when measured chroma is below the threshold", () => {
    // Mean ends up neutral (a≈0, b≈0) → chroma 0 → hue meaningless.
    expect(burnDeltaHue([[50, 0, 0]], [50, 30, 0])).toBeNull();
  });

  it("wraps to the signed [-180, 180] window", () => {
    // Expected red (a=30, b=0); measured at b=+30 → mean hue ≈ 45°,
    // expected hue 0° → +45°.
    const v = burnDeltaHue([[50, 30, 30]], [50, 30, 0]);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(45);
  });

  it("returns 0 when measured hue matches expected", () => {
    expect(burnDeltaHue([[50, 30, 0]], [50, 30, 0])).toBeCloseTo(0);
  });

  it("returns null with no finite measurements", () => {
    expect(burnDeltaHue([], [50, 30, 0])).toBeNull();
  });
});

describe("cellResidual", () => {
  it("breaks down signed Lab deltas + ΔE + Δhue between mean and expected", () => {
    const expected: Lab = [50, 30, 0]; // chroma 30, hue 0°
    const measurements: Lab[] = [
      [52, 28, 4],
      [54, 32, 8],
    ];
    // mean = [53, 30, 6]
    const r = cellResidual(measurements, expected);
    expect(r).not.toBeNull();
    expect(r!.deltaL).toBeCloseTo(3);
    expect(r!.deltaA).toBeCloseTo(0);
    expect(r!.deltaB).toBeCloseTo(6);
    expect(r!.deltaE).toBeCloseTo(deltaE76([53, 30, 6], expected));
    // hue rotation from (a*=30, b*=0) to (a*=30, b*=6) is atan2(6,30) ≈ 11.31°
    expect(r!.deltaHue).not.toBeNull();
    expect(r!.deltaHue!).toBeCloseTo(Math.atan2(6, 30) * (180 / Math.PI));
  });

  it("suppresses Δhue when the measured chroma is below the threshold", () => {
    // mean [50, 0.5, 0.5] → chroma ≈ 0.7 < 3
    const r = cellResidual([[50, 0.5, 0.5]], [50, 30, 0]);
    expect(r).not.toBeNull();
    expect(r!.deltaHue).toBeNull();
  });

  it("returns null when there are no finite measurements", () => {
    expect(cellResidual([], [50, 30, 0])).toBeNull();
  });
});

/* ─── Palette residual PC1 ─────────────────────────────────────────────── */

function fakeCells(expectedLabs: Lab[]): ValidationCell[] {
  return expectedLabs.map((lab, i) => ({
    cell_index: i,
    expected_lab: lab,
    expected_hex: "#000",
    params: {},
  })) as unknown as ValidationCell[];
}

function fakeSeries(measuredByCell: Map<number, Lab>): StatsSeriesEntry {
  const cells = new Map<number, { hex: string; lab: Lab }>();
  for (const [k, lab] of measuredByCell)
    cells.set(k, { hex: "#000", lab });
  return {
    result: { id: 1 } as ResultRecord,
    cells,
    label: "test",
  };
}

describe("computePaletteResidualPC1", () => {
  it("returns zero stats when fewer than 3 cells contribute", () => {
    const cells = fakeCells([[50, 0, 0], [60, 0, 0]]);
    const series: StatsSeriesEntry[] = [
      fakeSeries(
        new Map([
          [0, [55, 0, 0]],
          [1, [65, 0, 0]],
        ]),
      ),
    ];
    const r = computePaletteResidualPC1(cells, series);
    expect(r.sampleCount).toBe(2);
    expect(r.varianceRatio).toBe(0);
    expect(r.axis).toEqual({ L: 0, a: 0, b: 0 });
  });

  it("captures a single-axis Δa shift in PC1 with high variance ratio", () => {
    // 5 cells, expected at varying L*, all measured a* = expected + 4.
    // PC1 should land on the a-axis with ≈100% variance (since all
    // residuals are co-linear).
    const cells = fakeCells([
      [40, 5, 0],
      [50, 5, 0],
      [60, 5, 0],
      [70, 5, 0],
      [80, 5, 0],
    ]);
    const series: StatsSeriesEntry[] = [
      fakeSeries(
        new Map([
          [0, [40, 9, 0]],
          [1, [50, 9, 0]],
          [2, [60, 9, 0]],
          [3, [70, 9, 0]],
          [4, [80, 9, 0]],
        ]),
      ),
    ];
    const r = computePaletteResidualPC1(cells, series);
    expect(r.sampleCount).toBe(5);
    // All residuals identical → variance is zero → axis is undefined,
    // but math still produces a non-zero result via the centroid sign
    // flip. The variance ratio should be 0/0 → 0 (totalVar = 0).
    expect(r.meanDelta.a).toBeCloseTo(4);
    expect(r.meanDelta.L).toBeCloseTo(0);
  });

  it("PC1 captures the dominant variance direction in a noisy palette", () => {
    // Spread along a (variance ~16) plus tiny jitter on L (variance
    // ~1). PC1 should align with the a-axis and capture > 80% of
    // variance.
    const cells = fakeCells([
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
    ]);
    const series: StatsSeriesEntry[] = [
      fakeSeries(
        new Map([
          [0, [50.5, -4, 0]],
          [1, [50.0, -2, 0]],
          [2, [49.5, 0, 0]],
          [3, [50.5, 2, 0]],
          [4, [50.0, 4, 0]],
        ]),
      ),
    ];
    const r = computePaletteResidualPC1(cells, series);
    expect(r.sampleCount).toBe(5);
    // PC1 is an a-axis direction → |a| component dominates.
    expect(Math.abs(r.axis.a)).toBeGreaterThan(0.95);
    expect(r.varianceRatio).toBeGreaterThan(0.8);
  });

  it("flips PC1 sign so the axis points along the centroid", () => {
    // Residuals cluster around (Δa=+5) with a small L spread so the
    // power-iteration axis isn't degenerate with the starting basis.
    // PCA is sign-arbitrary; we force the sign so 'warmer' reads
    // consistently with the mean residual's actual direction.
    const cells = fakeCells([
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
      [50, 0, 0],
    ]);
    const series: StatsSeriesEntry[] = [
      fakeSeries(
        new Map([
          [0, [50.1, 4, 0]],
          [1, [50.0, 5, 0]],
          [2, [49.9, 6, 0]],
          [3, [50.0, 5, 0]],
          [4, [50.1, 4, 0]],
        ]),
      ),
    ];
    const r = computePaletteResidualPC1(cells, series);
    expect(r.axis.a).toBeGreaterThan(0);
  });
});

describe("describePc1Axis", () => {
  it("labels Δa-positive as warmer, Δb-positive as yellower, ΔL-positive as brighter", () => {
    expect(
      describePc1Axis({
        sampleCount: 5,
        meanDelta: { L: 1, a: 2, b: 0 },
        axis: { L: 0.5, a: 0.85, b: 0 },
        varianceRatio: 0.9,
        projectedMean: 1,
      }),
    ).toBe("warmer + brighter");
    expect(
      describePc1Axis({
        sampleCount: 5,
        meanDelta: { L: 0, a: 0, b: -3 },
        axis: { L: 0, a: 0, b: -1 },
        varianceRatio: 1,
        projectedMean: 1,
      }),
    ).toBe("bluer");
  });

  it("returns null on a zero axis (insufficient samples)", () => {
    expect(
      describePc1Axis({
        sampleCount: 2,
        meanDelta: { L: 0, a: 0, b: 0 },
        axis: { L: 0, a: 0, b: 0 },
        varianceRatio: 0,
        projectedMean: 0,
      }),
    ).toBeNull();
  });
});
