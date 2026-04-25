# Palette: manual entries + favorites

**Date:** 2026-04-25
**Status:** design — pending implementation plan
**Surface area:** `web/src/components/PalettePage.tsx`, `web/src/components/SvgLayersPage.tsx`, `src/xcs_gen_web/repositories/palette.py`, `src/xcs_gen_web/app.py`, `src/xcs_gen_web/models.py`, `alembic/versions/0008_*.py`, `.github/workflows/ci.yml`.

## Goal

Let users curate the palette beyond what gets ingested from burn results.

1. **Manual entries** — type a hex + a recipe and save it as a palette swatch. Material-scoped, but each entry can be copied to another material.
2. **Favorites** — star any swatch (manual or ingested) to pin it. Per-user (global across materials). The favorites surface is a dedicated tab on the Palette page and a dedicated row on the SVG matcher.

Both feed the existing color-matcher: manual entries rank alongside ingested ones; favorites get their own paginated row underneath the matcher's Suggested grid, closest-first.

## Non-goals

- **Cross-user / public favorites.** Today every palette entry is private and owner-scoped. Adding a join table for shared favoriting is future work.
- **A separate `name` column on `PaletteEntry`.** Manual entries reuse the existing `notes` field for label text.
- **Bulk import** (CSV / JSON drop). One-at-a-time only via the modal.
- **An "auto-match preferring favorites" flag** on the matcher's Auto-match button. Auto-match stays best-of-everything by ΔE.

## Architecture decision: unified table

Manual entries live in `palette_entries` with `source='manual'`. Favoriting is a boolean column on the same table.

The alternative — a separate `manual_palette_entries` table plus a `palette_favorites` join table — was considered and rejected. Reasons:

- The "manual vs ingested" distinction is *provenance*, not *type*. Both are "a recipe for a hex on a material."
- The matcher's `query_by_hex` already loads-and-ranks all rows in Python; folding manual entries into the same table costs nothing at query time.
- Per-user-private favoriting (today's reality) doesn't need a join table — a column on the row works. We'll revisit if/when public entries land.

## Data model

### Schema migration `0008_palette_manual_favorites.py`

Three changes to `palette_entries`:

1. Add `favorited BOOLEAN NOT NULL DEFAULT 0`.
2. Make `test_id` nullable (manual entries aren't tied to a test).
3. Replace the `palette_entries_source_chk` CHECK so `source IN ('averaged','single_result','manual')`.

CI's hardcoded migration check (`.github/workflows/ci.yml::mysql-migration-test`) bumps to `0008` in the same commit.

### Type changes — `web/src/types.ts`

```ts
export interface PaletteEntry {
  // …existing fields
  source: "averaged" | "single_result" | "manual";   // add 'manual'
  test_id: number | null;                             // was: number
  favorited: boolean;                                 // new
}
```

## Repository layer (`repositories/palette.py`)

All new helpers are owner-scoped (mirrors existing pattern).

- `create_manual(material_id, hex_, params, notes, *, owner_id) -> dict` — computes lab via `hex_to_lab`, sets `source="manual"`, `test_id=None`, `sigma=0.0`, `source_result_id=None`, `favorited=False`.
- `update_entry(eid, *, hex_=None, material_id=None, params=None, notes=None, owner_id) -> dict | None` — patch-style for manual entries. Re-computes lab if hex changes. Refuses to mutate `hex/material_id/params` on rows whose `source != 'manual'` (raises a sentinel exception that the route translates to 409 Conflict). Notes are mutable on any row (preserves today's behavior). **Replaces the existing `update_notes` helper** — `update_notes` is deleted; the route layer calls `update_entry` instead.
- `set_favorited(eid, value: bool, *, owner_id) -> dict | None` — idempotent toggle, allowed for any `source`. Returns the updated row, or `None` if not found / wrong owner.
- `query_by_hex` is **unchanged** — manual entries surface naturally because they share the table.
- `list_all` gains optional filters: `favorites_only: bool = False`, `source: str | None = None`. Both default to today's behavior.

## API (`app.py`)

- `POST /api/palette/manual` `{ material_id, hex, params, notes }` → `201 PaletteEntry`. Validates hex regex + material ownership.
- `PATCH /api/palette/{id}` — body widens to `{ hex?, material_id?, params?, notes?, favorited? }`. Backend rejects mutations to `hex/material_id/params` on non-manual rows (`409`). `favorited` accepted on any source.
- `GET /api/palette` — query params widen to `?material_id=&favorites_only=&source=`.

No "copy to material" endpoint — the frontend just calls `POST /api/palette/manual` with the source entry's body and a different `material_id`. Less API surface, identical UX.

## Palette page UX (`PalettePage.tsx`)

### Tabs

`Browse | Manual | Favorites | Query`. The `View` union extends; existing `Tabs` plumbing is reused unchanged.

### Manual tab

Same `Section`-per-material grid as Browse, filtered to `source === "manual"`. Header has a primary `+ Add manual entry` button. Empty state copy: "No manual entries for this material yet — click + to add one."

### Add / edit modal

Radix `Dialog` over the existing `DialogContent` shell.

- Header: `New swatch · <material name>` or `Edit swatch`.
- Material picker: locked to current selection on add; surfaced as a `Select` when no material is preselected.
- Hex picker: native `<input type="color">` paired with mono `Input`, mirroring `QueryView` at `PalettePage.tsx:165-180`.
- Label: optional `Input`, stored in `notes`.
- Base params: re-use `MaterialPresetPicker` to seed from a preset, then `NumberField`s for power/speed/frequency/density/passes plus `PulseWidthSelect` and the laser `Select` — same shape as `LayerEditor` at `SvgLayersPage.tsx:1094-1151`.
- Footer: `Cancel` / `Save`. Save disabled when hex is invalid or material is unset.

### Existing-entry actions on `EntryCard`

The hover-revealed icon group (`Info` / `Trash2` at `PalettePage.tsx:421-437`) gains:

- `Edit` (manual entries only) — re-opens the modal in edit mode, pre-filled.
- `Copy to material…` (manual entries only) — small popover with a material picker; on confirm, calls `POST /api/palette/manual` with the source entry's data and the new material_id.

### Favorites tab

Same Browse-style grouped grid, but `entries.filter(e => e.favorited)` then group by material. Empty state: "Star any swatch to pin it here." Material dropdown still works as a narrowing filter.

### Star button (universal swatch affordance)

Adds an absolutely-positioned star button to the top-right of every `EntryCard` and to the SVG matcher's swatch grid.

- Default: outline, `text-white mix-blend-difference opacity-70`.
- Hover: opacity 1, no fill.
- Favorited: filled gold (`text-amber-400` or `var(--color-accent)`), full opacity, no hover dependency.
- Click: optimistic toggle via `PATCH /api/palette/{id}` with `{ favorited }`; rolls back local state on error.

`InfoModalContent` (the workshop-instrument readout at `PalettePage.tsx:445-637`) gets the same star, top-left next to `DialogClose`.

## SVG matcher integration (`SvgLayersPage.tsx`)

All changes live in `PaletteMatchSection` at `SvgLayersPage.tsx:1296`.

### 1. Manual entries fold into Suggested

`queryPalette` already returns whatever the backend has; once manual entries are in the table they rank alongside ingested ones for free. The match-card grid renders one extra detail: a small `MAN` `Badge` (top-left of the chip) when `entry.source === "manual"`.

### 2. Star toggle on every match card

Same affordance as the Palette page. Click PATCHes the entry, mutates local component state, and invalidates the `paletteCacheRef.current` entry for the current `material_id` so the next auto-match refetches.

### 3. `PaletteFavoritesRow` subcomponent

Renders below the matches grid only when at least one favorite exists for the current `material_id`.

```
┌── Favorites · steel ─────────────────── ‹ 1/3 › ──┐
│  [chip★] [chip★] [chip★] [chip★] [chip★] [chip★]   │
└────────────────────────────────────────────────────┘
```

Behavior:

- **Source data** — fetched once per material via `paletteCacheRef.current`. Cold cache triggers `listPaletteEntries(matIdNum)` (the same call `autoMatchAllLayers` uses), warming both surfaces.
- **Sort** — closest ΔE to `layerColor` first, computed locally with `deltaE2000(target, entryLab)` (mirrors `SvgLayersPage.tsx:282-299`). Re-sorts when `layerColor` changes; trivial cost.
- **Pagination** — auto-fit page size: container width / chip width. Recomputes on resize via `ResizeObserver`. Current page in `useState`, prev/next buttons disabled at boundaries; small `1 / 3` indicator.
- **Card content** — same shape as the Suggested grid card (chip + hex + ΔE + laser dot) so the eye reads them as one continuous palette. Click selects the entry as the active match (drives the same `selectedId` state, so the Apply button picks it up).
- **Empty state** — the row is hidden entirely when no favorites exist for the material; no inline empty-state copy. Discovery happens on the Palette page.

`autoMatchAllLayers` is unchanged — manual entries naturally compete in the closest-match scan; favorites don't override the scan.

### Cache invalidation

When the user toggles a star or saves a manual entry, the matching cache key is dropped from `paletteCacheRef.current` so the next match call refetches. Cheap — palette fetches are <100ms in practice.

## Error handling

- Backend `update_entry` raises a sentinel exception when called against a non-manual row with `hex/material_id/params` mutations; the route layer maps it to `409 Conflict` with body `{"detail": "cannot mutate ingested swatch params"}`.
- Frontend modal disables Save until hex regex (`/^#[0-9a-fA-F]{6}$/`) and material are both valid; surfaces backend errors in a small inline banner above the form footer.
- Star toggle is optimistic; failure rolls back the local boolean and surfaces a toast (or, more realistically here, an inline error in the closest existing error region — there's no global toast system to lean on).
- Existing `delete_entry` and `delete_by_test` are unchanged.

## Testing

### Backend (`tests/`)

- `create_manual` writes a row with the expected shape; round-trip via `list_all`.
- `create_manual` is owner-scoped (user A's row absent from user B's list).
- `query_by_hex` ranks manual alongside ingested (insert one of each, query a hex closer to the manual, assert manual leads).
- `update_entry` succeeds on a `manual` row (hex change re-derives lab); same call against an `averaged` row → 409.
- `set_favorited(eid, True)` idempotent. Allowed on any source. Wrong owner → 404 (mirrors `delete_entry`).
- `PATCH /api/palette/{id}` with `{favorited: true}` round-trips.
- `POST /api/palette/manual` 422 on missing material_id, 422 on bad hex, 201 on valid input.
- Migration test (existing `mysql-migration-test`): bump hardcoded `$VER = "0008"`. Apply on a fresh DB.

### Frontend (`web/src/**/*.test.ts`, vitest)

- Pure unit test for the favorites paginator: given N entries and a container width W, page size = floor(W / chip-width); page-back/forward respects bounds.
- Existing `SvgLayersPage` and `PalettePage` tests should keep passing — the `MAN` badge and favorites row don't change their assertions.

### Manual Playwright walkthrough (per CLAUDE.md "test UI in a real browser")

1. Add a manual entry via the modal → appears in Manual tab and Browse tab.
2. Star a swatch on Browse → appears in Favorites tab grouped under its material. Unstar → disappears.
3. Open `#/svg` with a multi-color image, pick a material with manual entries and at least one favorite:
   1. Manual entry appears in Suggested grid with `MAN` badge.
   2. Favorites row renders below, sorted closest-first.
   3. Pagination prev/next works + reflows on window resize.
   4. Clicking a favorite drives the same Apply button as a regular suggestion.
4. "Copy to material" on a manual entry → appears under the new material with a fresh `id`.

## Rollout

This is a major change (new tab, new matcher feature), so it gets a `changelog/2026-04-25-palette-manual-favorites.md` entry with 1–2 screenshots in `changelog/images/` in the same PR. Filename stem matches the frontmatter `id`. Voice: Workshop Instrument register — concrete and active, no marketing-ese.

Branching follows the standard flow per CLAUDE.md: `feat/palette-manual-favorites`, draft PR, flip to ready when CI green.
