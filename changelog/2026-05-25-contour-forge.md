---
id: 2026-05-25-contour-forge
date: 2026-05-25
level: major
title: Contour Forge — staged cut strategies for fibre brass
summary: Upload an .xcs, turn its incise contour into seed / perforate / deepen / clean machining passes, and preview before export.
---

Brass on a MOPA fibre laser doesn't cut like sheet metal — a narrow kerf
self-limits as recast and ejecta seal the trench. **Contour Forge** (an
experimental page at `#/forge`) treats the cut contour as a staged process
instead of one repeated line.

Upload a project containing an emboss (RELIEF) object and an incise (INTAGLIO)
contour. The incise contour becomes source geometry for four path classes:

- **seed** — a shallow scrap-side track that conditions the surface and improves
  initial coupling;
- **perforate** — distributed starter/ejection pockets, denser at corners, so
  melt and vapour can escape;
- **deepen** — progressive scrap-side widening (1× → 8× beam width) with
  interlaced, direction-reversing segments to spread heat;
- **clean** — low-energy wall passes that lift recast/oxide without forcing more
  depth.

Everything is configurable and colour-coded in a live preview so you can check
which side the widening lands on before exporting a new `.xcs`. The original
incise contour is replaced by the generated stages; emboss and model objects are
left untouched.
