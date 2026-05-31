# Contour Forge — stage-parameter overhaul (machine constraints + Z-descent)

**Status:** design for review (2026-05-31)
**Owner:** Jon
**Route:** `#/forge`
**Branch:** `feat/forge-incise-only` (combined with the incise-only work, one PR)
**Extends:** `2026-05-31-forge-incise-only-design.md`

## Problem

`ForgeStageParams` renders all six per-stage fields as free `NumberField`s
(power / speed / passes / **Z layers** / pulse width / frequency) with a
"`0` = inherit source" convention. Two issues:

1. **No constraints.** The rest of the app constrains laser params to the
   active machine's profile (`DynamicParamForm` → `RangeField` /
   `SteppedField` / `PulseWidthSelect` / `EnumField`, driven by a
   `ValidationProfile`). Forge lets you type any number — e.g. a pulse width
   the F2 Ultra firmware silently rejects. Pulse width should be the shared
   preset **dropdown**, frequency/power/speed/passes/density bounded.
2. **"Z layers" is meaningless in isolation.** It writes `customize.zLayers`,
   which is only one of three coupled fields. In xStudio the control is
   **"Descend at Z-axis"** (`zAxisMove`, bool); when on it exposes
   **"every N layers"** (`zLayers`) and **"by N mm"** (`zDecline`). Shown
   alone, `zLayers` is opaque and overlaps with Passes.

## Decisions (locked with the user)

- **Profile = `COLOR_ENGRAVE`.** The F2 Ultra registry has no incise/INTAGLIO
  profile; the incise source values (freq 65, pulse 200) fit `COLOR_ENGRAVE`
  (freq 60–500, pulse_width stepped) and *not* `STANDARD` (freq 30–60,
  pulse_width `not_applicable`). `COLOR_ENGRAVE` also makes pulse width the
  dropdown the user asked for.
- **One combined branch/PR** with the incise-only work.

## `COLOR_ENGRAVE` constraints (from the live `/api/machines`)

| field | constraint | widget |
|---|---|---|
| power | range 1–100 (step 1) | `RangeField` |
| density | range 1–5000 | `RangeField` |
| frequency | range 60–500 | `RangeField` |
| speed | range 2–15000 | `RangeField` |
| passes | range 1–99 | `RangeField` |
| pulse_width | stepped [2…500] | `PulseWidthSelect` |
| laser | enum red/blue | `EnumField` |

## Design

### 1. `StageParams` model — `types.ts`

Extend (all optional; absent ⇒ inherit source incise value):

```ts
export interface StageParams {
  power?: number;          // → customize.power
  speed?: number;          // → customize.speed
  passes?: number;         // → customize.repeat
  pulseWidth?: number;     // → customize.pulseWidth
  frequency?: number;      // → customize.mopaFrequency
  density?: number;        // → customize.density            (new)
  laser?: "red" | "blue";  // → customize.processingLightSource (new)
  // Z-axis descent group:
  zAxisMove?: boolean;     // → customize.zAxisMove          (new)
  zLayers?: number;        // → customize.zLayers (every N layers)
  zDecline?: number;       // → customize.zDecline (mm per step)  (new)
  sliceNumber?: number;    // → customize.sliceNumber (total slices) (new)
}
```

Also add `params?: StageParams` to `XcsObject` (populated for cut targets from
their INTAGLIO `customize` during parse — see §4) so the page can pre-fill the
widgets from the selected target's source values.

### 2. `applyStageParams` — `xcs.ts`

The `set()` helper currently only writes finite numbers. Extend so it also
writes a boolean (`zAxisMove`) and a string (`laser` → `processingLightSource`).
Add the new mappings:

```ts
set("power", params.power);
set("speed", params.speed);
set("repeat", params.passes);
set("pulseWidth", params.pulseWidth);
set("mopaFrequency", params.frequency);
set("density", params.density);
setStr("processingLightSource", params.laser);   // "red" | "blue"
setBool("zAxisMove", params.zAxisMove);
set("zLayers", params.zLayers);
set("zDecline", params.zDecline);
set("sliceNumber", params.sliceNumber);
```

(`setStr`/`setBool` mirror `set` but for their types; all skip `undefined`.)

### 3. Param widgets — `ForgeStageParams.tsx`

- Resolve the profile once: `useCurrentMachine()` → `getValidationProfile(registry, machineId, "color_engrave")`. While the registry loads (or if the mode is missing) fall back to **free numeric** widgets so the panel never blocks.
- Map snake_case profile keys → camelCase `StageParams` keys
  (`pulse_width`→`pulseWidth`, others 1:1; `frequency`→`frequency` stored, written to `mopaFrequency` on export).
- Render each profile field via the constraint kind: `range`→`RangeField`,
  `stepped`→`SteppedField`, pulse width→`PulseWidthSelect`, `laser`→`EnumField`,
  `not_applicable`→skip. Reuse the existing `dynamic-form/*` components.

### 4. Inherit model — pre-fill from source (CHOSEN: Approach B)

Each field's displayed value = the per-stage override if set, else the
**selected target's own source value**, rendered in the constrained widget.
Editing a field stores an override in `config.stageParams[group]`; a per-stage
**Reset to source** clears that stage's overrides. Storage stays **sparse**
(only edited fields persist) so it's robust across different uploads, while the
widgets always show a concrete starting value (the source) instead of `0`.
Export is unchanged: `buildGeneratedXcs` already clones the source incise
entry as the template, so unset fields keep the source value and
`applyStageParams` writes only the overrides.

**Exposing the source values.** `parseXcsFile` reads each cut target's
INTAGLIO `customize` and attaches a mapped `params: StageParams` to its
`XcsObject`:

```
power→power, speed→speed, repeat→passes, pulseWidth→pulseWidth,
mopaFrequency→frequency, density→density, processingLightSource→laser,
zAxisMove→zAxisMove, zLayers→zLayers, zDecline→zDecline, sliceNumber→sliceNumber
```

The worker already sends `objects`, so no new message is needed — the page
reads `state.objects.find(id === selectedIncise)?.params` and passes it to
`ForgeStageParams` as `sourceParams`.

### 5. Z-descent group + depth stats (replaces the "Z layers" field)

A bordered sub-section:
- **Descend at Z-axis** — toggle (`zAxisMove`).
- When on: **Every N layers** (`zLayers`, int ≥ 1), **By mm** (`zDecline`),
  **Slices** (`sliceNumber`, int ≥ 1) — each with the same override/inherit
  affordance as §4.
- **Live stats** (computed from the effective values — override or source):
  - **Total depth** = `(sliceNumber / zLayers) × zDecline` mm
  - **Depth @ 256 layers** = `(256 / zLayers) × zDecline` mm
  - Shown only when `zAxisMove` is on and `zLayers > 0`; guard divide-by-zero.

### 6. Persistence

`config.stageParams` already round-trips through `localStorage`
(`forge.config.v1`) and `loadConfig` spreads defaults, so the new optional
fields are additive — old saves load unchanged, no migration.

## §4 decision (resolved)

**Approach B — pre-fill from source, edit freely** (user's choice), implemented
the robust way: widgets *display* source-seeded values but storage stays
**sparse** (only edited fields persist), so a stale save never masks a
newly-uploaded file's source. "Reset to source" clears a stage's overrides.
(Approach A — a per-field override toggle — was the alternative; not chosen.)

## Non-goals

- No change to geometry/stages or the deepen layer-range table.
- No wiring of a *dedicated* incise profile into the backend registry (use
  `COLOR_ENGRAVE`); if an incise profile is added later, swap the mode string.
- `scan_angle`/`processAngle`, `bitmapEngraveMode` etc. stay at source values.

## Testing

- `xcs.test.ts`: `applyStageParams` writes `density`, `processingLightSource`
  (from `laser`), `zAxisMove`, `zDecline`, `sliceNumber` into the exported
  INTAGLIO `customize`; unset fields keep the source value.
- A small pure helper for the depth stats (`(slices/everyN)×byMm`,
  `(256/everyN)×byMm`) with a unit test incl. the divide-by-zero guard.
- `ForgeStageParams` component test: pulse width renders as a select of the
  `ALLOWED_PULSE_WIDTHS` presets (not a free number); laser renders red/blue;
  an override toggle gates each field.
- Browser check: upload `test-text.xcs`, confirm constrained widgets + the
  Z-descent stats update live; export and confirm the customize values.

## Risks

- The active machine could be non-F2 (registry lacks `color_engrave`) →
  graceful fallback to free numeric widgets (§3).
- `EnumField`/`SteppedField` value typing is `number | string`; the `laser`
  field must round-trip as a string — keep `StageParams.laser` a string union.
