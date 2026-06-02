---
id: 2026-06-02-relief-tone-stretch
date: 2026-06-02
level: minor
title: Relief — tone stretch
summary: Spread a cramped depth map across the full engraving palette — linear, gamma, asinh, equalize, or CLAHE — applied after smoothing, previewed live.
images:
  - src: relief-tone-stretch.png
    caption: A depth map bunched in the midtones, stretched to fill 0–255 — the transfer curve overlays the histogram.
---

Depth maps often arrive with their values squeezed into a narrow band — the
relief then carves shallow and flat, and where the band starts above zero the
machine wastes passes cutting air before it reaches real geometry.

The Relief page now has an experimental **Stretch** section. Pick a mode and
the tones remap to fill the engraver's 256-level palette, live in the preview:

- **Linear** — pull the black/white points to 0–255, preserving relative depth
  (the wasted-descent fix).
- **Gamma / Asinh** — bend the midtones to reveal compressed detail.
- **Equalize / CLAHE** — even out the histogram globally, or per tile.

Monotonic modes run instantly in the browser; CLAHE runs on the server. The
inspect histogram draws the active tone curve so you can see the mapping, and
the export applies the exact same curve — preview is what you carve.
