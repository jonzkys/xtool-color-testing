---
id: 2026-09-09-validation-ingest-full-recipe
date: 2026-09-09
level: minor
title: Validating a test now saves the whole burn recipe, not just the axes it varied
summary: A palette entry created by validating a test recorded only the parameters that cell overrode, quietly dropping everything the test held constant — so an entry from a speed-and-frequency sweep remembered a speed and a frequency and nothing about the power, density, passes or pulse width that actually produced the colour. It now records the same merge the burn itself uses: the test's base parameters with the cell's own values on top. The two other ingest paths already did this; this one was the odd one out.
---
