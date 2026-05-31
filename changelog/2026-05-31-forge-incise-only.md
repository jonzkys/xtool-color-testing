---
id: 2026-05-31-forge-incise-only
date: 2026-05-31
level: minor
title: Forge — incise-only files + corrected kerf scale
summary: Forge no longer needs an emboss layer; any incise-only design converts to a smart cut, and kerf widths now match the beam-width setting.
---

Forge previously refused to export unless the uploaded `.xcs` carried a raised
emboss (RELIEF) object — but the cut geometry never used it. Now an
incise-only design (outlined text or shapes, no relief) converts to a smart
cut on its own: drop in the file, pick the contour, export.

Two fixes rode along. Layer detection now treats `VECTOR_ENGRAVING` as
**score** rather than emboss and hides device-map entries that carry no
geometry, so the object lists show only what's really there. And kerf
calibration now reads each contour's true scale instead of a job perimeter
that actually described the emboss — on emboss files the generated bands were
about 3.57× too wide. **Re-check a cut after updating.**
