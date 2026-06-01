---
id: 2026-06-01-validation-widget
date: 2026-06-01
level: minor
title: Real limits on every parameter input
summary: Material calibration and Loom now enforce the active machine's real per-mode constraints, and Loom ramp stops can no longer be set out of range.
---

The clamp/snap logic that keeps a parameter inside its machine's limits used to
live in three separate widgets, with several surfaces — Material calibration,
Loom — running their own hardcoded forms and validating nothing. That's now one
shared core (`clampToConstraint`), and every base-parameter editor renders the
same profile-driven form.

Concretely: the calibration recipe and Loom's base parameters show the real
per-machine, per-mode widgets (the F2 Ultra pulse-width dropdown, density up to
the mode's ceiling, the right laser options); and a Loom ramp stop typed or
dragged past a field's limit now snaps back into range instead of silently
failing at burn. Ramp params that don't apply to the active machine (pulse width
on a diode head) drop out of the picker.
