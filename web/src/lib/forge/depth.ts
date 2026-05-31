// web/src/lib/forge/depth.ts
/**
 * Total Z descent (mm) for a Z-axis-descend incise: the head steps down by
 * `byMm` every `everyN` layers across `layers` total slices, so the cut floor
 * drops `(layers / everyN) * byMm`. Returns 0 for a non-positive interval.
 */
export function descentDepthMm(layers: number, everyN: number, byMm: number): number {
  if (!(everyN > 0)) return 0;
  return (layers / everyN) * byMm;
}
