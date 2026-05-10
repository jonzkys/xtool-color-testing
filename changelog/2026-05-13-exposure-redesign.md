---
id: 2026-05-13-exposure-redesign
date: 2026-05-13
level: major
title: Exposure — workbench redesign
summary: Toolbar replaces left rail; filters open on demand; neighbours panel becomes a swatch strip with a full-recipe detail card.
---

The exposure page has been rebuilt around the chart. The biggest
visible changes:

- **Top toolbar.** Material picker, mode toggle, X/Y axis pickers, and
  a Filters button all live in a single 40 px row above the chart.
  The left rail is gone.
- **Click an axis label to change it.** The chart's own X / Y labels
  are now click-to-edit; the same popover opens from the toolbar pills.
  Chart updates live as you click options.
- **Filters are on-demand.** A Filters button toggles a 240 px panel
  that slides in between the chart and right rail. Closed by default
  so the chart gets full width on first load.
- **Per-row filters on the focused recipe.** Each param row in the
  focused entry's recipe (Power · 14.6%) has a small filter glyph;
  click to instantly filter the chart to that exact value. Click
  again to clear.
- **Neighbours panel rebuilt.** Six swatch tiles (focused + 5 nearest
  neighbours) on top, with a full detail card below showing the
  selected tile's recipe with +/- deltas vs focused, plus
  Jump-to / Filter-from action buttons. The cramped 5-row
  truncated list is gone.

The right rail consolidates to a single column: Stats, Focused,
Neighbours, Indices. The hue ribbon, correlations matrix, and range
brush stay below the chart unchanged.

If you previously found things in the left rail — material, axis
pickers, sources/validated checkboxes — they all live in the toolbar
or the on-demand filter panel now.
