# Laser exposure indices — Design Spec

**Date:** 2026-05-07
**Status:** Approved (design); awaiting implementation plan
**Branch:** new feature branch off `main` (separate from `feat/saved-spectrums`)
**Primary surface:** palette entries (phase 1); plotting / exploration
page enabled but out of scope for phase 1

## Summary

Attach a small set of derived **exposure indices** to every palette
entry, computed from the raw laser parameters already stored. The
indices give a principled way to compare entries that achieve similar
colours via different parameter combinations (higher power vs. lower
frequency vs. tighter line spacing), and form the substrate for a
later exploration page that plots palette entries in
exposure-vs-intensity space, per material.

The core discipline of this design: these are **indices**, not
calibrated physical quantities. xTool's `power` and `density` are
controller settings whose physical mapping isn't guaranteed, so the
formulas are honest products of raw parameters under explicit
"opaque controller setting" framing. Calibration can replace
individual inputs later (e.g. `power_percent` →
`effective_power_index`) without rewriting the surrounding system.

## Goals

- A single, regenerable set of exposure indices on every palette
  entry — including the ones already in the database.
- A pure-function compute module that's the only place a formula
  lives. Future calibration is a swap inside the module, not a search
  across services.
- Schema that supports cheap phase-2 plotting / clustering
  ("scatter all stainless entries by exposure vs. intensity").
- Raw params remain the source of truth; indices are a derived view
  and can be recomputed at any time.
- Naming that doesn't claim physical units we can't back —
  `*_index` for opaque values, `*_mm` only when the underlying inputs
  are themselves trustworthy real units.

## Non-goals (phase 1)

- Indices on saved-spectrum swatches or capture-page heatmap cells.
  The compute module is shared; surfacing them on those pages is
  cheap, but it's deferred to phase 2 to keep this scope focused.
- The exploration / plotting page itself. Phase 1 ends with the
  schema and indices in place; phase 2 designs and ships the page.
- Predictive parameter selection ("you want this colour, here's a
  cheaper way to hit it"). That's downstream of the exploration
  page once we have data points to learn from.
- Per-material weighting of the formulas themselves. Material
  differences live in the *interpretation* (clustering, colour
  curves), not in the indices.
- A calibrated `density_unit` or `effective_power_index`. The seams
  for both are designed in; the calibration work is its own project.

## The indices

Six derived values, computed from `ProcessingParams`:

| Name                      | Formula                                             | Units / framing      |
| ------------------------- | --------------------------------------------------- | -------------------- |
| `pulse_spacing_mm`        | `speed_mm_per_s / (mopa_frequency_khz × 1000)`      | real mm — speed and frequency are trustworthy as physical units |
| `line_spacing_index`      | `1 / density`                                       | dimensionless — density is opaque |
| `line_spacing_mm`         | `null` until `density_model` is calibrated          | real mm or null      |
| `pulse_energy_index`      | `power_percent / mopa_frequency_khz`                | opaque — power is a controller setting |
| `pulse_intensity_index`   | `power_percent / (mopa_frequency_khz × pulse_width_ns)` | opaque |
| `surface_exposure_index`  | `power_percent × density × repeat / speed_mm_per_s` | opaque, spans orders of magnitude (default ≈ 5; fine-stainless ≈ 1280) |

The set is internally consistent: `pulse_intensity_index =
pulse_energy_index / pulse_width`, and `surface_exposure_index ≈
pulse_energy_index × pulses_per_cm² × repeat` (modulo controller-side
constants). That structure is the analytical payoff: two entries with
matching `surface_exposure_index` but different `pulse_intensity_index`
hit the surface with the same total "stuff" but at very different
per-pulse violence — and that's exactly the axis along which colour
families separate.

### Why "exposure" not "dose"

`surface_exposure_index` rather than `surface_dose_index` because
"dose" still carries enough physical baggage (joules per unit area)
that readers will reach for J/cm² mentally. "Exposure" is the
correct register for an opaque-controller index: how much the surface
got exposed to the laser, scaled by controller settings whose true
mapping is unknown.

### Metadata travelling alongside

Three small fields disambiguate the inputs and let the formula
evolve:

- `indices_formula_version: int` — bumped any time a formula or
  calibration source changes. Phase 1 ships at version `1`.
- `density_model: str` — `"opaque"` in phase 1; future values like
  `"lines_per_cm_calibrated"` would unlock `line_spacing_mm`.
- `power_model: str` — `"controller_percent"` in phase 1; future
  `"effective_power_index_v1"` etc. as calibration arrives.

## Architecture

### 1. Pure compute module — `src/xcs_gen/laser_indices.py`

```python
@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_index: float
    line_spacing_mm: float | None
    pulse_energy_index: float
    pulse_intensity_index: float
    surface_exposure_index: float
    formula_version: int
    density_model: str
    power_model: str

INDICES_FORMULA_VERSION = 1

def compute_indices(
    params: ProcessingParams,
    *,
    density_model: str = "opaque",
    power_model: str = "controller_percent",
) -> LaserIndices: ...
```

- Lives in `src/xcs_gen/` (the pure library), not `xcs_gen_web/`. No
  HTTP, no DB, no I/O.
- Guards: zero-division on `speed`, `mopa_frequency`, `density`
  raises `ValueError` with the offending field name. Callers handle
  this — palette entries with non-physical params shouldn't have
  silent NaN indices.
- The `*_model` parameters are the calibration seams. Default values
  give phase-1 behaviour. When calibration ships, the function reads
  the model strings and dispatches to the relevant formula.
- Unit-tested against a fixed table of reference param sets covering
  the defaults plus the stainless / brass / steel examples in
  `generators.py`.

### 2. Schema changes on `palette_entries`

New columns:

```
pulse_spacing_mm         FLOAT
line_spacing_index       FLOAT
line_spacing_mm          FLOAT NULL
pulse_energy_index       FLOAT
pulse_intensity_index    FLOAT
surface_exposure_index   FLOAT
indices_formula_version  INT          NOT NULL DEFAULT 1
density_model            VARCHAR(32)  NOT NULL DEFAULT 'opaque'
power_model              VARCHAR(32)  NOT NULL DEFAULT 'controller_percent'
```

The five non-`line_spacing_mm` numeric columns are nullable in DDL to
allow best-effort backfill, but the repository write path
(`_build_row` in `src/xcs_gen_web/repositories/palette.py`, used by
`insert_bulk` and `replace_for_test`) enforces them as populated on
every write going forward by calling `compute_indices` and writing
the result inline with the row. `line_spacing_mm` is genuinely
nullable for the lifetime of the system — it stays `NULL` while
`density_model = "opaque"`.

Two composite indices to make phase-2 plotting cheap (each scatter
will be "all entries for material X, ordered by some index"):

- `(material_id, surface_exposure_index)`
- `(material_id, pulse_intensity_index)`

Raw params stay in `params_json` untouched. That column is the source
of truth and the input to recompute. The `*_json` blob is legacy
(per the project's stance on JSON in SQL) but isn't being touched as
part of this work — only the new fields are relational.

### 3. Backfill + recompute path

- The alembic migration adds the columns, adds the indices, then
  runs a one-shot data migration: parse `params_json` for each row,
  call `compute_indices`, write the result.
- Best-effort: rows that fail to parse (malformed JSON, missing
  required fields, zero division) are logged and written with
  `indices_formula_version = 0` so a `WHERE indices_formula_version
  = 0` query surfaces them later.
- A new CLI subcommand `xcs-gen recompute-indices` exists for
  re-running:
  - `--material-id N` — limit to one material
  - `--force-version V` — rewrite even rows already at the current
    version (used after a formula change to flush caches)
  - default behaviour: only recompute rows where
    `indices_formula_version != INDICES_FORMULA_VERSION`
- Repository layer: `_build_row` (used by both `insert_bulk` and
  `replace_for_test`) calls `compute_indices` and writes the values
  atomically with the entry. On read, a stale-version warning is
  logged (not raised) when a row is older than
  `INDICES_FORMULA_VERSION`.

### 4. API surface

- `PaletteEntryResponse` (in `schemas.py`) gains a nested `indices`
  object — additive, doesn't break existing consumers.

  ```json
  {
    "id": 42,
    "hex": "#5b3a1f",
    "lab_l": 28.4,
    ...,
    "indices": {
      "pulse_spacing_mm": 0.0154,
      "line_spacing_index": 0.0100,
      "line_spacing_mm": null,
      "pulse_energy_index": 0.769,
      "pulse_intensity_index": 0.00385,
      "surface_exposure_index": 5.0,
      "formula_version": 1,
      "density_model": "opaque",
      "power_model": "controller_percent"
    }
  }
  ```

- No new endpoints in phase 1. The exploration page's data endpoint
  is phase 2.

### 5. UI surface

- A small chip strip on the palette-entry expanded panel (the detail
  view, not the list-view tile).
- Six chips: `pulse_spacing_mm` (mm), the four `_index` values
  (raw values), and `line_spacing_mm` rendered as `—` while null.
  Plus a discreet `v1` formula-version badge so it's visible we're
  not claiming calibrated values.
- Typography: JetBrains Mono for the values, Inter for the labels —
  matches the Workshop Instrument register.
- `surface_exposure_index` gets a small log-scaled bar visual since
  it spans orders of magnitude across realistic param sets. The
  others are shown as numerals only.
- No phase-1 changes to the palette list view. List-view sortability
  by index is a phase-2 concern.

## Data flow

### Create-time (new palette entry)

```
client → POST /palette/entries (or any path that triggers ingestion)
       → repositories.palette.insert_bulk / replace_for_test
            → _build_row builds row dict from input
                → indices = compute_indices(params_from_row)
                → row gets raw params + index columns + version metadata
            → single INSERT writes raw params and indices together
       → 201, response includes `indices` block
```

### Read-time (palette listing / detail)

```
client → GET /palette/entries
       → repository fetches rows (indices already columns)
       → response shape adds `indices` object per entry
       → if any row.formula_version != INDICES_FORMULA_VERSION, log warning
```

### Migration / backfill

```
alembic upgrade
  → add columns + indices
  → for each existing row in palette_entries:
       parse params_json → ProcessingParams
       compute_indices(params)
       update row
     (rows that fail parse get formula_version=0 and a log line)
```

### Future formula change

```
1. Update compute_indices in laser_indices.py
2. Bump INDICES_FORMULA_VERSION
3. Run `xcs-gen recompute-indices` to flush old values
4. (No schema change needed for formula tweaks)
```

## Error handling

- `compute_indices` raises `ValueError` on zero-divides — the
  service layer catches this on writes and returns a 422 with the
  offending field. On the backfill path, the error is logged and the
  row is marked `formula_version=0`.
- `params_json` parse failures during backfill are logged and the row
  is marked `formula_version=0`. They don't block the migration.
- Stale-version reads (rare, only after a formula bump before the
  recompute CLI runs) emit a structured log warning, not an error.
  The user-visible API still returns the stale indices with the old
  `formula_version` field, so the client can choose how to render.

## Testing

- **Unit tests** for `compute_indices`:
  - Reference param table (defaults, stainless example, brass-style,
    a high-frequency / low-power case) with hand-computed expected
    values.
  - Zero-division guards: each of `speed = 0`, `mopa_frequency = 0`,
    `density = 0` raises `ValueError` naming the field.
  - `density_model="opaque"` always yields `line_spacing_mm = None`.
  - `formula_version` matches `INDICES_FORMULA_VERSION` on every
    output.
- **Migration test**: existing CI mysql-migration job runs the new
  migration end-to-end; the alembic version assertion in
  `.github/workflows/ci.yml::mysql-migration-test` is updated in
  the same commit.
- **Repository tests**: `insert_bulk` and `replace_for_test` write
  the indices via `_build_row`; the read path (`list_all`,
  `get_by_id`) includes them; the backfill path correctly handles a
  malformed `params_json` row by writing `formula_version=0`.
- **API tests**: `PaletteEntryResponse` shape includes `indices`
  object; existing tests asserting the shape are updated.
- **Frontend**: vitest covers the chip-strip component renders all
  six values plus the `—` placeholder when `line_spacing_mm` is null.
  Manual Playwright walkthrough on the palette page before merge.

## Phase 1 deliverable checklist

1. `src/xcs_gen/laser_indices.py` + tests
2. Alembic migration: schema + data backfill + CI version assertion
   bump
3. Repository update (`_build_row` + read paths) so indices are
   written on every insert and exposed on every read
4. API schema: `indices` object on `PaletteEntryResponse`
5. UI chip strip on palette-entry detail panel
6. CLI: `xcs-gen recompute-indices`
7. Changelog entry — major level (introduces a user-visible concept,
   warrants a body + screenshot of the chip strip)

## Phase 2 (out of scope, but enabled by this design)

- `#/spectrum/exposure-map` (or similar): 2D scatter of palette
  entries with axis pickers across the four `_index` values,
  filterable by material, points coloured by their actual swatch.
  The composite indices on `palette_entries` make the queries cheap.
- Indices on saved-spectrum swatches and capture-page cells. The
  compute module is already there; the work is schema additions on
  those tables and surfacing in the existing UIs.
- Calibration: ship `density_model = "lines_per_cm_calibrated"`
  and/or `power_model = "effective_power_v1"` as their own designs.
  Each bumps `INDICES_FORMULA_VERSION`; `recompute-indices` flushes
  the cache.
- Predictive parameter selection: given a target colour, suggest a
  parameter triple at lower power that lands in the same exposure /
  intensity neighbourhood as a known palette entry on the same
  material.

## Open questions

None blocking phase 1. The two long-running questions —
**how does xTool's `density` map to physical line spacing?** and
**how does `power_percent` map to effective laser output across
pulse-width presets?** — are explicitly deferred to calibration work,
and the `density_model` / `power_model` strings are the seams that
let that work land without rewriting this layer.
