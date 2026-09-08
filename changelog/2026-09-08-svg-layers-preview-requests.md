---
id: 2026-09-08-svg-layers-preview-requests
date: 2026-09-08
level: minor
title: SVG Layers — the preview stops re-rendering work it already did
summary: Editing a layer's power, speed or scan angle used to fire a full preview round trip — on a detailed trace that meant a multi-second wait for geometry that had not moved a micron. So did toggling a layer on or off, and so did typing a new project width. None of them do now: the enabled-colour filter already ran in the browser, width is a pure scale of a preview we already hold, and a freshly traced raster was being subtracted twice, the second pass chewing on the flattened output of the first. A photo upload followed by a handful of edits went from seven trips to the server to one.
---
