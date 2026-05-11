---
id: 2026-05-11-laser-indices-v5-frequency
date: 2026-05-11
level: major
title: Laser indices v5 — total exposure now factors frequency
summary: TEi (and its derivatives AAi/DSi) now scale linearly with mopa_frequency so frequency sweeps stop collapsing into a vertical stripe on the exposure scatter.
images:
  - src: laser-indices-v5-before.png
    caption: Before — every freq-sweep entry on 100×100×1mm SS stacks at TEi=60.
  - src: laser-indices-v5-after.png
    caption: After — the same sweep traces a clean diagonal from (low freq, low TEi, high PIi) to (high freq, high TEi, low PIi).
---

If you ran a pure frequency sweep on the F2 and opened the exposure
page expecting to see a curve, you got a vertical stripe instead. The
v4 `total_exposure_index` was `power × density × passes / speed` —
freq had zero weight, so every point in the sweep landed on the same
x-coordinate even though their cells looked nothing like each other.
You could see frequency move L\* by 40 units along that stripe; the
chart insisted nothing had changed.

v5 fixes the formula:

```
total_exposure_index = power × mopa_frequency × density × passes / speed
```

The physical reading: on the F2's MOPA laser, controller-% sets per-
pulse energy and the pulse repetition rate stays at whatever you
dial in, so average optical power scales linearly with frequency. The
total energy dumped into each cell over a scan is `avg_power × dwell`,
which is exactly what TEi now models. The denominators in PEi and
PIi already carried freq — TEi was the odd one out.

What moves with it:

- **`ablation_aggression_index` = TEi × PIi** loses its freq factor
  (TEi gains one, PIi has `1/freq` — they cancel). Aggression is now
  a pure peak-intensity × dose product.
- **`delivery_smoothness_index` = TEi ÷ PIi** picks up `freq²` because
  the freq factors compound. Same direction; more sensitivity.
- **Per-pulse indices unchanged.** PSm, LSm, PEi, PIi describe pulse
  geometry or per-pulse energy; freq either already lived in their
  denominator or doesn't physically belong.

What you need to do:

- Pull and `alembic upgrade head`. Migration 0025 recomputes every
  palette entry in place — same shape as the v3→v4 backfill.
- Indices values on the exposure page will look bigger (because they
  carry a freq factor, typically 60–500 kHz on F2 work). They're not
  comparable to v4 absolutes — only to other v5 values.

Caveat worth flagging: on stainless, frequency tunes the *colour* of
the oxide, not just the dose. On the 100×100×1mm SS plate the
freq-sweep L\* curve is non-monotonic — brightest around 200–260 kHz,
dark at both extremes. TEi v5 is a faithful dose proxy but it won't
predict L\* for SS marking on its own; that needs a 2D representation
of the colour window, which is its own conversation. v5 just gets the
geometry of the scatter honest enough to think with.
