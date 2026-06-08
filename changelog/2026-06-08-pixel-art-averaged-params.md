---
id: 2026-06-08-pixel-art-averaged-params
date: 2026-06-08
level: minor
title: Pixel Art no longer 422s on averaged palette colours
summary: Layers matched to an averaged palette entry carried fractional speed/frequency, which the converter rejected; those params are now rounded to whole numbers.
---

A Pixel Art layer matched to a palette entry built by averaging across runs
inherited that entry's fractional mean parameters (e.g. speed 1373.99,
frequency 249.64). Speed, frequency, density, passes and pulse width are
whole-number fields, so the converter rejected the request with a 422. Those
fields are now rounded to integers when a palette entry is materialised into a
layer's burn settings; power and scan angle, which are genuinely fractional,
are untouched.
