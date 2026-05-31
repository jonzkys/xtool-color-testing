---
id: 2026-05-31-forge-scan-angle
date: 2026-05-31
level: minor
title: Forge — optional scan-angle optimization
summary: An experimental toggle sets each cut to its speed-optimal raster scan angle, cutting scan-line count (and engrave time) on elongated geometry.
---

Raster engraving time is dominated by the number of scan lines — the geometry's
extent *perpendicular* to the scan direction. Forge can now compute the
speed-optimal angle (scan along the longest axis) and write it to each
operation's `processAngle` on export. The Debug panel always shows the computed
angle; the new **Optimize scan angle** toggle (Global panel) applies it.

The win scales with how elongated the design is — modest on a roughly-square
logo, large on long/narrow features (a 5 × 100 mm bar drops ~20× in scan
lines). It's opt-in and experimental: the exact angle convention is xTool's, so
compare the time estimate in Studio with the toggle on vs off before relying
on it.

The optimization is **off by default**. A companion **Scan angle** entry field
(Global panel) lets you set `processAngle` directly to any fixed value — enter
0 to inherit the source file's value unchanged. When **Optimize scan angle** is
enabled it takes precedence and the manual field is disabled.
