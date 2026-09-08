/**
 * How big an image should actually be traced at.
 *
 * vtracer traces at whatever resolution it is handed, and BOTH the trace and
 * everything downstream of it scale roughly linearly with pixel count. Measured
 * on a 1672x1328 screenshot (local dev server, default knobs):
 *
 *   longest edge | megapixels | paths | trace  | /api/svg-preview
 *   -------------|------------|-------|--------|-----------------
 *   1672 native  |    2.22    | 3253  | 748 ms | 7.6 s
 *   1200         |    1.14    | 2210  | 346 ms | 5.0 s
 *    900         |    0.64    | 1458  | 185 ms | 3.1 s
 *    500         |    0.20    |  708  |  56 ms | 1.0 s
 *
 * A phone photo at 4032x3024 is 12 MP — five times the row above the top of
 * that table — and users were routinely feeding those in and waiting a minute.
 */

/** Longest-edge cap applied to a raster before tracing, in pixels.
 *
 *  1200 is a measured compromise, not a round number. Below it, thin features
 *  start dropping out of a busy image faster than ``filter_speckle`` scaling
 *  can compensate for (on the reference screenshot the character-name labels
 *  begin to break up around 900). Above it, cost climbs with no visible return
 *  on the engraved result — the laser cannot resolve the extra detail at
 *  typical design widths anyway. */
export const DEFAULT_TRACE_MAX_PX = 1200;

/** Value meaning "do not downscale — trace at native resolution". */
export const TRACE_NATIVE = 0;

export interface TraceScale {
  /** Pixel dimensions to trace at. */
  width: number;
  height: number;
  /** Linear scale factor applied (1 = untouched). */
  scale: number;
  /** True when the image is being traced smaller than it was supplied. */
  downscaled: boolean;
}

/** Work out the dimensions to trace at, given a longest-edge cap.
 *
 *  ``maxPx <= 0`` (``TRACE_NATIVE``) or an image already inside the cap both
 *  return the native size with ``downscaled: false``. */
export function traceScaleFor(
  width: number,
  height: number,
  maxPx: number,
): TraceScale {
  const longest = Math.max(width, height);
  if (maxPx <= 0 || longest <= maxPx || longest === 0) {
    return { width, height, scale: 1, downscaled: false };
  }
  const scale = maxPx / longest;
  return {
    // Round, then floor at 1 — a very wide, very short image must not
    // collapse an axis to zero.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
    downscaled: true,
  };
}

/** Scale ``filter_speckle`` to match a downscale.
 *
 *  This is the part that is easy to get wrong. vtracer's ``filterSpeckle`` is
 *  an AREA threshold measured in pixels squared, so shrinking the image by
 *  ``s`` makes a fixed value effectively ``1/s^2`` more aggressive. Downscaling
 *  a busy image without co-scaling it wipes exactly the features you were
 *  hoping to keep — on the reference screenshot, tracing at 900 px with the
 *  speckle filter left at 8 turned every character-name label into mush, while
 *  900 px at speckle 2 kept them legible.
 *
 *  Floors at 1 whenever the user had any speckle filtering at all: speckle 0
 *  disables the filter entirely and lets anti-alias noise back in, which
 *  *increases* the path count — measured 5639 paths at 350 px with speckle 0
 *  versus 458 at speckle 8, i.e. worse than not downscaling. A 0 the user set
 *  themselves is passed through untouched. */
export function scaleFilterSpeckle(speckle: number, scale: number): number {
  if (speckle <= 0 || scale >= 1) return speckle;
  return Math.max(1, Math.round(speckle * scale * scale));
}

/** Human-readable note for the trace-options panel, or null when the image is
 *  being traced as supplied. */
export function describeTraceScale(s: TraceScale): string | null {
  if (!s.downscaled) return null;
  return `${s.width}×${s.height}`;
}
