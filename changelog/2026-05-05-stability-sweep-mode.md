---
id: 2026-05-05-stability-sweep-mode
date: 2026-05-05
level: major
title: Stability — sweep tests join the multi-photo comparison view
summary: A VALIDATION / SWEEP toggle in the left rail unlocks the same multi-photo comparison + cross-run stats for sweep tests. The first selected run becomes the "expected" baseline; every other run is plotted as drift relative to it.
images:
  - src: 2026-05-05-stability-sweep-scatter.png
    caption: Sweep test #2 (Dupe Test) viewed in the new SWEEP mode — four uploads across three burns, scatter plotting Δhue vs expected hue with the reference run sitting on the zero line.
---

The Stability page was validation-only — the burn-vs-camera σ
breakdown, the focused-cell drilldown, the spatial heatmap and
spectrums view all assumed an authored palette of expected
colours. Sweep tests benefit from the same analysis (how
consistent is this burn across N photos? Across N retests?) but
have no expected colours to compare against.

A **VALIDATION / SWEEP** toggle now sits at the top of the left
rail. Flipping it re-fetches the test list filtered to the chosen
family. For sweep tests the page picks the first selected run as
a reference baseline — its measured Lab becomes the "expected"
that every other selected run is plotted against. The chart math
is unchanged: ΔE / Δh° / σ all measure drift from the reference.

### What works

- **Scatter, Spatial, Spectrums** — the three workhorse modes
  consume the synthesised cells like normal validation cells, so
  per-cell highlights, the focused-cell panel, and the burn-mean
  collapse all behave identically.
- **Calibrate** — fits an affine Lab→Lab transform between the
  reference run and any other selected run via the FIT FROM
  picker. Useful for "how would I correct burn #2 to match burn
  #1?" — the Apply-to-Chart toggle simulates the correction
  through the rest of the views.
- **Burn-vs-camera σ** stats apply directly: σ across photos of
  one burn isolates camera noise, σ across burns also captures
  burn-to-burn variability, exactly like for validation tests.

### What's hidden

- **Polar** — the drift wheel needs an authored expected hue, so
  it's removed from the mode pill row in sweep mode.
- **Validate** — locks burn-mean Lab into a palette entry; only
  meaningful for validation tests. Also dropped from the row.

### Picker tweaks

- Per-row summary now reads `x_steps × rows` for sweep tests
  (e.g. `200×10`) instead of the validation-only `cpr × cells`.
- The empty state and search aria-label vary by kind so screen
  readers and the EmptyState card both reflect what the rail is
  currently showing.
- Toggling the kind resets the selection to the newest test in
  that family — the previously-selected id can't carry across.
