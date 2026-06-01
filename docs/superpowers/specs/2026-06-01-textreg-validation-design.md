# TextReg validation (Phase 3)

**Date:** 2026-06-01
**Status:** Design approved; ready for implementation plan
**Depends on:** Phase 2 (`docs/superpowers/specs/2026-06-01-validation-widget-rollout-design.md`) —
`DynamicParamForm`, `representativeMode`, and the `coerceParams`/`clampToConstraint`
pattern. Branch is stacked on `feat/validation-widget-rollout`.

## Problem

Text-registration (TextReg) params — the per-machine/material defaults for the
fiducial decoration (QR, ArUco, axis marks/labels) — are the one param surface
still outside the validation world. They have:
- their own 7-field schema (`TextRegParamsBody`) with **no upper bounds** on
  `speed`/`mopa_frequency`,
- their own DB-backed 3-tier resolution (material → machine → hardcoded fallback)
  and PUT endpoints that only do loose Pydantic range checks,
- a different field vocabulary: `repeat`/`mopa_frequency`/`processing_light_source`
  vs the profile's `passes`/`frequency`/`laser`,
- a hardcoded form (`TextRegParamsEditor`) that validates nothing.

A user can save a TextReg default of `speed=99999` that silently fails at burn.

## Goals

- Constrain TextReg params by the machine's real validation profile, both in the
  UI (constrained widgets) and on the server (coerce on save).
- Reuse the shared `DynamicParamForm` (one param-form implementation) via a
  vocab adapter — no bespoke TextReg widget logic.
- Keep TextReg's storage shape, endpoints, and 3-tier resolution unchanged.

## Non-goals

- No DB migration (same 7 columns).
- No change to the resolve/read path, the fallback constant, or the 3-tier logic.
- No new "mode" concept; no rejection-style validation (clamp/snap only).

## 1. Profile selection + vocab map

**Which profile.** TextReg is per-machine, and its fiducials emit as fill-engrave,
so it validates against the machine's **representative mode** —
`color_engrave` on the F2 family (IR fill-engrave: pulse-width available, wide
density), `engrave` on diode machines. FE uses Phase 2's `representativeMode`;
BE uses the existing `_default_mode_for(machine_id)` helper in `app.py`. Both
resolve the same profile.

**Vocab map** (one definition each side — `web/src/lib/textRegVocab.ts` and a
mirror `src/xcs_gen_web/text_reg_vocab.py`):

```
power → power            speed → speed            density → density
pulse_width → pulse_width                          (passthrough)
repeat → passes          mopa_frequency → frequency    processing_light_source → laser
```

`toProfile(textReg)` renames for the form/validator; `fromProfile(...)` renames
back for storage/wire. `scan_angle` is not a TextReg field (annotations are
fixed at 90°) and is unaffected.

## 2. Backend coercion

**New `coerce_against_profile(profile_id, params)` in `src/xcs_gen/machines.py`**
(beside `validate_against_profile`) — the Python mirror of Phase 2's
`coerceParams`/`clampToConstraint`:
- `range` → clamp to `[min,max]`, snap to step when step ≥ 1
- `stepped` → snap to nearest (reuse `snap_pulse_width` for `pulse_width`,
  `_nearest_in` otherwise)
- `enum` → keep if allowed, else first
- **`not_applicable` / field-not-in-profile → passthrough unchanged**

The passthrough rule is the deliberate difference from the FE `coerceParams`
(which *drops* `not_applicable`): TextReg persists a fixed 7-column row, so a
field like `pulse_width` on a diode machine must keep its stored value, not be
dropped. Returns a dict preserving all input keys.

> Rationale for a new function rather than reusing `validate_against_profile`:
> the existing validator **rejects** out-of-range `range` values (raises), only
> snapping `stepped`. The user chose clamp/snap semantics, and TextReg has no
> historical upper bounds, so rejecting would 422 legitimate-but-stale saves.

**TextReg PUT handlers** (`/api/text-registration-defaults/machine/{id}` and
`/material/{mid}/{id}` in `app.py`) gain one coercion step before persisting:
1. inbound `TextRegParamsBody` → rename via the Python vocab map
2. `profile_id = profile_for(machine_id, _default_mode_for(machine_id))`
3. `coerce_against_profile(profile_id, mapped)`
4. rename back → store the coerced row

- **Unknown machine / no profile → skip coercion**, store as-is (defensive;
  never 500 on an odd `machine_id`).
- Coercion is **write-only**; the `resolve` read path is unchanged (stored
  values are already clean; pre-existing rows self-heal on next save and the FE
  form clamps on display).

## 3. Frontend

- **`web/src/lib/textRegVocab.ts`** — the field map + `toProfile`/`fromProfile`
  renamers (round-trip safe), mirroring the Python map.
- **`TextRegParamsEditor.tsx` → adapter over `DynamicParamForm`.** Gains a
  `profile: ValidationProfile | null` prop and renders:
  ```tsx
  toProfile(value) → <DynamicParamForm profile={profile} value={mapped}
     onChange={next => onChange(fromProfile(next))} />
  ```
  The 7 fields get the real constrained widgets (pulse-width dropdown, ranges,
  laser enum) with canonical labels (Passes/Frequency/Laser). Null profile →
  "Loading constraints…" placeholder (Phase 2 `BaseParamsEditor` pattern).
- **Parents resolve and pass the profile** (not `useCurrentMachine` inside the
  editor) because `MaterialTextRegPanel` renders **one card per machine** and each
  card must constrain by *its own* machine:
  - `MaterialTextRegPanel`: per card → `getValidationProfile(registry,
    card.machine.id, representativeMode(card.machine))`.
  - `AnnotationParamsSection`: single `machineId` → resolve via the registry +
    `representativeMode`.

## 4. Testing

**Backend (pytest):**
- `coerce_against_profile`: clamp range, snap stepped/pulse, enum keep-or-first,
  **passthrough not_applicable + profile-absent fields**.
- vocab map round-trips (`to`∘`from` = identity on the 7 fields).
- TextReg PUT coerces: `mopa_frequency=99999` on F2 Ultra → stored at the
  profile's frequency max; `pulse_width=7` → snapped; unknown machine → stored
  unchanged.

**Frontend (vitest):**
- `textRegVocab` `toProfile`/`fromProfile` round-trip.
- `TextRegParamsEditor` renders `DynamicParamForm` (pulse-width dropdown present)
  for a profile and maps `onChange` back to TextReg field names; null profile →
  placeholder.

## Deliverables

**New**
- `src/xcs_gen/machines.py::coerce_against_profile` (+ tests)
- `src/xcs_gen_web/text_reg_vocab.py` (+ test)
- `web/src/lib/textRegVocab.ts` (+ test)
- changelog entry

**Modified**
- TextReg PUT handlers in `src/xcs_gen_web/app.py` (map → coerce → map back)
- `web/src/components/TextRegParamsEditor.tsx` (adapter over `DynamicParamForm`)
- `web/src/components/AnnotationParamsSection.tsx` + `MaterialTextRegPanel.tsx`
  (resolve + pass `profile`)

**Untouched:** the resolve/read path, the 3-tier resolution, the fallback
constant, the DB schema (no migration).

## Edge cases

- Unknown `machine_id` on PUT → skip coercion, store as-is.
- `not_applicable` field for the machine/mode → passthrough (keep the column
  value; the form simply won't expose it for editing).
- Pre-existing DB rows are not re-coerced until their next save; the FE form
  clamps them on display, so the user always sees in-range values.
