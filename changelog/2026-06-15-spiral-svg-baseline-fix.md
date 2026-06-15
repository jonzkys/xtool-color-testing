---
id: 2026-06-15-spiral-svg-baseline-fix
date: 2026-06-15
level: minor
title: Spiral Cut — fix runaway baseline on SVG imports
summary: Importing an SVG no longer reads "vs baseline" as hundreds of hours. The baseline now models the incise at its reference density (300 lines/cm) instead of inheriting the imported object's placeholder density.
---
