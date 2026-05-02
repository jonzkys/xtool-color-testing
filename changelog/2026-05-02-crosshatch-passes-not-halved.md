---
id: 2026-05-02-crosshatch-passes-not-halved
date: 2026-05-02
level: minor
title: Crosshatch passes are no longer silently halved
summary: A two-pass crosshatch test now actually fires two passes — the converter no longer divides the user's pass count by 2 under crosshatch mode.
---

The xcs converter used to halve the user's pass count when crosshatch
was on, on the assumption that XCS's `crossAngle` field automatically
doubled each repeat into two strokes. That assumption was wrong:
xTool Studio executes `repeat` literally — one repeat is one stroke —
and `crossAngle` only alternates the scan angle between strokes; it
does not double the count.

Net effect of the bug: any crosshatch test labelled "x2 crosshatch"
or "x4 crosshatch" was actually firing half as many strokes as the
label claimed. Tests that needed two passes ran one; tests that
needed four ran two. The label was right, the burn was wrong.

The form's "even passes only" constraint under crosshatch is gone too —
odd values are now valid and behave as you'd expect.
