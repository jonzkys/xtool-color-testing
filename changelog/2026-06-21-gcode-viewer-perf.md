---
id: 2026-06-21-gcode-viewer-perf
date: 2026-06-21
level: minor
title: Gcode Viewer — handles large files
summary: Big Studio .gc exports (tens of MB / millions of segments) now open fast and stay smooth — segments are stored as typed arrays and transferred zero-copy from the parser worker, the layer list no longer rescans every segment, and the canvas decimates sub-pixel detail.
---
