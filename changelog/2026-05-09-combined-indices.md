---
id: 2026-05-09-combined-indices
date: 2026-05-09
level: minor
title: Two combined indices — ablation aggression and delivery smoothness
summary: Two more axes for the exposure page that read more directly as physical regimes. Plus a rename — surface_exposure → total_exposure (canonical).
images:
  - src: combined-indices.png
    caption: The exposure page with the two new axes available in the dropdowns.
---

Every palette entry now carries two more derived indices:

- **`ablation_aggression_index`** — `total_exposure × pulse_intensity`. Reads as "how violently the surface was hit per unit area".
- **`delivery_smoothness_index`** — `total_exposure / pulse_intensity`. Reads as "how thoroughly the head blanketed the surface, regardless of how hard each pulse hit".

These aren't new physics — they're a 45° rotation of `(total_exposure, pulse_intensity)` in log-space:

- `geometric_mean(aggression, smoothness) = total_exposure`
- `aggression / smoothness = pulse_intensity²`

The motivation is interpretability. A power sweep at fixed everything-else lands as a vertical trace on `(delivery_smoothness, ablation_aggression)`, because power cancels in smoothness and adds to aggression. That's a clearer read than the same trace on `(total_exposure, pulse_intensity)`.

Existing `surface_exposure_index` is renamed to `total_exposure_index` — it was always the same number, just better named. The old name lives on as a Pydantic deprecated alias for backwards-compat.

The chip strip on every palette entry now shows 8 chips. The exploration page's X/Y dropdowns list 7 indices (the two new ones plus the renamed one), and the correlations matrix is 7×5 instead of 5×5. The exposure brush still anchors to `total_exposure_index` (rename only).

Migration `0023` does the rename + adds the two columns + backfills every row. The formula version bumps `1 → 2`.
