---
id: 2026-05-12-propose-test-forward-sample
date: 2026-05-12
level: major
title: Propose-test — forward-sample placement
summary: Cell placement varies every numeric param within user-set ranges plus crosshatch and passes, reliably hits the requested count, and spreads cells evenly across the polygon.
images:
  - src: 2026-05-12-propose-test-forward-sample.png
    caption: Fill mode with 100 cells across the polygon; CONSTRAINTS surfaces per-param min/max for every numeric parameter, plus a crosshatch tri-state and a passes range.
---

Fill-mode propose-test used to inverse-solve two parameters against the polygon. Newton-Raphson struggled with ill-conditioned param pairs, and the rejection-sampler exhausted its budget on tight polygons. Asking for 100 cells reliably yielded 60-80; the workaround was to inflate the request count until the actual return hit the target.

This release flips the algorithm. The new fill mode draws candidate recipes from the constraint hypercube, computes their indices, keeps those that fall inside the polygon, and farthest-point-downsamples to the requested count. Every numeric parameter now varies (within user-set min/max). Crosshatch is a tri-state (`varies` / `on` / `off`). Passes is a min/max range.

What changes:

- **Hits the requested cell count** whenever a reachable region exists. Drawing a polygon and asking for 100 or 200 cells now lands 100 or 200, not 60-80.
- **Spreads cells evenly** across the polygon via farthest-point selection rather than first-fit rejection.
- **Surfaces a partial-fill hint** below the cell-count slider when constraints are too tight (`Found N of M cells.` or `No cells reachable.`).
- **Persists per-cell recipes**: when crosshatch or passes vary across the sweep, each cell's `validation_cells.params` carries its own value so the burn matches what the algorithm chose.

The fill-mode rail is reorganised around per-param rows. Each numeric parameter gets one row with a two-thumb range slider, click-to-edit min/max labels at each end, and a `VARY` toggle on the right. Turning `VARY` off collapses the row to a single editable pinned-value label that defaults to the anchor cell. Filter-driven overrides continue to AND with the per-row sliders — the narrower bound wins.
