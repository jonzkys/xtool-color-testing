// web/src/lib/forge/heatmap.ts
// Pure colour mapping for the spiral duration heatmap. No DOM, no deps.

/** Heat scale anchors: short/least (red) → mid (amber) → long/most (steel). */
export const HEAT_STOPS = [
  { t: 0, hex: "#e2483d", rgb: [226, 72, 61] as [number, number, number] },
  { t: 0.5, hex: "#f59e0b", rgb: [245, 158, 11] as [number, number, number] },
  { t: 1, hex: "#4b7f9e", rgb: [75, 127, 158] as [number, number, number] },
] as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Log-normalise values to [0,1] so a wide dynamic range (a tiny feature vs the
 * whole silhouette) stays legible. Fewer than two distinct values → 0.5 each.
 */
export function logNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const EPS = 1e-9;
  const ls = values.map((v) => Math.log(Math.max(EPS, v)));
  let lo = Infinity, hi = -Infinity;
  for (const l of ls) { if (l < lo) lo = l; if (l > hi) hi = l; }
  // No spread (all-equal / single value) or a non-finite extreme (e.g. an
  // Infinity slipped in) → flat mid-tone rather than NaN colours.
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return values.map(() => 0.5);
  return ls.map((l) => clamp01((l - lo) / (hi - lo)));
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, "0");

/** Map t∈[0,1] to a heat colour via HEAT_STOPS (red→amber→steel). Clamps t. */
export function durationColor(t: number): string {
  const tc = clamp01(t);
  let i = 0;
  while (i < HEAT_STOPS.length - 2 && tc > HEAT_STOPS[i + 1].t) i++;
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
  const span = b.t - a.t || 1; // `|| 1` is defensive only — HEAT_STOPS has distinct t's
  const f = (tc - a.t) / span;
  const r = lerp(a.rgb[0], b.rgb[0], f);
  const g = lerp(a.rgb[1], b.rgb[1], f);
  const bl = lerp(a.rgb[2], b.rgb[2], f);
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}

/** Compact seconds label for the heatmap legend. Per-pass times are often
 *  sub-second, so keep 2 decimals under 1s, 1 decimal under 10s, whole above —
 *  unlike `fmtDuration`, which rounds to whole seconds (→ "0:00" here). */
export function fmtSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0s";
  if (s < 0.01) return "<0.01s"; // sub-10ms reads sensibly, not a bare "0.00s"
  if (s < 1) return `${s.toFixed(2)}s`;
  if (s < 10) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}
