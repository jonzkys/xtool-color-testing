// Pure detector for scrap necks ("near-gaps") in a part region, + slot helpers.
// A near-gap is where two NON-ADJACENT pieces of the part boundary nearly touch
// with SCRAP between them. Used by the relief (perforate) stage to place a vent
// that lets the choked kerf clear sideways. No clipper; O(n) via a spatial grid.
import { pointInPolygon } from "./offset";
import type { Pt } from "./types";

export interface NearGapAnchor {
  pt: Pt;
  /** Unit direction ALONG the scrap channel (perpendicular to the s->t chord). */
  dirX: number;
  dirY: number;
}

/** Count-based even-odd: pt is inside the part iff an ODD number of loops contain
 *  it. Orientation-agnostic (clipper hole winding varies) — never use area sign. */
export function inPart(part: Pt[][], pt: Pt): boolean {
  let c = 0;
  for (const loop of part) if (pointInPolygon(loop, pt)) c++;
  return (c & 1) === 1;
}

interface Sample { x: number; y: number; loop: number; edge: number; arc: number }

function perimeter(loop: Pt[]): number {
  let p = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

function resampleLoop(loop: Pt[], step: number, loopIndex: number): Sample[] {
  const out: Sample[] = [];
  if (loop.length < 3) return out;
  let arc = 0, next = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    while (next <= arc + len) {
      const d = next - arc;
      out.push({ x: a.x + dx * (d / len), y: a.y + dy * (d / len), loop: loopIndex, edge: i, arc: next });
      next += step;
    }
    arc += len;
  }
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Detect scrap necks. `gapThresholdMm` = max neck width to vent. */
export function detectNearGaps(part: Pt[][], gapThresholdMm: number): NearGapAnchor[] {
  const step = gapThresholdMm / 3;
  const minArcSep = Math.PI * gapThresholdMm;
  const loopPerim = part.map(perimeter);
  const samples: Sample[] = [];
  part.forEach((loop, li) => { for (const s of resampleLoop(loop, step, li)) samples.push(s); });
  if (samples.length === 0) return [];

  const cell = gapThresholdMm;
  const grid = new Map<string, number[]>();
  const key = (gx: number, gy: number) => gx + "," + gy;
  samples.forEach((s, idx) => {
    const k = key(Math.floor(s.x / cell), Math.floor(s.y / cell));
    const arr = grid.get(k);
    if (arr) arr.push(idx); else grid.set(k, [idx]);
  });

  const anchors: NearGapAnchor[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const gx = Math.floor(s.x / cell), gy = Math.floor(s.y / cell);
    let bestD = Infinity, bestJ = -1;
    for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
      const arr = grid.get(key(gx + ax, gy + ay));
      if (!arr) continue;
      for (const j of arr) {
        if (j === i) continue;
        const t = samples[j];
        if (t.loop === s.loop) {
          const dArc = Math.abs(t.arc - s.arc);
          const wrap = Math.min(dArc, loopPerim[s.loop] - dArc);
          if (wrap < minArcSep) continue;
        }
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < bestD) { bestD = d; bestJ = j; }
      }
    }
    if (bestJ < 0 || bestD >= gapThresholdMm) continue;
    const t = samples[bestJ];
    const tl = part[t.loop], n = tl.length;
    let dRef = bestD;
    for (const e of [t.edge - 1, t.edge, t.edge + 1]) {
      const a = tl[((e % n) + n) % n], b = tl[(((e + 1) % n) + n) % n];
      dRef = Math.min(dRef, segDist(s, a, b));
    }
    if (dRef >= gapThresholdMm) continue;
    const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
    if (inPart(part, { x: mx, y: my })) continue;
    let cx = -(t.y - s.y), cy = t.x - s.x;
    const cl = Math.hypot(cx, cy);
    if (cl === 0) continue;
    cx /= cl; cy /= cl;
    const lo = Math.min(s.loop, t.loop), hi = Math.max(s.loop, t.loop);
    const nk = lo + ":" + hi + ":" + Math.round(mx / gapThresholdMm) + ":" + Math.round(my / gapThresholdMm);
    if (seen.has(nk)) continue;
    seen.add(nk);
    anchors.push({ pt: { x: mx, y: my }, dirX: cx, dirY: cy });
  }
  // Second pass: detect "floating islands" — loops whose samples lie entirely in
  // scrap when ignoring that loop itself. The annular channel around such a loop
  // is fully enclosed and needs a vent regardless of the neck width.
  for (let li = 0; li < part.length; li++) {
    const loopSamples = samples.filter((s) => s.loop === li);
    if (loopSamples.length === 0) continue;
    // Build the part without this loop to test if the loop lives in scrap.
    const partWithout = part.filter((_, idx) => idx !== li);
    if (!loopSamples.every((s) => !inPart(partWithout, s))) continue;
    // This loop is floating in enclosed scrap. Find the closest sample from any
    // other loop to place the vent anchor at the midpoint.
    let bestD = Infinity, bestS: Sample | null = null, bestT: Sample | null = null;
    for (const s of loopSamples) {
      for (const t of samples) {
        if (t.loop === li) continue;
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < bestD) { bestD = d; bestS = s; bestT = t; }
      }
    }
    if (!bestS || !bestT) continue;
    const mx = (bestS.x + bestT.x) / 2, my = (bestS.y + bestT.y) / 2;
    if (inPart(part, { x: mx, y: my })) continue;
    let cx = -(bestT.y - bestS.y), cy = bestT.x - bestS.x;
    const cl = Math.hypot(cx, cy);
    if (cl === 0) continue;
    cx /= cl; cy /= cl;
    const lo = Math.min(li, bestT.loop), hi = Math.max(li, bestT.loop);
    const nk = lo + ":" + hi + ":" + Math.round(mx / gapThresholdMm) + ":" + Math.round(my / gapThresholdMm);
    if (seen.has(nk)) continue;
    seen.add(nk);
    anchors.push({ pt: { x: mx, y: my }, dirX: cx, dirY: cy });
  }

  return anchors;
}

/** A kerf-wide rectangle of `lengthMm` along (dirX,dirY), centred at `center`. */
export function buildSlotRect(center: Pt, dirX: number, dirY: number, lengthMm: number, widthMm: number): Pt[] {
  const hl = lengthMm / 2, hw = widthMm / 2;
  const px = -dirY, py = dirX;
  return [
    { x: center.x - dirX * hl - px * hw, y: center.y - dirY * hl - py * hw },
    { x: center.x + dirX * hl - px * hw, y: center.y + dirY * hl - py * hw },
    { x: center.x + dirX * hl + px * hw, y: center.y + dirY * hl + py * hw },
    { x: center.x - dirX * hl + px * hw, y: center.y - dirY * hl + py * hw },
  ];
}

/** True iff the slot's 4 corners AND both end-midpoints are all in scrap. */
export function slotInScrap(rect: Pt[], center: Pt, dirX: number, dirY: number, lengthMm: number, part: Pt[][]): boolean {
  const hl = lengthMm / 2;
  const ends = [
    { x: center.x - dirX * hl, y: center.y - dirY * hl },
    { x: center.x + dirX * hl, y: center.y + dirY * hl },
  ];
  return [...rect, ...ends].every((p) => !inPart(part, p));
}
