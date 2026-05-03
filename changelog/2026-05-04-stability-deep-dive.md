---
id: 2026-05-04-stability-deep-dive
date: 2026-05-04
level: major
title: Stability — twelve iterations deep
summary: Validation-comparison page grew through twelve iterations into a four-mode diagnostic tool — scatter, spatial heatmap, per-cell spectrums, and an affine-calibration simulator — with cross-view focus, retest awareness, and an axis-help layer woven through.
---

The Stability page started as a scatter chart of one validation
test's per-cell drift. After a long night of sustained iteration
it's a complete diagnostic tool with four chart modes, three
right-strip stat cards, a focused-cell drilldown, a per-result
photo modal, and explanatory help on every axis pill.

### What's new

**Four chart modes**, accessed via a top-left toggle:

- **SCATTER** — per-result dots, with optional spread connectors
  between same-cell points across runs, marginal histograms on
  both axes, per-run mean lines, and a hue-binned trend trace
  (toggleable).
- **SPATIAL** — cells laid out in their physical workpiece
  position (mirrors the burn grid), tinted by metric. Reveals
  spatial bias — lighting fall-off, lens vignette, anything that
  correlates with where on the workpiece the cell sits.
- **SPECTRUMS** — per-cell vertical mini-bars from min → max
  measured value with a mean dot. Sortable by expected hue,
  expected lightness, expected chroma, cell index, or range.
  Reads "which cells are unstable across runs" in one glance.
- **CALIBRATE** — pick a reference run, the page fits a
  closed-form Lab → Lab affine transform that maps that run
  toward expected, displays the matrix + per-channel R² + a
  before/after ΔE distribution, and offers an "apply to chart"
  toggle that re-renders the other modes with the corrected
  values previewed.

**Cross-view focus.** Hover or click a cell anywhere — top-variable
list, scatter dot, heatmap cell, spectrum bar, or stats card —
the same cell highlights in every other view. Pinned focus
survives moving the cursor; transient hover cleans up on leave.
Esc clears.

**Per-cell drilldown.** Pinning a cell surfaces a card at the top
of the right stats strip with the expected swatch, per-run
measured chips, the burn-mean (run-averaged) chip, the residual
breakdown (ΔL / Δa / Δb / Δh°), and the actual burn params used.
Click a hex value to copy.

**Per-result modal.** Each per-result card and the per-run chips
inside the focused-cell drilldown open a modal with the
result's warped photo + its full stats panel + an `OPEN ⤴` link
to the test detail page. Bridges the analytical view with the
actual photographic evidence.

**BURN-vs-CAMERA stat card.** Splits the per-run error into
"systematic burn drift" (mean of measurements vs expected) and
"camera measurement noise" (spread of measurements around their
own mean). Verdict, ratio, stacked-bar visualisation. Works only
for ≥2 runs; degrades gracefully otherwise.

**Quadrant analysis.** Add `BURN ΔE` and `CAMERA σ` as X-axis
options. With both on, the scatter becomes a per-cell quadrant
classifier: top-right cells have both problems, bottom-right are
"calibration wins" (consistent miss that a global shift would
fix), top-left are "camera victims", bottom-left are good.
Median-cross reference lines partition the chart.

**Retest awareness.** The picker rail now groups results by
`retest_index` so different photos of the same burn render under
one header and different burns are visually separate. The σ
stat caption flips from `CAMERA σ` to `RUN σ` when selected
results span multiple burns, with an inline caveat that the
variance now mixes camera and burn-to-burn drift.

**Two-tier axis help.** Hover any axis pill ~250 ms → quick
tooltip with a single-sentence explanation. Hover ~1.5 s → the
tooltip expands into a richer info card with a hand-drawn
inline-SVG schematic illustrating the metric's family. Each
axis-row label gets a `?` icon for row-level orientation. Copy
lives in `stabilityHelpCopy.ts` so phrasing tweaks don't hunt
through component files.

### What it answers

- Is my burn off, and by how much? — BURN ΔE.
- Is my photo setup the noise floor? — CAMERA σ + ratio.
- Where on the workpiece is the photo unreliable? — SPATIAL heatmap.
- Which cells are most variable across runs? — TOP VARIABLE list +
  SPECTRUMS sorted by range.
- Is the systematic shift hue-dependent? — trend trace per run.
- Would a single global colour shift help, and by how much? —
  CALIBRATE mode + before/after ΔE distribution.

### What's still on the queue

- Validated-palettes flow (mark cells as accepted, expose to SVG
  layers as the source-of-truth colour database, with cluster-
  based robust mean instead of arithmetic).
- Per-hue-region affine fit (closed-form globally hits ~0.27 R²
  on noisy data; a banded fit per ±60° hue would tighten that
  but needs careful parameter budgeting).
- Polar / colour-wheel residual visualisation as a fifth mode —
  pretty but the existing modes already cover the same questions.
