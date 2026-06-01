---
id: 2026-06-01-textreg-validation
date: 2026-06-01
level: minor
title: Text-registration params respect machine limits
summary: The engraved-annotation (QR/fiducial) params now use the active machine's real constraints, and out-of-range saved defaults are clamped instead of failing at burn.
---

The text-registration params — the power/speed/density/pulse-width behind the
QR code, ArUco fiducials, axis ticks, and summary strip — were the last param
surface outside the validation system. They had their own field names and no
upper bounds, so a default of `speed=99999` would save happily and only fail at
the machine.

Now they ride the same rails as the rest of the workbench. The editor (in the
Tests Registration tab and the Library "Text & Registration" cards) renders the
active machine's real constrained widgets — the F2 Ultra pulse-width dropdown,
the per-mode density ceiling, the right laser options — and the server clamps
any out-of-range value to the machine's profile on save. Each Library card is
bounded by *its own* machine. Nothing about the per-machine/per-material
defaults or the way burns resolve them changed.
