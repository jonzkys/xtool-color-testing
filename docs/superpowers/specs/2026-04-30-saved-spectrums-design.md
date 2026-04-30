# Saved spectrums — stage 1 design

**Date:** 2026-04-30
**Status:** approved, ready for plan

## Problem

The 1D spectrum page lets users crop a sweep down to a sub-range and read off
a polynomial fit (per-channel L\*/a\*/b\*, with R² per channel). That state is
purely in-memory: there's no DB table for spectrums, no save target, no way to
recall a cropped + fitted slice later.

The user's eventual goal is a separate **predictor page** that takes a target
colour and answers "which saved spectrums could this colour belong to, and
how close is it to each?" The theory: same base material → same equation
shape, possibly with a constant offset, so a fresh test plate can be **fit to
existing spectrums with minimal data**.

This spec covers **stage 1**: the persistence layer + a list page. The
predictor query is stage 2 and lands on top of this storage without
restructuring.

## Solution

A new persistence model for cropped + fitted sub-spectrums, accessible via
a new top-level "Saved spectrums" page in the workbench nav. Save flow lives
on the existing spectrum page next to the fit-quality readout. Storage is
fully relational (three tables — no JSON columns) so future predictor queries
can index Lab bounding boxes and material context without re-parsing blobs.

## Architecture

### Storage shape — three normalised tables

`saved_spectrums` — top-level record, one row per saved sub-spectrum:

| column | type | notes |
|---|---|---|
| `id` | int pk | |
| `name` | str | user-edited at save-time |
| `source_test_id` | FK → `tests.id` | provenance only, `ON DELETE SET NULL` |
| `machine_id` | FK → `machines.id` | scope |
| `material_id` | FK → `materials.id` | denormalised from source test, drives predictor's per-material prefilter |
| `owner_id` | FK → `users.id` | |
| `axis_param` | str | e.g. `"speed"`, `"power"` |
| `axis_min` | float | crop lower bound, in param-space |
| `axis_max` | float | crop upper bound, in param-space |
| `fit_form` | str | `"polynomial"` today; reserved for `"exponential"` etc. |
| `fit_degree` | int | 1, 2, or 3 |
| `fit_l_r2` | float | per-channel R² — fixed shape (always 3 channels) |
| `fit_a_r2` | float | |
| `fit_b_r2` | float | |
| `fit_r2_min` | float | derived = `min(L, a, b)` — indexed for "good fit" filter |
| `displayed_projection` | str | `"pc1" \| "lightness" \| "chroma" \| "hue" \| "hue_raw" \| "a" \| "b" \| "delta_e_first"` — what the user was looking at |
| `lab_l_min` / `lab_l_max` | float | bbox of saved swatches in Lab — indexed |
| `lab_a_min` / `lab_a_max` | float | indexed |
| `lab_b_min` / `lab_b_max` | float | indexed |
| `lab_l_centroid` | float | mean Lab — for "similar to this" ranking |
| `lab_a_centroid` | float | |
| `lab_b_centroid` | float | |
| `created_at` | timestamp | |

Indexes on `saved_spectrums`:
- `(machine_id, material_id, created_at desc)` — list page query
- `(material_id, lab_l_min, lab_l_max)` and likewise for `a`, `b` — predictor bbox prefilter scoped to material
- `fit_r2_min` — filter "show only strong fits"

`saved_spectrum_swatches` — one row per data point inside the saved crop:

| column | type | notes |
|---|---|---|
| `id` | int pk | |
| `saved_spectrum_id` | FK → `saved_spectrums.id`, `ON DELETE CASCADE` | indexed |
| `swatch_row` | int | original test cell coordinates, kept for traceability |
| `swatch_col` | int | |
| `x_value` | float | param value at this swatch |
| `hex` | str(7) | |
| `lab_l` / `lab_a` / `lab_b` | float | |

Composite unique on `(saved_spectrum_id, swatch_row, swatch_col)`.

`saved_spectrum_fit_coefficients` — polynomial coefficients, normalised:

| column | type | notes |
|---|---|---|
| `id` | int pk | |
| `saved_spectrum_id` | FK → `saved_spectrums.id`, `ON DELETE CASCADE` | indexed |
| `channel` | str(1) | `"l" \| "a" \| "b"` |
| `degree` | int | 0..3 |
| `coeff` | float | |

Composite unique on `(saved_spectrum_id, channel, degree)`. A spectrum
with `fit_degree = N` produces `(N+1) * 3` rows here (3 to 12 rows total).

### API

Five endpoints under `/api/spectrums`:

```
POST   /api/spectrums              create
GET    /api/spectrums               list (machine-scoped, optional ?material_id, ?min_r2, ?source_test_id)
GET    /api/spectrums/{id}          full record
PATCH  /api/spectrums/{id}          rename (only ``name`` is mutable in stage 1)
DELETE /api/spectrums/{id}          cascade-delete swatches + coefficients
```

**POST request shape** (Pydantic `SavedSpectrumCreate`):

```python
class SavedSpectrumSwatchInput(BaseModel):
    swatch_row: int
    swatch_col: int
    x_value: float
    hex: str  # "#rrggbb"
    lab: tuple[float, float, float]  # L, a, b

class SavedSpectrumCreate(BaseModel):
    name: str
    source_test_id: int
    axis_param: str
    axis_min: float
    axis_max: float
    fit_form: Literal["polynomial"]
    fit_degree: int  # 1..3
    fit_coefficients: dict[Literal["l", "a", "b"], list[float]]  # length = fit_degree + 1 each
    fit_r2: dict[Literal["l", "a", "b"], float]
    displayed_projection: str
    swatches: list[SavedSpectrumSwatchInput]  # length >= fit_degree + 1
```

Backend responsibilities on POST:
- Validate `len(fit_coefficients[c]) == fit_degree + 1` for each channel.
- Validate `len(swatches) >= fit_degree + 1`.
- Look up `material_id` and `machine_id` from `source_test_id` (request only carries `source_test_id`; the FK denormalisation is server-derived).
- Verify the requesting user owns / can access the source test.
- Compute `lab_*_min/max` and `lab_*_centroid` from the swatches (server-derived — never trust client for bbox math).
- Compute `fit_r2_min = min(fit_r2.values())`.
- Insert in one transaction: `saved_spectrums` row, then `saved_spectrum_swatches` rows, then `saved_spectrum_fit_coefficients` rows.

**Trust boundary** (deliberate): the client computes the polyfit in
`web/src/color/math.ts:407` and posts coefficients + R². The backend does not
recompute the fit. Reasoning: the user is *visually* deciding "this fit is
strong enough" by reading R² off the page; saving exactly what they saw
matches that mental model, and porting `polyFit` to Python only to recompute
the same thing creates a drift bug surface for no gain. A malicious client
sending a fake fit isn't a credible threat for this app.

### Frontend

**Save button** lives in `FitPanel` at `web/src/pages/SpectrumPage.tsx:1989`,
next to the existing degree selector and R² readout. Disabled when:
- the crop is the full sweep (nothing to save),
- `fit_degree === 0` (no equation),
- `swatches_inside_crop.length < fit_degree + 1` (under-determined fit).

Click opens a small dialog with:
- **Name** — text input, default `"<test name> · <axis_param> <min>-<max>"`.
- **Read-only preview** — source test, axis range + point count, fit form +
  degree + per-channel R², Lab range covered by the saved swatches.
- **Save** button — POSTs and shows a toast "Saved · view in Saved
  Spectrums" with a link.

**New page** at hash route `#/saved-spectrums`. New file
`web/src/pages/SavedSpectrumsPage.tsx`. Layout mirrors the Tests list:

- Left rail: filters (material, min R², source test search, sort).
- Right column: cards. Each card shows name, source test (linked), axis range
  and point count, per-channel R², a strip rendered client-side from the
  saved swatches (re-uses `web/src/color/math.ts` math), Lab range, created
  timestamp, and a delete button.
- Empty state: "No saved spectrums yet — save one from the spectrum page" +
  a footer note explaining stage 2 ("These will become the source data for
  the upcoming colour-to-spectrum predictor").

**Nav entry** added to the top nav, after Spectrum.

### Data flow

1. User crops the spectrum page to a sub-range, picks a fit degree, sees
   per-channel R² update.
2. User clicks **Save spectrum** in `FitPanel`. Dialog opens.
3. Dialog reads from `SpectrumBody`'s existing state: source test, crop
   bounds, fit coefficients, R² per channel, swatches inside crop, displayed
   projection.
4. POST `/api/spectrums` with the full payload.
5. Backend validates, derives bbox/centroid from swatches, inserts in one
   transaction across the three tables.
6. Frontend receives the new ID, shows success toast linking to
   `#/saved-spectrums`.
7. Saved Spectrums page lists the record, lets the user delete it.

## Files

| Layer | Path | Change |
|---|---|---|
| Backend | `alembic/versions/0015_saved_spectrums.py` (new) | Three-table migration; cascade FKs; indexes as listed above |
| Backend | `.github/workflows/ci.yml` | Bump hardcoded alembic revision check to 0015 |
| Backend | `src/xcs_gen_web/models.py` | Three SQLAlchemy models |
| Backend | `src/xcs_gen_web/repositories/saved_spectrums.py` (new) | CRUD with multi-table transactions |
| Backend | `src/xcs_gen_web/schemas.py` | `SavedSpectrumCreate`, `SavedSpectrumResponse`, `SavedSpectrumPatch`, `SavedSpectrumSwatchInput` |
| Backend | `src/xcs_gen_web/app.py` | Five endpoints |
| Backend | `tests/test_saved_spectrums_api.py` (new) | Endpoint tests |
| Backend | `tests/test_saved_spectrums_repo.py` (new) | Repository tests |
| Frontend | `web/src/types.ts` | `SavedSpectrum`, `SavedSpectrumCreate`, related types |
| Frontend | `web/src/api/savedSpectrums.ts` (new) | `listSpectrums`, `getSpectrum`, `createSpectrum`, `patchSpectrum`, `deleteSpectrum` |
| Frontend | `web/src/components/SaveSpectrumDialog.tsx` (new) | Save dialog |
| Frontend | `web/src/components/SaveSpectrumDialog.test.tsx` (new) | Dialog rendering + form validation |
| Frontend | `web/src/pages/SpectrumPage.tsx` | Save button in `FitPanel`; disabled-state logic |
| Frontend | `web/src/pages/SavedSpectrumsPage.tsx` (new) | List page |
| Frontend | `web/src/router.ts` | New route `#/saved-spectrums` |
| Frontend | `web/src/components/TopNav.tsx` (or wherever nav lives) | New entry after Spectrum |
| Frontend | `web/src/api/savedSpectrums.test.ts` (new) | API client tests via mock fetch |

## Testing

### Backend

- `tests/test_saved_spectrums_repo.py` — repository unit tests:
  - Create with valid payload → 1 row in each of 3 tables, FKs wired,
    bbox/centroid derived correctly from swatches.
  - Create with `fit_degree = 1` → 2 coefficients per channel = 6 rows.
  - Create with `fit_degree = 3` → 4 coefficients per channel = 12 rows.
  - Cascade-delete: deleting a row in `saved_spectrums` deletes its
    swatches + coefficients.
  - `ON DELETE SET NULL` for `source_test_id`: deleting the source test
    leaves the saved spectrum intact with `source_test_id = NULL`.
- `tests/test_saved_spectrums_api.py` — endpoint integration:
  - POST happy path returns 201 with the full record.
  - POST with mismatched coefficient count (e.g. `fit_degree = 2` but only
    2 coeffs in a channel) returns 422.
  - POST with too-few swatches (under-determined) returns 422.
  - POST referencing a non-existent / non-owned source test returns 404.
  - GET list scoped to current machine.
  - GET list filtered by `material_id`, `min_r2`, `source_test_id`.
  - PATCH renames; doesn't change cascade children.
  - DELETE removes children; subsequent GET returns 404.

### Frontend

- `web/src/components/SaveSpectrumDialog.test.tsx` — vitest with RTL:
  - Disabled save button when no crop / no fit / under-determined.
  - Default name is `"<test name> · <axis_param> <min>-<max>"`.
  - Submit calls `createSpectrum` with the right payload shape.
- `web/src/api/savedSpectrums.test.ts` — fetch mock tests for shape/URL.
- Manual browser walkthrough on a real test: crop, save, verify the new
  page lists it, delete, verify it's gone.

## Migration & rollout

- Alembic revision `0015_saved_spectrums`. Standard pattern; remember to
  bump the hardcoded revision check in `.github/workflows/ci.yml::mysql-migration-test`
  in the same commit (per CLAUDE.md).
- Auto-migrate on startup is on by default
  (`XCS_GEN_AUTO_MIGRATE=true`), so deployment is a redeploy.
- Backwards-compatible: no changes to existing tables, no schema breaks.
  Old clients without the new feature continue to work unchanged.

## Out of scope (stage 2+)

- **The predictor query**: "given a target colour C, find spectrums whose
  bbox covers C and rank by curve residual ΔE, optionally allowing a Δ-Lab
  offset". The schema supports this query out of the box; it's a stage-2
  endpoint + page.
- **Comparison view**: side-by-side rendering of multiple saved spectrums to
  visually inspect the "same equation + offset" theory.
- **Search by colour** on the Saved Spectrums page (find all spectrums whose
  range covers `#rrggbb`).
- **Spectrum merging / consensus** ("average all green-stainless spectrums
  into one canonical curve").
- **Export / share**: portable JSON download of a saved spectrum.
- **Notes / annotation field** on saved spectrums.
- **Migration to Elasticsearch**: deferred until SQL bbox queries actually
  start sweating. The schema is designed so a future denormalised ES index
  is a clean port (every indexed column maps directly to an ES field).
