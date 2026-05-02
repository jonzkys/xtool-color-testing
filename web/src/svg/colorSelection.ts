/**
 * Pure helpers for picking validation-burn colours from a material's
 * palette. Lifted out of MaterialPalettePicker.tsx so they're unit-
 * testable without DOM / RTL setup.
 */

import type { PaletteEntry } from "../types";

/** Euclidean distance in Lab space — ΔE76. Cheap and consistent
 *  with the threshold the user sees on the result-detail summary. */
export function deltaE76(a: readonly number[], b: readonly number[]): number {
  const dl = (a[0] ?? 0) - (b[0] ?? 0);
  const da = (a[1] ?? 0) - (b[1] ?? 0);
  const db = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Pick `n` palette entries that are spread out in Lab space.
 *  Returns the `id`s of the picked entries (palette ids are stable).
 *  Seed = the entry with maximum |L* - mean(L*)|; subsequent picks
 *  maximise minimum ΔE76 to the already-picked set. Deterministic,
 *  doesn't depend on input ordering. */
export function seedFarthestPointSample(
  entries: PaletteEntry[],
  n: number,
): Set<number> {
  const ids = new Set<number>();
  if (entries.length === 0 || n <= 0) return ids;
  const eligible = entries.filter((e) => e.lab && e.lab.length >= 3);
  if (eligible.length === 0) return ids;

  // Seed: most-extreme L*. Stable tie-break by id.
  const meanL = eligible.reduce((acc, e) => acc + e.lab[0], 0) / eligible.length;
  let seed = eligible[0];
  let seedScore = -1;
  for (const e of eligible) {
    const score = Math.abs(e.lab[0] - meanL);
    if (
      score > seedScore
      || (score === seedScore && e.id < seed.id)
    ) {
      seed = e;
      seedScore = score;
    }
  }
  ids.add(seed.id);

  // Iteratively pick the entry maximising min-ΔE76 to picked.
  while (ids.size < Math.min(n, eligible.length)) {
    let best: PaletteEntry | null = null;
    let bestScore = -1;
    for (const e of eligible) {
      if (ids.has(e.id)) continue;
      let minD = Infinity;
      for (const p of eligible) {
        if (!ids.has(p.id)) continue;
        const d = deltaE76(e.lab, p.lab);
        if (d < minD) minD = d;
      }
      if (
        minD > bestScore
        || (minD === bestScore && best != null && e.id < best.id)
      ) {
        best = e;
        bestScore = minD;
      }
    }
    if (!best) break;
    ids.add(best.id);
  }
  return ids;
}
