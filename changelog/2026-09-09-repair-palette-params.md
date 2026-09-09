---
id: 2026-09-09-repair-palette-params
date: 2026-09-09
level: minor
title: A command to recover palette entries that lost their constants
summary: Entries saved by validating a test used to record only the parameters that cell varied, dropping everything the test held constant — leaving a validated colour that could not say what power or density produced it. `xcs-gen repair-palette-params` puts them back, reading each entry's own test spec, filling only what is missing, and never overwriting a value the entry already had. It reports and writes nothing until you pass `--apply`.
---

The missing values are recoverable, and provably so. A validation cell is
burned as the test's `base_params` with the cell's own params laid over the
top — that is literally how the converter builds it — so merging the two back
together reconstructs what the machine ran, rather than guessing at it.

The repair is deliberately narrow. It only fills keys that are absent, so an
entry's own measured values always win. It only reads that entry's own test,
never a sibling. If a test cannot supply every missing key it skips the entry
whole and says so, because a half-filled entry looks complete to everything
downstream while carrying a number the burn never used. And it recomputes the
exposure indices, which had been calculated from the incomplete parameters —
a missing density had quietly become a default line spacing.

```
$ xcs-gen repair-palette-params
scanned            1429
already complete   1329
repairable         100
NOT repairable     0

Dry run — nothing written. Re-run with --apply to make these changes.
```
