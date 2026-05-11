---
id: 2026-05-11-exposure-scatter-zoom
date: 2026-05-11
level: minor
title: Exposure scatter — zoom, pan, and box-crop
summary: Wheel zooms toward the cursor, ⌘-drag crops to a rectangle, ⇧-drag pans. A RESET ZOOM chip appears top-right when the view is overridden.
---

The exposure-page scatter is now interactive — the auto-fit bounds
that's worked for the overview also makes it impossible to peek
inside a dense cluster without filtering rows away. v5 indices made
that worse on freq sweeps, which now span 10× on TEi.

What works:

- **Wheel** to zoom in or out, anchored at the cursor. Hold the wheel
  while reading a cluster and the chart magnifies around the spot you
  care about.
- **⌘ (or Ctrl) + drag** to draw a marquee — the chart zooms into that
  rectangle on mouse-up. Useful for "show me only the validated cells
  in the bright corner" without touching the filter panel.
- **⇧ + drag** to pan within the current zoom level.
- **RESET ZOOM** chip top-right of the chart returns to auto-fit.
  Switching axis, mode, or scale also resets — the saved bounds live
  in scale-space and aren't meaningful against a new view.

Left-click without a modifier still does what it always did (hover
dots, add polygon vertices in propose-test mode), so none of the
existing wizard interactions change.
