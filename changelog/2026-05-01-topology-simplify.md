---
id: 2026-05-01-topology-simplify
date: 2026-05-01
level: major
title: Simplify shapes — adjacency-aware
summary: Path simplification now respects shared boundaries. Adjacent regions stay aligned at every tolerance the slider exposes.
images:
  - src: topology-simplify-after.png
    caption: 0.20 mm tolerance on a 1,118-shape vtracer trace. Vertex count halves (23,171 → 11,334) and the colour layers stay perfectly aligned — no slivers, no gaps.
---

The Simplify-shapes dialog used to run Douglas-Peucker on every path
independently. For a vtracer-traced raster — where adjacent colour
regions share their boundaries — that produced black slivers and
triangle wedges where each side simplified the shared edge differently.

The simplifier now builds a planar topology from every closed and open
polyline in the SVG and runs Visvalingam-Whyatt with weight propagation
across shared arcs. Shared edges are simplified once, not twice; the
result is gap-free at any tolerance the slider exposes.

Curved paths and primitives (`<rect>`, `<circle>`, `<ellipse>`,
`<line>`) are still passed through untouched. The tolerance slider now
caps at 0.5 mm without producing visible breakage on dense traces.
