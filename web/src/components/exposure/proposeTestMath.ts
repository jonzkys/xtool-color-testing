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
  | "delivery_smoothness_index";

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
