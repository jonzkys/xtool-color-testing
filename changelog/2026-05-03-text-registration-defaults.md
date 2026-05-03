---
id: 2026-05-03-text-registration-defaults
date: 2026-05-03
level: major
title: Per-material text & registration burn defaults
summary: The QR / ArUco / axis-label / summary-text params are no longer hardcoded — every material can carry its own per-machine calibration, and the Tests page lets you promote what you've typed to either default with one click.
images:
  - src: library-text-reg-tab.png
    caption: Library page → material → Text & Registration tab. One card per machine, per-material override on top of a per-machine fallback.
---

The renderer engraves a few things on every burn that *aren't* the
cell grid: the QR code, the three ArUco fiducials, axis ticks + tick
labels, and the summary text strip above the grid. Those have always
shared a single hardcoded ProcessingParams bundle (`speed=400`,
`power=14`, `density=2566`, `pulse_width=80`, `mopa_frequency=90` on
red), tuned for stainless on the F2Ultra. On anodised aluminium, on
a coated brass, on the F1Ultra — the marks were either too pale to
read or so dark they bled into the cells.

This release moves those params out of code and into the database, in
two layers per owner:

- **Per machine** — your default for that machine. One row keyed on
  `(owner, machine)`.
- **Per material** — overrides the machine default for one specific
  substrate. One row per `(owner, machine, material)`.

Resolution at burn time:

```
test override → material default → machine default → built-in constants
```

The hardcoded constants stay around as the "fresh install" fallback,
so nothing breaks if you haven't calibrated yet.

### Where to set them

- **Library → pick a material → Text & Registration tab.** One card
  per machine, with the seven param fields (speed, power, density,
  passes, pulse width, frequency, laser). Save the card to write the
  material override; reset the card to fall back to your machine
  default. A pill on each card tells you whether you're looking at a
  material override, the machine default, or the built-in fallback.
- **Tests page → Registration tab.** A new "Engraved annotation
  params" section sits below the existing QR/ArUco mode block. The
  fields prefill from whatever the resolver returns for this test's
  `(machine, material)` pair — and two buttons let you promote the
  current values to **machine default** or **material default** in
  one click. The buttons don't change the test you're editing; they
  just remember what you typed for next time.

### Migration

Migration `0018` adds the two tables. Nothing is backfilled — your
first burn after upgrading still uses the built-in constants, and the
moment you save a default it becomes the fallback for every subsequent
burn that doesn't override it.
