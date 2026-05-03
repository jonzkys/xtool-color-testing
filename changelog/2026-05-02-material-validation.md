---
id: 2026-05-02-material-validation
date: 2026-05-02
level: major
title: Material validation tests
summary: A new test kind that re-burns a representative subset of a material's palette and reports per-cell ΔE against the stored Lab.
images:
  - src: validation-picker.png
    caption: The Palette tab — a*/b* gamut on the left, swatch grid on the right. Auto-pick spreads N tiles across the gamut; click to toggle.
  - src: validation-kind-chooser.png
    caption: New test → choose between a parameter sweep and a palette validation.
---

Tests used to be one shape: pick a sweep axis, burn the grid, ingest
the colours that emerge. The new **Validation** kind inverts that —
given a material whose palette is already ingested, pick the swatches
you want to re-prove, burn them with their stored params, and the
result modal shows you per-cell ΔE76 against what the palette
predicted.

The flow:

- **New test → Validation.** The form's `Sweep` tab becomes a
  **Palette** tab: an a*/b* scatter plus a swatch grid. The picker
  auto-picks N farthest-point samples in 3D Lab space (deterministic,
  spreads across the full gamut) but you can swap any tile in or out
  by clicking it. N is a *seed*, not a cap — the burn uses whatever's
  selected at xcs-generation time.
- **Generate the xcs as usual.** Cells are emitted in L*-ascending
  order so the burn forms a luminance ramp; each cell uses the
  power/speed/frequency/density/passes/pulse-width that produced its
  source palette swatch.
- **Burn and upload the photo.** The existing capture pipeline runs
  unchanged. The result modal augments each swatch tile into a paired
  measured-on-top / expected-on-bottom split with a ΔE caption, and a
  summary strip above the grid shows median ΔE, max ΔE, and count
  over a configurable threshold (default 3.0 — the textbook
  "perceptible at a glance" line).

Curves, primitives, and existing sweep tests behave exactly as
before. Validation simply opens a second axis on what a `tests` row
can mean.
