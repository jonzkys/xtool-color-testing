---
id: 2026-06-11-spiral-cut
date: 2026-06-11
level: major
title: Spiral Cut — continuous-vector cutting that beats incise
summary: A new Forge strategy that severs the contour with one continuous spiral cut — cleaner edges and roughly half the time of the raster incise.
images:
  - src: spiral-cut.png
    caption: The Spiral Cut preset loaded — a continuous venting-channel spiral around the part, on the IR fibre, in flat-surface mode.
---

Forge has always cut by **incise**: rastering a kerf band, layer after layer, until the
contour drops. It works — but it sweeps the whole bounding box every pass, and on thick
brass it is slow.

**Spiral Cut** takes a different path. It traces the contour as a single continuous
*vector* line that spirals outward through a narrow venting channel — concentric offset
loops packed at roughly a beam width, stitched into one open polyline, with the focus
stepping down each set of passes. Because the beam only ever travels along the channel
(not back-and-forth across the part), it removes the same material in **about half the
time**, and the open channel lets molten metal escape upward instead of re-welding the
kerf — so the wall comes out cleaner.

It emerged from a long cut-vs-incise investigation on 3 mm brass: a plain vector cut
**can't** sever thick brass on a galvo with no assist gas (the melt has nowhere to go and
re-welds), but a *wide enough* continuous channel vents like the incise while staying a
fast vector trace. On a real cut it severed cleanly; the workbench estimate lands it
around 57 % of the incise time for the same part.

**Using it**

- Upload a `.xcs`/`.xs` with an incise (INTAGLIO) contour, then hit **Load Spiral Cut
  preset** — or pick *Spiral Cut* from the strategy dropdown.
- The **Spiral Cut (CUT_08)** card controls the geometry: channel width (0.8 mm cuts
  clean, down to a 0.4 mm floor for thin necks), arm pitch, passes, and the per-pass
  focus step-down. Laser params live in the stage tab (defaults: IR fibre, 1500 mm/s,
  500 passes, 0.06 mm every 10 passes → 3 mm).
- It exports as a **flat-surface `VECTOR_CUTTING` job on the IR laser** — the cut mode,
  not Embossment.

**Notes**

- Spiral Cut is **standalone**: it doesn't mix with the incise stages. If you leave incise
  stages on, Forge warns and exports spiral-only (a mixed cut+incise file would force the
  whole job into Embossment, where the cut won't run).
- It handles arbitrary contours — holes spiral inward, separate parts get their own
  spirals, and a concave neck that splits an offset forks into independent arms. A scrap
  neck too thin for even the minimum channel is skipped with a warning.
- The defaults are tuned for 3 mm brass on the F2 Ultra. Spiral direction and seam
  placement are exposed as tunables — dial them in on your stock.
