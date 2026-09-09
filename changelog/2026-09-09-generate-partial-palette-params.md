---
id: 2026-09-09-generate-partial-palette-params
date: 2026-09-09
level: minor
title: SVG Layers — Generate no longer fails on a palette entry that only carries some parameters
summary: Matching a layer against a palette entry saved from a sweep that varied only speed and frequency wrote NaN into every parameter the entry did not carry. JSON turns NaN into null, the API rejects null, and Generate came back with a wall of validation errors — one per missing field, per layer. A parameter the entry does not carry is now left alone, so the layer keeps the value it already had, which is what the crosshatch and angle-mode fields next to it have always done.
---
