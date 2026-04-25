---
id: 2026-04-25-multi-machine-support
date: 2026-04-25
created_at: 2026-04-25T16:30:00Z
level: major
title: Multi-machine support — F1 Ultra joins the workbench
summary: Pick a machine in the TopBar; tests, palette, and library scope to it automatically.
images:
  - src: multi-machine-switcher.png
    caption: Machine switcher in the TopBar — both machines shown with their laser specs and supported modes. The active machine is highlighted.
---

The workbench used to assume one machine — the F2 Ultra Dual. Today it
learns about the F1 Ultra too, with the scaffolding to add more from a
single registry edit.

**Pick a machine.** A new control in the TopBar shows the machine you're
on. Click it to see the alternatives, with their laser specs and supported
modes called out. Switch and the entire workbench reloads onto that
machine's data — its tests, its palette, its presets. The selection
persists across reloads.

**Per-machine parameter ranges.** The parameter form adapts to the machine
and mode you've picked. F1 Ultra hides `pulse_width` (no colour-engrave
mode), the LPC slider snaps to the F1's stepped values (10, 20, …, 100,
120, 140, …, 200), and out-of-range frequency or speed values are caught
at save instead of being silently accepted.

**Data scoping.** Tests, palette swatches, and library presets are all
filtered to the active machine. Switch to the F1 Ultra and you see only
F1 data; switch back to the F2 and its workspace is exactly as you left
it.

**Existing data stays put.** Everything created before today was on the
F2 Ultra Dual; the migration backfills that label so nothing is lost or
re-attributed. The F1 Ultra starts with an empty workspace — yours to
populate.

Adding a third machine later is a single entry in
`src/xcs_gen/machines.py`.
