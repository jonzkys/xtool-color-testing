---
id: 2026-05-12-exposure-rail-filters
date: 2026-05-12
level: major
title: Exposure — advanced filters + doubled right rail
summary: Per-param range filters, a test/lineage/kind picker, and an active-filter pill bar that always shows what's restricting the chart.
---

The exposure page used to mix interpretation controls (axis pickers,
mode toggle) with a thin set of filter checkboxes bolted onto the
left rail. There was no way to restrict the chart to a comparable
subset — no per-test filter, no parameter-range filter, no kind
filter — and the existing source-checkbox toggle was buggy
(toggling a source after the initial fetch left the page lying
about what it was showing).

This release rebuilds the right rail and the filter system from
scratch:

- **Doubled right rail with two columns.** Stats, focused entry,
  neighbours, and the seven derived indices live on the left; a
  full filter panel lives on the right. Stacks single-column on
  narrower viewports.
- **Per-parameter range sliders.** Six dual-handle sliders for
  power, speed, frequency, pulse-width, density, and passes. Click
  a label to type a precise number; auto-detected log scale for
  high-ratio params like density.
- **Test / lineage / kind filter.** Pick a specific test, optionally
  extend the set with `+ source test` or `+ parent test` (single-
  step, not transitive), or filter to sweep-only / validation-only
  tests across the corpus.
- **Active-filter pill bar above the chart.** Every active filter
  shows up as a removable pill with the live entry count. Clear all
  resets everything.
- **URL-shareable filters.** Filter state round-trips through the
  hash, so you can paste `#/exposure/1?test=42&p=10..40` to a
  colleague and they'll see exactly what you saw.
- **The source-checkbox bug is fixed.** Filtering moved to a single
  pure derivation, so toggling source/validated checkboxes
  immediately updates the chart.

`trim outliers` moves into the filter panel; the Sources block in
the left rail is gone.

Tag-based filtering and `derived_from_entry_id` lineage in the
focused card are out of scope here — both are cheap follow-ups now
that the data already exists from the previous release.
