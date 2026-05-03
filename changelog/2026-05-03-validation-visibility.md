---
id: 2026-05-03-validation-visibility
date: 2026-05-03
level: minor
title: Validation tests are easier to read at a glance
summary: The preview now paints each cell in its picked palette colour, the picker has a "Picked only" toggle, and the engraved header names the validation test instead of carrying a meaningless sweep summary.
---

Three small changes that make a validation test feel like a complete
workpiece preview rather than a translation problem.

- **Preview paints cells in the palette colour.** For
  `kind=validation`, every cell rect (or circle) on the right-side
  preview now fills with the picked entry's `expected_hex` instead of
  the default substrate amber. You can tell at a glance whether
  you've covered the spectrum, and whether a particular swap reads
  the way you expect against the others.
- **"Picked only" toggle on the Palette tab.** A new pill in the
  picker header filters the swatch grid down to entries you've
  actually selected. Useful for sanity-checking a finished selection
  without scrolling through hundreds of palette tiles. The
  `a*/b*` scatter keeps showing the full gamut so you don't lose
  spatial context.
- **Engraved header names the validation test.** The summary text
  burned above the cells used to be the source sweep's params
  (`power 0-17 S1000 F200kHz 1x` etc.), which is meaningless once
  every cell carries its own overlay. It now reads
  `Validation #N · M cells` instead — one line, faithful to what's
  actually being burned.
