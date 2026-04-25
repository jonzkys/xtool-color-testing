# Multi-machine support (F1 Ultra + F2 Ultra)

**Date:** 2026-04-25
**Status:** design — pending implementation plan
**Branch:** `feat/multi-machine-support`
**Surface area:** `src/xcs_gen/machines.py` (new), `src/xcs_gen/model.py`, `src/xcs_gen/builder.py`, `src/xcs_gen/converter.py`, `src/xcs_gen/cli.py`, `src/xcs_gen/pulse_width.py`, `src/xcs_gen_web/schemas.py`, `src/xcs_gen_web/models.py`, `src/xcs_gen_web/app.py`, `src/xcs_gen_web/repositories/{tests,palette,presets}.py`, `alembic/versions/0009_*.py`, `.github/workflows/ci.yml`, `web/src/state/machine.ts` (new), `web/src/api/machines.ts` (new), `web/src/api/{tests,palette,presets,library}.ts`, `web/src/components/TopBar.tsx`, `web/src/components/MachineSwitcher.tsx` (new), `web/src/components/dynamic-form/*` (new), `web/src/pages/{TestsPage,PalettePage,SpectrumPage,LibraryPage,SvgLayersPage,LoomPage}.tsx`, `web/public/machines/*.png` (new), `changelog/2026-04-25-multi-machine.md` (new) + image.

## Goal

Make the workbench machine-aware so we can support more than the F2 Ultra Dual.

1. **Add F1 Ultra** as a second supported machine. New machines are added via a code-level registry; no admin UI.
2. **Per-machine parameter validation** so that out-of-range / out-of-step inputs are rejected (or snapped, where the existing pattern calls for it). Today nothing meaningful is enforced — the schema lets `frequency=999999` through.
3. **Machine-scoped data**: tests, palette entries, and presets belong to a single machine. Switching machines in the UI swaps to that machine's records.
4. **Machine switcher in the TopBar** showing the current machine's product photo, with a popover listing alternatives. Built with `frontend-design` to match the Workshop Instrument aesthetic.
5. **`.xcs` output is machine-correct**: an F1 test produces an F1-loadable file (`extId: "F1Ultra"`, `device.power: [20, 20]`); an F2 test continues to produce `GS004-CLASS-4` / `[60, 40]`.

## Non-goals

- **DB-backed `machines` table** (i.e. machines as data, with admin UI). Code-level registry is the v1; if/when users want to add custom machines without a deploy, we can migrate to a table later. The string-column FK from tests/palette/presets to a machine ID is forward-compatible with that change.
- **Bitmap engraving param shapes.** The codebase doesn't currently emit bitmap-engrave elements, and the user confirmed it's out of scope.
- **Multi-user per-user machine selection.** Standalone-mode this lives in localStorage. Multi-user mode (`XCS_GEN_MODE=multi_user`) layers on later by reading the choice from the user record.
- **Backwards-compatible API shims.** `machine_id` becomes a required parameter on relevant endpoints with no F2 fallback. Existing standalone deployments are migrated by the Alembic backfill; no external API consumers exist.
- **Per-machine materials.** Materials stay global (`materials` table gets no `machine_id`). `presets` is what binds a material to a machine + parameter recipe.
- **Custom machine icons / theming.** Machine cards show a product photo, name, and laser specs. No per-machine accent colour or page chrome.

## Architecture decision: code-level registry + string column

**Machines are declared in `src/xcs_gen/machines.py`** as immutable dataclasses. A new machine = a new entry in that file and (rarely) a new validation profile. Adding F1 Ultra in this PR is the worked example.

**The DB column is a plain `VARCHAR(32)`** (`machine_id`) on `tests`, `palette_entries`, `presets`. No FK to a machines table — the string references the code registry. Validation rejects unknown machine IDs at the API boundary.

The alternatives — DB-backed machines table, or per-machine subclasses of a `Machine` base class — were considered and rejected:

- **DB-backed table** adds migrations, seeding, and JSON-vs-typed-constraints friction for a feature where the machine list grows by code edit, not by user action. Defer until there's a real need.
- **Per-machine subclasses** scatter validation and serialisation logic across many tiny classes and are harder to ship to the frontend (you can't easily serialise a Python class to JSON for the registry endpoint).

The string-column choice keeps Approach B (DB-backed) reachable later: the column already exists; we'd just add the table and a constraint.

## The two parameter profiles

Every (machine, mode) pair maps to one of two named validation profiles. Adding a third machine that fits one of these profiles requires no profile work; only a new machine entry.

### `STANDARD` — F1 Ultra all modes; F2 Ultra cut/score/engrave

| field         | constraint kind | values                                                          |
|---------------|-----------------|-----------------------------------------------------------------|
| `power`       | range           | min 1, max 100, step 1 (percentage)                             |
| `density`     | stepped         | `{10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200}` (lines/cm) |
| `frequency`   | range           | min 30, max 60                                                  |
| `speed`       | range           | min 2, max 10000                                                |
| `passes`      | range           | min 1, max 99 (existing soft cap; keep)                         |
| `pulse_width` | not_applicable  | rejected if present in payload                                  |
| `laser`       | enum            | `{red, blue}` (red == fiber on F1; both machines accept either) |

### `COLOR_ENGRAVE` — F2 Ultra `color_engrave` only

| field         | constraint kind | values                                          |
|---------------|-----------------|-------------------------------------------------|
| `power`       | range           | min 1, max 100, step 1                          |
| `density`     | range           | min 1, max 5000 (continuous)                    |
| `frequency`   | range           | min 60, max 500                                 |
| `speed`       | range           | min 2, max 15000                                |
| `passes`      | range           | min 1, max 99                                   |
| `pulse_width` | stepped         | existing list in `src/xcs_gen/pulse_width.py::ALLOWED_PULSE_WIDTHS` |
| `laser`       | enum            | `{red, blue}`                                   |

### Snap vs reject policy

- **stepped** fields snap to the nearest legal value (existing pattern from `pulse_width`). Rationale: tolerance for legacy data + slider UX where the user nudges a control past a valid step.
- **range** fields reject (HTTP 422) when out of range. No legacy data to be tolerant of for the new machine-specific bounds; surfacing the bug is the right behaviour.
- **not_applicable** fields reject if present in the payload. Don't silently drop — surface the bug.

## Data model

### Machine registry (code) — `src/xcs_gen/machines.py`

```python
from dataclasses import dataclass
from typing import Literal

LaserKind = Literal["fiber", "blue"]
ModeId = Literal["engrave", "score", "cut", "color_engrave"]
ProfileId = Literal["STANDARD", "COLOR_ENGRAVE"]

@dataclass(frozen=True)
class LaserSpec:
    kind: LaserKind
    wattage: int
    spot_mm: tuple[float, float]   # width, height — blue is rectangular

@dataclass(frozen=True)
class ModeSpec:
    id: ModeId
    profile: ProfileId

@dataclass(frozen=True)
class MachineSpec:
    id: str                # e.g. "F2Ultra", "F1Ultra"
    display_name: str
    ext_id: str            # written to .xcs `extId` and `device.id`
    ext_name: str          # written to .xcs `extName`
    image: str             # served at /static/machines/<file>
    lasers: tuple[LaserSpec, ...]
    modes: tuple[ModeSpec, ...]

PROFILES: dict[ProfileId, dict[str, dict]] = { ... }   # constraint dicts

MACHINES: dict[str, MachineSpec] = {
    "F2Ultra": MachineSpec(
        id="F2Ultra",
        display_name="F2 Ultra",
        ext_id="GS004-CLASS-4",
        ext_name="F2 Ultra",
        image="f2ultra.png",
        lasers=(
            LaserSpec("fiber", 60, (0.03, 0.03)),
            LaserSpec("blue",  40, (0.08, 0.10)),
        ),
        modes=(
            ModeSpec("engrave",       "STANDARD"),
            ModeSpec("score",         "STANDARD"),
            ModeSpec("cut",           "STANDARD"),
            ModeSpec("color_engrave", "COLOR_ENGRAVE"),
        ),
    ),
    "F1Ultra": MachineSpec(
        id="F1Ultra",
        display_name="F1 Ultra",
        ext_id="F1Ultra",
        ext_name="F1 Ultra",
        image="f1ultra.png",
        lasers=(
            LaserSpec("fiber", 20, (0.03, 0.03)),
            LaserSpec("blue",  20, (0.08, 0.10)),
        ),
        modes=(
            ModeSpec("engrave", "STANDARD"),
            ModeSpec("score",   "STANDARD"),
            ModeSpec("cut",     "STANDARD"),
        ),
    ),
}

def get(machine_id: str) -> MachineSpec: ...
def profile_for(machine_id: str, mode: ModeId) -> dict: ...
```

The registry is the single source of truth. `Device` in `src/xcs_gen/model.py` loses its hardcoded F2 defaults and becomes a mandatory field on `XCSProject`, populated from `MACHINES[machine_id]`.

### Schema migration `0009_machine_id.py`

Three table changes — performed in three steps each (add nullable, backfill, set NOT NULL):

1. `tests.machine_id VARCHAR(32) NOT NULL` — backfill all rows to `'F2Ultra'`.
2. `palette_entries.machine_id VARCHAR(32) NOT NULL` — backfill all rows to `'F2Ultra'`.
3. `presets.machine_id VARCHAR(32) NOT NULL` — backfill all rows to `'F2Ultra'`.

Plus indexes `(owner_id, machine_id)` on each table to support the `WHERE owner_id=? AND machine_id=?` filters that every list query will use.

`mode` is **not** promoted to a column. Where mode is needed for validation it's read out of `tests.spec_json` (current location — exact JSON path confirmed at implementation; the Explore phase noted spec_json contains the params block but didn't pin down where mode lives within it) or out of the request payload directly. Promoting `mode` to a column is a separate refactor; revisit if validation lookups become a hotspot.

CI's hardcoded migration check (`.github/workflows/ci.yml::mysql-migration-test`) bumps to `0009` in the same commit.

### Type changes — `web/src/types.ts`

```ts
export interface MachineSpec {
  id: string;
  display_name: string;
  ext_id: string;
  ext_name: string;
  image: string;             // resolves under /static/machines/
  lasers: { kind: "fiber" | "blue"; wattage: number; spot_mm: [number, number] }[];
  modes: { id: "engrave" | "score" | "cut" | "color_engrave"; profile: "STANDARD" | "COLOR_ENGRAVE" }[];
}

export interface FieldConstraint {
  kind: "range" | "stepped" | "not_applicable" | "enum";
  min?: number; max?: number; step?: number;
  values?: (number | string)[];
}

export type ValidationProfile = Record<string, FieldConstraint>;

// Existing types gain machine_id:
export interface Test { /* … */ machine_id: string; }
export interface PaletteEntry { /* … */ machine_id: string; }
export interface Preset { /* … */ machine_id: string; }
```

### Cross-table consistency

Enforced in the repository layer (with assertions in tests), not as DB-level FKs — the tables sit under both SQLite and MySQL backends, and the rules involve joins.

- `palette_entries.test_id IS NOT NULL` ⇒ `palette_entries.machine_id == tests.machine_id` (mismatch → 409 `machine_mismatch`).
- A test created from a preset inherits `machine_id` from the preset; explicit override that mismatches → 422.
- `results` are scoped transitively via `test_id`; no column added.
- `machine_id` is **immutable** after row creation. PATCH on tests/palette/presets that includes a different `machine_id` → 422 `machine_immutable`.

## API surface

### New endpoint — `GET /api/machines`

Returns the full registry — machines + profiles — in a single payload. Static for the app's lifetime; the frontend caches indefinitely.

```json
{
  "machines": [
    {
      "id": "F2Ultra",
      "display_name": "F2 Ultra",
      "ext_id": "GS004-CLASS-4",
      "ext_name": "F2 Ultra",
      "image": "/static/machines/f2ultra.png",
      "lasers": [
        {"kind": "fiber", "wattage": 60, "spot_mm": [0.03, 0.03]},
        {"kind": "blue",  "wattage": 40, "spot_mm": [0.08, 0.10]}
      ],
      "modes": [
        {"id": "engrave",       "profile": "STANDARD"},
        {"id": "score",         "profile": "STANDARD"},
        {"id": "cut",           "profile": "STANDARD"},
        {"id": "color_engrave", "profile": "COLOR_ENGRAVE"}
      ]
    },
    {
      "id": "F1Ultra",
      "display_name": "F1 Ultra",
      "ext_id": "F1Ultra",
      "ext_name": "F1 Ultra",
      "image": "/static/machines/f1ultra.png",
      "lasers": [
        {"kind": "fiber", "wattage": 20, "spot_mm": [0.03, 0.03]},
        {"kind": "blue",  "wattage": 20, "spot_mm": [0.08, 0.10]}
      ],
      "modes": [
        {"id": "engrave", "profile": "STANDARD"},
        {"id": "score",   "profile": "STANDARD"},
        {"id": "cut",     "profile": "STANDARD"}
      ]
    }
  ],
  "profiles": {
    "STANDARD": {
      "power":       {"kind": "range",   "min": 1,  "max": 100,   "step": 1},
      "density":     {"kind": "stepped", "values": [10,20,30,40,50,60,70,80,90,100,120,140,160,180,200]},
      "frequency":   {"kind": "range",   "min": 30, "max": 60},
      "speed":       {"kind": "range",   "min": 2,  "max": 10000},
      "passes":      {"kind": "range",   "min": 1,  "max": 99},
      "pulse_width": {"kind": "not_applicable"},
      "laser":       {"kind": "enum",    "values": ["red", "blue"]}
    },
    "COLOR_ENGRAVE": {
      "power":       {"kind": "range",   "min": 1,  "max": 100,   "step": 1},
      "density":     {"kind": "range",   "min": 1,  "max": 5000},
      "frequency":   {"kind": "range",   "min": 60, "max": 500},
      "speed":       {"kind": "range",   "min": 2,  "max": 15000},
      "passes":      {"kind": "range",   "min": 1,  "max": 99},
      "pulse_width": {"kind": "stepped", "values": "<see ALLOWED_PULSE_WIDTHS in src/xcs_gen/pulse_width.py>"},
      "laser":       {"kind": "enum",    "values": ["red", "blue"]}
    }
  }
}
```

### Modified endpoints

| Route                                 | Change |
|---------------------------------------|--------|
| `GET /api/tests`                      | `machine_id` required query param |
| `POST /api/tests`                     | `machine_id` required in body; mode read from spec |
| `GET /api/palette`                    | `machine_id` required query param |
| `GET /api/palette/query`              | `machine_id` required query param |
| `POST /api/palette`                   | `machine_id` required in body |
| `GET /api/presets`                    | `machine_id` required query param |
| `POST /api/presets`                   | `machine_id` required in body |
| `PATCH /api/{tests,palette,presets}/{id}` | `machine_id` immutable; 422 if attempted change |
| `POST /api/tests/{tid}/generate`      | reads `machine_id` from the test row; passes to builder |
| `GET /api/health`                     | extends payload with `available_machines: [ids]` for cheap bootstrap |

### Validation flow on writes

1. Handler resolves `(machine_id, mode)` and loads the validation profile from the registry.
2. Pydantic validator on `BaseParams` walks the profile field-by-field:
   - **stepped**: snap to nearest legal value (existing `pulse_width` pattern).
   - **range**: reject 422 if out of bounds.
   - **not_applicable**: reject 422 if the field is present in the payload.
   - **enum**: reject 422 if not in the set.
3. Repository layer applies the cross-table consistency rules above before insert.

## Frontend

### Machine context — `web/src/state/machine.ts`

- `useCurrentMachine()` — returns `{ machineId, setMachineId, machine }`. Reads/writes `localStorage["xcs.currentMachineId"]`. Cold-start fallback: `"F2Ultra"`. `setMachineId(id)` writes to localStorage and triggers `location.reload()`. Page reload is an honest UX for a rare action where the entire data scope changes wholesale.
- `useMachineRegistry()` — fetches `GET /api/machines` once on mount (via React Query or the existing fetch wrapper, matching project convention). Result is cached for the app's lifetime.
- `useValidationProfile(mode)` — pure derivation: looks up the current machine + given mode in the cached registry, returns the constraint dict. No network.

### Machine switcher — `web/src/components/MachineSwitcher.tsx` (new)

Lives in the existing `TopBar.tsx`, right side of the bar. Built with `frontend-design` agent at implementation time.

Closed state: a compact button showing the current machine's product photo thumbnail (24px square) + the display name.

Open state: a Radix `<Popover>` (consistent with existing Radix usage in the codebase) showing one card per machine. Each card has:

- Larger product photo (~64px square, rounded)
- Display name (Inter)
- Laser specs as small monospaced labels (JetBrains Mono): `fiber 60W · blue 40W`
- Supported modes as pill-style badges: `engrave · score · cut · color engrave`
- Selected machine has a metallic-bar accent border (existing aesthetic primitive)

Clicking a card calls `setMachineId(id)` → reloads the page to the same hash route with the new scope.

### Machine images — `web/public/machines/<id>.png`

Product photos sourced from xtool's product pages, sized to a uniform aspect ratio (square or 4:3). If sourcing in time is friction, the implementation plan can ship with placeholder geometric tiles (matching the blueprint-poster aesthetic) and swap in real photos in a follow-up commit. The product-photo path is preferred.

The backend serves the directory under `/static/machines/` (or whatever the existing static mount is — confirm at implementation).

### Dynamic form rendering — `web/src/components/dynamic-form/*` (new)

The test-create and preset-create forms today render hand-coded fields. They become a single `<DynamicParamForm profile={...} value={...} onChange={...} />` driven by the validation profile:

- `range` constraint → continuous slider + numeric input bound to min/max/step
- `stepped` constraint → a control snapped to allowed values; short lists (≤16) render as a select, longer lists as a discrete slider
- `not_applicable` → field is hidden entirely
- `enum` → select

A new profile in the future = no new form code.

### Page touches

| Page              | Change |
|-------------------|--------|
| Tests             | List query passes `?machine_id=<current>`. Create form reads validation profile from `(currentMachineId, mode)`. Mode dropdown filters to machine-supported modes. |
| Palette           | List query passes `?machine_id=<current>`. Display unchanged. |
| Spectrum / 2D     | Inherit via the underlying palette query — passes `machine_id` through. No display change. |
| Library           | Preset list filtered by `machine_id`. Preset create binds to current machine. Materials list unchanged (global). |
| Loom / SVG Layers | Layer picker scoped to current-machine tests. Composer asserts all selected layers share `machine_id`; mismatch surfaces an error toast. (In normal use this never fires; it catches state drift.) |

### Changelog entry

`changelog/2026-04-25-multi-machine.md` — major level. Title: "Multi-machine support — F1 Ultra joins the party". Body explains the switcher, the per-machine validation, the data scoping. Includes a screenshot of the open switcher popover. Voice: Workshop Instrument register.

## Testing

### Backend

- **`tests/test_machines.py` (new)**: every machine in the registry resolves; every (machine, mode) maps to a known profile; every profile field name matches a `BaseParams` field; profile dicts pass a structural schema check.
- **`tests/test_validation_profiles.py` (new)**: table-driven over `(profile, params) → {ok, snapped, rejected}`. Covers each constraint kind; covers F1 stepped LPC including boundary values (10, 100, 200, 110-snaps-to-100, 130-snaps-to-140); covers F2 color-engrave continuous LPC; covers `not_applicable` rejection.
- **Repository tests**: `create_palette_entry(test_id=X on F2, machine_id="F1Ultra")` → 409. PATCH attempting `machine_id` change → 422.
- **Builder round-trip**: build `.xcs` for an F1 test, parse back, assert `extId/extName/device.power` match the F1 entry. Same for F2 (regression — current samples still load).
- **Migration test**: existing `mysql-migration-test` already exercises the migration; bump the version-assertion line.

### Frontend

- Vitest for `useValidationProfile` (pure derivation, no fetch).
- Vitest for `<DynamicParamForm>` rendering each constraint kind.
- Playwright walkthrough at the end (per CLAUDE.md UI-testing rule):
  1. Land on the app, default machine = F2 Ultra (existing data visible).
  2. Open machine switcher, switch to F1. Page reloads, lists are empty.
  3. Create an F1 test in the engrave mode; assert `pulse_width` field is hidden, LPC is a stepped control, frequency rejects 100 and accepts 45.
  4. Generate the test; download the resulting `.xcs`; assert `extId == "F1Ultra"` in the JSON.
  5. Switch back to F2 Ultra; pre-existing palette entries are intact.

## Rollout

Single PR — `feat/multi-machine-support`. The user explicitly preferred a single PR over the staged-PR alternative to avoid the merge / CI dance.

The PR is large but logically segmented; the commit history within it should reflect that segmentation (registry → migration → backend wiring → frontend context → switcher UI → page touches → tests → changelog) so the reviewer can step through it commit-by-commit if they want.

CI gates: existing pytest + frontend tsc + vitest + alembic migration test all pass green. The migration version assertion in `.github/workflows/ci.yml` is bumped to `0009` in the same commit as `alembic/versions/0009_*.py`.

## Open questions resolved during brainstorming

- *Power semantics on F1 vs F2*: both are 1–100% (LPC was lines-per-cm, not laser power — clarified mid-brainstorm).
- *F1 supports color engrave?*: no — F1's marquee feature is the fiber laser at lower wattage; no MOPA. F1 supports cut / score / engrave only.
- *Backfill correctness*: all existing data → `F2Ultra`. User confirmed treating existing palette/test data as F2 color engrave is fine.
- *Default machine on first run*: localStorage with `F2Ultra` cold-start fallback.
- *Machine switching*: full page reload (honest UX for wholesale data scope change).
- *Loom guard on cross-machine layers*: error toast (silent filtering would hide bugs).
- *Materials*: global, not machine-scoped.
- *API breakage*: clean break — `machine_id` required, no F2 fallback.
- *PR strategy*: single PR (per user preference, to avoid mid-feature merge friction).
- *Beam spot per laser*: yes — moved into `LaserSpec` on the registry. Blue is rectangular (0.08 × 0.10 mm), fiber is square (0.03 × 0.03 mm).
