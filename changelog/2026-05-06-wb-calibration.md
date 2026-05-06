---
id: 2026-05-06-wb-calibration
date: 2026-05-06
level: major
title: WB calibration — calibrated palettes across lighting
summary: Embed a calibration strip in every test plate and a small ceremony that locks in the canonical RGBs, so palette colours stay stable across lighting and camera-WB drift.
images:
  - src: wb-calibration-hero.png
    caption: Calibration panel inside the material editor — clean-pass recipe + light/mid/dark patches with measured canonical RGBs.
---

A new field on each material — **calibration** — captures three small
reference burns plus a clean pass that standardises the substrate
underneath. Burned into every test plate's registration frame, the
strip lets the ingest pipeline measure your camera and lighting on
every shot and apply a per-channel correction *before* sampling the
colour grid.

Open a material in the library, expand the new **Calibration**
section, prefill three stainless-steel patches with one click, then
hit **Calibrate**. The wizard walks through it: emit a one-time
calibration plate as `.xcs`, burn it on your machine, photograph it
under good lighting, eyeball each measured colour into the form, and
save. From then on, every test plate carries the strip automatically
and ingest applies the right correction without you thinking about it.

Three correction modes show up in the result-detail dialog:

- **ANCHORED** (green) — strip detected and the material has canonical
  RGBs recorded; per-channel linear or 3-anchor gamma correction was
  applied. White balance and exposure both fixed.
- **CHROMA** (yellow) — no strip or canonical, but markers were
  detected; per-channel chromaticity ratio neutralised against a
  silver-anodised canonical (`(1.0, 1.0, 0.91)` after R/G normalised).
  White balance only.
- **RAW · NO WB** (red) — neither anchors nor markers were usable;
  result kept as-is.
- **WB DISABLED** (grey) — toggle off (default-on for now; UI toggle
  is a follow-up).

Old results stay unchanged. The result-detail dialog now has a
**Re-ingest with WB** button that re-runs the correction on the
existing warped image without re-shooting.

Substrate support is configurable per material. Stainless steel ships
with sane defaults; the clean-pass and calibration burn parameters
(power, speed, frequency, density, passes, pulse-width) are fully
editable for any other substrate you set up. Disable
**White-balance correction supported** for materials that don't
tolerate the clean pass and the strip won't be emitted.
