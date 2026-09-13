---
id: 2026-09-13-repair-pulse-width-values
date: 2026-09-13
level: minor
title: A command to put the burned pulse widths back into old sweep data
summary: Pulse-width sweeps captured before the inspector fix stored each row's pulse width as an evenly spaced ramp — 13, 57, 102 ns where the burn used 13, 20, 30 — and palette entries saved from them inherited those numbers. `xcs-gen repair-pulse-width-values` rewrites the stored swatches and those entries to the preset each row actually burned, recomputing the exposure indices as it goes. Validation tests that re-burned one of those wrong values are listed, not rewritten. It reports and writes nothing until you pass `--apply`.
---

The right value is provable, not guessed. A sweep's rows are laid out by its
spec, so a swatch's row says which preset it burned; an entry saved by the
batch ingest records its cell, which says the same. An entry picked by hand
carries no cell, so its stored number is matched back to the ramp step it
came from.

Three kinds of row are left alone and reported instead:

- **A number that could be either.** A 2–60 ns sweep over 9 rows ramps 2, 9,
  16, 24 … and burns 2, 4, 6, 9 …, so a hand-picked entry reading 9 ns is
  either row 1 before repair or row 3 after it. Without a cell to settle it,
  the command doesn't pick one.
- **A sweep that asked for more steps than there are presets.** It burned
  fewer rows than it was sampled as, so the colours came from the wrong
  places. Relabelling them would make bad data look good.
- **Anything burned with a ramp value.** A validation test built from an
  affected entry sent that number, say 53 ns, to the machine. What the
  machine did with a pulse width it doesn't offer isn't known, so those cells
  and the entries validated from them keep their recipe.

```
$ xcs-gen repair-pulse-width-values
pulse-width sweeps  3

results
  scanned           0
  already correct   0
  repairable        0
  NOT repairable    0

palette entries
  scanned           217
  already correct   19
  repairable        198
  NOT repairable    0

Left untouched — a non-preset pulse width was burned or saved here,
and what the machine made of it is unknown:
  validation test #58: 13 cells burned with 24, 31, 38, 46, 53
  …

Dry run — nothing written. Re-run with --apply to make these changes.
```
