import { describe, expect, it } from "vitest";
import { deltaE76, type Lab } from "../color/math";
import {
  burnDeltaE,
  burnDeltaHue,
  cameraSigma,
  meanLab,
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
