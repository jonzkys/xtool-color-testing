---
id: 2026-06-08-forge-time-aware
date: 2026-06-08
level: major
title: Forge — time-aware cutting
summary: Forge now estimates cut time per stage, shows how it compares to a plain incise, warns before a strategy gets slow, and defaults to a lean strategy.
images:
  - src: forge-estimate-panel.png
    caption: Per-stage time, total, and % of a plain incise.
---

Forge used to happily generate a beautiful, staged cut that took hours longer
than a plain incise — and showed you nothing about it until the laser was
running. No more.

**Cut-time estimates.** Every regenerate now shows estimated laser-on time per
stage and for the whole job, plus how that compares to cutting the outline once
("% of incise"). The numbers come from a model calibrated against xTool Studio
on the F2 Ultra: cut time is linear in slices and passes and in line density,
weakly dependent on speed, and sub-linear in band width — so the cost is
cumulative depth × area, not the headline width multiplier.

**A budget warning.** Set a time budget (default 1.5× a plain incise) and Forge
warns — never blocks — when a strategy blows past it, naming the worst stages
and what to trim.

**A lean default.** The new default does the depth work in one main incise with
a shallow seed, sparse perforation and a light wall-clean — typically a small
fraction over a plain cut. The old deep 1×/2×/4×/8× progressive schedule is one
click away as the **Aggressive** preset.

**A quiet but important fix.** Seed, perforation and clean stages used to
silently inherit the source cut's deep layer count, so a "3-layer seed" could
secretly run hundreds of layers. They now export their own shallow depth.

Re-verify your recipes against the new estimates and the corrected shallow
stages before committing brass.
