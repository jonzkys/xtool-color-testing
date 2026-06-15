---
id: 2026-06-15-spiral-svg-arc-import
date: 2026-06-15
level: minor
title: Spiral Cut — circles and rounded SVGs import correctly
summary: An SVG built from arcs — a plain circle, rounded rectangles, anything xTool exports with the "A" path command — now imports as its true shape instead of a scattered handful of stray points. The dPath flattener gained elliptical-arc support, so a circle spirals as one clean continuous ring rather than a tangle of cross-cuts.
---
