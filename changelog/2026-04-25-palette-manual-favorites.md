---
id: 2026-04-25-palette-manual-favorites
date: 2026-04-25
level: major
title: Palette — manual swatches + favourites
summary: Hand-author swatches for recipes you've already dialled in, and star any swatch to keep it on hand. The SVG matcher surfaces your favourites in their own row.
images:
  - src: palette-manual.png
    caption: A new Manual tab on the Palette page. Click + to capture a hex and the recipe that produces it.
  - src: palette-favorites-row.png
    caption: Favourites flow into the SVG matcher as a paginated row underneath the closest-by-ΔE matches, sorted closest-first to whatever colour you're matching.
---

The palette grew up. Until now every swatch came from a burned test —
fine when you're still mapping a material, less fine when you already
know that "#a76c2f at 38 % / 1100 / 25 ns" is the recipe you reach for.

## Manual swatches

A new **Manual** tab on the Palette page. Click `+`, type a hex, dial
in the params, save. The entry sits in the same table as ingested
swatches and rides the same matcher — manual rows are marked with a
small **MAN** badge so provenance stays honest. Edit them in place; or
copy a recipe across to a sibling material from the swatch's hover menu.

## Favourites

Every swatch (manual or ingested) now has a star in the corner. Star
one and it pins to the new **Favourites** tab, grouped by material so
you can scan recipes across substrates without losing context.

On the SVG matcher, your favourites for the current material show up
in their own row underneath the top-N matches, sorted closest-first to
the layer colour you're matching, with auto-fit pagination when you
have more than fit in a row. Adding a favourite from the matcher's
suggested grid pops the chip into the row immediately — no reload, no
dance.

## Click-to-apply

The matcher's old **Apply** button is gone. Click any swatch — in the
suggested grid or the favourites row — and its recipe is applied to
the layer in one gesture. Same behaviour everywhere; one less click.
