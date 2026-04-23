"""F2 Ultra MOPA pulse-width presets.

The laser head only accepts these exact pulse-width values (ns).
Anything else we send gets rejected by the machine firmware without
warning, so we snap to the allowed list on test generation and the
frontend constrains user input to the same set.

Keep in sync with ``web/src/laser/pulseWidths.ts``.
"""

from __future__ import annotations

ALLOWED_PULSE_WIDTHS: tuple[int, ...] = (
    2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500,
)


def snap_pulse_width(v: float) -> int:
    """Nearest allowed pulse width by absolute distance."""
    best = ALLOWED_PULSE_WIDTHS[0]
    best_d = abs(v - best)
    for w in ALLOWED_PULSE_WIDTHS:
        d = abs(v - w)
        if d < best_d:
            best = w
            best_d = d
    return best


def allowed_pulse_widths_in_range(lo: float, hi: float) -> list[int]:
    """Allowed values inside ``[lo, hi]`` inclusive, sorted ascending."""
    a, b = (lo, hi) if lo <= hi else (hi, lo)
    return [w for w in ALLOWED_PULSE_WIDTHS if a <= w <= b]
