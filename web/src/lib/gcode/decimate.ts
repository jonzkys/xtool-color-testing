// web/src/lib/gcode/decimate.ts
// Pure sub-pixel decimation for a vertex polyline. Given the x/y columns and a
// screen transform (scale, ox, oy with screenX = x*scale + ox), return the
// indices to draw — keeping a vertex only when it is >= minPx (screen space)
// from the last KEPT vertex. First and last vertices are always kept, so a
// dense run of sub-pixel moves collapses to one segment while the visible shape
// is preserved. O(count); no allocation beyond the result.
export function decimateIndices(
  x: Float32Array,
  y: Float32Array,
  count: number,
  scale: number,
  ox: number,
  oy: number,
  minPx: number,
): number[] {
  if (count <= 2) {
    const all: number[] = [];
    for (let i = 0; i < count; i++) all.push(i);
    return all;
  }
  const min2 = minPx * minPx;
  const keep: number[] = [0];
  let lastSx = x[0] * scale + ox;
  let lastSy = y[0] * scale + oy;
  const last = count - 1;
  for (let i = 1; i < last; i++) {
    const sx = x[i] * scale + ox;
    const sy = y[i] * scale + oy;
    const dx = sx - lastSx;
    const dy = sy - lastSy;
    if (dx * dx + dy * dy >= min2) {
      keep.push(i);
      lastSx = sx;
      lastSy = sy;
    }
  }
  keep.push(last);
  return keep;
}
