---
id: 2026-06-01-machine-profiles
date: 2026-06-01
level: minor
title: Real machine limits for the F2 Ultra & F1 families
summary: Param fields are now bounded by xTool's actual per-machine, per-mode limits, and four more machines are selectable.
---

The validation profiles behind every parameter input used to be hand-curated
for two machines and two shared profiles. They now carry the **real**
constraints, extracted per machine and per mode straight from xTool Studio:
power, speed, frequency, density, passes, pulse width, and laser — each bounded
to what the machine actually accepts.

Four machines join the switcher — **F2 Ultra (Single)**, **F2 Ultra UV**,
**F1 Lite**, and **F1** — and two modes, **Intaglio** and **Relief**, are now
first-class (Forge's stages pick up their real limits). Pulse width and Color
Engrave are correctly limited to the MOPA-capable F2 Ultra and F2 Ultra Single;
frequency drops away on the diode-only F1 Lite and F1.

The four new machines ship with placeholder icons for now — real artwork
follows. Saved tests keep loading: where a limit tightened, the slider clamps
the old value into range on open.
