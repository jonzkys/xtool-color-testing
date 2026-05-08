---
id: 2026-05-09-exposure-page
date: 2026-05-09
level: major
title: Exposure indices — material-scoped exploration page
summary: A new page at #/exposure for seeing how the six exposure indices relate to colours in your palette, scoped to a single material.
images:
  - src: exposure-page.png
    caption: The exposure indices exploration page on stainless. Scatter, hue ribbon, correlations matrix, and chromaticity-disc focus widget all share a focused entry across the page.
---

The phase-1 chip strip showed the exposure indices on each palette
entry. This page asks the next question: **does any of them relate
to the colours you're getting?**

Open `#/exposure` (or click *Materials → Exposure* in the top
bar). Pick a material and the page draws every palette entry on
that material into a configurable scatter. Pick any of the five
indices for the X axis, any of L\* / a\* / b\* / hue / chroma for
the Y, and the **regression overlay** + the right-rail **`r =`**
stat give you a direct answer.

Below the scatter, the **Hue Ribbon** lays out every entry's
swatch ordered by the X axis. A successful index/colour
relationship reads as a smooth gradient down the ribbon; a noisy
one looks scrambled. Beside it, the **Correlations Matrix** is a
5×5 heatmap of `|r|` for every (index, channel) pair — click any
cell to switch the scatter to that pair.

The right rail's **Focused card** holds an a\*/b\* chromaticity
disc with every entry plotted; the focused entry gets a crosshair
pinpointing its hue family. Hover any dot anywhere on the page,
and the focus propagates — scatter halo, ribbon mark, disc
crosshair, full recipe + indices readout in the right rail.

Two **bivariate** modes are available too: pick *another* index
on the Y axis, and the scatter shows you whether two indices
together separate the colour clusters better than one alone.

Bottom of the page: an **Exposure brush**. Drag the handles to
filter the page to a slice of `surface_exposure_index`. Useful
for *"only show me the high-energy burns and let me see the
matrix recompute"*.

The indices stay framed as **heuristic, not calibrated**. The
chip strip's `v1 · heuristic indices, not calibrated values`
discipline carries through; the page does not claim joules or
millimetres unless the underlying value is honest mm.

Phase 2.5 (deferred) — multi-material comparison overlay.
Phase 3 — predictive parameter selection from a target colour.
