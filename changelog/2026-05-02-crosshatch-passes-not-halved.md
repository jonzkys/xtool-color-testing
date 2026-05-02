---
id: 2026-05-02-crosshatch-passes-not-halved
date: 2026-05-02
level: major
title: Crosshatch fixes — pass count, separate toggle, palette context
summary: Three related crosshatch fixes — passes no longer silently halved, crosshatch is now a separate checkbox that stacks with any angle mode, and palette entries persist their angle/crosshatch context so the same colour can actually be reproduced.
---

Three crosshatch-related fixes ship together because they share the
same root: the device executes `repeat` literally and `crossAngle`
adds the perpendicular companion stroke per pass — earlier code
treated them as if they were the same lever, and that drifted
silently into incorrect burns.

**Passes are no longer silently halved.** The xcs converter used to
halve the user's pass count under crosshatch, on the assumption that
xTool internally doubled each `repeat` into two strokes regardless of
the value. The actual hardware behaviour: `repeat=N` fires N strokes,
and `crossAngle=true` adds one perpendicular companion per stroke.
So `passes=2 + crosshatch` should fire **4** strokes (2 at scan_angle,
2 at scan_angle+90°). The earlier code emitted `repeat=1` and produced
**2** strokes — half what the label claimed.

**Crosshatch is now a separate toggle.** It used to be one of three
options on the Angle-mode dropdown (`fixed | crosshatch | incremental`),
which meant you couldn't combine crosshatch with incremental. Now the
dropdown is `Fixed | Incremental` and Crosshatch is its own checkbox
that stacks with either: incremental + crosshatch rotates the angle
between passes AND adds the perpendicular companion to each. Existing
tests stored as `angle_mode="crosshatch"` are snapped on read to the
new shape (`angle_mode="fixed", crosshatch=true`), so nothing breaks.

**Palette entries now record angle / crosshatch.** Ingest used to
copy `power / speed / frequency / density / passes / pulse_width / laser
/ scan_angle` into the palette row's params blob, but `angle_mode` and
`crosshatch` (test-level) were dropped — meaning a "fixed x2" colour
and a "crosshatch x2" colour from the same other params would land in
the palette as indistinguishable rows. They're now persisted.

⚠️ **Palette verification.** If you ingested colours from any
crosshatch sweep test between **2026-04-20 and today**, those palette
entries reflect a burn that fired **half** the strokes their label
claims. Their hex / Lab values are real measurements of what the
device actually produced, but they're under-burned relative to the
test's stated parameters. Recommended: re-burn affected tests at the
corrected pass count and re-ingest the palette to pick up the proper
colour for the labelled stroke count. The palette-clear action on the
Edit-material modal is the easiest way to wipe and start over.
