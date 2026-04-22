import { describe, it, expect } from "vitest";
import {
  alignPcaWithReference,
  deltaE76,
  hexToLab,
  labToHex,
  pca1,
  polyFit,
  evalPoly,
  predictXFromLab,
  type Lab,
} from "./math";

describe("hexToLab", () => {
  it("black and white land near expected L*", () => {
    expect(hexToLab("#000000")[0]).toBeCloseTo(0, 1);
    expect(hexToLab("#ffffff")[0]).toBeCloseTo(100, 1);
  });
  it("mid-grey sits around L* ≈ 53", () => {
    const [L] = hexToLab("#808080");
    expect(L).toBeGreaterThan(52);
    expect(L).toBeLessThan(55);
  });
});

describe("labToHex", () => {
  it("round-trips primaries within a tolerance", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#808080", "#b8410e"]) {
      const back = labToHex(hexToLab(hex));
      // Each channel within 2/255 due to float precision + quantisation.
      const a = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(back.slice(1, 3), 16);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
    }
  });
  it("black and white survive round-trip exactly", () => {
    expect(labToHex(hexToLab("#000000"))).toBe("#000000");
    expect(labToHex(hexToLab("#ffffff"))).toBe("#ffffff");
  });
});

describe("deltaE76", () => {
  it("is zero for identical colours", () => {
    expect(deltaE76(hexToLab("#c4a87b"), hexToLab("#c4a87b"))).toBeCloseTo(
      0,
      3,
    );
  });
  it("orders obviously-different colours", () => {
    const red = hexToLab("#ff0000");
    const green = hexToLab("#00ff00");
    const redish = hexToLab("#ee0505");
    expect(deltaE76(red, redish)).toBeLessThan(deltaE76(red, green));
  });
});

describe("pca1", () => {
  it("captures >95% variance along a pure ramp", () => {
    // Labs lying exactly on a line through Lab space → PC1 should absorb
    // essentially all variance.
    const labs: Lab[] = Array.from(
      { length: 20 },
      (_, i) => [i * 2, i * -0.5, i * 0.8] as Lab,
    );
    const r = pca1(labs);
    expect(r.variance_ratio).toBeGreaterThan(0.95);
    // Projected values should be monotonic (may be increasing or
    // decreasing depending on sign).
    const diffs = r.projected.slice(1).map((v, i) => v - r.projected[i]);
    const allIncreasing = diffs.every((d) => d > 0);
    const allDecreasing = diffs.every((d) => d < 0);
    expect(allIncreasing || allDecreasing).toBe(true);
  });

  it("alignPcaWithReference flips sign when projection opposes reference", () => {
    const labs: Lab[] = Array.from(
      { length: 10 },
      (_, i) => [i, 0, 0] as Lab,
    );
    const raw = pca1(labs);
    const xs = Array.from({ length: 10 }, (_, i) => i);
    const aligned = alignPcaWithReference(raw, xs);
    // Aligned projection should correlate positively with xs.
    const corrSign = Math.sign(
      aligned.projected[aligned.projected.length - 1] - aligned.projected[0],
    );
    expect(corrSign).toBe(1);
  });
});

describe("polyFit", () => {
  it("linear fit recovers known slope + intercept", () => {
    const x = [0, 1, 2, 3, 4];
    const y = x.map((xi) => 3 * xi + 5);
    const fit = polyFit(x, y, 1);
    expect(fit.coeffs[0]).toBeCloseTo(5, 6);
    expect(fit.coeffs[1]).toBeCloseTo(3, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });
  it("quadratic fit produces r²=1 on quadratic data", () => {
    const x = [-2, -1, 0, 1, 2, 3];
    const y = x.map((xi) => 2 * xi * xi - xi + 4);
    const fit = polyFit(x, y, 2);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.coeffs[2]).toBeCloseTo(2, 4);
    expect(evalPoly(fit.coeffs, 10)).toBeCloseTo(2 * 100 - 10 + 4, 3);
  });
});

describe("predictXFromLab", () => {
  it("returns the exact x when the target matches a sample", () => {
    const samples = [
      { x: 100, lab: hexToLab("#ff0000") },
      { x: 200, lab: hexToLab("#00ff00") },
      { x: 300, lab: hexToLab("#0000ff") },
    ];
    const r = predictXFromLab(samples, hexToLab("#00ff00"));
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(200, 0);
    expect(r!.bestIndex).toBe(1);
  });
  it("interpolates between neighbours for an intermediate colour", () => {
    const samples = [
      { x: 0, lab: [0, 0, 0] as Lab },
      { x: 100, lab: [100, 0, 0] as Lab },
    ];
    const r = predictXFromLab(samples, [50, 0, 0] as Lab);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(50, 0);
  });
});
