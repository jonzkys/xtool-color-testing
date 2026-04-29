---
id: 2026-04-29-svg-layers-simplify-and-tracer
date: 2026-04-29
created_at: 2026-04-29T15:15:00Z
level: major
title: SVG Layers — vertex counts, polygon trace mode, Save SVG, tracer fixes
summary: The Simplify dialog's path-tolerance slider now has a number it visibly affects — vertex counts show on every layer card and in the header total, and a new Polygon output mode lets vtracer emit M/L paths the tolerance can actually collapse. Plus Save SVG, a preview clip fix, and two tracer reliability fixes that were silently shipping wrong colour on busy raster traces.
images:
  - src: svg-layers-polygon-simplify.png
    caption: Polygon-mode trace + tolerance slider — 30 shapes / 2,394 verts collapse to 23 / 693 in one pass. The faceted preview is the trade — curves become line segments, but the laser flattens them anyway.
---

A small stack of changes that mostly orbit the same problem: when
a raster trace produces noisy output, the tools to clean it up
weren't telling you whether they were doing anything.

### Vertex counts everywhere shape counts already lived

Every layer card now reads `× shapes · × verts`, the Layers
section header sums them as `(N · X shapes · Y verts)`, and the
Simplify dialog shows `before → after` for both shapes **and**
vertices. The vertex line goes accent-coloured when the number
drops, mirroring the shape count's existing treatment.

If you ever pulled the **Path simplification tolerance** slider in
the Simplify dialog and wondered whether it was doing anything —
that's because on a typical raster trace it wasn't. The dialog
deliberately skips paths with curve commands so it never wrecks a
hand-authored SVG, and vtracer's default output is all curves. The
new vertex counter makes that visible: drag the slider, the
"after" number stays put, you know to flip the new toggle below.

### Polygon trace mode

The trace panel grows an **Output style** select with two options:

- **Spline (curves preserved)** — current default. Cubic Bézier
  paths, smooth boundaries. Simplify tolerance has no effect.
- **Polygon (line segments only)** — `M`/`L` paths only. Curves
  become line segments (the trace panel's preview shows visible
  faceting); the Simplify tolerance can now collapse vertex chains.

Concrete numbers from a Pikachu raster at default knobs: spline
mode produces 6,139 vertices, polygon mode produces 2,394 — and
running the Simplify tolerance at 0.20 mm against the polygon
output drops it to **693**, with all 30 paths simplified. That's
the kind of cleanup that takes a 5,000-shape xTool Studio session
from "sluggish" to "snappy".

The default is still spline so existing flows are unchanged. Flip
to polygon when the Simplify dialog is your goal.

### Save SVG

Next to **Generate .xcs** there's a new **Save SVG** button that
downloads whatever the .xcs generator would receive — palette-
matched colours and collapse-identical-layers applied if the
matching toggles are on. Useful for archiving the asset that
produced a given burn, or for handing the rewritten SVG to
another tool.

The default for the **Collapse identical layers** toggle also
flipped to **on**: nearly every flow benefits from merging layers
that share params, and the off-default just made first-time users
generate redundant passes.

### Tracer reliability fixes

Three smaller fixes that were silently shipping wrong output:

- **Corner backdrops on complex scenes.** The per-quadrant rect
  backdrops vtracer's output uses to paper over anti-alias slivers
  could paint half a city skyline red because the bottom-right
  corner happened to sit on a red bus. We now only emit the
  half-canvas backdrops we're confident about — both endpoints of
  an edge have to agree on the colour, otherwise that edge gets
  no backdrop and slivers fall through to substrate. Worse to
  paint a small wrong region than to wash a quadrant in the wrong
  colour.
- **Subtract-overlaps now runs at trace time.** vtracer's stacked
  output has every layer extending to the canvas edges; gaps in
  the trace expose whichever layer is largest, which produced
  the "red bleed" complaint on raster traces of cityscapes. We
  now pre-bake the subtraction once after each trace so the
  shapes hand to the .xcs pipeline are already non-overlapping
  and the runtime **Subtract overlaps** toggle becomes
  effectively idempotent.
- **Preview SVG clips to its viewBox.** vtracer can emit shapes
  that extend a fraction of a pixel past the canvas; the preview
  pane's flexbox could then balloon to fit the overhang and
  squash the controls. Now clipped at the viewBox.

### Where to find it

`#/svg-layers` — the Simplify dialog, the trace panel's new
Output style select, the layer cards, and the Save SVG button.
