---
id: 2026-04-26-sample-aggregator
date: 2026-04-26
created_at: 2026-04-26T22:00:00Z
level: major
title: Pick how each cell's colour is sampled
summary: Five aggregators (median, mean, saturation-biased, trimmed mean, K-Means dominant) plus a per-cell inspector that shows the sampling region and compares all five side-by-side.
---

The capture pipeline used to sample every cell with a single fixed
algorithm — the median of the most-saturated half of the cell's
central 60%. That works well for MOPA gradient strips where a thin
colour band lives inside a mostly-substrate cell. It works less well
for circle parameter sweeps, where the captured swatches end up
several L* units below what the eye averages over the whole cell.

**Pick your aggregator on the test.** A new dropdown on the test edit
page lets you choose how cells get distilled into a single colour:

- **Median** — straight per-channel median. Robust, predictable.
- **Mean** — straight per-channel mean. Closest to "what the eye averages".
- **Saturation-biased median** — the previous default. Kept for MOPA
  strips and similar gradient burns.
- **Trimmed mean (10%)** — drop the 10% darkest and 10% lightest
  pixels by luminance, mean the rest. Robust to glare and dust.
- **K-Means dominant cluster** — find the most-populated colour blob.
  Useful for variegated burns where the cell has multiple oxidation
  layers.

Defaults are picked for you: **median** for new circle tests,
**saturation-biased median** for new rect/MOPA tests. Existing tests
keep their old behaviour until you opt in.

**Compare aggregators on a single cell.** Click any swatch tile in
the result-detail dialog to open the new inspect modal. It shows the
cell crop on the left, the same crop with the sampling region drawn
as a precision iris overlay on the right, and a five-position
comparison tray below — each tile a chip in the colour analysis tray,
labelled with its hex and the ΔL* difference from the currently-active
aggregator. Click any tile to switch the underlying preview.

**Live preview without commitment.** Above the swatch grid, an
aggregator dropdown re-renders the swatches as you change it (no
database write). When you find the one you want, hit *Save as test
default* — the test spec updates and the result reingests with the
new method.

The geometric sampling region also changed for circle cells: where it
used to be a 60% rectangle whose corners brush against the burn edge,
it's now a 50% inscribed circle — strictly inside the burn area, no
substrate halo.
