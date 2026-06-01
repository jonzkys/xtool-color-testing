# Shared validation widget + rollout (Phase 2)

**Date:** 2026-06-01
**Status:** Design approved; ready for implementation plan
**Depends on:** Phase 1 (`docs/superpowers/specs/2026-06-01-validation-profiles-design.md`) —
the real per-machine/mode profiles served by `/api/machines`. Branch is stacked on
`feat/machine-validation-profiles`.

## Problem

Phase 1 gave the project real per-(machine, mode) validation profiles, but only the
surfaces that already read the registry (`ParamTestEditor`/`DynamicParamForm`,
`ForgeStageParams`) benefit. Several param-input surfaces still use hardcoded ranges
or no validation at all:

- `BaseParamsEditor` — hardcoded NumberFields (used by Material calibration + Loom).
- `LoomPage` ramp stops — **no validation**: a power of 999 is accepted and only
  fails at burn time.
- `ParamTestEditor` carries a duplicate hardcoded fallback form.

Also, the clamp/snap logic is **duplicated** inside `RangeField`, `SteppedField`, and
`PulseWidthSelect`, with no reusable validator — so spot-validation (e.g. a ramp stop)
has nothing to call.

## Goals

- One reusable validation core (`clampToConstraint` / `coerceParams`) that the widgets,
  the ad-hoc surfaces, and spot-validation all share, mirroring the backend's
  `validate_against_profile`.
- Every base-params surface renders the real per-machine/mode constraints through the
  single existing `DynamicParamForm`.
- Loom ramp stops validated against the active profile (fixes the silent power=999 bug).
- Consistent UX: clamp/snap on commit + a "(legacy)" annotation when a loaded value was
  coerced; never hard-block input.

## Non-goals (deferred / out of scope)

- **TextReg** (`AnnotationParamsSection` / `TextRegParamsEditor`) — its own schema,
  `/api/text-registration-defaults` endpoint, and field vocabulary
  (`repeat`/`mopa_frequency`/`processing_light_source`). Gets its own spec.
- **PixelArt** — per-layer params are baked from palette entries (read-only); nothing
  to convert.
- **HatchPassesEditor** — hatch-specific (pass angles), not base_params.
- No backend changes; no new param-form implementation (reuse `DynamicParamForm`).
- No hard-reject/error-state validation; no per-surface mode pickers.

## 1. Shared validation core — `web/src/lib/constraints.ts`

A pure, dependency-free module (imports only `snapPulseWidth`) that centralizes what is
currently duplicated and mirrors `xcs_gen.machines.validate_against_profile`:

```ts
// Coerce one value to satisfy one constraint. Returns the coerced value.
clampToConstraint(value: number | string, c: FieldConstraint): number | string
//  range          → clamp to [min,max], then snap to step (when step >= 1)
//  stepped        → nearest allowed value (pulse_width reuses snapPulseWidth;
//                   others: nearest by numeric distance, or string equality)
//  enum           → value if in the allowed set, else the first allowed value
//  not_applicable → value unchanged (callers drop it; see coerceParams)

// Coerce a whole param dict against a profile.
coerceParams(
  profile: ValidationProfile,
  values: Record<string, number | string>,
): {
  values: Record<string, number | string>;        // not_applicable fields DROPPED
  changed: Record<string, [original: number|string, coerced: number|string]>;
}
```

- **DRY:** `RangeField`, `SteppedField`, `PulseWidthSelect` are refactored to call
  `clampToConstraint` instead of their own inline clamp/snap math — so the form,
  spot-validation, and backend all agree. Behavior must be identical (existing widget
  tests are the guard).
- **`coerceParams` drops `not_applicable` fields** → a surface can safely submit params
  for a machine/mode where a field doesn't apply without tripping the backend's
  `not_applicable`→422. The `changed` map is what drives the "(legacy)" annotation.

## 2. Base-params surface conversions

- **`BaseParamsEditor` → profile-aware wrapper around `DynamicParamForm`.** It resolves
  the active profile (`useCurrentMachine` + a mode, see §4) and renders the real
  constrained widgets, mapping its existing `BaseParams` `value`/`onChange` onto
  `DynamicParamForm`'s. **Callers do not change**, so two surfaces upgrade for free:
  - **Material calibration** (`MaterialEditDialog`)
  - **Loom base params** (`LoomPage`)
  When the registry/profile hasn't loaded, render a disabled placeholder — the hardcoded
  NumberFields are removed, not kept as a fallback.
- **`ParamTestEditor`** — drop the duplicate hardcoded fallback (≈ lines 1091–1127). The
  profile path is the single code path; if a profile is ever null it falls back to the
  same profile-aware `BaseParamsEditor`, not a bespoke form.

Result: exactly one param-form implementation in the app, every base-params surface
showing real per-machine/mode constraints.

## 3. Loom ramp-stop validation

Loom ramps are `{ param, axis, stops: [{position, value}] }`; stop `value`s are entered
by double-click prompt or rail drag, currently unvalidated.

- For each ramp, resolve the `FieldConstraint` for its `param` from the active profile
  (current machine + representative mode, §4). On every stop-value commit (prompt **and**
  drag), run it through `clampToConstraint` — ranges clamp to `[min,max]`, `pulse_width`
  snaps to the allowed enum.
- The draggable rail's value axis is bounded to `[min,max]` so a stop cannot be dragged
  out of range.
- **Filter the ramp-param dropdown** to fields applicable to the current machine/mode —
  e.g. no ramping `pulse_width` on a diode machine where it's `not_applicable`.
- **`spacing`** is hatch-specific and not in the 7-field vocabulary → keeps its existing
  handling (left unvalidated). Explicitly out of scope, not an omission.

## 4. Mode resolution for non-test surfaces

Profiles are keyed by `(machine, mode)`, but calibration / Loom have no explicit mode.
One shared helper, mirroring the backend's `_default_mode_for`:

```ts
// web/src/state/machine.ts
representativeMode(machine: Machine): ModeId
//  → "color_engrave" if the machine supports it, else "engrave"
```

- `BaseParamsEditor` gains an optional `mode?` prop; callers with a natural mode pass it,
  otherwise it defaults to `representativeMode(currentMachine)`.
- Loom (base + ramps) and Material calibration use `representativeMode`. On F2 Ultra that
  is `color_engrave` — the widest envelope (density to 5000, pulse-width available),
  appropriate for high-density hatch fills and calibration; on diode machines, `engrave`.

No new UI; the `mode?` prop is there if a surface later needs an explicit mode.

## 5. Testing

Frontend-only (vitest):

- **`constraints.test.ts`** — `clampToConstraint`: range clamp + step-snap,
  stepped/pulse-width nearest-snap, enum keep-or-first-fallback, `not_applicable`
  passthrough; `coerceParams`: drops `not_applicable`, records `changed`, leaves valid
  dicts untouched.
- **Refactor guard** — existing `RangeField`/`SteppedField`/`PulseWidthSelect`/
  `DynamicParamForm` tests stay green unchanged (proves delegation is behavior-preserving).
- **`BaseParamsEditor`** — renders `DynamicParamForm` with the resolved profile; disabled
  placeholder when no registry; respects the `mode` prop.
- **`representativeMode`** — color_engrave-capable → `color_engrave`, else `engrave`.
- **Loom** — a stop committed out of range is clamped; ramp-param list excludes
  `not_applicable` fields; `spacing` still works.

## Deliverables

**New**
- `web/src/lib/constraints.ts` + `web/src/lib/constraints.test.ts`
- `representativeMode` in `web/src/state/machine.ts` (+ test)
- changelog entry

**Modified**
- `web/src/components/dynamic-form/RangeField.tsx`, `SteppedField.tsx`,
  `web/src/components/PulseWidthSelect.tsx` — delegate to `clampToConstraint`
- `web/src/components/BaseParamsEditor.tsx` — profile-aware wrapper
- `web/src/components/ParamTestEditor.tsx` — drop hardcoded fallback
- `web/src/pages/LoomPage.tsx` — ramp-stop clamping + param-list filtering

**Untouched (deferred):** TextReg, PixelArt, HatchPassesEditor.

**Verification:** `npx tsc --noEmit`, `npm test`, `npm run build`, plus a browser pass
(Loom ramp clamps; Material calibration + Loom base params show real constrained widgets).
