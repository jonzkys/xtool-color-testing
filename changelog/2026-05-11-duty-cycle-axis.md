---
id: 2026-05-11-duty-cycle-axis
date: 2026-05-11
level: major
title: Exposure — duty cycle axis, refined power semantics (v6)
summary: New `duty_cycle_index` axis, opaque-power caveat dropped after G-code verification, and the rail tabs no longer crush their text.
images:
  - src: 2026-05-11-duty-cycle-axis.png
    caption: Duty Cycle (%) selectable as an X-axis; chart, hue ribbon, and correlation matrix all key off the new index.
---

Spent an evening reading xTool G-code exports to figure out what the
exposure page's "power %" actually does inside the controller. Three
useful things came out of it.

**1. Power is no longer opaque.** The "controller power %" slider lands
verbatim in G-code as the per-move `S` value on a 0–1000 scale
(`S = power × 10`). 10% → S=100, 50% → S=500 — linear, no curve, no
hidden duty-cycle multiplier. The help-tip text on the exposure page
now says so. The slider-to-watts conversion is still per-machine, but
the formulas using `power` as a relative 0–100 factor are physically
correct, not just heuristic.

**2. New `duty_cycle_index` axis.** Pulled out of the help-tip footnote
into a first-class index. It's a pure physical ratio — `frequency_kHz ×
pulse_width_ns ÷ 10000`, expressed as 0–100% — and it's the lever that
converts average-power % into peak-power %. Two recipes at the same
slider value can deliver radically different peaks if their duty cycles
differ; on the F2 Ultra MOPA, a default 65 kHz × 200 ns gives a 1.3%
duty cycle, which means peak ≈ 77× average. Plot it on either axis,
read it from the focused-card chip, or eyeball its correlation against
each Lab channel in the matrix at the bottom of the page.

**3. Frequency, pulse-width, density, passes — all confirmed direct.**
Diffing four G-code files (baseline + one each varying power, freq,
pulse-width) showed:

| UI slider        | G-code location       | Mapping                              |
|---|---|---|
| Power (%)        | `S<n>` per move       | `S = power × 10` (0–1000 scale)      |
| Frequency (kHz)  | `G0Q<n>`              | direct                                |
| Pulse width (ns) | `G0H<n>`              | direct                                |
| Pass count       | `G104 P<n>`           | controller loop (not literal repeat) |
| Speed (mm/s)     | `F<n>` (mm/min)       | `F = speed × 60`                      |
| Lines per cm     | `blockConfig.density` | matches xTool's slider 1:1            |

The `M523P40` boilerplate I initially mistook for a power register
turned out to be a fixed init that doesn't change with the slider.

What you need to do: pull and `alembic upgrade head`. Migration 0026
adds a `duty_cycle_index` column to `palette_entries` and backfills it
in place (same pattern as the v5 backfill). Indices `formula_version`
bumps 5 → 6.

Also fixed in the same pass: the right-rail Info/Filters/Stats/Color
tabs were crushed against their borders at the previous font size;
they're a hair smaller now with a little breathing room. Unrelated to
the G-code work — just got in the way during testing and was a
two-character fix.
