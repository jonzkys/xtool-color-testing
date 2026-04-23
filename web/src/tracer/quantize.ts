/**
 * Median-cut colour quantisation.
 *
 * Replaces the old backend step (PIL ``Image.quantize(method=MEDIANCUT)``)
 * that ran before vtracer. Vtracer alone groups similar colours via
 * ``color_precision`` + ``layer_difference``, but aggressive pre-quantisation
 * produces cleaner layer boundaries on photographic input — so we keep the
 * knob, just run it in the browser.
 *
 * Input: RGBA ``Uint8ClampedArray`` as yielded by canvas ``getImageData``.
 * Output: same shape, every pixel replaced with its assigned palette
 * colour. Fully-opaque pixels only; alpha channel preserved verbatim.
 */

export function quantizeRgba(
  rgba: Uint8ClampedArray,
  maxColors: number,
): Uint8ClampedArray {
  if (maxColors < 2) return rgba;

  // Build buckets of [r, g, b, count]. Using sparse keys keeps memory tight
  // even for 4K photos — each distinct colour shows up once rather than per-pixel.
  const bucketMap = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue; // skip fully transparent
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = (r << 16) | (g << 8) | b;
    const slot = bucketMap.get(key);
    if (slot) slot[3]++;
    else bucketMap.set(key, [r, g, b, 1]);
  }
  let buckets = Array.from(bucketMap.values());
  if (buckets.length <= maxColors) {
    // Already at or below target palette. No-op but still normalise so the
    // caller can rely on a deterministic colour count downstream.
    return rgba;
  }

  // Iteratively split the most-populous / widest bucket until we have
  // ``maxColors`` of them. Each split picks the channel with the largest
  // range in the chosen bucket, sorts by it, and cuts at the median.
  type Bucket = [number, number, number, number][]; // [r,g,b,count]
  const bins: Bucket[] = [buckets];
  while (bins.length < maxColors) {
    // Pick the bin with the greatest colour volume (largest axis range ×
    // pixel count). Optimising that heuristic matches the classic Heckbert
    // median-cut we're replacing.
    let pickIdx = -1;
    let pickScore = -1;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      if (b.length < 2) continue;
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, total = 0;
      for (const p of b) {
        if (p[0] < rMin) rMin = p[0];
        if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1];
        if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2];
        if (p[2] > bMax) bMax = p[2];
        total += p[3];
      }
      const volume = Math.max(rMax - rMin, gMax - gMin, bMax - bMin) * total;
      if (volume > pickScore) {
        pickScore = volume;
        pickIdx = i;
      }
    }
    if (pickIdx < 0) break;
    const bucket = bins[pickIdx];
    // Sort by the widest axis, then cut at median.
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const p of bucket) {
      if (p[0] < rMin) rMin = p[0];
      if (p[0] > rMax) rMax = p[0];
      if (p[1] < gMin) gMin = p[1];
      if (p[1] > gMax) gMax = p[1];
      if (p[2] < bMin) bMin = p[2];
      if (p[2] > bMax) bMax = p[2];
    }
    const rangeR = rMax - rMin;
    const rangeG = gMax - gMin;
    const rangeB = bMax - bMin;
    const axis = rangeR >= rangeG && rangeR >= rangeB ? 0 : rangeG >= rangeB ? 1 : 2;
    bucket.sort((a, b) => a[axis] - b[axis]);
    const mid = bucket.length >> 1;
    bins.splice(pickIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  // Compute a representative colour per bin (count-weighted average) and
  // build a flat palette.
  const palette: [number, number, number][] = bins.map((b) => {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (const p of b) {
      sr += p[0] * p[3];
      sg += p[1] * p[3];
      sb += p[2] * p[3];
      n += p[3];
    }
    return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
  });

  // Map every source colour to its nearest palette entry. Cache the map
  // so we don't re-search for repeated pixels.
  const lookup = new Map<number, [number, number, number]>();
  const nearest = (r: number, g: number, b: number): [number, number, number] => {
    const key = (r << 16) | (g << 8) | b;
    const cached = lookup.get(key);
    if (cached) return cached;
    let best = palette[0];
    let bestD = Infinity;
    for (const p of palette) {
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    lookup.set(key, best);
    return best;
  };

  // Rewrite pixels in place.
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) {
      out[i + 3] = 0;
      continue;
    }
    const [r, g, b] = nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}
