---
id: 2026-05-18-gcode-viewer
date: 2026-05-18
level: major
title: Gcode viewer — forensic inspection of Studio exports
summary: New `#/gcode` page parses an xTool Studio `.gc` export entirely in the browser, renders each layer's geometry with auto-fit cropping, and surfaces the observed peak S, cutting speed, Z-axis movements, and cleanup-pass anomalies so you can see what Studio actually emitted — not what it told you it would emit.
---

Studio's preview tells you what it intended to do. The new gcode viewer tells you what it actually wrote to the file. Drop a `.gc` export onto the page, no upload, and a Web Worker streams the file into a structured job → layer → block tree without touching the server. The viewer is built for one job: spotting cases where Studio's behaviour diverges from the parameters you set.

What it surfaces:

- **Per-block observed stats**, not just the configured ones. The right rail shows `PEAK S` (the actual power emitted on burn segments), `SPEED` in mm/s with the gcode F shown alongside, and the line number where the block starts. When a value differs from the layer's configured peak, it goes bold red so anomalies pop without you having to read the JSON.
- **Cleanup-pass detection.** Studio emits "cleanup" passes inside the same `blockConfig` group at much lower power (e.g. S=210 on a 900-power layer). Those blocks render in white on the canvas instead of the warm power ramp, and the params box flags the pass type explicitly.
- **Z-axis tracking.** A permanent `Z` row shows the running head position from file start. Colour is green when descended below origin and amber when above; it goes bold with a tinted background when the current block contains a real Z movement. `G91`/`G90` mode brackets are followed correctly so relative descents like `G91 G0Z-0.08 G90` accumulate instead of being misread as absolute targets.
- **Multi-layer comparison.** Tick checkboxes on the layer list to pin two or more layers as side-by-side panels. A single block-offset slider scrubs all panels in lockstep, so you can compare "block 200 of the dog at power 900" against "block 200 of the dog at power 1000" and see how Studio interleaved them.
- **Auto-fit cropping per layer.** The canvas re-fits its bbox every time the focused layer changes, so a small vector line zooms in tightly while a full bitmap zooms out — no constant manual zooming. Burns are rendered via batched Path2Ds (one stroke call per power band) so even the 408-block, 1.7M-line files render in under a second.

The page is read with: TopBar → "Gcode" → "Open .gc file…". Files parse client-side so the viewer works in standalone mode too, and nothing about the file leaves your machine.
