import { describe, expect, it } from "vitest";
import type { Lab } from "../color/math";
import {
  applyTransform,
  fitAffineTransform,
  IDENTITY_TRANSFORM,
  MIN_FIT_CELLS,
  simulateTransform,
} from "./stabilityCalibrateMath";

/* The fit is closed-form least squares; everything downstream (the
 * SCATTER overlay, the residual histogram) silently misrenders if the
 * (XᵀX)⁻¹ is wrong. Tests are exhaustive on purpose — a future tweak
 * to the linear-algebra inner loops should fail here before the chart
 * paints garbage. */

/** Build a fanned-out grid of Lab values that genuinely span the
 *  3-dimensional space — enough rank for the design matrix to be
 *  invertible. Returns ``count`` distinct triples in roughly the
 *  palette envelope: L*=[20, 90], a*=[-50, 50], b*=[-50, 50]. */
function gridLabs(count: number): Lab[] {
  const out: Lab[] = [];
  let i = 0;
  for (let zi = 0; zi < 4 && out.length < count; zi++) {
    for (let yi = 0; yi < 4 && out.length < count; yi++) {
      for (let xi = 0; xi < 4 && out.length < count; xi++) {
        out.push([
          20 + (xi * 70) / 3,
          -50 + (yi * 100) / 3,
          -50 + (zi * 100) / 3,
        ]);
        i++;
      }
    }
  }
  return out;
}

describe("fitAffineTransform — identity case", () => {
  it("recovers A = I, b = 0 when measured equals expected", () => {
    const expected = gridLabs(20);
    const pairs = expected.map((lab) => ({ measured: lab, expected: lab }));
    const r = fitAffineTransform(pairs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { A, b } = r.fit.transform;
    expect(A[0][0]).toBeCloseTo(1, 5);
    expect(A[1][1]).toBeCloseTo(1, 5);
    expect(A[2][2]).toBeCloseTo(1, 5);
    expect(A[0][1]).toBeCloseTo(0, 5);
    expect(A[0][2]).toBeCloseTo(0, 5);
    expect(A[1][0]).toBeCloseTo(0, 5);
    expect(A[1][2]).toBeCloseTo(0, 5);
    expect(A[2][0]).toBeCloseTo(0, 5);
    expect(A[2][1]).toBeCloseTo(0, 5);
    expect(b[0]).toBeCloseTo(0, 5);
    expect(b[1]).toBeCloseTo(0, 5);
    expect(b[2]).toBeCloseTo(0, 5);
    expect(r.fit.rSquared[0]).toBeCloseTo(1, 5);
    expect(r.fit.rSquared[1]).toBeCloseTo(1, 5);
    expect(r.fit.rSquared[2]).toBeCloseTo(1, 5);
    expect(r.fit.medianResidualDeltaE).toBeCloseTo(0, 5);
    expect(r.fit.maxResidualDeltaE).toBeCloseTo(0, 5);
    expect(r.fit.n).toBe(pairs.length);
  });
});

describe("fitAffineTransform — pure shift", () => {
  it("recovers A = I, b = -shift when measurements are expected + constant", () => {
    const expected = gridLabs(20);
    // Burn drifts +5 L*, -3 a*, +2 b* across every cell. The
    // calibration should fold that into b = (-5, +3, -2) so that
    // measured + b → expected.
    const shift: Lab = [5, -3, 2];
    const pairs = expected.map((lab) => ({
      measured: [lab[0] + shift[0], lab[1] + shift[1], lab[2] + shift[2]] as Lab,
      expected: lab,
    }));
    const r = fitAffineTransform(pairs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { A, b } = r.fit.transform;
    expect(A[0][0]).toBeCloseTo(1, 4);
    expect(A[1][1]).toBeCloseTo(1, 4);
    expect(A[2][2]).toBeCloseTo(1, 4);
    expect(b[0]).toBeCloseTo(-shift[0], 4);
    expect(b[1]).toBeCloseTo(-shift[1], 4);
    expect(b[2]).toBeCloseTo(-shift[2], 4);
    expect(r.fit.rSquared[0]).toBeCloseTo(1, 4);
    expect(r.fit.rSquared[1]).toBeCloseTo(1, 4);
    expect(r.fit.rSquared[2]).toBeCloseTo(1, 4);
  });
});

describe("fitAffineTransform — pure scale", () => {
  it("recovers A = 0.5·I, b = 0 when measurements are expected · 2", () => {
    const expected = gridLabs(20);
    const pairs = expected.map((lab) => ({
      measured: [lab[0] * 2, lab[1] * 2, lab[2] * 2] as Lab,
      expected: lab,
    }));
    const r = fitAffineTransform(pairs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { A, b } = r.fit.transform;
    expect(A[0][0]).toBeCloseTo(0.5, 4);
    expect(A[1][1]).toBeCloseTo(0.5, 4);
    expect(A[2][2]).toBeCloseTo(0.5, 4);
    expect(A[0][1]).toBeCloseTo(0, 4);
    expect(A[1][2]).toBeCloseTo(0, 4);
    expect(b[0]).toBeCloseTo(0, 4);
    expect(b[1]).toBeCloseTo(0, 4);
    expect(b[2]).toBeCloseTo(0, 4);
  });
});

describe("fitAffineTransform — failures", () => {
  it("refuses when fewer than MIN_FIT_CELLS pairs are supplied", () => {
    const expected = gridLabs(MIN_FIT_CELLS - 1);
    const pairs = expected.map((lab) => ({ measured: lab, expected: lab }));
    const r = fitAffineTransform(pairs);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure.kind).toBe("too_few_cells");
    if (r.failure.kind !== "too_few_cells") return;
    expect(r.failure.n).toBe(MIN_FIT_CELLS - 1);
  });

  it("flags coplanar measurements as singular", () => {
    // Every cell sits on the L* = 50 plane → measured matrix has only
    // 2 independent linear dimensions, the design matrix loses rank,
    // and (XᵀX) is singular. The fit must refuse.
    const pairs: { measured: Lab; expected: Lab }[] = [];
    for (let i = 0; i < 20; i++) {
      const a = -40 + (i * 5);
      const b = 25 - (i * 3);
      pairs.push({
        measured: [50, a, b],
        expected: [50, a + 1, b - 1],
      });
    }
    const r = fitAffineTransform(pairs);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure.kind).toBe("singular");
  });
});

describe("applyTransform — round-trip", () => {
  it("running the fitted transform over the measured set lands close to expected", () => {
    // Compose a known affine: measured = 0.9 · expected + (4, -2, 1)
    // plus a small per-cell noise vector. The fit recovers something
    // close to A = (1/0.9)·I, b = -(4, -2, 1)/0.9 + noise smear.
    const expected = gridLabs(30);
    const pairs = expected.map((lab, i) => {
      const noise = [
        ((i % 3) - 1) * 0.4,
        ((i % 5) - 2) * 0.3,
        ((i % 7) - 3) * 0.25,
      ];
      const measured: Lab = [
        0.9 * lab[0] + 4 + noise[0],
        0.9 * lab[1] - 2 + noise[1],
        0.9 * lab[2] + 1 + noise[2],
      ];
      return { measured, expected: lab };
    });
    const r = fitAffineTransform(pairs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Every cell's predicted Lab should be within the median residual
    // ΔE of expected — small perturbation, well-determined fit.
    let worst = 0;
    for (const p of pairs) {
      const pred = applyTransform(r.fit.transform, p.measured);
      const dE = Math.hypot(
        pred[0] - p.expected[0],
        pred[1] - p.expected[1],
        pred[2] - p.expected[2],
      );
      worst = Math.max(worst, dE);
    }
    expect(worst).toBeCloseTo(r.fit.maxResidualDeltaE, 5);
    // Per-channel R² should still be very high — the fit explains away
    // most of the linear structure even with the per-cell noise.
    expect(r.fit.rSquared[0]).toBeGreaterThan(0.95);
    expect(r.fit.rSquared[1]).toBeGreaterThan(0.95);
    expect(r.fit.rSquared[2]).toBeGreaterThan(0.95);
  });
});

describe("simulateTransform", () => {
  it("returns a fresh map keyed by the same cell indices", () => {
    const m = new Map<number, Lab>([
      [3, [50, 10, 0]],
      [7, [40, -5, 8]],
    ]);
    const out = simulateTransform(IDENTITY_TRANSFORM, m);
    expect(out).not.toBe(m);
    expect([...out.keys()].sort()).toEqual([3, 7]);
    expect(out.get(3)).toEqual([50, 10, 0]);
    expect(out.get(7)).toEqual([40, -5, 8]);
  });

  it("applies the transform per-cell rather than batching it incorrectly", () => {
    const t = {
      A: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      b: [10, -5, 2],
    } as const;
    const m = new Map<number, Lab>([[0, [50, 0, 0]]]);
    const out = simulateTransform(t, m);
    const labOut = out.get(0)!;
    expect(labOut[0]).toBeCloseTo(60);
    expect(labOut[1]).toBeCloseTo(-5);
    expect(labOut[2]).toBeCloseTo(2);
  });
});
