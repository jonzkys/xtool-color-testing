---
id: 2026-05-30-pixel-art-robustness
date: 2026-05-30
level: minor
title: Pixel Art — stable palette + safer grids
summary: Re-quantising no longer reshuffles colours out from under your enable/match picks, big grids can't freeze the tab, and downloads disable when every colour is off.
---

Three Pixel Art papercuts, fixed:

- **The palette is stable now.** Quantisation ran from an unseeded
  random, so nudging the width or hitting re-render could reshuffle the
  detected colours — and because your enable/match choices are keyed by
  colour, they'd silently snap back to defaults. Identical settings now
  produce the identical palette every run.
- **Big grids can't freeze the tab.** "Cells across" is capped and the
  total cell count is bounded before the (main-thread) k-means runs, so
  a wide bed or a tall crop no longer hangs or crashes the page.
- **No more dead-end download.** Turning off every colour used to build
  an empty request that errored after the click; the .xcs / .svg buttons
  now disable until at least one colour is on.
