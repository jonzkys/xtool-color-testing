---
id: 2026-06-03-f2-ultra-frequency
date: 2026-06-03
level: minor
title: F2 Ultra frequency now reaches its real 4000 kHz ceiling
summary: The F2 Ultra and F2 Ultra Single MOPA frequency was wrongly capped at 150 kHz; it now spans the machine's full pulse-width-dependent range up to 4000 kHz.
---

The frequency field on the F2 Ultra and F2 Ultra Single was clamped to 150 kHz —
a stale value the profile extractor picked up from a generic fallback field in
the xTool Studio bundle. The real MOPA control sets its ceiling per pulse width
(up to 4000 kHz at the shortest pulses) through a lookup the extractor's regex
couldn't read, so it silently fell back to the wrong number. Both machines now
carry the honest 1–4000 kHz envelope, and sweeps or saved tests above 150 kHz
are no longer rejected or clamped. The diode-only and non-MOPA machines are
unchanged.
