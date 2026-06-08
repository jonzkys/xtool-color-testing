/**
 * Pure helpers for the Pixel Art palette picker's three sections
 * (Similar / Favourites / All). Kept out of the component so they're
 * unit-testable and the panel stays focused on rendering.
 */

import { deltaE2000, hexToLab, type Lab } from "../color/math";
import type { PaletteEntry } from "../types";

export interface RankedEntry {
  entry: PaletteEntry;
  /** ΔE2000 from the layer colour; 0 when the layer colour is malformed. */
  dE: number;
}

/** Rank palette entries by ΔE2000 distance from ``color`` (nearest first).
 *  Uses each entry's stored Lab when present, else derives it from the hex.
 *  A malformed ``color`` yields dE 0 for all (preserves prior behaviour). */
export function rankByDeltaE(
  entries: PaletteEntry[],
  color: string,
): RankedEntry[] {
  const targetLab = /^#[0-9a-fA-F]{6}$/.test(color) ? hexToLab(color) : null;
  const ranked = entries.map((entry) => {
    const eLab =
      entry.lab.length >= 3
        ? ([entry.lab[0], entry.lab[1], entry.lab[2]] as Lab)
        : hexToLab(entry.hex);
    return { entry, dE: targetLab ? deltaE2000(targetLab, eLab) : 0 };
  });
  ranked.sort((a, b) => a.dE - b.dE);
  return ranked;
}

/** HSL hue (0–360) of a ``#rrggbb`` hex. Near-grey colours (saturation ≈ 0)
 *  return ``360 + lightness*100`` so neutrals sort *after* all hues, darker
 *  neutrals first (black ≈ 360, white ≈ 460). Unparseable input sorts last (1000). */
export function hueOf(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 1000;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return 360 + l * 100; // neutral → after all hues
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/** Return a hue-sorted copy of ``entries`` (neutrals last). Non-mutating. */
export function hueSorted(entries: PaletteEntry[]): PaletteEntry[] {
  return [...entries].sort((a, b) => hueOf(a.hex) - hueOf(b.hex));
}

/** Case-insensitive substring match of ``query`` against an entry's display
 *  ``label`` or ``hex``. Empty/whitespace query matches everything. */
export function matchesFilter(query: string, label: string, hex: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || hex.toLowerCase().includes(q);
}
