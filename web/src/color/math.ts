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

/** Polar hue angle (degrees, 0..360) of a Lab (a, b) pair. */
export function hueDeg(a: number, b: number): number {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return ((h % 360) + 360) % 360;
}

/** Chroma — radial distance from the L* axis in Lab (sqrt(a² + b²)). */
export function chroma(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/** Wrap a hue delta (degrees) into the signed [-180, 180] range so that
 *  a +355° rotation reads as -5° (the visually closer rotation). */
export function wrapHueDelta(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}

/** CIEDE2000 color difference (Sharma et al. 2005).
 *
 *  Ported verbatim from ``src/xcs_gen_web/palette.py::delta_e_2000``. Used on
 *  the client so "match all layers to palette" doesn't fire N parallel API
 *  calls — we load the user's palette once and do the math locally.
 */
export function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;

  const avgL = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const avgC7 = Math.pow(avgC, 7);
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (C1p + C2p) / 2;

  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const h1p = ((Math.atan2(b1, a1p) * deg) % 360 + 360) % 360;
  const h2p = ((Math.atan2(b2, a2p) * deg) % 360 + 360) % 360;

  const avgHp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;

  const T =
    1 -
    0.17 * Math.cos((avgHp - 30) * rad) +
    0.24 * Math.cos(2 * avgHp * rad) +
    0.32 * Math.cos((3 * avgHp + 6) * rad) -
    0.20 * Math.cos((4 * avgHp - 63) * rad);

  let dhp = h2p - h1p;
  if (Math.abs(dhp) > 180) dhp -= dhp > 0 ? 360 : -360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

  const SL = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const avgCp7 = Math.pow(avgCp, 7);
  const RC = 2 * Math.sqrt(avgCp7 / (avgCp7 + Math.pow(25, 7)));
  const RT = -RC * Math.sin(2 * dTheta * rad);

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  );
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

export interface Pca2Result {
  /** Unit-length first principal axis in Lab. */
  axis1: [number, number, number];
  /** Unit-length second principal axis, orthogonal to ``axis1``. */
  axis2: [number, number, number];
  /** Centroid of the input cloud. */
  mean: [number, number, number];
  /** Each input's projection onto ``axis1`` (mean-centred). */
  projected1: number[];
  /** Each input's projection onto ``axis2`` (mean-centred). */
  projected2: number[];
  /** Fraction of total variance captured by PC1 / PC2 (each ≤ 1). */
  variance_ratio_1: number;
  variance_ratio_2: number;
}

/** Two-component PCA in Lab space. Extracts PC1 via power iteration, then
 *  deflates the covariance matrix and extracts PC2 the same way.
 *
 *  Used by the 2D Spectrum page's drift map to draw samples in a
 *  (PC1, PC2) plane. Kept separate from ``pca1`` rather than folded into
 *  it because 1D callers don't want PC2 overhead.
 */
export function pca2(labs: Lab[]): Pca2Result {
  const n = labs.length;
  if (n === 0) {
    return {
      axis1: [1, 0, 0],
      axis2: [0, 1, 0],
      mean: [0, 0, 0],
      projected1: [],
      projected2: [],
      variance_ratio_1: 0,
      variance_ratio_2: 0,
    };
  }
  const mean: [number, number, number] = [0, 0, 0];
  for (const l of labs) {
    mean[0] += l[0] / n;
    mean[1] += l[1] / n;
    mean[2] += l[2] / n;
  }
  const centered: Lab[] = labs.map((l) => [
    l[0] - mean[0],
    l[1] - mean[1],
    l[2] - mean[2],
  ]);
  const cov: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const denom = Math.max(1, n - 1);
  for (const c of centered) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) cov[i][j] += (c[i] * c[j]) / denom;
  }
  const totalVar = cov[0][0] + cov[1][1] + cov[2][2];

  const powerIterate = (
    m: number[][],
    seed: [number, number, number],
  ): [[number, number, number], number] => {
    let v: [number, number, number] = [seed[0], seed[1], seed[2]];
    for (let k = 0; k < 40; k++) {
      const nv: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) nv[i] += m[i][j] * v[j];
      const norm = Math.hypot(nv[0], nv[1], nv[2]) || 1;
      v = [nv[0] / norm, nv[1] / norm, nv[2] / norm];
    }
    const Av: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) Av[i] += m[i][j] * v[j];
    const lambda = v[0] * Av[0] + v[1] * Av[1] + v[2] * Av[2];
    return [v, lambda];
  };

  const [v1, lambda1] = powerIterate(cov, [1, 0, 0]);

  // Deflate: cov' = cov - λ₁ v₁ v₁ᵀ so the next dominant eigenpair is PC2.
  const deflated: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      deflated[i][j] = cov[i][j] - lambda1 * v1[i] * v1[j];

  // Seed PC2 with [1, 1, 1] minus its v1-projection — guaranteed to be
  // non-zero and orthogonal to v1 unless v1 itself is [1, 1, 1] (which
  // can't happen for a unit vector). A standard-basis seed would fail
  // when v1 aligns with an axis AND the deflated matrix's kernel
  // contains that same axis — the seed would sit entirely in the kernel
  // and power iteration would yield the zero vector.
  const rawSeed: [number, number, number] = [1, 1, 1];
  const sdot = v1[0] + v1[1] + v1[2];
  const sRaw: [number, number, number] = [
    rawSeed[0] - sdot * v1[0],
    rawSeed[1] - sdot * v1[1],
    rawSeed[2] - sdot * v1[2],
  ];
  const sNorm = Math.hypot(sRaw[0], sRaw[1], sRaw[2]) || 1;
  const seed: [number, number, number] = [sRaw[0] / sNorm, sRaw[1] / sNorm, sRaw[2] / sNorm];
  const [v2Raw, lambda2] = powerIterate(deflated, seed);

  // Re-orthogonalise against v1 to clean up any drift from power iteration.
  const dot = v1[0] * v2Raw[0] + v1[1] * v2Raw[1] + v1[2] * v2Raw[2];
  const v2u: [number, number, number] = [
    v2Raw[0] - dot * v1[0],
    v2Raw[1] - dot * v1[1],
    v2Raw[2] - dot * v1[2],
  ];
  const v2Norm = Math.hypot(v2u[0], v2u[1], v2u[2]) || 1;
  const v2: [number, number, number] = [v2u[0] / v2Norm, v2u[1] / v2Norm, v2u[2] / v2Norm];

  const projected1 = centered.map((c) => c[0] * v1[0] + c[1] * v1[1] + c[2] * v1[2]);
  const projected2 = centered.map((c) => c[0] * v2[0] + c[1] * v2[1] + c[2] * v2[2]);

  return {
    axis1: v1,
    axis2: v2,
    mean,
    projected1,
    projected2,
    variance_ratio_1: totalVar > 0 ? lambda1 / totalVar : 0,
    variance_ratio_2: totalVar > 0 ? Math.max(0, lambda2) / totalVar : 0,
  };
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
