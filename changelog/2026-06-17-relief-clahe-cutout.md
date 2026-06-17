---
id: 2026-06-17-relief-clahe-cutout
date: 2026-06-17
level: minor
title: Relief — CLAHE stretch now reads the cut-out, not the whole frame
summary: Background removal now runs before the CLAHE local-contrast stretch, and CLAHE only equalizes the foreground — a large dark or bright background no longer skews the adaptive tiles near the object edge. The monotonic stretches (Linear / Gamma / Asinh / Equalize) already histogram the cut-out only, so all stretching is now of the background-subtracted image.
---
