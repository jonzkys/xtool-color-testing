---
id: 2026-06-13-spiral-svg
date: 2026-06-13
level: major
title: Spiral Cut — SVG in and out
summary: Import an .svg straight into Spiral Cut and export the cut as .svg, .xs, or .xcs.
images:
  - src: spiral-svg.png
    caption: An imported SVG (Pikachu) spiraled — each shape gets its own concentric venting channel.
---

Spiral Cut now speaks **SVG**, both directions.

**Import.** Drop an `.svg` onto the Spiral page and it becomes a cut. The file is
converted to a vector-cutting project (reusing the same SVG engine behind the
SVG Layers and Loom pages), and its **largest shape is auto-selected** as the
spiral target — every other shape stays in the list so you can switch. From
there it's the normal Spiral workflow: tune the channel, watch the estimate,
export.

**Export.** Any source — `.xcs`, `.xs`, or `.svg` — can now be exported to any of
the three. Pick `.xs`/`.xcs` to run the spiral on the machine, or `.svg` to pull
the cut paths into another tool. The output toggle gained a third option.

Because an imported SVG is converted to a real project, it round-trips like any
other file — so an SVG you bring in can still be exported as a machine-ready
`.xs`.
