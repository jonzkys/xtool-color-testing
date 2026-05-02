---
id: 2026-05-02-clear-palette-by-material
date: 2026-05-02
level: minor
title: Clear a material's palette in one click
summary: A new Danger zone on the Edit material modal lets you wipe every palette entry for a material without touching its tests or results.
images:
  - src: clear-palette-danger-zone.png
    caption: A live entry count + a red-ringed Clear-palette button at the bottom of the Edit material modal.
---

Palettes can drift over time as you re-burn the same material on
different machine settings. The new **Danger zone** at the bottom of
the Edit material modal lets you wipe a material's palette in one
click. A two-step confirm shows the count and the material name so
you can't fire it on the wrong row.

Tests, results, and the material itself stay where they are — the
button only deletes from `palette_entries`. Re-ingest selectively from
the existing results when you're ready.
