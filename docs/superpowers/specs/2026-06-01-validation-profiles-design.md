# Machine validation profiles — extraction & population (Phase 1)

**Date:** 2026-06-01
**Status:** Design approved; ready for implementation plan
**Scope:** Phase 1 of a two-phase effort. Phase 2 (a shared validation widget +
converting the ad-hoc param pages) gets its own spec later.

## Problem

The project's machine registry (`src/xcs_gen/machines.py`) and validation
profiles are hand-curated for only two machines (`F2Ultra`, `F1Ultra`) sharing
two profiles (`STANDARD`, `COLOR_ENGRAVE`). The numeric ranges, stepped lists,
and field applicability were approximated, not derived from xTool. We have now
reverse-engineered the authoritative data out of a logged-in xTool Studio
session (see `~/xtool-param-capture/` and the
`reference_xtool_studio_bundle_machine_defs` memory). Phase 1 replaces the
approximations with real per-machine, per-mode constraints for the F2 Ultra and
F1 families, surfacing them through the existing API and UI unchanged.

## Goals

- Extract real validation constraints for six machines and populate the
  project's existing profile model with them.
- Add `intaglio` and `relief` as first-class modes (Forge already needs them).
- Keep the `/api/machines` payload shape, the `FieldConstraint` union, and all
  param widgets **unchanged** — this is a data-population task, not a redesign.
- Make extraction reproducible enough to redo when Studio updates.

## Non-goals (Phase 2)

- No new validation widget; no consolidation of the ad-hoc param pages
  (`BaseParamsEditor`, `PixelArtPage`, `LoomPage`, `AnnotationParamsSection`).
- No source-dynamic profiles (constraints that change live as the user toggles
  the laser source). Phase 1 uses a static superset envelope (see below).
- No expansion of the field vocabulary beyond the current 7 fields.

## Architecture (shape unchanged, more data)

The existing system is already the right shape and is reused verbatim:

- `GET /api/machines` → `{ machines: Machine[], profiles: Record<ProfileId, ValidationProfile> }`.
- `ValidationProfile = Record<field, FieldConstraint>`;
  `FieldConstraint = range{min,max,step?} | stepped{values} | not_applicable | enum{values}`.
- Frontend resolves `machines[id].modes[mode].profile → profiles[profileId]`
  via `getValidationProfile()`; `DynamicParamForm` dispatches widgets by
  `constraint.kind`. **None of this changes.**

What changes is the *content*:

1. **Profiles become machine-specific.** Today `F2Ultra` and `F1Ultra` share
   `STANDARD`/`COLOR_ENGRAVE`. With real data they diverge, so each
   `(machine, mode)` gets its own profile, id `"<machineId>:<mode>"`
   (e.g. `"F2Ultra:color_engrave"`). No cross-machine sharing even if a few end
   up identical — simpler and honest. The shared `STANDARD`/`COLOR_ENGRAVE`
   profiles are removed.
2. **Field vocabulary stays the current 7:** `power, density, frequency, speed,
   passes, pulse_width, laser`.

## Machines in scope & mode availability

Derived from the captured `materialParams` (which `processingType`s each
deviceCode exposes) and `material-device-basic-info` (`sourcePowerAssoc`).

| Machine | Registry id | deviceCode | ext bundle dir | score | engrave | cut | color_engrave | intaglio | relief | sources |
|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| F2 Ultra | `F2Ultra` | GS004-CLASS-4 | `GS004-CLASS-4` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | red@60, blue@40 |
| F2 Ultra Single | `F2UltraSingle` | GS007-CLASS-4 | `GS007-CLASS-4` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | red@60 |
| F2 Ultra UV | `F2UltraUV` | GS009-CLASS-4 | `GS009-CLASS-4` | ✓ | ✓ | ✓ | ? | ✓ | ✓ | uv@5 |
| F1 Ultra | `F1Ultra` | GS002 | `F1Ultra` | ✓ | ✓ | ✓ | ? | ✓ | ✓ | red@20, blue@20 |
| F1 Lite | `F1Lite` | GS005 | `GS005` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | blue@10 |
| F1 | `F1` | MF1 | `F1` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | blue@10, red@2 |

- **Mode mapping:** `score→VECTOR_ENGRAVING`, `engrave→BITMAP_ENGRAVING`,
  `cut→VECTOR_CUTTING`, `color_engrave→`the GS UI mode (`device.gs.color_engrave`),
  `intaglio→INTAGLIO`, `relief→RELIEF`.
- `color_engrave` is a GS UI mode, not a materialParams `processingType` —
  confirmed for the F2 Ultra family; **verify UV / F1 Ultra against their
  bundles during implementation** (the `?` cells).
- F1 Lite / F1 are diode-only → no intaglio/relief.
- F2 Ultra UV also exposes UV-only inner-3D modes
  (`INNER_THREE_D`, `INNER_BITMAP_ENGRAVING`, …); these are **out of scope** —
  only the standard six modes are modelled.
- A `(machine, mode)` profile is emitted **only where the mode is supported**.

## Extraction (per machine × mode × field)

Constraints are spread across three captured sources:

1. **Numeric ranges** (`range` min/max/step) — parse each machine's ext bundle
   (`Resources/exts/<dir>/index.js`) for the **per-mode field-config groups**.
   These hold the mode-specific ranges (e.g. density `1–300` base vs `1–5000`
   in Color Engrave). Minified, so this step is partly automated, partly
   hand-verified.
2. **pulse_width** (`stepped` enum) — IR modes only. Read from the **live editor
   DOM via CDP** per IR machine/mode (`[role=option]` on the open select; the
   method proven during capture). F2 Ultra:
   `[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]` ns. Diode
   machines/modes → `pulse_width: not_applicable`.
3. **laser** (`enum`) — from `sourcePowerAssoc`
   (e.g. F2 Ultra `["red","blue"]`, F1 Lite `["blue"]`, UV `["uv"]`).
4. **`not_applicable`** — derived: if a mode's field group omits a field.
5. **IndexedDB recommended values** — used only as a **sanity cross-check**
   (observed presets must fall within the extracted ranges); not part of the
   profile.

**Tooling (semi-automated):** a Node bundle-parser that emits per-(machine,mode)
ranges and a CDP enum-reader for pulse_width, committed under
`tools/xtool-extract/`. The operator assembles and hand-reviews the final JSON.
Full procedure documented in `docs/.../machine-profile-extraction.md`.

## Source-dependence: superset-envelope rule

Phase 1 profiles are static per `(machine, mode)`, but some constraints differ
by laser source. Resolution rule:

- **Applicability:** a field is included if it applies for *at least one* source
  available in that mode. So `pulse_width` is `stepped` on any machine/mode with
  an IR (red) source, `not_applicable` on pure-diode machines. It may remain
  visible when the user has `blue` selected — a cosmetic imperfection Phase 2's
  widget can hide per-source.
- **Ranges:** where min/max differ by source, take the **union**
  (min-of-mins, max-of-maxes), so the profile never wrongly rejects a value
  valid for *either* source. The profile is the widest honest envelope.

## Data format & backend loading

Committed artifact `src/xcs_gen/data/machine_profiles.json` (numbers below are
**illustrative** — `density 1–5000` and the pulse_width enum are confirmed, but
`frequency`/`speed`/`power` bounds are finalised during extraction, e.g. the
bundle shows base `frequency 40–150` rather than the old hardcoded `60–500`):

```json
{
  "meta": { "source": "xTool Studio 1.7.24", "extracted": "2026-06-01" },
  "profiles": {
    "F2Ultra:color_engrave": {
      "power": {"kind":"range","min":1,"max":100,"step":1},
      "density": {"kind":"range","min":1,"max":5000,"step":1},
      "frequency": {"kind":"range","min":60,"max":500,"step":1},
      "speed": {"kind":"range","min":2,"max":15000,"step":1},
      "passes": {"kind":"range","min":1,"max":99,"step":1},
      "pulse_width": {"kind":"stepped","values":[2,4,6,9,13,20,30,45,60,80,100,150,200,250,350,500]},
      "laser": {"kind":"enum","values":["red","blue"]}
    },
    "F2Ultra:cut": {
      "density": {"kind":"not_applicable"},
      "pulse_width": {"kind":"not_applicable"},
      "...": "..."
    }
  }
}
```

- `machines.py` loads this JSON at import into `PROFILES`, **validating** each
  entry against the `FieldConstraint` union (fail-fast on unknown `kind`,
  `min>max`, empty `stepped`/`enum`).
- The `MachineSpec` registry (ids, display names, `ext_id`/`ext_name`, lasers,
  image paths, supported modes) stays in `machines.py`; each `ModeSpec.profile`
  references a `"<machineId>:<mode>"` id present in the JSON.
- `/api/machines` payload shape is unchanged.

## Validation & backward-compatibility

- Preserve `validate_against_profile` semantics exactly: `range`→reject
  out-of-bounds, `stepped`→snap-to-nearest (record the swap), `not_applicable`→
  reject if present, `enum`→reject if unknown. Preserve the CLAUDE.md snapping
  convention (legacy values snap, don't 422).
- Real ranges are mostly **wider** than today's hardcoded ones (safe). **Any
  field whose real range is *tighter* than the current one is a migration risk**
  for saved specs/tests. During extraction, diff old-vs-new per field and either
  widen to cover, or accept snapping/clamping, and call out each tightening
  explicitly. Frontend `RangeField` already clamps on load.

## What ships in Phase 1 (no widget work)

The real data flows automatically to consumers that already read the registry:

- `DynamicParamForm` via `TestDetailPage`/`ParamTestEditor`.
- `ForgeStageParams` — its `getValidationProfile(registry, machineId,
  "color_engrave")` now returns real F2 Ultra data. (Wiring Forge's
  intaglio/relief stages to those new modes is a Phase 2 nicety.)
- The machine switcher auto-lists the four new machines (needs images).

## Testing

**Backend (pytest):**
- `machine_profiles.json` loads; every entry validates against the
  `FieldConstraint` union (`min≤max`, non-empty `stepped`/`enum`, known `kind`).
- Every `MachineSpec` mode references a profile id that exists in the JSON.
- `/api/machines` returns the six machines with expected modes/profiles; shape
  matches `MachinesPayload`.
- `validate_against_profile` snaps/rejects correctly against a real extracted
  profile.
- Regression: `F2Ultra`/`F1Ultra` and the original four modes still resolve.

**Frontend (vitest):**
- `machine.test.ts`: `getValidationProfile` resolves the new machines/modes.
- Render test: `DynamicParamForm` shows the right widgets for
  `F2Ultra:color_engrave` (pulse_width→stepped/PulseWidthSelect, density→range).
- Adding `intaglio`/`relief` breaks no existing tests.

**Cross-check (documented dev step, not committed):** observed IndexedDB
recommended values fall within the extracted ranges.

## Deliverables

**New**
- `src/xcs_gen/data/machine_profiles.json` — committed extracted data.
- `tools/xtool-extract/` — bundle-parser + CDP enum-reader.
- `docs/.../machine-profile-extraction.md` — reproduction procedure.
- This spec; a changelog entry (new machines + real constraints are
  user-visible).

**Modified**
- `src/xcs_gen/machines.py` — load JSON; add `F2UltraSingle`, `F2UltraUV`,
  `F1Lite`, `F1`; add `intaglio`/`relief` modes; per-machine profile ids; drop
  shared `STANDARD`/`COLOR_ENGRAVE`.
- `web/src/types.ts` and any mode-selector lists — add `intaglio`/`relief` if
  `mode` is a typed union.
- `web/public/machines/` — images for the four new machines.

**Out of git**
- The 5.75 MB IndexedDB dump stays in `~/xtool-param-capture/`.

## Open risks (resolved during implementation)

1. Parsing per-mode ranges from the minified bundle is the hardest part — partly
   manual + hand-verified.
2. `color_engrave` availability on UV / F1 Ultra — verify against their bundles.
3. Whether the pulse_width enum is identical across IR machines — verify per
   machine via DOM.
4. Machine images for the four new machines — source from the bundle or use a
   placeholder.
