---
id: 2026-05-15-exposure-propose-test
date: 2026-05-15
level: major
title: Exposure — Propose Test from a drawn region
summary: Draw a polygon on the bivariate scatter; the workbench builds a ready-to-burn validation test that fills your region.
---

The bivariate exposure scatter just gained a workflow that turns a
visual hunch into an actual test. Click `◇ PROPOSE TEST` in the
toolbar, click vertices to draw a polygon around the region you want
to probe, press Enter (or double-click) to close. The right rail
swaps to a wizard:

- **Anchor.** The wizard auto-picks the existing entry closest to the
  polygon's centre — its params are the constants for everything you
  don't sweep.
- **Mode.** The wizard chooses **CURVE** (one varied param producing
  a 2D curve through the polygon) when one of `power, speed, frequency,
  density` can do it. Otherwise it switches to **FILL** mode (two
  varied params producing a scatter of cells inside the polygon). You
  can flip the mode and override the chips manually.
- **Cells.** A slider from 2 to 200 (default 16) controls how many
  cells the test will burn. The cells are rendered live on the chart
  as you move it.
- **Create.** Clicking CREATE TEST builds a `kind=validation` test
  with per-cell param snapshots and drops you on the tests list with
  the new test ready to generate the `.xcs`.

The math runs entirely client-side — no API round-trip per slider
tick — so the curve and cells re-render instantly.

Stage 1 limits the testable params to `power, speed, frequency,
density` and supports up to 2 simultaneous varied params. Pulse-width
and passes sweeps stay in the existing manual test-creation flow for
now.
