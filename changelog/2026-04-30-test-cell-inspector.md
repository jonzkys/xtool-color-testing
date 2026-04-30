---
id: 2026-04-30-test-cell-inspector
date: 2026-04-30
created_at: 2026-04-30T11:00:00Z
level: major
title: Test results — cell inspector with axis labels and hover params
summary: The result detail dialog now opens to a new "Inspect" view of the warped image with X / Y axis labels overlaid on the grid edges and a hover affordance that surfaces row × col, x_param + y_param values, captured swatch + hex, σ, and Lab for whichever cell is under the cursor. Click a cell to drill straight into the existing sample inspector. Built so dense tests (10×10, 20×14) with axis labels hidden become legible at a glance.
images:
  - src: test-cell-inspector.png
    caption: Hovering a mid-grid cell on a dense 20×14 sweep — tooltip carries the exact params and captured colour for that cell, while the axis labels along the edges give the lay of the land at a glance.
---

Dense tests (a 10×10 sweep, a 20×14 like the one in the screenshot)
with axis labels hidden produced a wall of swatches with no obvious
map back to params. The information was on the page — every swatch
already knew its `x_value` and `y_value` — but reading "what range
should I drill into next" required clicking each swatch in turn.

### What's new

The result-detail dialog's image hero now has a third toggle —
**Inspect** — alongside Warped and Original, and it's the default
view when the dialog opens. In Inspect mode:

- **Axis labels** ride along the edges of the grid: x-values along
  the bottom (per-physical-row for 1D-wrapped tests, single strip
  for 2D), y-values down the left side. Labels skip-stride when
  cells are too narrow to fit one per cell, but the first and last
  always render so you can read the range bounds.
- **Hover** shows a floating tooltip with `row × col`,
  `x_param = value`, `y_param = value`, the captured swatch + hex,
  σ, and Lab. The cell under the cursor is highlighted with a
  white outline so you can see exactly which cell you're reading.
- **Click** a cell to open the existing sample inspector for that
  cell — the modal that shows the warped crop and sampling iris.
  Same dialog, same code path; this just gets you there faster.
- **Touch** taps a cell to pin the tooltip in place with an
  explicit `Inspect →` button inside it for the drill-in.

### Geometry

The math agrees with the sampler exactly. A new
`GET /api/results/{rid}/grid-layout` endpoint returns the
pixel-space cell origin, cell size, row stride, and image
dimensions — pure function of the test's spec, no I/O. The
forward formula here is the same one the sampler uses to compute
each cell's sample bounds, so the highlighted cell on hover is
*the* cell that was sampled, not its neighbour. Every historical
result gets this for free; no migration, no re-ingest.

### Where to find it

`#/tests/{id}` → click any result thumbnail → dialog opens to
Inspect. The Warped / Original toggles are still there if you need
them.
