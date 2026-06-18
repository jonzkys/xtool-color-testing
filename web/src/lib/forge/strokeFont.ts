// web/src/lib/forge/strokeFont.ts
// Minimal 7-segment stroke font for engraved numeric labels. Each glyph is a
// set of open 2-point polylines on a cell of width 0.6·size and height size
// (y grows downward, matching mm canvas space). Only the characters spiral-test
// labels use are defined: digits, '.', '/', '-', space.
import type { Pt } from "./types";

/** 7-segment endpoints on a unit cell [0..W]×[0..H], W = 0.6, H = 1. */
const W = 0.6;
const H = 1;
const TL: Pt = { x: 0, y: 0 };
const TR: Pt = { x: W, y: 0 };
const ML: Pt = { x: 0, y: H / 2 };
const MR: Pt = { x: W, y: H / 2 };
const BL: Pt = { x: 0, y: H };
const BR: Pt = { x: W, y: H };
const SEG: Record<string, [Pt, Pt]> = {
  a: [TL, TR], b: [TR, MR], c: [MR, BR], d: [BL, BR], e: [ML, BL], f: [TL, ML], g: [ML, MR],
};
const DIGIT_SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
  "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

/** Unit-cell strokes (2-point polylines) for one character; [] if unsupported. */
export function glyphSegments(ch: string): [Pt, Pt][] {
  if (ch in DIGIT_SEGS) return DIGIT_SEGS[ch].split("").map((s) => SEG[s]);
  if (ch === "-") return [SEG.g];
  if (ch === "/") return [[BL, TR]];
  if (ch === ".") {
    // A small square at the baseline — a single thin dash engraves near-
    // invisibly, but a box reads clearly as a decimal point at label sizes.
    const cx = W / 2;
    const s = 0.12;
    const lo = { x: cx - s, y: H - 2 * s };
    const hi = { x: cx + s, y: H };
    return [
      [lo, { x: hi.x, y: lo.y }],
      [{ x: hi.x, y: lo.y }, hi],
      [hi, { x: lo.x, y: hi.y }],
      [{ x: lo.x, y: hi.y }, lo],
    ];
  }
  return []; // space + anything else
}

const ADVANCE = W + 0.25; // unit cell advance (monospace + kerning)

/** Render `text` as open polylines (mm), top-left of the first glyph at `origin`,
 *  glyph height = `sizeMm`, laid out left-to-right. */
export function renderLabel(text: string, sizeMm: number, origin: Pt): Pt[][] {
  const out: Pt[][] = [];
  let penX = origin.x;
  for (const ch of text) {
    for (const [a, b] of glyphSegments(ch)) {
      out.push([
        { x: penX + a.x * sizeMm, y: origin.y + a.y * sizeMm },
        { x: penX + b.x * sizeMm, y: origin.y + b.y * sizeMm },
      ]);
    }
    penX += ADVANCE * sizeMm;
  }
  return out;
}

/** Tight width (mm) of a rendered label — N-1 advances plus one glyph cell
 *  (the last glyph has no trailing kerning gap). */
export function labelWidth(text: string, sizeMm: number): number {
  if (text.length === 0) return 0;
  return ((text.length - 1) * ADVANCE + W) * sizeMm;
}
