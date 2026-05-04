---
id: 2026-05-03-stability-validation-compare
date: 2026-05-03
level: major
title: Stability — compare validation results against the expected base
summary: New top-level page that pairs a validation test's expected colours with one or more uploaded results so you can spot consistent shifts (a hue rotation, a brightness offset) and decide whether your engraving needs a global correction.
images:
  - src: stability-validation-compare.png
    caption: Stability page — base test on the left, scatter of cell deltas in the centre, per-result stats on the right.
---

A validation test gives you an expected target colour per cell. Each
result of that test is one photograph of an engraving and carries
the *measured* colours per cell. If your lighting is consistent and
your burn settings stable, deltas across the run should also be
consistent — a uniform hue rotation, a steady brightness shift —
and the whole palette can be corrected with a single shift. The new
**Stability** page is the place to find that shift.

### What you can do

- **Pick a base validation test** in the left rail. The picker shows
  every validation test you've created on the active machine; search
  by name or filter by material.
- **Tick one or more results** of that test. Each result becomes a
  coloured series in the centre scatter.
- **Pick X and Y axes** with the pill rows above the chart:
  - X: expected hue · expected L\*/a\*/b\*/chroma · cell index
  - Y: ΔH° · ΔE76 · ΔL/Δa/Δb · measured H\*/L\*/a\*/b\*/chroma · per-cell σ across selected runs
- **Read the stat strip** on the right — per-result mean Δ vector,
  median + max ΔE, hue rotation. When two or more results are
  selected, an "across runs" card surfaces the most variable cells
  so you can spot which colours you can't yet reproduce reliably.

The default view is **expected hue × Δhue** — the "did my whole
palette rotate?" answer in one chart. Switch the Y axis to ΔE for a
straight error map, or to per-cell σ when comparing multiple
runs to see where the burn is reliable vs. where lighting / angle
matter most.

### Use it for

- A single result with **varying lighting angles** — upload the same
  engraving photographed three times and the σ-across-runs card
  tells you which cells the camera is unreliable on.
- **Two engravings at the same settings** — compare reproducibility
  of the burn itself, separate from the camera.
- A revalidation **after changing material or machine settings** —
  pick the old test as base, the new result on top, see whether the
  shift is uniform (a calibration tweak) or per-cell (a colour
  drifting independently).

The page works without any backend changes; everything composes from
the existing `/api/tests` and `/api/tests/{tid}/results` endpoints.

### Things still to come

PC1 of the residual vector (the principal direction of error across
the palette), the spatial-position heatmap, and overlay across
multiple validation tests aligned by `palette_entry_id` are all
natural follow-ups once the v1 lands.
