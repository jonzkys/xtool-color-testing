---
id: 2026-06-15-spiral-simplify-and-cap
date: 2026-06-15
level: minor
title: Spiral Cut — Simplify control + configurable per-path cap
summary: Two new Cut-geometry controls plus a live Path-geometry readout. "Simplify (mm)" rounds the source outline before spiraling (like Studio's simplify), so every concentric arm carries far fewer nodes. "Max points / path" sets the per-path cap that splits the spiral into separate cut objects — raise it to keep the cut as one continuous path. The Path-geometry panel shows, before you export, how many cut objects (and points) the current settings produce — "1 · continuous" vs "N · split" — so you can dial it in. Together they take a dense outline from a dozen sequential cut objects down toward one.
---
