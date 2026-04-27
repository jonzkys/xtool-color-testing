---
id: 2026-04-27-svg-layers-palette-redesign
date: 2026-04-27
created_at: 2026-04-27T17:30:00Z
level: major
title: SVG Layers — palette-first layer cards, export-colour toggle, sharper trace
summary: The SVG Layers page is now driven by palette matching instead of per-layer presets. Each layer renders as a card showing detected colour over matched palette colour with both hex codes; one toggle decides whether the .xcs ships with original or matched colours. Plus a stack of trace-pipeline fixes — output is clipped to the source image, vtracer corner gaps are backfilled, sweep min/max snaps to the active param's range.
images:
  - src: svg-layers-palette-redesign.png
    caption: A traced image's layers show as a 2-col grid of cards — top half is the detected colour, bottom half is the matched palette colour, hex codes underneath. The ORIGINAL / MATCHED toggle in the top-right decides which colour set the .xcs export carries. Both Design and Expected burn previews stay side-by-side.
---

The SVG Layers page used to assume every layer wanted its own
material preset. With Auto-match in place — pick a project material,
hit one button, get a palette colour for every detected layer —
that workflow is no longer the primary one. The page has been
rebuilt around the palette-match flow, plus a series of trace
pipeline fixes that surfaced along the way.

### Layer cards

The flat row list (swatch + name + checkbox) is now a 2-col grid
of cards. Each card is split: top half is the **detected** colour,
bottom half is the **matched palette** colour, both hex codes
labelled underneath. Layers without a palette match show a `NO
MATCH` placeholder and the matched-hex column reads `—`. Reading
"what does this layer match to" is now a glance, not a click.

### One toggle, two modes

A new `ORIGINAL / MATCHED` toggle sits next to **Generate .xcs**.
When `MATCHED` is selected at export time, every shape's fill in
the SVG and every `LayerSpec.color` is rewritten through the
palette-match map before the .xcs is built. Two detected colours
that map to the same palette hex collapse into one engrave layer.
The Design + Expected burn preview pair stays side-by-side — the
toggle only affects the file you download.

### Per-layer Material/Preset picker is gone

Each layer used to carry its own material + preset selection inside
the editor. With params now sourced from the palette match, that
duplicated state. Removed. The base-params section opens with a
one-line hint pointing back at the palette section above.

### Sort the layer list

A small `Sort` dropdown above the layer cards. Options:
**As detected** (top → bottom z-order), **Hue**, **Luminance ·
light → dark**, **Luminance · dark → light**. Pure UI sort — does
not change z-order or output.

### Trace pipeline fixes

Several trace-pipeline issues surfaced during the redesign:

- **Output clipped to source image.** vtracer occasionally emits
  fractional-pixel overhang along anti-alias edges. Without
  clipping a "base colour" leaked past the source-image footprint
  in the .xcs. The build pipeline now intersects every shape with
  the source rect (in the same `start_x / start_y` reference frame
  as the export) so what you see is what burns.
- **Backdrop fills the canvas corners.** Vtracer's stacked output
  partitions pixels into N colour buckets; anti-aliased corner
  slivers can land between buckets and end up uncovered, leaving
  diagonal cuts at the canvas corners. The trace now prepends four
  per-corner backdrop rects sampled from the actual source-image
  corner colours, plus a base average rect underneath to bridge
  any sub-pixel hairline at the seams.
- **Subtract / merge tooltips.** Plain-language explanations on
  the **Subtract overlaps** and **Merge similar…** controls so it's
  obvious that subtract retains the *top* layer in overlaps, and
  merge rewrites every shape's fill in the SVG so subtraction
  treats merged colours as one.
- **Merge similar preserves per-layer state.** Re-detecting after
  a merge used to wipe every layer's params back to the page-wide
  preset; an Auto-match run before a merge would lose all its
  matches. The new merge path inherits each post-merge layer's
  full state (params, name, enabled flag, processing type, hatch
  passes) from the pre-merge layer with the same colour.
- **Auto-match status is clearer.** Re-running Auto-match on a
  fully-matched layer set used to read "Applied to 0/25 layers
  (25 skipped — no palette match)" — sounded like every layer
  failed. The message now splits into three buckets: newly
  applied, already matched, no palette match.

### Tests page — sweep range snaps to the active param

Bonus: switching the sweep parameter on the Tests page used to
keep the previous param's min/max (e.g. `speed 550–1500` →
`power 550–1500`). Min/Max now snap to the active machine + mode's
profile range for the new parameter, and the inputs clamp on blur
so out-of-range values can't slip in.
