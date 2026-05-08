---
id: 2026-05-08-laser-exposure-indices
date: 2026-05-08
level: major
title: Exposure indices on every palette entry
summary: Six derived numbers per entry — pulse spacing, line spacing, pulse energy, pulse intensity, surface exposure — surfacing how each colour was actually exposed to the laser.
images:
  - src: laser-exposure-indices-chips.png
    caption: The new chip strip on a palette entry, with surface exposure log-scaled to handle the order-of-magnitude range.
---

Every palette entry now carries a small set of derived **exposure
indices** computed from its raw laser parameters. Open any entry on
the palette page and the new chip strip shows:

- **Pulse spacing (mm)** — how far the head moves between pulses
  (`speed / frequency`). Real millimetres.
- **Line spacing index** — `1 / density`. Dimensionless: xTool's
  `density` is a controller setting, not a guaranteed lines-per-cm,
  so we don't claim mm here yet.
- **Line spacing (mm)** — empty (`—`) for now. Lights up once we
  ship per-machine density calibration.
- **Pulse energy index** — `power / frequency`. How much the
  controller asks each pulse to deliver, before it gets spread out by
  pulse width.
- **Pulse intensity index** — `power / (frequency × pulse width)`.
  Per-pulse "violence" — short pulses at low frequency hit harder
  even at the same average power.
- **Surface exposure index** — `power × density × repeat / speed`.
  The big one: total controller-driven exposure per unit area. This
  is the axis on which colour families separate.

These are explicitly **heuristic indices, not calibrated joules**.
xTool's `power %` and `density` are controller settings whose
mapping to wall-plug watts and physical line spacing isn't
guaranteed. The chip strip footer shows `v1 · heuristic indices, not
calibrated values` so we don't oversell them.

Why bother? Two engravings can hit the same colour through totally
different parameter combinations — higher power vs. lower frequency
vs. tighter line spacing. The indices give a principled way to
compare them, and they're the substrate for an upcoming exploration
page that plots palette entries in exposure-vs-intensity space, per
material.

Existing palette entries got the indices computed retroactively
during the migration; new entries get them on insert. If the formula
changes later (when calibration arrives), `xcs-gen recompute-indices`
flushes every row to the new version in one pass.
