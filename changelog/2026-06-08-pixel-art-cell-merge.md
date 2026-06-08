---
id: 2026-06-08-pixel-art-cell-merge
date: 2026-06-08
level: major
title: Pixel Art — merged shapes, not a grid of squares
summary: Contiguous same-colour cells now collapse into one clean outline per region.
---

Pixel Art used to ship every cell as its own little square — a solid
patch of one colour became thousands of abutting rectangles, so the
output read as a grid, not a shape. It now traces the boundary of each
contiguous colour region into a **single merged outline** (holes and
all), collapsing straight runs so a long edge is two points, not fifty.

A solid block that was thousands of squares becomes one shape. The result
is a smaller, faster `.xs`/`.svg`, cleaner vector geometry, and a preview
that finally matches what you meant to engrave.

Flip **Merge cells** in the layer panel (on by default), and use the new
**Fill / Shapes** preview toggle to see the outlines before you download.
