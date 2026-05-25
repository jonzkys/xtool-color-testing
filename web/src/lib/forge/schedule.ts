// web/src/lib/forge/schedule.ts

export interface InterlaceOptions {
  /** Process every Nth segment first, then fill the gaps. */
  stride: number;
  /** Reverse the whole order on odd passes (counter-propagating). */
  reverse: boolean;
  /** Shift the starting segment by `pass` so successive passes don't share a start. */
  stagger: boolean;
  /** Zero-based pass index within the group. */
  pass: number;
}

/**
 * Produce a processing order over `count` segments that spreads heat around the
 * contour: take every `stride`-th segment starting at an offset, then advance
 * the offset to fill remaining segments. Optionally reverse on odd passes and
 * stagger the start point per pass so we never restart at the same physical
 * point. Always returns a permutation of [0..count-1].
 */
export function orderSegmentsInterlaced(count: number, opts: InterlaceOptions): number[] {
  if (count <= 0) return [];
  const stride = Math.max(1, Math.floor(opts.stride));
  const startShift = opts.stagger ? opts.pass % count : 0;

  const order: number[] = [];
  const seen = new Set<number>();
  for (let offset = 0; offset < stride && order.length < count; offset++) {
    for (let i = offset; i < count; i += stride) {
      const idx = (i + startShift) % count;
      if (!seen.has(idx)) {
        seen.add(idx);
        order.push(idx);
      }
    }
  }
  // safety: append any missed (possible when startShift collides)
  for (let i = 0; i < count; i++) {
    if (!seen.has(i)) order.push(i);
  }
  if (opts.reverse && opts.pass % 2 === 1) order.reverse();
  return order;
}
