---
id: 2026-05-12-laser-indices-v4-crosshatch
date: 2026-05-12
level: major
title: Laser indices v4 — crosshatch counts as 2× passes
summary: TEi, AAi, and DSi now double for crosshatched cells so they reflect actual delivered energy. The propose-test wizard gains a Burn Settings section.
---

The exposure indices formula has been bumped from v3 to v4 to be
physically honest about crosshatch. When a test was burned with the
`crosshatch` flag on, XCS adds a perpendicular companion stroke per
pass — every cell receives 2× the strokes of energy. v3 ignored this:
the three pass-dependent indices (total_exposure_index,
ablation_aggression_index, delivery_smoothness_index) were stored at
half their actual value for every crosshatched palette entry. Two
identical cells — one crosshatched, one not — sat on top of each other
on the exposure scatter even though they delivered double the energy
on one side. v4 fixes this.

What's new:

- **`compute_indices(..., crosshatch=True)`** multiplies repeat by 2
  before applying it to TEi, AAi, DSi. Per-pulse indices (PSm, LSm,
  PEi, PIi) are unchanged because crosshatch doesn't alter pulse
  layout or per-pulse energy.
- **Every stored palette entry has been recomputed.** Running
  `xcs-gen recompute-indices --force` after the deploy flushes the
  whole palette to v4. Crosshatched entries move along the TEi/AAi/DSi
  axes to where they always should have been.
- **Propose-test wizard — Burn Settings.** The rail gains a new
  section below PARAMS with scan_angle, crosshatch, angle_mode, and
  unidirectional controls. Defaults are inherited from the anchor
  entry's source test, so the wizard "remembers" the regime that
  produced the anchor's colour. Toggle crosshatch on and the predicted
  cells re-render correctly along the doubled axes.
- **Reset button now covers both.** The existing `↺ reset` clears
  param overrides AND burn-setting overrides — back to the anchor's
  full regime in one click.

What hasn't changed:

- Palette entries' stored `params_json` (passes value is the raw
  setting, not doubled).
- The renderer / converter (already handled crosshatch correctly via
  stroke duplication; this change is just about what we _store_ as
  indices).
- Cross-test comparisons of per-pulse intensity / energy. Those
  indices don't care about crosshatch.

If the exposure scatter looks like it shifted, that's intentional —
the chart is now telling the truth about delivered energy for the
crosshatched parts of your palette.
