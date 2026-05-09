---
id: 2026-05-10-exposure-formula-affordances
date: 2026-05-10
level: major
title: Exposure — formula affordances and hover help cards
summary: Every index now shows its formula on the chart and reveals a definition card on hover.
---

The exposure page used to assume you knew what `Total exposure` and
`Ablation aggression` were. Now it tells you.

The X axis carries a two-line label: the index name on top, the formula
in plain words underneath — `power × density × passes ÷ speed`, not
`P × D × R / S`. Hover the axis (or any of the axis picker pills, the
palette indices chips on a saved entry, or the correlation-matrix row
labels) and a card appears with the index's definition, a small
schematic, the formula, the inputs (with units), and a few sentences on
how to read it.

The card matches the stability page's register, because that's already
how you learn what a metric means in this tool. CIELab basics (`L*`,
`a*`, `b*`, `h°`, `C*`) get a thinner card with definition + how-to-read
only. Raw parameters (`PWR`, `SPD`, `FRQ`…) on the raw-params matrix get
a one-line definition card.

Layout changes that ride along: the chart is slightly smaller so it fits
without scrolling, the Y label has more breathing room from the chart's
left border, and the Hue Ribbon now sits above the Exposure Range brush
on the left so they jointly fill the height of the Correlations card —
no more dead band beside the ribbon strip.
