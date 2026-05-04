import { deltaE76, type Lab } from "../color/math";

/* ─── Calibrate math ──────────────────────────────────────────────────────
 *
 * Closed-form least-squares fit of measured Lab → expected Lab. Given
 * pairs (m_i, e_i), build the design matrix X with rows [m_iL, m_ia,
 * m_ib, 1] and target Y with rows [e_iL, e_ia, e_ib], then solve
 * Θ = (XᵀX)⁻¹ Xᵀ Y for Θ ∈ ℝ⁴ˣ³. The first three rows of Θ are the
 * 3×3 transpose of A (so A·m + b ≈ e), the last row is b.
 *
 * The 4×4 inverse is implemented inline via Gauss-Jordan with partial
 * pivoting — small system, no new deps.
 */

export interface AffineTransform {
  /** 3×3 in row-major order: A[i] = [A_iL, A_ia, A_ib]. */
  A: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  b: readonly [number, number, number];
}

export interface CalibrationFit {
  transform: AffineTransform;
  /** Per-channel R² in [L, a, b] order. */
  rSquared: readonly [number, number, number];
  medianResidualDeltaE: number;
  maxResidualDeltaE: number;
  n: number;
}

export type CalibrationFailure =
  | { kind: "too_few_cells"; n: number }
  | { kind: "singular" };

export type CalibrationResult =
  | { ok: true; fit: CalibrationFit }
  | { ok: false; failure: CalibrationFailure };

/** Parameter count = 12. Anything below is under-determined. */
export const MIN_FIT_CELLS = 12;

/** Determinant magnitude under which we treat XᵀX as singular and
 *  refuse the fit — below this the closed-form inverse can amplify
 *  numerical noise into a wildly unstable transform. */
export const SINGULAR_DET_THRESHOLD = 1e-9;

export const IDENTITY_TRANSFORM: AffineTransform = {
  A: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  b: [0, 0, 0],
};

export function fitAffineTransform(
  pairs: readonly { measured: Lab; expected: Lab }[],
): CalibrationResult {
  const n = pairs.length;
  if (n < MIN_FIT_CELLS) {
    return { ok: false, failure: { kind: "too_few_cells", n } };
  }
  // Build XᵀX (4×4) + XᵀY (4×3) directly — no need to materialise X.
  const XtX: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const XtY: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of pairs) {
    const x = [p.measured[0], p.measured[1], p.measured[2], 1];
    const y = [p.expected[0], p.expected[1], p.expected[2]];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) XtX[i][j] += x[i] * x[j];
      for (let j = 0; j < 3; j++) XtY[i][j] += x[i] * y[j];
    }
  }
  if (Math.abs(determinant4(XtX)) < SINGULAR_DET_THRESHOLD) {
    return { ok: false, failure: { kind: "singular" } };
  }
  const theta = solve4x3(XtX, XtY);
  if (theta == null) return { ok: false, failure: { kind: "singular" } };

  // Θ row k holds [θ_kL, θ_ka, θ_kb] = the contribution of x_k to each
  // expected channel. So A[i][j] (row of A, col of A) = θ[j][i].
  const A: AffineTransform["A"] = [
    [theta[0][0], theta[1][0], theta[2][0]],
    [theta[0][1], theta[1][1], theta[2][1]],
    [theta[0][2], theta[1][2], theta[2][2]],
  ];
  const b: AffineTransform["b"] = [theta[3][0], theta[3][1], theta[3][2]];
  const transform: AffineTransform = { A, b };

  // Per-channel R² + per-cell residual ΔE76 across the fitting set.
  const tot: [number, number, number] = [0, 0, 0];
  const res: [number, number, number] = [0, 0, 0];
  const mean: [number, number, number] = [0, 0, 0];
  for (const p of pairs) {
    mean[0] += p.expected[0] / n;
    mean[1] += p.expected[1] / n;
    mean[2] += p.expected[2] / n;
  }
  const residuals: number[] = [];
  for (const p of pairs) {
    const pred = applyTransform(transform, p.measured);
    for (let i = 0; i < 3; i++) {
      res[i] += (pred[i] - p.expected[i]) ** 2;
      tot[i] += (p.expected[i] - mean[i]) ** 2;
    }
    residuals.push(deltaE76(pred, p.expected));
  }
  const summary = summariseDistribution(residuals);
  return {
    ok: true,
    fit: {
      transform,
      rSquared: [0, 1, 2].map((i) => (tot[i] > 0 ? 1 - res[i] / tot[i] : 1)) as
        unknown as readonly [number, number, number],
      medianResidualDeltaE: summary.median,
      maxResidualDeltaE: summary.max,
      n,
    },
  };
}

export function applyTransform(t: AffineTransform, lab: Lab): Lab {
  const [L, a, b] = lab;
  return [
    t.A[0][0] * L + t.A[0][1] * a + t.A[0][2] * b + t.b[0],
    t.A[1][0] * L + t.A[1][1] * a + t.A[1][2] * b + t.b[1],
    t.A[2][0] * L + t.A[2][1] * a + t.A[2][2] * b + t.b[2],
  ];
}

export function simulateTransform(
  t: AffineTransform,
  measurements: ReadonlyMap<number, Lab>,
): Map<number, Lab> {
  const out = new Map<number, Lab>();
  measurements.forEach((lab, idx) => out.set(idx, applyTransform(t, lab)));
  return out;
}

/** Sorted-ascending list of per-cell ΔE plus its summary stats. Used
 *  by the calibrate canvas's before/after distribution. */
export interface DistributionData {
  values: number[];
  median: number;
  max: number;
  count: number;
}

/** Summarise an unsorted ΔE list into ``DistributionData`` (sorted +
 *  median + max + count). Empty list → all zeros. */
export function summariseDistribution(values: number[]): DistributionData {
  if (values.length === 0) return { values: [], median: 0, max: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    values: sorted,
    median,
    max: sorted[sorted.length - 1],
    count: sorted.length,
  };
}

/* ─── Linear-algebra helpers ────────────────────────────────────────────── */

function determinant4(m: number[][]): number {
  return (
    m[0][0] * det3(minor(m, 0, 0)) -
    m[0][1] * det3(minor(m, 0, 1)) +
    m[0][2] * det3(minor(m, 0, 2)) -
    m[0][3] * det3(minor(m, 0, 3))
  );
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function minor(m: number[][], skipRow: number, skipCol: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < m.length; i++) {
    if (i === skipRow) continue;
    const row: number[] = [];
    for (let j = 0; j < m[i].length; j++) {
      if (j === skipCol) continue;
      row.push(m[i][j]);
    }
    out.push(row);
  }
  return out;
}

/** Solve 4×4 A·X = B (B is 4×3 → X is 4×3) via Gauss-Jordan with
 *  partial pivoting. Returns ``null`` if elimination collapses to a
 *  near-zero pivot (caught upstream by the determinant guard, but
 *  double-checked defensively). */
function solve4x3(A: number[][], B: number[][]): number[][] | null {
  const n = 4;
  const cols = 3;
  const M: number[][] = Array.from({ length: n }, (_, i) => [...A[i], ...B[i]]);
  for (let i = 0; i < n; i++) {
    let pivotRow = i;
    let pivotMag = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      const mag = Math.abs(M[k][i]);
      if (mag > pivotMag) {
        pivotMag = mag;
        pivotRow = k;
      }
    }
    if (pivotMag < 1e-12) return null;
    if (pivotRow !== i) {
      const tmp = M[i];
      M[i] = M[pivotRow];
      M[pivotRow] = tmp;
    }
    const piv = M[i][i];
    for (let j = i; j < n + cols; j++) M[i][j] /= piv;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = M[k][i];
      if (factor === 0) continue;
      for (let j = i; j < n + cols; j++) M[k][j] -= factor * M[i][j];
    }
  }
  return Array.from({ length: n }, (_, i) => M[i].slice(n, n + cols));
}
