---
id: 2026-05-07-wb-flatfield
date: 2026-05-07
level: minor
title: WB flat-field — automatic colour correction at ingest
summary: Burns a thin clean-pass strip around every test plate; ingest samples it to neutralise camera-WB drift and uneven lighting.
images:
  - src: wb-flatfield-hero.png
    caption: Calibration panel in the material editor + the FLATFIELD badge on a result.
---

A new "Calibration" section in the material editor lets you pin a
**clean-pass recipe** per material. From then on, every test plate
emitted for that material burns a thin clean-passed strip around its
perimeter.

At ingest the pipeline samples the strip in 4 edge regions, builds
a bilinear flat-field across the colour grid, and applies a per-cell
gain *before* sampling each cell. That neutralises both colour cast
(camera auto-WB drift, lighting temperature) and spatial brightness
variance (specular gradients, flash falloff) — the dominant noise
source on reflective substrates like stainless.

Three correction modes show up on the result-detail dialog:

- **FLATFIELD** (green) — strip detected on all 4 sides, full
  flat-field gain applied.
- **CHROMA** (yellow) — fewer than 3 strips usable but markers were
  detected; per-channel ratio neutralisation against unburned
  material.
- **RAW · NO WB** (red) — neither anchors nor markers usable.
- **WB DISABLED** (grey) — toggled off for that material.

A new toggle on the stability page lets you A/B-compare with vs
without the correction so you can see whether your setup is
benefiting. Per-result "Re-ingest with WB" applies the latest
settings to a stored warped image without re-shooting.

Substrates can opt out via a per-material `wb_supported` flag —
default on; intended only for substrates that don't tolerate a
clean pass.
