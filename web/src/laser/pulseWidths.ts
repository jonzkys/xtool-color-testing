/**
 * F2 Ultra MOPA pulse-width presets.
 *
 * The laser head only accepts these exact pulse-width values (ns) —
 * anything else the UI sends is rejected by the machine firmware
 * without warning. Hard-coded here because the value set is a
 * property of the machine, not of any individual test / preset.
 *
 * Keep in sync with ``src/xcs_gen_web/pulse_width.py``.
 */

export const ALLOWED_PULSE_WIDTHS = [
  2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500,
] as const;

export type PulseWidth = (typeof ALLOWED_PULSE_WIDTHS)[number];

/** Nearest allowed value to ``v`` by absolute distance. Used for
 *  gracefully coercing legacy data or out-of-range user input before
 *  handing it to a component that only understands allowed values. */
export function snapPulseWidth(v: number): PulseWidth {
  let best: PulseWidth = ALLOWED_PULSE_WIDTHS[0];
  let bestDist = Math.abs(v - best);
  for (const w of ALLOWED_PULSE_WIDTHS) {
    const d = Math.abs(v - w);
    if (d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  return best;
}

/** Allowed values that fall in ``[lo, hi]``, inclusive. Used for
 *  capping test sweeps that name ``pulse_width`` as an axis — the
 *  caller asks for N steps but the machine can only give as many
 *  as there are allowed values in range. */
export function allowedPulseWidthsInRange(lo: number, hi: number): PulseWidth[] {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return ALLOWED_PULSE_WIDTHS.filter((w) => w >= a && w <= b);
}
