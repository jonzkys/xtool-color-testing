---
id: 2026-05-31-forge-stage-params
date: 2026-05-31
level: minor
title: Forge — machine-aware stage params + Z-descent control
summary: Per-stage laser params now use the same constrained widgets as the rest of the app (pulse width is a preset dropdown), and "Z layers" is replaced by a proper Z-axis descent control with live depth readouts.
---

The Contour Forge stage-parameter panel now mirrors the rest of the app: each
field is constrained to the machine's allowed range (pulse width is the F2
Ultra preset **dropdown**, not a free number), pre-filled from the source
incise's own values so you edit from a sane starting point.

The opaque "Z layers" field is gone. In its place is xStudio's actual model —
**Descend at Z-axis** with **every N layers** and **by N mm** — plus two live
readouts: **total depth** and **depth @ 256 layers**, so you can sanity-check
the expected engraving depth before cutting.

And the deepen stages now share settings by default: B–D copy the first deepen
stage's params (uncheck "Copy from first deepen stage" on any of them to dial
it in separately).
