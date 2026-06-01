---
id: 2026-05-31-xcs-v2-emitter
date: 2026-05-31
level: major
title: xcs-workspace-v2 (.xs) export
summary: Write xTool's modern directory-style .xs bundle alongside the legacy flat .xcs.
---

xTool Studio's newer projects ship as **xcs-workspace-v2** — a `.xs` ZIP
bundle that splits a project into a workspace manifest, per-canvas display
scene graphs, a parameter-profile store, a device/param-binding layer, and
two content-addressed side stores (vectors keyed by the sha256 of each SVG
`dPath`, rasters named by the sha256 of their PNG bytes). xcs-gen can now
emit that format.

The legacy flat `.xcs` writer is untouched and stays the default. Pass
`--format xs` to the `generate`, `image`, or `svg generate` subcommands, or
simply give an output path ending in `.xs`, and the new emitter takes over:

```bash
xcs-gen svg generate logo.svg -o logo.xs          # inferred from the extension
xcs-gen image photo.png -o out.xs --format xs
```

What the bundle carries:

- **Vectors** stay inline by default, matching how xTool itself saves; only
  geometry that repeats is externalized to a hash-keyed store and referenced,
  so a tiled design doesn't carry the same `dPath` once per copy.
- **Rasters** are content-addressed: two identical bitmaps collapse to a
  single `resources/<sha>.png`, each BITMAP display pointing at it by path.
- **Parameters** live in `profiles.json` and are bound to displays through the
  device descriptor; relief work (intaglio + relief heightmap) emits in
  `RELIEF_PROCESS` mode with the z-stepped depth parameters intact.

The structure was reverse-engineered against real xTool bundles and is
validated by a round-trip test suite that diffs the emitted member set and
JSON key shapes against a genuine `.xs` sample.
