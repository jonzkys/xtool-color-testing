---
id: 2026-09-08-svg-preview-geometry
date: 2026-09-08
level: minor
title: SVG Layers — the preview does the geometry once instead of twice
summary: Subtracting overlaps and clipping to the canvas were two passes, and the second rebuilt every polygon from a d-string the first had just written — on a detailed trace that was the largest single phase in the request. They now share one pass and keep the geometry in hand, so a shape neither step touches even keeps its original curves instead of being flattened for nothing. Curve sampling no longer allocates a throwaway numpy array per point, hole nesting no longer compares every ring against every other, and closed-path detection stopped re-serialising the whole path to look at its last character. The preview endpoint is a little over twice as fast on a heavy trace.
---
