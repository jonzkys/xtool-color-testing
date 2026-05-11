/**
 * Pure helpers driving the propose-test wizard's live computation.
 * No React, no DOM, no I/O — every function is referentially transparent
 * so they can be unit-tested exhaustively.
 */

import type { ExposureRow } from "./exposureCorrelations";

export type Point2 = readonly [number, number];
export type Polygon = ReadonlyArray<Point2>;

export type IndexKey =
  | "pulse_spacing_mm"
  | "line_spacing_mm"
  | "pulse_energy_index"
  | "pulse_intensity_index"
  | "total_exposure_index"
  | "ablation_aggression_index"
  | "delivery_smoothness_index"
  | "duty_cycle_index";

export function pointInPolygon(p: Point2, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  // Standard ray-casting along +X axis.
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function rowPoint(row: ExposureRow, xKey: IndexKey, yKey: IndexKey): Point2 {
  const x = row.indices[xKey] as number;
  const y = row.indices[yKey] as number;
  return [x, y];
}

function centroid(polygon: Polygon): Point2 {
  if (polygon.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of polygon) {
    sx += x;
    sy += y;
  }
  return [sx / polygon.length, sy / polygon.length];
}

export function findAnchor(
  polygon: Polygon,
  rows: readonly ExposureRow[],
  xKey: IndexKey,
  yKey: IndexKey,
): ExposureRow | null {
  if (polygon.length < 3) return null;
  const inside = rows.filter((r) => pointInPolygon(rowPoint(r, xKey, yKey), polygon));
  if (inside.length === 0) return null;
  const [cx, cy] = centroid(polygon);
  let best = inside[0];
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const r of inside) {
    const [x, y] = rowPoint(r, xKey, yKey);
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = r;
    }
  }
  return best;
}

import { computeIndices, type LaserParams, type LaserIndices } from "../../laser/laserIndices";

export type ParamKey = "power" | "speed" | "frequency" | "density";

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export type LaserLimits = Record<ParamKey, ParamRange>;

export interface CurveSample {
  paramValue: number;
  x: number;
  y: number;
}

export const CURVE_SAMPLE_COUNT = 200;

export function computeCurve(
  anchor: LaserParams,
  varyParam: ParamKey,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  crosshatch: boolean = false,
): CurveSample[] {
  const range = laserLimits[varyParam];
  const out: CurveSample[] = [];
  for (let i = 0; i < CURVE_SAMPLE_COUNT; i++) {
    const t = i / (CURVE_SAMPLE_COUNT - 1);
    const value = range.min + t * (range.max - range.min);
    const params: LaserParams = { ...anchor, [varyParam]: value };
    let indices;
    try {
      indices = computeIndices(params, { crosshatch });
    } catch {
      // Skip points where the formula throws (e.g. zero denominators).
      continue;
    }
    out.push({
      paramValue: value,
      x: indices[xKey] as number,
      y: indices[yKey] as number,
    });
  }
  return out;
}

interface XY { readonly x: number; readonly y: number; }

function lineIntersectsSegment(
  p1: XY, p2: XY, q1: XY, q2: XY,
): XY | null {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = q2.x - q1.x;
  const dy2 = q2.y - q1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const dx3 = q1.x - p1.x;
  const dy3 = q1.y - p1.y;
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}

function intersectionsWithPolygon(p1: XY, p2: XY, polygon: Polygon): XY[] {
  const out: XY[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const q1 = { x: polygon[j][0], y: polygon[j][1] };
    const q2 = { x: polygon[i][0], y: polygon[i][1] };
    const hit = lineIntersectsSegment(p1, p2, q1, q2);
    if (hit !== null) out.push(hit);
  }
  // Sort along the segment p1→p2 by parameter so callers get them in
  // walked order.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq > 0) {
    out.sort((a, b) => {
      const ta = ((a.x - p1.x) * dx + (a.y - p1.y) * dy) / lenSq;
      const tb = ((b.x - p1.x) * dx + (b.y - p1.y) * dy) / lenSq;
      return ta - tb;
    });
  }
  return out;
}

interface PolylinePoint { readonly x: number; readonly y: number; readonly paramValue?: number; }

function interpolateAlong<T extends PolylinePoint>(a: T, b: T, ratio: number): T {
  const x = a.x + ratio * (b.x - a.x);
  const y = a.y + ratio * (b.y - a.y);
  if (a.paramValue !== undefined && b.paramValue !== undefined) {
    return {
      ...a,
      x, y,
      paramValue: a.paramValue + ratio * (b.paramValue - a.paramValue),
    } as T;
  }
  return { ...a, x, y } as T;
}

function ratioOnSegment(p1: XY, p2: XY, q: XY): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return ((q.x - p1.x) * dx + (q.y - p1.y) * dy) / lenSq;
}

export function clipPolylineToPolygon<T extends PolylinePoint>(
  polyline: readonly T[],
  polygon: Polygon,
): T[][] {
  if (polyline.length < 2 || polygon.length < 3) return [];
  const segments: T[][] = [];
  let current: T[] = [];

  function pushCurrent(): void {
    if (current.length >= 2) segments.push(current);
    current = [];
  }

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const aIn = pointInPolygon([a.x, a.y], polygon);
    const bIn = pointInPolygon([b.x, b.y], polygon);
    const hits = intersectionsWithPolygon(
      { x: a.x, y: a.y }, { x: b.x, y: b.y }, polygon,
    );

    if (aIn && bIn) {
      // Both endpoints inside — keep the start vertex (last segment will
      // duplicate b).
      if (current.length === 0) current.push(a);
      current.push(b);
    } else if (aIn && !bIn) {
      // Exits polygon — interpolate to the boundary intersection.
      if (current.length === 0) current.push(a);
      const hit = hits[0];
      if (hit) current.push(interpolateAlong(a, b, ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hit,
      )));
      pushCurrent();
    } else if (!aIn && bIn) {
      // Enters polygon — start fresh from the boundary intersection.
      pushCurrent();
      const hit = hits[hits.length - 1];
      if (hit) current.push(interpolateAlong(a, b, ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hit,
      )));
      current.push(b);
    } else if (hits.length >= 2) {
      // Crosses through (in-out): take the first two intersections as a
      // sub-segment.
      pushCurrent();
      const r1 = ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hits[0],
      );
      const r2 = ratioOnSegment(
        { x: a.x, y: a.y }, { x: b.x, y: b.y }, hits[1],
      );
      current.push(interpolateAlong(a, b, r1));
      current.push(interpolateAlong(a, b, r2));
      pushCurrent();
    }
  }

  pushCurrent();
  return segments;
}

const TESTABLE_PARAMS: readonly ParamKey[] = ["power", "speed", "density", "frequency"];

export type ModeChoice =
  | { readonly mode: "curve"; readonly varyParam: ParamKey }
  | { readonly mode: "fill"; readonly varyParams: readonly [ParamKey, ParamKey] };

export const CURVE_COVERAGE_THRESHOLD = 0.4;

interface BoundingBox { minX: number; maxX: number; minY: number; maxY: number; }

function bbox(points: ReadonlyArray<{ x: number; y: number }>): BoundingBox | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function polygonBox(polygon: Polygon): BoundingBox | null {
  return bbox(polygon.map(([x, y]) => ({ x, y })));
}

function paramScore(
  anchor: LaserParams,
  varyParam: ParamKey,
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): { score: number; xSpread: number; ySpread: number } {
  const curve = computeCurve(anchor, varyParam, xKey, yKey, laserLimits);
  const segments = clipPolylineToPolygon(curve, polygon);
  const flat = segments.flat();
  const polyBox = polygonBox(polygon);
  if (flat.length === 0 || !polyBox) return { score: 0, xSpread: 0, ySpread: 0 };
  const segBox = bbox(flat);
  if (!segBox) return { score: 0, xSpread: 0, ySpread: 0 };
  const polyW = Math.max(polyBox.maxX - polyBox.minX, 1e-12);
  const polyH = Math.max(polyBox.maxY - polyBox.minY, 1e-12);
  const xSpread = (segBox.maxX - segBox.minX) / polyW;
  const ySpread = (segBox.maxY - segBox.minY) / polyH;
  return { score: Math.min(xSpread, ySpread), xSpread, ySpread };
}

export function pickModeAndParams(
  anchor: ExposureRow,
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
): ModeChoice {
  if (!anchor.params) {
    return { mode: "fill", varyParams: ["power", "speed"] };
  }
  const anchorParams = anchor.params as unknown as LaserParams;

  // Score each testable param. Tie-break order: power, speed, density, frequency.
  const scores = TESTABLE_PARAMS.map((p) => ({
    param: p,
    ...paramScore(anchorParams, p, polygon, xKey, yKey, laserLimits),
  }));

  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score >= CURVE_COVERAGE_THRESHOLD) {
    return { mode: "curve", varyParam: best.param };
  }

  // Fill mode: pick the two params with highest x-spread + y-spread that
  // are different. Sort each by spread; greedily pick non-duplicate.
  const byX = [...scores].sort((a, b) => b.xSpread - a.xSpread);
  const byY = [...scores].sort((a, b) => b.ySpread - a.ySpread);
  const p1 = byX[0].param;
  let p2 = byY[0].param;
  if (p1 === p2) {
    p2 = byY.find((s) => s.param !== p1)?.param ?? "speed";
  }
  return { mode: "fill", varyParams: [p1, p2] };
}

export function sampleByArcLength(
  segment: readonly CurveSample[],
  n: number,
): CurveSample[] {
  if (segment.length < 2 || n < 2) {
    return segment.length > 0 ? [segment[0]] : [];
  }

  const cum: number[] = [0];
  for (let i = 1; i < segment.length; i++) {
    const dx = segment[i].x - segment[i - 1].x;
    const dy = segment[i].y - segment[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];

  if (total === 0) return [segment[0]];

  const out: CurveSample[] = [];
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    const a = segment[lo];
    const b = segment[hi];
    const segLen = cum[hi] - cum[lo];
    const t = segLen === 0 ? 0 : (target - cum[lo]) / segLen;
    out.push({
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
      paramValue: a.paramValue + t * (b.paramValue - a.paramValue),
    });
  }
  return out;
}

export function partialDerivative(
  indexKey: IndexKey,
  paramKey: ParamKey | "passes" | "pulse_width",
  params: LaserParams,
  crosshatch: boolean = false,
): number {
  const { power, speed, frequency, density, passes, pulse_width } = params;
  const xh = crosshatch ? 2 : 1;
  const effPasses = passes * xh;

  switch (indexKey) {
    case "pulse_spacing_mm": {
      // PSm = speed / (frequency * 1000) — independent of crosshatch
      switch (paramKey) {
        case "speed":     return 1 / (frequency * 1000);
        case "frequency": return -speed / (frequency * frequency * 1000);
        default: return 0;
      }
    }
    case "line_spacing_mm": {
      // LSm = 10 / density — independent of crosshatch
      switch (paramKey) {
        case "density": return -10 / (density * density);
        default: return 0;
      }
    }
    case "pulse_energy_index": {
      // PEi = power / frequency — independent of crosshatch
      switch (paramKey) {
        case "power":     return 1 / frequency;
        case "frequency": return -power / (frequency * frequency);
        default: return 0;
      }
    }
    case "pulse_intensity_index": {
      // PIi = power / (frequency * pulse_width) — independent of crosshatch
      switch (paramKey) {
        case "power":       return 1 / (frequency * pulse_width);
        case "frequency":   return -power / (frequency * frequency * pulse_width);
        case "pulse_width": return -power / (frequency * pulse_width * pulse_width);
        default: return 0;
      }
    }
    case "total_exposure_index": {
      // v5: TEi = power * frequency * density * effPasses / speed
      switch (paramKey) {
        case "power":     return frequency * density * effPasses / speed;
        case "frequency": return power * density * effPasses / speed;
        case "density":   return power * frequency * effPasses / speed;
        case "passes":    return power * frequency * density * xh / speed;
        case "speed":     return -power * frequency * density * effPasses / (speed * speed);
        default: return 0;
      }
    }
    case "ablation_aggression_index": {
      // v5: AAi = TEi × PIi = power² * density * effPasses / (speed * pulse_width)
      // (frequency cancels: TEi gains a freq factor and PIi has 1/freq)
      const denom = speed * pulse_width;
      switch (paramKey) {
        case "power":       return 2 * power * density * effPasses / denom;
        case "density":     return power * power * effPasses / denom;
        case "passes":      return power * power * density * xh / denom;
        case "speed":       return -power * power * density * effPasses / (speed * denom);
        case "pulse_width": return -power * power * density * effPasses / (pulse_width * denom);
        default: return 0;
      }
    }
    case "delivery_smoothness_index": {
      // v5: DSi = TEi / PIi = frequency² * density * effPasses * pulse_width / speed
      // (power cancels: TEi has a `power` factor and PIi has `1/power`)
      switch (paramKey) {
        case "frequency":   return 2 * frequency * density * effPasses * pulse_width / speed;
        case "density":     return frequency * frequency * effPasses * pulse_width / speed;
        case "passes":      return frequency * frequency * density * xh * pulse_width / speed;
        case "pulse_width": return frequency * frequency * density * effPasses / speed;
        case "speed":       return -frequency * frequency * density * effPasses * pulse_width / (speed * speed);
        default: return 0;
      }
    }
    case "duty_cycle_index": {
      // v6: Duty = frequency * pulse_width / 10000 — independent of crosshatch
      switch (paramKey) {
        case "frequency":   return pulse_width / 10_000;
        case "pulse_width": return frequency / 10_000;
        default: return 0;
      }
    }
  }
}

export const FILL_GRID_RESOLUTION = 32;

export interface FillCell {
  paramValues: Partial<Record<ParamKey, number>>;
  x: number;
  y: number;
}

export function fillByForwardGrid(
  anchor: LaserParams,
  varyParams: readonly [ParamKey, ParamKey],
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  n: number,
  crosshatch: boolean = false,
): FillCell[] {
  const [a, b] = varyParams;
  const aRange = laserLimits[a];
  const bRange = laserLimits[b];

  const candidates: FillCell[] = [];
  for (let i = 0; i < FILL_GRID_RESOLUTION; i++) {
    const u = i / (FILL_GRID_RESOLUTION - 1);
    const aValue = aRange.min + u * (aRange.max - aRange.min);
    for (let j = 0; j < FILL_GRID_RESOLUTION; j++) {
      const v = j / (FILL_GRID_RESOLUTION - 1);
      const bValue = bRange.min + v * (bRange.max - bRange.min);
      const params: LaserParams = { ...anchor, [a]: aValue, [b]: bValue };
      let indices;
      try {
        indices = computeIndices(params, { crosshatch });
      } catch {
        continue;
      }
      const x = indices[xKey] as number;
      const y = indices[yKey] as number;
      if (!pointInPolygon([x, y], polygon)) continue;
      candidates.push({
        paramValues: { [a]: aValue, [b]: bValue },
        x, y,
      });
    }
  }

  if (candidates.length <= n) return candidates;

  // Stratified picking: divide polygon bbox into ⌈√n⌉ × ⌈√n⌉ sub-cells.
  // For each sub-cell, take the candidate closest to its centre. Fill any
  // empty sub-cells from the remaining candidates in candidate order.
  const polyBox = polygonBox(polygon);
  if (!polyBox) return candidates.slice(0, n);

  const k = Math.ceil(Math.sqrt(n));
  const cellW = (polyBox.maxX - polyBox.minX) / k;
  const cellH = (polyBox.maxY - polyBox.minY) / k;

  // Each sub-cell stores the *index* of the picked candidate (or null).
  const subPicked: (number | null)[][] = Array.from(
    { length: k }, () => Array.from({ length: k }, () => null),
  );
  const used = new Set<number>();
  for (let candIdx = 0; candIdx < candidates.length; candIdx++) {
    const c = candidates[candIdx];
    const ci = Math.min(k - 1, Math.floor((c.x - polyBox.minX) / cellW));
    const cj = Math.min(k - 1, Math.floor((c.y - polyBox.minY) / cellH));
    const curIdx = subPicked[ci][cj];
    const cx = polyBox.minX + (ci + 0.5) * cellW;
    const cy = polyBox.minY + (cj + 0.5) * cellH;
    const distSq = (c.x - cx) ** 2 + (c.y - cy) ** 2;
    if (curIdx === null) {
      subPicked[ci][cj] = candIdx;
      used.add(candIdx);
    } else {
      const cur = candidates[curIdx];
      const curDistSq = (cur.x - cx) ** 2 + (cur.y - cy) ** 2;
      if (distSq < curDistSq) {
        // Evict the old winner back to the pool.
        used.delete(curIdx);
        subPicked[ci][cj] = candIdx;
        used.add(candIdx);
      }
    }
  }

  const picked: FillCell[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const idx = subPicked[i][j];
      if (idx !== null) picked.push(candidates[idx]);
    }
  }
  // Top up to n from the unused pool, in candidate order.
  if (picked.length < n) {
    for (let i = 0; i < candidates.length && picked.length < n; i++) {
      if (!used.has(i)) picked.push(candidates[i]);
    }
  }
  return picked.slice(0, n);
}

function polygonArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0;
  let s = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    s += (polygon[j][0] + polygon[i][0]) * (polygon[j][1] - polygon[i][1]);
  }
  return Math.abs(s) / 2;
}

export const SAMPLE_BUDGET_PER_POINT = 30;
export const MIN_DIST_FACTOR = 0.6;

/**
 * Sample up to N points evenly distributed in a polygon, avoiding any
 * supplied known points.
 *
 * Distance comparisons are NORMALISED by the polygon's bbox dimensions
 * so the algorithm is invariant to the axes' raw scales. Without this,
 * an anisotropic polygon (e.g. TEi-axis spans 80 units, PIi-axis spans
 * 0.045 units) would have a min-distance threshold larger than its
 * smaller dimension, and zero points would ever satisfy spacing.
 *
 * ``minDistOverride`` is interpreted as a normalised threshold in
 * [0, 1] for consistency.
 */
export function samplePolygonArea(
  polygon: Polygon,
  n: number,
  knownPoints: ReadonlyArray<{ x: number; y: number }>,
  minDistOverride?: number,
): Array<{ x: number; y: number }> {
  if (polygon.length < 3 || n <= 0) return [];
  const box = polygonBox(polygon);
  if (!box) return [];
  const area = polygonArea(polygon);
  if (area === 0) return [];

  // Capture into a local const so TypeScript narrows inside the closure.
  const bbox = box;
  const w = Math.max(bbox.maxX - bbox.minX, 1e-12);
  const h = Math.max(bbox.maxY - bbox.minY, 1e-12);

  // Normalised threshold: scale-invariant across anisotropic polygons.
  // Default is roughly the side length of a regular grid in [0,1]² with
  // n + known cells, scaled by MIN_DIST_FACTOR.
  const initialMinDist = minDistOverride ?? (
    MIN_DIST_FACTOR / Math.sqrt(n + knownPoints.length)
  );
  const budget = SAMPLE_BUDGET_PER_POINT * n;

  function tryWith(minDist: number): Array<{ x: number; y: number }> {
    const accepted: Array<{ x: number; y: number }> = [];
    const minDistSq = minDist * minDist;
    let attempts = 0;
    while (accepted.length < n && attempts < budget) {
      attempts++;
      const x = bbox.minX + Math.random() * w;
      const y = bbox.minY + Math.random() * h;
      if (!pointInPolygon([x, y], polygon)) continue;
      let ok = true;
      for (const k of knownPoints) {
        const dxn = (k.x - x) / w;
        const dyn = (k.y - y) / h;
        if (dxn * dxn + dyn * dyn < minDistSq) { ok = false; break; }
      }
      if (!ok) continue;
      for (const p of accepted) {
        const dxn = (p.x - x) / w;
        const dyn = (p.y - y) / h;
        if (dxn * dxn + dyn * dyn < minDistSq) { ok = false; break; }
      }
      if (!ok) continue;
      accepted.push({ x, y });
    }
    return accepted;
  }

  let result = tryWith(initialMinDist);
  if (result.length < n) {
    // Single relaxation pass with half the threshold.
    result = tryWith(initialMinDist * 0.5);
  }
  return result;
}

export const INVERSE_SOLVE_MAX_ITERS = 20;
const INVERSE_SOLVE_RESIDUAL_EPS = 1e-6;
const INVERSE_SOLVE_DET_EPS = 1e-12;

export function inverseSolve(
  target: { x: number; y: number },
  varyParams: readonly [ParamKey, ParamKey],
  baseParams: LaserParams,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  crosshatch: boolean = false,
): LaserParams | null {
  const [p1, p2] = varyParams;
  const params: LaserParams = { ...baseParams };

  for (let iter = 0; iter < INVERSE_SOLVE_MAX_ITERS; iter++) {
    let current: LaserIndices;
    try {
      current = computeIndices(params, { crosshatch });
    } catch {
      return null;
    }
    const rx = (current[xKey] as number) - target.x;
    const ry = (current[yKey] as number) - target.y;
    if (Math.abs(rx) < INVERSE_SOLVE_RESIDUAL_EPS && Math.abs(ry) < INVERSE_SOLVE_RESIDUAL_EPS) {
      return params;
    }

    const j00 = partialDerivative(xKey, p1, params, crosshatch);
    const j01 = partialDerivative(xKey, p2, params, crosshatch);
    const j10 = partialDerivative(yKey, p1, params, crosshatch);
    const j11 = partialDerivative(yKey, p2, params, crosshatch);
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < INVERSE_SOLVE_DET_EPS) {
      return null;
    }

    const dp1 = (j11 * rx - j01 * ry) / det;
    const dp2 = (-j10 * rx + j00 * ry) / det;
    params[p1] -= dp1;
    params[p2] -= dp2;

    if (params[p1] < laserLimits[p1].min || params[p1] > laserLimits[p1].max) return null;
    if (params[p2] < laserLimits[p2].min || params[p2] > laserLimits[p2].max) return null;
  }
  return null;
}

export function fillByInverseSolve(
  baseParams: LaserParams,
  varyParams: readonly [ParamKey, ParamKey],
  polygon: Polygon,
  xKey: IndexKey,
  yKey: IndexKey,
  laserLimits: LaserLimits,
  n: number,
  knownPoints: ReadonlyArray<{ x: number; y: number }>,
  crosshatch: boolean = false,
): FillCell[] {
  const targets = samplePolygonArea(polygon, n, knownPoints);
  const [p1, p2] = varyParams;
  const out: FillCell[] = [];

  for (const t of targets) {
    const solved = inverseSolve(t, varyParams, baseParams, xKey, yKey, laserLimits, crosshatch);
    if (solved === null) continue;

    let verify: LaserIndices;
    try {
      verify = computeIndices(solved, { crosshatch });
    } catch {
      continue;
    }
    out.push({
      paramValues: { [p1]: solved[p1], [p2]: solved[p2] },
      x: verify[xKey] as number,
      y: verify[yKey] as number,
    });
  }
  return out;
}
