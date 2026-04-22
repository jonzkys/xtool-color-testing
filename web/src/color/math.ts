/**
 * Client-side color math for the Spectrum playground.
 *
 * Conversions target CIE L*a*b* under D65 because that's what the
 * backend's palette math uses too — keeps delta-E reasoning consistent.
 */

export type Lab = [number, number, number]; // L* ∈ [0,100], a*/b* ∈ roughly [-128, 127]
export type Rgb = [number, number, number]; // 0..255

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

// sRGB companding (gamma ≈ 2.4).
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

// D65 reference white.
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB D65 → XYZ (0..1).
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : (t * 24389 + 16 * 27) / (27 * 116);
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b2 = 200 * (fy - fz);
  return [L, a, b2];
}

// Inverse of hexToLab: Lab D65 → XYZ → linear sRGB → gamma-compand → sRGB hex.
// Out-of-gamut values are clipped to [0, 1] linear; that can lose saturation
// in extrapolated regions, which is the correct signal that the predicted
// colour isn't reproducible on an sRGB display.
export function labToHex(lab: Lab): string {
  const [L, a, b2] = lab;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b2 / 200;
  const fInv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 216 / 24389 ? t3 : (116 * t - 16) / (24389 / 27);
  };
  const X = Xn * fInv(fx);
  const Y = Yn * fInv(fy);
  const Z = Zn * fInv(fz);
  // sRGB D65 inverse matrix.
  const R =  3.2404542 * X + -1.5371385 * Y + -0.4985314 * Z;
  const G = -0.969266  * X +  1.8760108 * Y +  0.041556  * Z;
  const B =  0.0556434 * X + -0.2040259 * Y +  1.0572252 * Z;
  const gamma = (c: number) => {
    const cc = Math.max(0, Math.min(1, c));
    return cc <= 0.0031308 ? 12.92 * cc : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055;
  };
  return rgbToHex(gamma(R) * 255, gamma(G) * 255, gamma(B) * 255);
}

/** ΔE76 — simple Euclidean distance in Lab. Good enough for ordering. */
export function deltaE76(a: Lab, b: Lab): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/* ---------------- PCA -------------------------------------------------- */

export interface PcaResult {
  /** Unit-length 3-vector = first principal axis in Lab space. */
  axis: [number, number, number];
  /** Centroid of the input Lab cloud. */
  mean: [number, number, number];
  /** Each input's projection onto the axis (mean-centred, so 0 = centroid). */
  projected: number[];
  /** Fraction of total variance captured by PC1 (≤ 1). A 1D-ish sweep
   *  should land close to 1; divergent spectra trend toward 0.33. */
  variance_ratio: number;
}

export function pca1(labs: Lab[]): PcaResult {
  const n = labs.length;
  if (n === 0) {
    return { axis: [1, 0, 0], mean: [0, 0, 0], projected: [], variance_ratio: 0 };
  }
  const mean: [number, number, number] = [0, 0, 0];
  for (const l of labs) {
    mean[0] += l[0] / n;
    mean[1] += l[1] / n;
    mean[2] += l[2] / n;
  }
  const centered = labs.map<Lab>((l) => [
    l[0] - mean[0],
    l[1] - mean[1],
    l[2] - mean[2],
  ]);
  // 3x3 covariance.
  const cov: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const c of centered) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        cov[i][j] += (c[i] * c[j]) / Math.max(1, n - 1);
      }
    }
  }
  // Power iteration for the dominant eigenvector. 30 iters is plenty for 3x3.
  let v: [number, number, number] = [1, 0, 0];
  for (let k = 0; k < 30; k++) {
    const nv: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) nv[i] += cov[i][j] * v[j];
    }
    const norm = Math.hypot(nv[0], nv[1], nv[2]) || 1;
    v = [nv[0] / norm, nv[1] / norm, nv[2] / norm];
  }
  // Eigenvalue via Rayleigh quotient (= explained variance along v).
  const Av: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) Av[i] += cov[i][j] * v[j];
  const lambda = v[0] * Av[0] + v[1] * Av[1] + v[2] * Av[2];
  const totalVar = cov[0][0] + cov[1][1] + cov[2][2];
  const projected = centered.map(
    (c) => c[0] * v[0] + c[1] * v[1] + c[2] * v[2],
  );
  return {
    axis: v,
    mean,
    projected,
    variance_ratio: totalVar > 0 ? lambda / totalVar : 0,
  };
}

/** Project a single Lab point onto a previously-computed PCA axis. */
export function projectLab(lab: Lab, pca: PcaResult): number {
  const c0 = lab[0] - pca.mean[0];
  const c1 = lab[1] - pca.mean[1];
  const c2 = lab[2] - pca.mean[2];
  return c0 * pca.axis[0] + c1 * pca.axis[1] + c2 * pca.axis[2];
}

/** Ensure the projection monotonically increases with `reference` where
 *  possible; flips the axis sign if the correlation is negative. */
export function alignPcaWithReference(
  pca: PcaResult,
  reference: number[],
): PcaResult {
  if (pca.projected.length !== reference.length || reference.length < 2) {
    return pca;
  }
  let meanR = 0, meanP = 0;
  for (let i = 0; i < reference.length; i++) {
    meanR += reference[i] / reference.length;
    meanP += pca.projected[i] / pca.projected.length;
  }
  let num = 0, dr = 0, dp = 0;
  for (let i = 0; i < reference.length; i++) {
    const a = reference[i] - meanR;
    const b = pca.projected[i] - meanP;
    num += a * b;
    dr += a * a;
    dp += b * b;
  }
  const corr = num / (Math.sqrt(dr * dp) || 1);
  if (corr < 0) {
    return {
      ...pca,
      axis: [-pca.axis[0], -pca.axis[1], -pca.axis[2]],
      projected: pca.projected.map((x) => -x),
    };
  }
  return pca;
}

/* ---------------- Polynomial fit -------------------------------------- */

export interface PolyFit {
  coeffs: number[]; // coeffs[k] is the coefficient of x^k (so coeffs[0] is intercept)
  r2: number;
  degree: number;
}

export function polyFit(x: number[], y: number[], degree: number): PolyFit {
  const n = x.length;
  const m = degree + 1;
  // Normal equations: (V^T V) c = V^T y, V = Vandermonde.
  const A: number[][] = Array.from({ length: m }, () => Array(m).fill(0));
  const b: number[] = Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    let xi_k = 1; // x[i]^0
    const powers: number[] = new Array(2 * m - 1);
    powers[0] = 1;
    for (let k = 1; k < 2 * m - 1; k++) powers[k] = powers[k - 1] * x[i];
    for (let j = 0; j < m; j++) {
      b[j] += powers[j] * y[i];
      for (let k = 0; k < m; k++) A[j][k] += powers[j + k];
    }
    void xi_k;
  }
  const coeffs = solveSymmetric(A, b);
  // R².
  let yMean = 0;
  for (let i = 0; i < n; i++) yMean += y[i] / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yhat = evalPoly(coeffs, x[i]);
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - yhat) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return { coeffs, r2, degree };
}

export function evalPoly(coeffs: number[], x: number): number {
  // Horner's method.
  let r = 0;
  for (let k = coeffs.length - 1; k >= 0; k--) r = r * x + coeffs[k];
  return r;
}

// Gaussian elimination with partial pivoting. For small m (≤ 4) it's plenty.
function solveSymmetric(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // Pivot.
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];
    const piv = M[i][i] || 1e-12;
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / piv;
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / (M[i][i] || 1e-12);
  }
  return x;
}

/* ---------------- Oracle / interpolation ----------------------------- */

/** Find the sample with the smallest ΔE to `target`, and linearly
 *  interpolate a fractional x between the two nearest samples for a
 *  smoother prediction. Returns { x, bestIndex, bestDeltaE }. */
export function predictXFromLab(
  samples: { x: number; lab: Lab }[],
  target: Lab,
): { x: number; bestIndex: number; bestDeltaE: number } | null {
  if (samples.length === 0) return null;
  // Find nearest.
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = deltaE76(samples[i].lab, target);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  // Linear interpolate between the nearest and its better-matching neighbor.
  let x = samples[bestI].x;
  const left = bestI > 0 ? samples[bestI - 1] : null;
  const right =
    bestI < samples.length - 1 ? samples[bestI + 1] : null;
  const candidate = (() => {
    const dL = left ? deltaE76(left.lab, target) : Infinity;
    const dR = right ? deltaE76(right.lab, target) : Infinity;
    if (!left && !right) return null;
    return dL < dR ? left : right;
  })();
  if (candidate) {
    const lab1 = samples[bestI].lab;
    const lab2 = candidate.lab;
    const dirL = lab2[0] - lab1[0];
    const dirA = lab2[1] - lab1[1];
    const dirB = lab2[2] - lab1[2];
    const len2 = dirL * dirL + dirA * dirA + dirB * dirB;
    if (len2 > 1e-9) {
      const tL = target[0] - lab1[0];
      const tA = target[1] - lab1[1];
      const tB = target[2] - lab1[2];
      let t = (tL * dirL + tA * dirA + tB * dirB) / len2;
      t = Math.max(0, Math.min(1, t));
      x = samples[bestI].x + t * (candidate.x - samples[bestI].x);
    }
  }
  return { x, bestIndex: bestI, bestDeltaE: bestD };
}
