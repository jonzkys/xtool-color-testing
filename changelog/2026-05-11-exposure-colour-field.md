---
id: 2026-05-11-exposure-colour-field
date: 2026-05-11
level: minor
title: Exposure scatter — hex-tinted colour-field overlay
summary: A new "COLOUR FIELD" toolbar toggle paints the chart background with the local measured colour, making "colour windows" on SS visible without staring at individual dots.
images:
  - src: exposure-colour-field.png
    caption: 100×100×1mm SS — the colour window pops as a continuous warm band running diagonally through the cloud.
---

Stainless marking doesn't get monotonically darker with dose — at the
right pulse-rate / power balance it produces straws, blues, and
purples instead. The bivariate scatter has the data points to see
that, but the eye has to do the aggregation.

Toggle "▦ COLOUR FIELD" in the toolbar (bivariate only). The chart
draws a backdrop tinted by the inverse-distance-weighted blend of
the 12 nearest palette dots, fading to transparent in regions with no
data. The shape of any colour window pops out visually — a continuous
straw zone where individually a viewer would see a slightly-paler
cluster of dots.

This is a visualization, not a model: the field is just a smoothed
view of the measured `hex` values, with no extrapolation beyond
reachable param space. For materials with sparse data the field stays
mostly transparent.
