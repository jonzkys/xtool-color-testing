---
id: 2026-05-03-validation-multirow-extraction
date: 2026-05-03
level: minor
title: Multi-row validation tests now extract every row
summary: Validation tests with more than one physical row were sampling only row 1 — the warped-image overlay drew a single bounding box and the per-row strip skipped rows 2+. Re-upload affected results to recapture all rows.
---

A validation test inherits `rows: 1` from its source sweep but
actually burns `ceil(cell_count / cells_per_row)` physical rows. The
capture/inspect pipeline was reading the stored `rows` directly, so a
3-row, 18-cell test only sampled the top row; the other 12 cells went
unmatched.

The .xcs builder always derived the true row count — that's why the
burns rendered correctly — but the analysis side never got the same
number. Both consumers now share a single helper that overrides
`rows` and `x_steps` from `cells_per_row` + `validation_cells.length`.

If a multi-row validation result looks half-empty, re-upload the
photo (or hit "Recapture") and the swatches will populate from
every row.
