---
id: 2026-05-11-exposure-filter-stack
date: 2026-05-11
level: major
title: Exposure — three-column layout, Filter Stack, clause filters, persistent MRU
summary: The Exposure page is a filter-driven exploration tool now, with filters on the left, the chart in the middle, and recipe + data on the right. Each filterable parameter supports multiple clauses (=, ≠, <, ≤, >, ≥, range), and recent values you've used are remembered per (machine, material, parameter).
images:
  - src: 2026-05-11-exposure-filter-stack.png
    caption: Filter Stack on the left, scatter in the middle, recipe + indices + stats + correlations + overlays on the right.
---

The Exposure page lived inside one main column for too long. Filters
were buried in a rail tab; you had to click into them to set a value
and then back out to look at the chart. A pure-range filter model
forbade "power = 14.6 OR power = 50" — the moment you wanted two
values you had to widen the range and pull in everything in between.
And there was no memory: every visit started blank, even when you
burn at the same five powers every test.

This release rewires the page around filtering.

**Three columns.** Left rail = Filter Stack. Middle = scatter. Right
rail = Focus + Recipe + Indices + Neighbours + Stats + Correlations +
Overlays. Both rails are capped to viewport height; the rail tabs are
gone — everything is one scrolling column per side, with collapsible
sections.

**Filter Stack.** Each filterable param (power, speed, frequency,
pulse_width, density, passes, scan_angle) has its own section.
Inside each section: chips for the active clauses, a recent-values
strip (last 5, MRU-ordered), an inline `+ add value` editor with an
operator picker.

**Clause filter model.** Filters are now lists of clauses per param:

| Op | Glyph |
|---|---|
| equals | `=` |
| not equals | `≠` |
| less than | `<` |
| less than or equal | `≤` |
| greater than | `>` |
| greater than or equal | `≥` |
| range | `lo–hi` |

Same-param clauses are OR'd together (`power = 14.6 OR power < 20`).
`≠` clauses are AND'd as excludes (`power ≠ 50` always strips that
value). Different params are AND'd. Float equality has a small
tolerance so `14.6` survives JSON round-trips.

**MRU per (machine, material, parameter).** Recent values are
remembered in localStorage, scoped to the active machine and
material. Top 5 per param, MRU-ordered. Click a chip in the recent
strip to add it as an `= value` clause; adding a clause via the
inline editor also bumps the MRU.

**Recipe apply-filter buttons.** When you focus a dot, the right
rail's Recipe section now shows a small funnel-with-plus icon next
to each numeric param. Click it to add `param = currentValue` as a
clause; click again (the icon fills) to remove it. The seven numeric
params get the button; the three boolean / enum burn settings
(crosshatch, unidirectional, angle mode) use the left-rail tri-state
pills instead.

**Filter pills under the toolbar.** Each active clause renders as
its own pill so the entire active filter is legible at a glance.
Click the × on any pill to remove just that clause; "Clear all"
nukes the lot.

**Other smaller things in the same pass:**

- The focus crosshair (dashed L-lines through the focused dot) is
  gone — it was clutter, and dropping it lets the Recipe stay on the
  first scroll position of the right rail.
- The brushRange filter is gone (the slider was removed earlier;
  this cleans up the dead state).
- Old rail tabs / FilterPanel / RangeSlider / HueRibbon /
  RangeBrush components are deleted along with their tests.

What you need to do: just pull. Existing URLs with the old
`p=10..40` filter syntax won't decode — they'll fall back to an
unfiltered view. New URLs use `p=eq:14.6,lt:20` style — readable
and round-trip stable.
