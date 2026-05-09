---
id: 2026-05-11-test-schema-lineage
date: 2026-05-11
level: minor
title: Tests + palette — explicit lineage and physical line spacing
summary: Tests record source/parent/tag; palette entries record their source entry; line spacing is in mm now, not a dimensionless index.
---

The tests model gains three new fields:

- **`source_test_id`** — for `kind=validation` tests, points at the
  test whose harvested palette is being validated. Filled
  automatically when validation cells get persisted (the
  `validation_cells.replace_for_test` repository takes the modal
  `palette_entries.test_id` of the cells and writes it to the test
  row).
- **`parent_test_id`** — fork/iteration lineage. Set when a future
  copy-this-test affordance writes a new test from an existing one.
- **`tag`** — short campaign label (≤64 chars) for grouping related
  tests across a project.

Palette entries gain **`derived_from_entry_id`** — for entries
produced by ingesting cross-material validation results, this points
at the original entry the validation was run against. Different from
the existing `validated_test_id` / `validated_cell_index`, which
point downstream (this entry has been validated by a later test).
The validate-batch ingest endpoint now writes this automatically
from the matching `validation_cells.palette_entry_id`.

Separately: laser `density` is now treated as the lines-per-cm value
it always was (the controller stepped-value tables in
`xcs_gen.machines` were always explicit about LPC). The dimensionless
`line_spacing_index` is gone; in its place, `line_spacing_mm = 10 / density`
is populated for every entry. The exposure page and palette-indices
chips show one `Line spacing` field in mm instead of a redundant
pair, and `density`'s unit string in every help card now reads
`lines/cm` instead of `controller value (opaque)`.

Migration `0024` adds the columns, backfills lineage from the
existing validation-cell joins, drops `palette_entries.line_spacing_index`,
and recomputes every palette entry's indices under formula version 3.

UI surfacing of the new lineage fields (test header, focused-card
provenance row, filterable tag pills) is a separate follow-up.
