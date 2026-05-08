/**
 * Pure-function helpers for the exposure-indices exploration page.
 *
 * Pearson + Spearman correlations and a log-linear regression
 * (y = a + b·log10(x)) are used by the scatter's regression overlay,
 * the right-rail Stats hero, and the correlations matrix builder.
 *
 * NaN handling is deliberate: callers pass arrays whose entries may
 * have stale formula_version or otherwise-missing values; the math
 * helpers drop NaN-containing rows rather than poisoning the result.
 */

/**
 * Format a tick label intelligently for arbitrary-magnitude axes.
 * Uses fixed notation in the [0.001, 99999] range, exponential
 * notation otherwise, and tries to use the minimum significant
 * digits needed for adjacent ticks to be distinguishable.
 */
export function fmtIndexTick(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e5) return v.toExponential(1);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.01) return v.toFixed(3);
  return v.toFixed(4);
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) return NaN;
  const cleanXs: number[] = [];
  const cleanYs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      cleanXs.push(xs[i]);
      cleanYs.push(ys[i]);
    }
  }
  const n = cleanXs.length;
  if (n < 2) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += cleanXs[i]; sy += cleanYs[i]; }
  const mx = sx / n;
  const my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = cleanXs[i] - mx;
    const dy = cleanYs[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return NaN;
  return num / den;
}

function rankAverage(values: readonly number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) return NaN;
  const cleanXs: number[] = [];
  const cleanYs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      cleanXs.push(xs[i]);
      cleanYs.push(ys[i]);
    }
  }
  if (cleanXs.length < 2) return NaN;
  return pearson(rankAverage(cleanXs), rankAverage(cleanYs));
}

export interface LogLinearFit {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
}

export function logLinearRegression(
  xs: readonly number[],
  ys: readonly number[],
): LogLinearFit {
  if (xs.length !== ys.length) {
    return { intercept: NaN, slope: NaN, r2: NaN, n: 0 };
  }
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && xs[i] > 0 && Number.isFinite(ys[i])) {
      lx.push(Math.log10(xs[i]));
      ly.push(ys[i]);
    }
  }
  const n = lx.length;
  if (n < 2) return { intercept: NaN, slope: NaN, r2: NaN, n };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += lx[i]; sy += ly[i]; }
  const mx = sx / n;
  const my = sy / n;
  let dx2 = 0, dxdy = 0;
  for (let i = 0; i < n; i++) {
    const dx = lx[i] - mx;
    dx2 += dx * dx;
    dxdy += dx * (ly[i] - my);
  }
  if (dx2 === 0) return { intercept: NaN, slope: NaN, r2: NaN, n };
  const slope = dxdy / dx2;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * lx[i];
    ssRes += (ly[i] - yhat) ** 2;
    ssTot += (ly[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? NaN : 1 - ssRes / ssTot;
  return { intercept, slope, r2, n };
}
