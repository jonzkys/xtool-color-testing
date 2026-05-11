---
id: 2026-05-11-exposure-colour-field
date: 2026-05-11
level: major
title: Exposure scatter — colour-window overlays
summary: Three new toolbar toggles for reading the colour topology of a material — a hex-tinted colour field, iso-L* contours, and a dot-fade for cleaner overlay viewing.
images:
  - src: exposure-overlays.png
    caption: All three overlays composed on 100×100×1mm SS — the warm "straw window" sits inside the L*60 contour, dark burn outside L*30.
  - src: exposure-colour-field.png
    caption: Colour field alone — measured hex blended over the chart.
---

Stainless marking doesn't get monotonically darker with dose — at the
right pulse-rate / power balance it produces straws, blues, and
purples instead. The bivariate scatter has the data points to show
that, but the eye has to do all the aggregation. Three new toggles
on the toolbar (bivariate-only) help the eye out.

**▦ COLOUR FIELD** paints a low-resolution backdrop behind the dots
where each pixel is the inverse-distance-weighted blend of the 12
nearest palette dots' measured hex values. Empty regions fade to
transparent so the field doesn't hallucinate colours far from data.
The "colour window" pops as a continuous coloured patch instead of
asking you to mentally connect scattered dots.

**◷ CONTOURS** runs marching squares over a kNN-interpolated grid
of L\* (lightness) values and draws iso-L\* lines — same idea as a
topo map, brightness instead of elevation. Labels at L\*30 / L\*40 /
L\*50 / L\*60 / L\*70 land at the median position of each line. Useful
for "stay above L\*60 for bright marks; below L\*30 is full black".

**◯ FADE DOTS** dims the palette dots to ~28% so the overlay viz
above reads without the dot cloud competing. Underlying interactions
(hover, click) still work — the dots just visually recede.

Implementation notes worth a heads-up:

- All three are pure visualization layers on data that's already on
  the chart. No new model, no extrapolation beyond reachable
  parameter space — empty regions render nothing.
- Today the contours track L\* only. The component is value-agnostic
  so swapping in chroma / hue / a\* / b\* is a one-line parent-side
  change. We'll add a channel picker when there's a clear ask.
- A per-material colour-window *classifier* (a predictor, not just a
  view) is on the deferred-projects pile — these overlays cover the
  "let me see what's there" use case without committing to a model.
