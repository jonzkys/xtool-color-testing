---
id: 2026-06-08-pixel-art-palette-picker
date: 2026-06-08
level: minor
title: Pixel Art — pick any palette colour, not just the nearest
summary: The layer colour picker now has Similar, Favourites, and a hue-sorted All section so you can reach any entry, not only the 8 closest.
---

Matching a Pixel Art layer to a palette colour used to show only the eight
nearest entries by ΔE — there was no way to reach a favourite that wasn't
close, or to scroll the whole palette. The picker now has three sections:
**Similar** (nearest, with a "Load more"), **★ Favourites** (each with its
ΔE), and **All** — every entry for the material, sorted by hue and
filterable by name or hex. Picking a colour now also shows through: the
Representative preview and the exported `.xs`/`.svg` layer swatch take on the
matched palette entry's colour (the burn still uses its validated parameters).
