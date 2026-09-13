---
id: 2026-09-13-pulse-width-axis-values
date: 2026-09-13
level: minor
title: Inspecting a pulse-width sweep shows the pulse widths it actually burned
summary: The F2 Ultra only burns 16 preset pulse widths, and a sweep from 2 to 500 ns over 16 rows burns exactly those — 2, 4, 6, 9, 13 and on up to 350 and 500. The inspector's axis and hover card spaced the rows evenly instead (2, 35.2, 68.4 …), so the row burned at 60 ns read as 268. Capture stored the same wrong values, and ingest copied them into palette recipes. The inspector, the cell-inspect panel and every new capture now read each row's value off the same preset list the generator burns with. Results captured before this fix show the right values in the inspector too, but palette entries already saved from them still hold the old numbers.
---
