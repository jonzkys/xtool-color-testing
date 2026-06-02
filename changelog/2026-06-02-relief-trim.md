---
id: 2026-06-02-relief-trim
date: 2026-06-02
level: minor
title: Relief — optional smoothing, range trim, background cut-out
summary: Toggle smoothing off to use just the histogram tools; drop unused bottom-of-range layers; and make a black background transparent so it isn't engraved.
images:
  - src: relief-trim.png
    caption: A depth map with its black background cut to transparency — the cut-out reads against the checkerboard.
---

Three Relief refinements that pair with the tone stretch:

- **Smoothing is now optional** — flip it off to drive the histogram / stretch
  tools on the raw heightfield.
- **Remove empty layers** — drop the unused bottom of the value range (offsets
  the lowest value to 0) without changing contrast, so the machine stops
  cutting air before it reaches real geometry.
- **Background → transparency** — depth maps often ship with a black surround.
  Mask it out by threshold and it becomes transparent: shown against a
  checkerboard in the preview, excluded from the stretch histogram, and skipped
  by the engraver. The exported PNG carries the alpha.
