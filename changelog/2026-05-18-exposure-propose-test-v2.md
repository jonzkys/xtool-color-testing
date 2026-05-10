---
id: 2026-05-18-exposure-propose-test-v2
date: 2026-05-18
level: minor
title: Propose Test — all-params editor + true area fill
summary: The wizard now lets you adjust all 6 params live (rotating the curve / shifting the fill), and Fill mode actually fills the polygon evenly.
---

Two refinements to the propose-test wizard from last week:

- **Edit any param.** All six base params (power, speed, frequency,
  density, passes, pulse_width) now appear as editable sliders in the
  rail. The currently-varied param row is locked and shows the resolved
  min → max as a band; everything else is draggable. Adjusting a
  non-varied param re-runs the curve/fill live, letting you "rotate"
  the curve through a different region or shift where the fill cells
  land. A small `↺ reset` button above the section restores everything
  to the anchor's values when you've wandered too far.
- **Better fill.** Fill mode used to forward-sample a (p1, p2) param
  grid and filter to polygon-inside; if the grid didn't cover the
  polygon evenly, you'd see fewer cells than asked for. Now the
  algorithm samples N points evenly distributed in the polygon area
  itself (Poisson-disk-style) and inverse-solves the params for each
  target. Existing palette entries inside the polygon are treated as
  "known points" — new cells avoid sitting on top of them.

Smaller polish:

- The toolbar chip reads `× CANCEL` while the wizard is active.
- The hint banner above the chart is clickable once the polygon has
  3+ vertices: "✓ Click here to finish".
- The Anchor section shows how many entries are inside the polygon.
