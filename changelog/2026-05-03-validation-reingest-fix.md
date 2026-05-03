---
id: 2026-05-03-validation-reingest-fix
date: 2026-05-03
level: minor
title: Re-ingesting a validation result no longer scrambles params
summary: The ingest path used to write `params[x_param] = swatch.x_value` — which, for validation tests, is the cell index, not a real param value. New palette entries from a validation re-ingest now pull from `validation_cells.params_json` directly.
---

If you re-ingested a validation test's result back into the palette
(common workflow: validate the existing palette in two big tests,
then promote the swatches that actually came out right), the new
palette rows had params like `power=0` or `power=99` instead of the
real values the burn used.

Cause: the ingest endpoint stamped the swept-axis position onto the
palette row — `params["power"] = swatch.x_value` — which is fine for
sweep tests (`x_value` is the real swept value) but wrong for
validation, where `bytes_for_test` pins `x_min=0` / `x_max=cell_count-1`
to keep the wrapped-1D layout honest. The `x_value` of every captured
swatch was just its cell index.

Fix: the ingest endpoint now detects `kind="validation"` and reaches
into `validation_cells.params_json` (the frozen snapshot every cell
already carries) for the per-cell params, ignoring the swept-axis
projection entirely. Sweep behaviour is unchanged.

Side effect of the original frozen-cell design: existing validation
tests are perfectly safe to delete the source palette entries from —
the cells carry their own `expected_hex`, `expected_lab`, and
`params_json`, and the `palette_entry_id` FK is `ON DELETE SET NULL`.
The cells survive intact.
