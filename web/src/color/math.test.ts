import { describe, it, expect } from "vitest";
import {
  alignPcaWithReference,
  chroma,
  circularStatsDeg,
  deltaE76,
  hexToLab,
  hueDeg,
  labToHex,
  pca1,
  polyFit,
  evalPoly,
  predictXFromLab,
  wrapHueDelta,
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

describe("hueDeg / chroma / wrapHueDelta", () => {
  it("hueDeg returns 0..360 quadrant angles", () => {
    // Pure +a* (red side) is hue 0°.
    expect(hueDeg(50, 0)).toBeCloseTo(0, 5);
    // Pure +b* (yellow side) is hue 90°.
    expect(hueDeg(0, 50)).toBeCloseTo(90, 5);
    // Pure -a* (green side) is hue 180°.
    expect(hueDeg(-50, 0)).toBeCloseTo(180, 5);
    // Pure -b* (blue side) wraps to 270°, never -90°.
    expect(hueDeg(0, -50)).toBeCloseTo(270, 5);
  });
  it("chroma is the radial Lab distance from the L* axis", () => {
    expect(chroma(3, 4)).toBeCloseTo(5, 5);
    expect(chroma(0, 0)).toBe(0);
    expect(chroma(-12, 5)).toBeCloseTo(13, 5);
  });
  it("wrapHueDelta folds wrap-around rotations into [-180, 180]", () => {
    // 5° apart, regardless of which side of 0° you start from.
    expect(wrapHueDelta(5)).toBe(5);
    expect(wrapHueDelta(355)).toBe(-5);
    expect(wrapHueDelta(-355)).toBe(5);
    // Boundary cases.
    expect(wrapHueDelta(180)).toBe(180);
    expect(wrapHueDelta(-180)).toBe(-180);
    // Bigger-than-one-turn deltas still collapse correctly.
    expect(wrapHueDelta(720 + 30)).toBe(30);
    expect(wrapHueDelta(-720 - 30)).toBe(-30);
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

describe("circularStatsDeg", () => {
  it("returns null on empty input", () => {
    expect(circularStatsDeg([])).toBeNull();
  });

  it("matches arithmetic stats when values are clustered far from the seam", () => {
    const s = circularStatsDeg([+5, +10, +15], true)!;
    expect(s.mean).toBeCloseTo(10, 3);
    expect(s.min).toBeCloseTo(5, 3);
    expect(s.max).toBeCloseTo(15, 3);
  });

  it("means values straddling the seam to ±180 instead of 0 (THE BUG)", () => {
    // The reported case: two runs at +179° and -179° hue rotation are
    // visually nearly identical (both ~180° off-target). Naive mean
    // would give 0; circular mean correctly returns ±180.
    const s = circularStatsDeg([+179, -179], true)!;
    // Mean lands at ±180; sign depends on numerical bias, magnitude is what matters.
    expect(Math.abs(s.mean)).toBeCloseTo(180, 1);
    // min/max bar reflects the actual 2° dispersion, not the full ±180 range.
    expect(s.max - s.min).toBeCloseTo(2, 1);
  });

  it("returns deviations clipped to the shortest arc per sample", () => {
    // mean ≈ 0; samples are -5, +5 — min/max should be -5/+5, NOT
    // wrapped through +355.
    const s = circularStatsDeg([-5, +5], true)!;
    expect(s.mean).toBeCloseTo(0, 3);
    expect(s.min).toBeCloseTo(-5, 3);
    expect(s.max).toBeCloseTo(+5, 3);
  });

  it("unsigned mode lands the mean in [0, 360) for raw hue values", () => {
    // Two runs measure hue 355° and 5° — both near red.
    // Circular mean is 0° (or 360°); arithmetic would give 180° (cyan).
    const s = circularStatsDeg([355, 5], false)!;
    // Mean ≈ 0 or 360 (both represent the same direction).
    const m = s.mean;
    expect(m === 0 || Math.abs(m - 360) < 0.5 || Math.abs(m) < 0.5).toBe(true);
    // Spread is small — both values are within 5° of the mean.
    const spread = Math.max(Math.abs(s.max - s.mean), Math.abs(s.min - s.mean));
    expect(spread).toBeLessThan(6);
  });
});
