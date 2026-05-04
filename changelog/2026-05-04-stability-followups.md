---
id: 2026-05-04-stability-followups
date: 2026-05-04
level: major
title: Stability — follow-ups (PC1, robust burn-mean, validated palettes, polar)
summary: Four iterations on top of the deep-dive — a PALETTE DRIFT card surfacing the dominant residual axis, a cluster-based robust burn-mean that drops outlier runs, a "validated" badge on SVG-layer cards whose auto-matched colour passed a validation test, and a polar drift-arrow chart mode.
---

The Stability page kept compounding. Four follow-ups landed in
a single afternoon, two on the analytical layer and two on
workflow integration.

### Palette drift · PC1

A new card on the right strip captures the dominant direction
of palette error. Per-cell ΔLab residuals (averaged across
selected runs) feed `pca1`; the dominant eigenvector and its
variance ratio fall out. Card surfaces:

- **Direction** — short hint ("warmer + brighter", "bluer", …).
- **Mean Δ** — magnitude of the centroid in Lab units.
- **Variance** — % captured by PC1, plus a 100 % bar that
  splits primary tint vs ink-subtle on the explained / residual
  variance.
- **Verdict** — `SINGLE SHIFT FITS` ≥ 60 %, `MOSTLY ALIGNED` ≥
  40 %, `DIFFUSE` otherwise. Quick read on whether one global
  Lab translation could realign the palette.
- **Signed ΔL / Δa / Δb breakdown** so the reader maps the hint
  back to channel deltas.

Sign of the axis is flipped to point the same way the centroid
does — without that, the verbal hint flipped run-to-run because
PCA itself doesn't fix axis sign.

### Cluster-based robust burn-mean

Replaced the arithmetic burn-mean with a cluster-aware estimator
across `burnDeltaE` / `burnDeltaHue` / `cellResidual` / palette
PC1. The algorithm is small but well-behaved:

1. Take the simple centroid of the N finite measurements.
2. ΔE76-distance each input from the centroid.
3. Threshold = `max(2 × median distance, 1.5)` — the floor
   catches tight-cluster cases where every run sits ≤ 0.7 ΔE
   from the centroid (without it, sub-noise jitter would
   trigger exclusion).
4. Drop runs above the threshold; if < 2 would remain, abandon
   and keep the simple mean.
5. Recompute the centroid from the inliers.

`N < 3` short-circuits to the simple mean — exclusion math is
under-supported below that. Camera-σ intentionally still uses
the non-robust mean: it's measuring spread, so trimming the
outliers would conceal the very thing it's trying to surface.

The focused-cell panel now badges excluded runs: each excluded
chip fades to 65 % opacity, gets a tiny amber `OUT` badge, and
the tooltip explains the exclusion reason.

### Validated palettes on SVG layers

A palette entry is **validated** when at least one validation
result photo of a test that targets it (via
`validation_cells.palette_entry_id`) measures the cell within
ΔE76 ≤ 5 of expected — the just-perceptible boundary.

The SVG Layers tab now surfaces this as a green corner badge on
each layer card whose auto-matched palette entry is in that set,
plus a green-tinted card border. While wiring up an SVG you can
spot at a glance which colours are known to print correctly
versus the ones that are still unproven.

Backend exposes the join over a new
`GET /api/palette/validation-status?material_id=…` endpoint,
covered by five pytest cases (within / above threshold,
no-validation case, machine-id filter, max_de knob).

### POLAR mode — drift arrows on a CIE Lab a×b wheel

A new chart mode shows each cell at its expected (hue, chroma)
on a polar map, with an arrow stretching to where it actually
landed. Direction tells you which way the burn pulled the
colour; length tells you how far. One frame, the question
"is the whole palette rotating one way, or smearing
everywhere?" — the kind of question SCATTER answers one axis
at a time.

Highlights:

- Faint LCH-tinted wheel underneath (36 hue × 5 chroma wedges,
  L = 60) so the region under each arrow is tinted with the
  colour the palette is targeting.
- Auto-scaled chroma rings + ±a / ±b axis labels.
- Arrow colour is bucketed by ΔE76 (≤ 2 imperceptible / ≤ 5
  noticeable / ≤ 10 clearly off / > 10 wrong) so the eye picks
  "is this an OK drift or a problem one" without reading
  numbers.
- Single-point cells (where measured ≈ expected) collapse to a
  dot pair instead of a stub arrow, so noise doesn't fill the
  centre with hairs.
- Multi-run selections feed through the cluster-robust
  burn-mean — outlier runs don't smear the arrow.

Wired into the existing focus state: hover/click an arrow pins
the cell across all views; the focused-cell panel on the right
keeps showing the cell's full readout.

### Notes

- Validation tests created before `palette_entry_id` was wired
  into the picker carry NULL there, so they don't contribute to
  the validated set. New tests created via the validation
  picker populate it correctly.
- Multi-test overlay aligned by `palette_entry_id` and a
  per-hue-region affine calibration are the next natural
  follow-ups.
