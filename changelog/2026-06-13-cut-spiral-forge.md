---
id: 2026-06-13-cut-spiral-forge
date: 2026-06-13
level: major
title: Cut → Spiral & Forge — split into two purpose-built pages
summary: The Forge workbench is now a "Cut" menu with two pages — a dedicated Spiral Cut tool and the original staged Forge, kept but deprecated.
images:
  - src: cut-spiral-page.png
    caption: The new Spiral Cut page — geometry on the right, laser & focus docked under the preview, single-segment time estimate up top.
---

Forge had grown to carry two different jobs in one page: the staged **seed →
perforate → deepen → clean** incise workflow, and the newer **Spiral Cut** —
the continuous-vector strategy that severs a contour in one pass. They want
different controls, so they're now two pages under a new **Cut** menu in the
top nav (the standalone Forge button is gone).

**Spiral** is a purpose-built tool. No strategy presets, no stage tabs, none of
the incise stages — just the cut geometry (channel width, pitch, min channel,
side) on the right, the laser and focus-descent controls docked under the live
preview, and a single-segment cut-time estimate across the top. Passes and
focus descent each have exactly one control now, not two.

**Forge (deprecated)** is the original staged workbench, unchanged apart from a
banner pointing toward Spiral Cut and the removal of the spiral option that had
been bolted on. It stays available indefinitely for the staged incise workflow
— bookmarks to `#/forge` still land here.

Both pages share the redesigned cockpit layout: a viewport-pinned workbench
with internally-scrolling rails, so the time estimate and preview stay in view
while you work instead of scrolling off the bottom.
