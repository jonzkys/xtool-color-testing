---
id: 2026-05-05-validated-palette
date: 2026-05-05
level: major
title: Validated palette — stability gate, deep links, "validated only" matching
summary: A new VALIDATE mode on the Stability page locks in burn-mean Lab as a fresh palette entry once the colour engraves consistently across runs, and the SVG layers page learns to match against only those entries.
---

The Stability page kept telling you which cells *drifted* but
gave you nowhere to take that signal. The palette had no concept
of "I've actually seen this colour engrave correctly multiple
times" — auto-match would happily pick the closest entry by
CIEDE2000 even if that entry came from a single dimly-lit photo.
A new VALIDATE mode closes that loop.

### What's new

**Stability page → VALIDATE mode**

A sixth mode pill, sitting alongside SCATTER / SPATIAL / SPECTRUMS
/ POLAR / CALIBRATE. Each cell of the selected validation test is
bucketed by *cross-run stability* — the max ΔE between any single
run's per-cell mean and the across-run consensus. Rows split into:

- **Stable** — every run lands within tolerance of the consensus.
  Save by default.
- **Drifted** — at least one run diverged. Off by default; one
  click promotes a row.
- **Skipped** — fewer than two runs measured this cell.

Hit Save and each accepted row creates a brand-new palette entry
with `is_validated=true` and the consensus Lab as its primary
colour. The original linked entry, if any, stays untouched. The
gate is intra-cell stability — *not* closeness to the original
palette colour, because that colour might itself be wrong from a
poorly-lit first ingest.

The tolerance slider lives at the top of the canvas (default 8
ΔE, range 2–20). Counts update live as the user drags it.

**Palette page → cell back-references**

Validated entries now carry `validated_cell_index` as well as
`validated_test_id`, so the palette UI can link from "this
validated entry" → "the exact cell of that test that produced
it" in one click. The entry detail modal shows the deep-link
under "Source cell"; the cards themselves grow a green `VAL`
pill in the top-left that hover-shows the residual ΔE / run
count / date.

**SVG layers → "Validated only" filter**

A toggle next to the auto-match button restricts both bulk and
per-layer matching to validated palette entries. The suggested-
matches strip's chips also grow `VAL` pills so the filter's
state is visible everywhere it's relevant. Persisted to
localStorage. Empty-state copy distinguishes "no palette match"
from "no validated match" so the user spots when the filter is
the explanation.

**Auto-match crosshatch fix**

A separate but related find: the auto-match path silently dropped
`crosshatch`, `angle_mode`, and `scan_angle` from palette entries
when applying them to a layer. Those three fields live on
`LayerSpec` directly (not inside `base_params`), and the backend
exporter reads them from the top level, so an entry burned with
`crosshatch=1` got applied as `crosshatch=false` and the result
didn't match the validated swatch. Fixed across every code path
that lands a palette entry on a layer.

### Notes

- Save is idempotent per `(test, cell, owner)` — re-running
  validate after uploading more results refreshes the existing
  entry instead of accumulating duplicates. User-curated columns
  (`notes`, `favorited`, `created_at`) stay through the upsert.
- The `/api/palette/validation-status` endpoint moved off its
  earlier ΔE-based heuristic and now reads the `is_validated`
  column directly. Same shape on the wire; the heavy compute it
  used to do on every SVG-layers page open is gone.
