---
id: 2026-09-08-svg-layers-trace-resolution
date: 2026-09-08
level: minor
title: SVG Layers — max colours now means max colours, and big rasters trace at a sane size
summary: Asking for six colours could hand you four hundred and forty-four layers. vtracer averages the pixels inside each region it traces, so regions straddling a palette boundary came back as colours the quantised image never held — one new layer each. Fills are now snapped back onto the palette you asked for, so six means six. Rasters also trace at 1200 px on the longest edge by default rather than at whatever a phone or a screenshot happened to produce; the panel says what it traced and offers full resolution in one click. Filter speckle scales with the downscale, because it measures area in pixels — leaving it fixed is what turns fine detail to mush when an image shrinks.
---
