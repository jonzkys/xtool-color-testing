---
id: 2026-06-01-xs-in-the-ui
date: 2026-06-01
level: major
title: .xs everywhere — the new format lands in the workbench
summary: Every generator page can now download xTool's xcs-workspace-v2 (.xs) bundle, .xs is the default, and Contour Forge reads and writes it too.
---

xTool Studio's newer projects are **xcs-workspace-v2** — a `.xs` ZIP bundle that
splits a project into a workspace manifest, per-canvas scene graphs, a
parameter-profile store, a device/param-binding layer, and content-addressed
vector + raster stores. The generator could already *emit* it; now the whole
workbench speaks it.

**Every generator page has a format toggle, and `.xs` is the default.** Pixel
Art, SVG Layers, Loom, and the per-test Generate button all carry a small
`.xs / .xcs` switch next to their download control. The button label tracks your
choice — *Generate .xs* by default, *Generate .xcs* if you flip it — so you
always know what lands in your Downloads folder. Legacy `.xcs` is one click away
and byte-for-byte what it was before.

**Contour Forge reads and writes `.xs`.** Upload either a legacy `.xcs` or a
`.xs` bundle — Forge resolves the incise (INTAGLIO) cut target and preserves any
emboss (RELIEF) heightmap from both. The export format is now *your* choice, not
the upload's: a `.xs` / `.xcs` toggle (defaulting to `.xs`) sits beside the
export button, so you can take a legacy project and hand back a modern bundle —
heightmaps and all are carried across, content-addressed into the bundle's
resource store.

Under the hood the browser gained a faithful TypeScript reader/writer for the v2
container, mirroring the Python emitter field-for-field and validated against
real xTool bundles, so a project round-trips through the UI without losing
geometry, laser parameters, or relief depth.
