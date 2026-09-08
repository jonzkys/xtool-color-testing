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

/** An `#rrggbb` string for an RGB triple, uppercase to match vtracer's own
 *  output casing so a snapped fill is byte-comparable with an unsnapped one. */
export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")
  ).toUpperCase();
}

/** ``quantizeRgba`` plus the palette it chose.
 *
 *  The palette matters downstream: vtracer computes each traced region's OWN
 *  average colour, so it happily emits colours the quantised input never
 *  contained — 6 input colours became 1057 distinct fills (and 444 UI layers)
 *  on a real user file. Snapping vtracer's fills back to this palette is what
 *  makes ``max_colors`` actually mean what the label says. */
export function quantizeRgbaWithPalette(
  rgba: Uint8ClampedArray,
  maxColors: number,
): { pixels: Uint8ClampedArray; palette: [number, number, number][] } {
  const pixels = quantizeRgba(rgba, maxColors);
  // Read the palette back off the result rather than plumbing it out of the
  // median-cut internals: the buffer holds at most ``maxColors`` distinct
  // colours by construction, so this is a bounded scan and it stays correct
  // if the quantiser's internals ever change.
  const seen = new Set<number>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  const palette = [...seen].map(
    (v) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff] as [number, number, number],
  );
  return { pixels, palette };
}

/** Rewrite every ``fill="#rrggbb"`` in ``svg`` to its nearest palette entry
 *  by squared RGB distance. No-op when the palette is empty. */
export function snapFillsToPalette(
  svg: string,
  palette: [number, number, number][],
): string {
  if (palette.length === 0) return svg;
  const cache = new Map<string, string>();
  return svg.replace(/fill="#([0-9a-fA-F]{6})"/g, (_m, hex: string) => {
    const cached = cache.get(hex);
    if (cached !== undefined) return cached;
    const n = parseInt(hex, 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
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
    const out = `fill="${rgbToHex(best[0], best[1], best[2])}"`;
    cache.set(hex, out);
    return out;
  });
}

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
