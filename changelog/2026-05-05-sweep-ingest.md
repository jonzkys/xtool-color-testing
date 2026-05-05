---
id: 2026-05-05-sweep-ingest
date: 2026-05-05
level: major
title: Stability — INGEST mode for sweep tests
summary: A sister to VALIDATE for sweep tests. Bucket each cell by σ across the picked runs, auto-tick the stable ones, and add them to the palette in one save.
images:
  - src: 2026-05-05-sweep-ingest.png
    caption: Sweep test #2 viewed in INGEST mode at σ ≤ 8 ΔE — 29 stable cells auto-ticked, 11 unstable cells offered with manual accept.
---

VALIDATE turns a validation test's authored expected colours into
new palette entries when the burns line up. Sweep tests don't have
authored expected colours, but the same multi-photo consensus + σ
analysis applies — and the colours that come out of a stable region
of the sweep are exactly the ones worth adding to the palette.

INGEST is that flow.

### How it works

For each cell on the grid:

1. The per-run mean of every swatch landing in that cell.
2. Cluster-robust burn-mean across runs (drop outliers > 2 × median
   distance, with a 1.5 ΔE floor — same algorithm validate uses).
3. Stability gate: max ΔE76 between any kept run's mean and the
   consensus.
4. If ≤ the σ slider, **stable**; else **unstable**; if fewer than
   two runs measured it, **skipped**.

Stable cells tick on by default. Unstable cells stay un-ticked but
visible — click ACCEPT on a row to override and save it anyway.
Skipped cells are read-only.

### What gets saved

Each accepted cell becomes a brand-new validated palette entry on
the test's material:

- `lab` is the burn-mean consensus.
- `params` projects the spec axes onto the cell's first-run swatch:
  if the test sweeps `power` along X, the entry stores
  `power: 8.4` (or whatever the cell's value was), plus `speed`,
  `frequency`, `passes`, `angle_mode`, `crosshatch` and the rest of
  `base_params`. The recipe column in the panel previews exactly
  what gets persisted.
- `validated_test_id` + `validated_cell_index` are the natural key.
  Re-running INGEST on the same test (e.g. after uploading more
  photos) **upserts** instead of duplicating — one cell, one entry,
  regardless of how many times you save.
- `validated_residual_de` carries the stability gate value, so the
  palette page can sort or filter by "how cleanly did this colour
  come out of the burn".

### Defaults

The σ slider seeds at **3 ΔE** — half the just-perceptible boundary,
which is roughly where camera noise + burn-to-burn variation in
sweep tests gets indistinguishable from real per-cell drift. Bumping
to 5–8 covers the noisier end of the dial; the count pills at the
top of the panel re-bucket live as you drag.

### Notes

- INGEST is sweep-only — validation tests already have VALIDATE,
  which gates by ΔE-vs-expected and threads through `palette_entry_id`
  for the original linked entry. The two paths share their consensus
  math (`services/validate.py:_robust_mean`) but diverge on
  bucket semantics.
- The recipe column reads from the first-run's swatch (sweep results
  agree on `(row, col) → (x_value, y_value)`), so what you see is
  what gets persisted. No second-pass through the swatches needed.
- Filtering the picker's tick set rebucketing live: pick a single
  burn to see σ-across-photos, pick all to see σ-across-burns. Same
  axis the BURN VS CAMERA stat panel splits on.
