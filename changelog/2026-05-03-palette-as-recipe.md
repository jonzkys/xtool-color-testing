---
id: 2026-05-03-palette-as-recipe
date: 2026-05-03
level: minor
title: Palette entries are now full recipe cards
summary: Every palette entry carries its own angle_mode + crosshatch, so a validation test reproduces a colour exactly the way it was burned. The Base params tab disappears for validation tests; legacy entries are backfilled by the 0017 migration.
---

A palette entry is meant to answer a single question: "to reproduce
this colour on this material, burn it like *this*." Until now it
held the burn parameters (power, speed, frequency, density, …) but
not the *angle behaviour* — `angle_mode` and `crosshatch`. A "fixed
×2" colour is a different colour to a "crosshatch ×2" colour
(twice the strokes, alternating orientations); without those fields
on the entry, validation tests had to fall back to whatever the
test-level dropdown was set to.

This release closes that loop end to end:

- **Ingest** persists `angle_mode` + `crosshatch` into every new
  palette entry (PR #38 added this; this release wires it through
  the rest of the pipeline).
- **Validation cells** carry those fields straight through to the
  renderer, which now applies them per cell. Mixing entries with
  different angle settings in one validation test now burns each
  cell faithfully.
- **The validation test editor** drops its **Base params** tab —
  every cell shadows it anyway — so the editor surfaces only the
  things that actually drive the burn (Test, Palette, Registration).
- **Migration 0017** walks every existing palette entry and backfills
  the two fields from its source test's spec. Manual entries
  (`test_id IS NULL`) are left alone.

If you have validation results that look "almost but not quite right",
recapture them after the migration runs — the renderer will now use
each cell's true angle settings instead of the test-level fallback.

Drive-by fixes for the inspect overlay on validation tests:

- The x-axis labels stopped honouring the source-sweep linspace
  (which doesn't apply when each cell carries its own params) — they
  now skip the per-cell tick labels for validation tests, leaving
  only the row indices.
- Closing the Inspect modal correctly resumes hover on other cells.
  Previously the click-to-open also pinned a sticky cell, and
  closing the modal left it pinned, blocking hover.
