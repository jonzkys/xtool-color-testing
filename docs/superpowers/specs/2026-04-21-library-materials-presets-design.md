# Library: materials + parameter presets

**Date:** 2026-04-21
**Status:** Design approved, ready for implementation plan

## Problem

Users manually re-type the same `base_params` (power / speed / frequency / density / passes / pulse_width / laser) across every param test, SVG stack generation, and SVG layer. There's no way to save a known-good parameter set, share it across tests in a project, or recall it after a browser clear.

Users also work across multiple physical substrates — stainless steel, anodised aluminium, painted MDF — with wildly different optimal parameters. Grouping presets by material is the natural mental model.

## Goals

1. A browser-local library of **materials** and **parameter presets** under each material.
2. One preset per material is flagged as the default.
3. A "Library" tab manages materials and presets with inline CRUD.
4. All three parameter-editing forms (TestEditor, SvgStackPage, SvgLayersPage per-layer) gain a material+preset picker that can overwrite the form's `base_params` with one click.
5. New tests/layers inherit their material from the most recent prior test (or a global bootstrap) and auto-apply that material's default preset.
6. Schema is DB-migration-ready: UUID ids, timestamps, stable foreign key shape.
7. Palette-ingest (Tasks 10 & 13 of the prior plan) gains a thin material-tagging touchpoint.

## Non-goals

- Import/export of presets (JSON file download/upload) — deferred.
- Multi-select/bulk delete, preset tags beyond name+color, preset duplication button.
- Syncing presets across browsers/devices.
- Backend-hosted presets (DB migration) — schema is DB-ready; actual migration is future work.
- Laser-specific preset validation (`laser` + `frequency` sanity checks).
- Preset history / changelog / diff view.
- Pre-built material/preset libraries shipped in-app.

## Architecture

Pure frontend, stored in a new top-level localStorage key separate from project state. Backend sees only resolved `BaseParams` on the wire (no backend changes except the small palette touchpoint in Section 5). Schema uses UUID ids + ISO timestamps so a future move to server-side storage is a mechanical migration.

## Section 1: Data model

### Material

```typescript
interface Material {
  id: string;             // UUID
  name: string;           // "Stainless Steel", "Anodised Aluminium"
  notes?: string;         // optional free text (schema-only in v1; no edit UI yet)
  created_at: string;     // ISO timestamp
}
```

### Preset

```typescript
interface Preset {
  id: string;             // UUID
  material_id: string;    // foreign key → Material.id
  name: string;           // "Dark blue", "Medium copper"
  color?: string;         // #rrggbb, optional
  is_default: boolean;    // exactly one per material is true
  base_params: {
    power: number;
    speed: number;
    frequency: number;
    density: number;
    passes: number;
    pulse_width: number;
    laser: "red" | "blue";
  };
  created_at: string;
  updated_at: string;
}
```

### LibraryState

Stored at new localStorage key `xcs-gen:library:v1`:

```typescript
interface LibraryState {
  version: 1;
  active_material_id: string;   // global default material for new tests/layers
  materials: Material[];
  presets: Preset[];
}
```

Kept separate from the project key (`xcs-gen:project:v1`) because the library is a personal, project-independent resource. Projects reference materials by id; they do not embed library state.

**Invariants** (enforced by mutation helpers in Section 4):
- `active_material_id` always references an existing material. If the active material is deleted, it's reassigned to the first remaining material; if none remain, forms fall back to `defaultBaseParams()`.
- Exactly one preset per material has `is_default: true`. Creating the first preset in a material auto-flags it default; setting a new default clears the flag on the previous one.

### Tests / layers gain one field

Add `material_id: string | null` to:
- `ParamTest` (pydantic + TypeScript)
- `SvgStackRequest`
- `LayerSpec`

This field records the material the author was targeting — useful for provenance and consumed by the palette-ingest touchpoint (Section 5). It is NOT a `preset_id` — per the "detached copy" decision (Section 3), applying a preset overwrites `base_params` and does not leave a live reference.

### Bootstrap

On first app load (library missing from localStorage), seed:

- **Material:** "Stainless Steel"
- **Preset:** "Default" under Stainless Steel, `is_default: true`, values mirror the current `defaultBaseParams()`:
  - `power: 14.6, speed: 1000, frequency: 125, density: 5000, passes: 1, pulse_width: 200, laser: "red"`

### Migration

`storage.ts`'s `migrateProject` is extended to backfill `material_id: null` on every placement's test that lacks the field. Legacy projects load cleanly.

SvgStackPage and SvgLayersPage state lives in their own localStorage keys if any; the implementation plan's first task will audit the current storage surface and add identical `material_id: null` backfills wherever a stored request carries `base_params`.

## Section 2: Library management page

New tab **"Library"** in TopBar, positioned between "SVG layers" and "Palette" (Palette will arrive with the prior plan's remaining tasks; put Library before it in the tab order).

### Layout

Two panes, fixed widths on desktop:

**Left pane — Materials list**
- Vertical list of all materials, one row per material.
- Each row: name (inline-editable on double-click or "Rename" affordance) + preset-count badge.
- Click a row to select → right pane updates to that material's presets.
- "+ New material" button below the list. Click → opens an input inline for the name; defaults to "Untitled material".
- Delete button per row. Blocked (button disabled + tooltip) if the material still has any presets. User must delete all presets first — prevents accidental preset loss.

**Right pane — Presets under selected material**
- Table or card grid (card grid preferred — more breathable). Each card:
  - **Name** (inline-editable)
  - **Color swatch** with native `<input type="color">` + clear button
  - **Default** radio input. Selecting sets `is_default: true` on this preset and `false` on all other presets for the same material.
  - **Param fields** — seven inline controls: power (float), speed (int), frequency (int), density (int), passes (int), pulse_width (int), laser (red/blue dropdown). Same validation rules as existing base_params fields.
  - **Delete** button with a confirm dialog.
- "+ New preset" button at the top of the right pane. Creates a preset pre-filled from the current default preset of this material; if no default yet, from `defaultBaseParams()`. New preset name defaults to "Untitled preset".

### Persistence

All edits persist immediately to localStorage (`xcs-gen:library:v1`) on every change — mirrors the existing project auto-save behavior. No explicit Save button.

### Empty states

- Library entirely empty (shouldn't happen after bootstrap, defensive): left pane shows "+ New material" as primary CTA with explanation text.
- Material selected but no presets: right pane shows "+ New preset" CTA with explanation.

## Section 3: Form integration

Three forms gain a picker block above their existing `base_params` editor:

- `web/src/components/TestEditor.tsx` — before the base_params section
- `web/src/components/SvgStackPage.tsx` — before the shared base_params
- `web/src/components/SvgLayersPage.tsx` — inside each `LayerSpec` card, before that layer's base_params

### Picker block

```
┌─ Material + preset ─────────────────────┐
│ Material: [ Stainless Steel ▾ ]         │
│ Preset:   [ Default           ▾ ] [Apply]│
│                              ✓ Applied  │
└─────────────────────────────────────────┘
[existing base_params fields below...]
```

- **Material dropdown**: all materials in the library. Defaults to the test/layer's current `material_id`, or the global default material if null.
- **Preset dropdown**: scoped to presets under the currently-selected material. If the user changes the material, the preset dropdown resets to that material's default.
- **Apply button**: overwrites the form's `base_params` with the selected preset's values AND writes the selected material's id to `material_id`.
- **Status indicator**:
  - `✓ Applied` when `base_params` exactly matches the last-applied preset.
  - `Modified` (warning orange) when the user has edited any field after applying.
  - Blank when no preset has been applied yet in this session for this form.

### Why explicit Apply (not auto-apply on change)

Detached-copy semantics mean applying clobbers manual edits. An explicit Apply prevents accidental overwrites while the user browses options. Changing the material dropdown alone does not apply — it only changes which presets are listed.

### Inheritance for new tests/layers

| Trigger | New `material_id` | Auto-apply default preset? |
|---|---|---|
| New test added in a project with existing tests | Copies from the *most recent* test's `material_id` | Yes (default preset of that material) |
| First test in a fresh project | Global default material id | Yes |
| SvgStackPage opened | Global default material id | Yes |
| New layer detected in SvgLayersPage | Global default material id | Yes |

"Global default material" = `library.active_material_id` (defined in Section 1). Bootstrap sets it to the Stainless Steel material's id. User can change the active material from the Library tab via a "Set as active" pill on the currently-selected material.

### Library empty fallback

If no materials exist (user deleted everything), forms show a subdued "No library yet — set up in Library tab" hint and fall back to `defaultBaseParams()` for any new test/layer. No hard errors.

## Section 4: State management

### Library state lives in App.tsx

New state hook alongside `project`:

```typescript
const [library, setLibrary] = useState<LibraryState>(() => loadLibrary() ?? bootstrapLibrary());
useEffect(() => { saveLibrary(library); }, [library]);
```

Library passed down to Library tab, TestEditor, SvgStackPage, SvgLayersPage as a prop (or via React Context if prop-drilling gets ugly — TBD at implementation time based on actual call tree).

### Mutation helpers

New module `web/src/library.ts`:

```typescript
export function loadLibrary(): LibraryState | null;
export function saveLibrary(state: LibraryState): void;
export function bootstrapLibrary(): LibraryState;
export function migrateLibrary(state: unknown): LibraryState;  // defensive

// Mutations (pure; return new state)
export function addMaterial(state, name): LibraryState;
export function deleteMaterial(state, id): LibraryState;  // blocked if presets exist
export function renameMaterial(state, id, name): LibraryState;
export function setActiveMaterial(state, id): LibraryState;

export function addPreset(state, materialId, seed?): LibraryState;
export function deletePreset(state, id): LibraryState;
export function updatePreset(state, id, patch): LibraryState;
export function setDefaultPreset(state, id): LibraryState;  // clears others in same material
```

Pure-function mutations simplify testing (vitest) and React reconciliation.

## Section 5: Palette-ingest tie-in

Additive; doesn't change the shape of Tasks 8–13 already planned.

### At photo-upload time (prior plan's Task 9)

The UI reads `library.active_material_id` and passes it as an optional form field alongside the uploaded image in `/api/capture/ingest`. Backend passes it through to the swatch records.

### Palette entry schema (prior plan's Task 10)

Add one field:

```python
material_id: str | None   # matches a library Material.id; nullable for legacy
```

### Query & browse (prior plan's Task 13)

Palette UI gets a "Filter by material" chip alongside the existing "Filter by test_id" chip.

### Legacy

Palette entries created before this lands have `material_id = null` and show under "Unknown" in filters.

### Plan impact

Tasks 10 and 13 of `docs/superpowers/plans/2026-04-17-photo-palette-ingest.md` each gain one small sub-step (~20 total extra lines) when we resume. Tasks 1–9 of that plan are unaffected.

## Section 6: Scope

### In v1
- Bootstrap library with Stainless Steel + one default preset
- Library tab: materials list + presets cards, inline CRUD, auto-save, set-active-material pill
- Material/preset picker with Apply button on all three forms; Applied/Modified indicator
- Inheritance rules for new tests / SVG stack / SVG layers
- `material_id: null` migration for legacy projects
- `LibraryState` persistence in localStorage under a new key
- Palette-ingest touchpoint documented here (implemented within Tasks 10 & 13 when we resume)

### Deferred
- Preset import/export (JSON download/upload)
- Multi-select / bulk delete
- Preset tags beyond name+color
- Syncing presets across browsers/devices
- Backend-hosted presets / DB migration
- Preset duplication button (workaround: "+ New preset" copies from current default)
- Preset history / changelog
- Material-level `notes` edit UI (schema supports it; UI is v2)

### Explicitly out of scope
- Pre-built material/preset libraries shipped in-app
- Laser-specific validation (warnings when `laser` + `frequency` combination is unusual)
- Preset diff view

## Section 7: Risks & open items

1. **Active-material semantics** — the choice between per-project active material vs global (from `LibraryState`) was simplified to global during brainstorm. If users work across multiple projects with different dominant materials, this could feel wrong. Revisit if real usage surfaces friction.
2. **Prop drilling vs Context** — TBD at implementation; pick whichever keeps the diff smaller.
3. **Concurrent edits in Library tab** — if the user has the Library tab open in two browser tabs, last-write-wins. Acceptable for v1.
4. **Color picker value semantics** — `<input type="color">` only produces `#rrggbb` (no alpha). Preset `color` is optional, clearable via a "×" button next to the swatch.

## Build sequence (for the implementation plan)

1. `web/src/library.ts` — types, load/save/bootstrap/migrate, pure mutation helpers + vitest tests
2. `App.tsx` — load library, pass down as prop or Context
3. `LibraryPage.tsx` — new component, materials list + presets cards, inline edits
4. `TopBar.tsx` — add "Library" tab button
5. Pydantic + TypeScript schema updates — add `material_id: string | null` to ParamTest / SvgStackRequest / LayerSpec; backend passes through
6. `storage.ts::migrateProject` — backfill `material_id: null`
7. Form integration — picker block in TestEditor, SvgStackPage, SvgLayersPage
8. Inheritance logic — new-test material inherits from last test; global fallback for fresh projects / SVG forms
9. Tests — vitest for library mutations; pytest for schema pass-through
