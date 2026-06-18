// web/src/lib/forge/textPaths.ts
// Render a string to filled glyph-outline rings (mm) using a pre-baked
// JetBrains Mono glyph table. Pure + sync. Counters/holes are separate rings
// (use fillRule "nonzero" downstream). Y is down, matching mm canvas space.
import type { Pt } from "./types";
import { splitSubpaths } from "./contour";
import glyphTable from "./glyphTable.json";

const GLYPHS: Record<string, { d: string; adv: number }> = glyphTable.glyphs;
const SPACE_ADV = GLYPHS[" "]?.adv ?? 0.6;

function glyphFor(ch: string): { d: string; adv: number } | null {
  const up = ch.toUpperCase();
  return GLYPHS[up] ?? null;
}

/** Filled outline rings (Pt[][]) for `text`; em scaled to `sizeMm`, the text
 *  baseline at `origin.y`, left edge at `origin.x` (y-down mm). */
export function renderText(text: string, sizeMm: number, origin: Pt): Pt[][] {
  const rings: Pt[][] = [];
  let penX = origin.x;
  for (const ch of text) {
    const g = glyphFor(ch);
    if (!g) { penX += SPACE_ADV * sizeMm; continue; }
    if (g.d) {
      for (const sub of splitSubpaths(g.d)) {
        rings.push(sub.points.map((p) => ({ x: penX + p.x * sizeMm, y: origin.y + p.y * sizeMm })));
      }
    }
    penX += g.adv * sizeMm;
  }
  return rings;
}

/** Total advance width (mm) of `text` at `sizeMm`. */
export function textWidth(text: string, sizeMm: number): number {
  let w = 0;
  for (const ch of text) {
    const g = glyphFor(ch);
    w += (g ? g.adv : SPACE_ADV) * sizeMm;
  }
  return w;
}
