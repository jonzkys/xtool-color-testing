---
id: 2026-05-03-validation-inspect-ux
date: 2026-05-03
level: minor
title: Validation inspect — hover works everywhere, swatch grid breathes
summary: Hovering any cell on a validation result now shows its tooltip (used to bail on cell #2+), and the result-modal swatch grid drops the always-visible MEAS / EXP / WARN / FAIL labels at 100-cell density.
---

Two related fixes for validation tests with lots of cells.

**Hover only worked on cell (0, 0).** Validation tests inherit the
source sweep's `spec.x_steps = 1` (the renderer overrides at burn
time, but the stored spec keeps the sweep shape so the row survives
schema validation). The inspector's hit-tester rejected anything past
flat-index 0 against that stored value. Now it counts validation
cells from `validation_cells` directly, so a 100-cell test accepts
hovers on every chip.

**The swatch grid was crowded.** At 100 cells, the chip-corner `meas`
/ `exp` labels and the `WARN` / `FAIL` text inside the bottom strip
piled on top of the same signals the ring colour already gave you —
double-stamping turned every tile into a wall of mono. The labels
now surface only on hover (or keyboard focus) and the bottom strip
drops the redundant pass/warn/fail text in favour of a single ΔE
number coloured by threshold. The ring is still the at-a-glance
signal; the modal still has the full breakdown one click away.
