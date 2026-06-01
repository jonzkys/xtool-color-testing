# TextReg Validation (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain text-registration (fiducial) params by the machine's real validation profile — in the UI (shared `DynamicParamForm` via a vocab adapter) and on the server (clamp/snap on save).

**Architecture:** A bidirectional TextReg↔profile vocab map (mirrored TS + Python) renames `repeat↔passes` / `mopa_frequency↔frequency` / `processing_light_source↔laser`. A new backend `coerce_against_profile` (clamp-mode mirror of Phase 2's `coerceParams`) coerces saved defaults against the machine's representative-mode profile. The TextReg form becomes a thin adapter over `DynamicParamForm`.

**Tech Stack:** Python/FastAPI + pytest (backend); React/TypeScript + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-01-textreg-validation-design.md`
**Branch:** `feat/textreg-validation` (stacked on `feat/validation-widget-rollout`).

---

## File Structure

**New:**
- `src/xcs_gen_web/text_reg_vocab.py` — Python TextReg↔profile field map + `to_profile`/`from_profile`.
- `web/src/lib/textRegVocab.ts` — TS mirror.
- tests for each new unit.
- `changelog/2026-06-01-textreg-validation.md`.

**Modified:**
- `src/xcs_gen/machines.py` — add `coerce_against_profile`.
- `src/xcs_gen_web/app.py` — coerce in the two TextReg PUT handlers.
- `web/src/components/TextRegParamsEditor.tsx` — adapter over `DynamicParamForm`.
- `web/src/components/AnnotationParamsSection.tsx` + `MaterialTextRegPanel.tsx` — resolve + pass `profile`.

**Untouched:** resolve/read path, 3-tier resolution, fallback constant, DB schema (no migration).

---

## Task 1: `coerce_against_profile` (backend, TDD)

**Files:**
- Modify: `src/xcs_gen/machines.py`
- Modify: `tests/test_validation_profiles.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_validation_profiles.py`:

```python
def test_coerce_against_profile_clamps_and_snaps():
    from xcs_gen import machines
    pid = machines.profile_for("F2Ultra", "color_engrave")  # power 1-100, pulse_width stepped, laser enum
    out = machines.coerce_against_profile(pid, {
        "power": 999,          # range -> clamp to 100
        "pulse_width": 7,      # stepped -> snap to 6
        "laser": "green",      # enum -> first allowed
        "speed": 1000,         # in range -> unchanged
    })
    assert out["power"] == 100
    assert out["pulse_width"] == 6
    assert out["laser"] in ("red", "blue")
    assert out["speed"] == 1000


def test_coerce_against_profile_passes_through_unconstrained_fields():
    from xcs_gen import machines
    # F1Lite: diode-only -> pulse_width is not_applicable; frequency not_applicable.
    pid = machines.profile_for("F1Lite", "engrave")
    out = machines.coerce_against_profile(pid, {
        "pulse_width": 200,    # not_applicable -> passthrough (NOT dropped)
        "frequency": 9999,     # not_applicable -> passthrough
        "scan_angle": 45,      # absent from profile -> passthrough
        "power": 999,          # range -> clamp
    })
    assert out["pulse_width"] == 200
    assert out["frequency"] == 9999
    assert out["scan_angle"] == 45
    assert out["power"] == 100
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_validation_profiles.py -k coerce -q`
Expected: FAIL — `coerce_against_profile` not defined.

- [ ] **Step 3: Implement**

In `src/xcs_gen/machines.py`, after `validate_against_profile`, add:

```python
def coerce_against_profile(profile_id: str, params: dict) -> dict:
    """Clamp/snap ``params`` to satisfy the profile, returning a coerced dict.

    Unlike ``validate_against_profile`` (which REJECTS out-of-range ``range``
    values), this clamps them — the clamp-mode mirror of the frontend's
    ``coerceParams``. Fields the profile marks ``not_applicable`` OR doesn't
    mention are passed through UNCHANGED (callers persist fixed-shape rows, so
    we never drop a key). Only ``range``/``stepped``/``enum`` fields move.
    """
    if profile_id not in PROFILES:
        raise KeyError(f"unknown profile_id: {profile_id!r}")
    profile = PROFILES[profile_id]
    out = dict(params)
    for field_name, v in params.items():
        constraint = profile.get(field_name)
        if constraint is None:
            continue
        kind = constraint["kind"]
        if kind == "range":
            lo, hi = constraint["min"], constraint["max"]
            try:
                n = float(v)
            except (TypeError, ValueError):
                continue
            step = constraint.get("step")
            if step and step >= 1:
                n = lo + round((n - lo) / step) * step
            out[field_name] = max(lo, min(hi, n))
        elif kind == "stepped":
            allowed = constraint["values"]
            if v in allowed:
                continue
            if field_name == "pulse_width":
                out[field_name] = snap_pulse_width(float(v))
            else:
                out[field_name] = _nearest_in(allowed, float(v))
        elif kind == "enum":
            if v not in constraint["values"]:
                out[field_name] = constraint["values"][0]
        # not_applicable / unknown kind: passthrough (leave out[field_name] as-is)
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_validation_profiles.py -k coerce -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/machines.py tests/test_validation_profiles.py
git commit -m "feat(machines): coerce_against_profile (clamp-mode coercion)"
```

---

## Task 2: Python vocab map (TDD)

**Files:**
- Create: `src/xcs_gen_web/text_reg_vocab.py`
- Create: `tests/test_text_reg_vocab.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_text_reg_vocab.py`:

```python
from xcs_gen_web.text_reg_vocab import to_profile, from_profile, TEXTREG_TO_PROFILE


def test_renames_to_profile_vocab():
    out = to_profile({
        "power": 50, "speed": 1000, "density": 100,
        "repeat": 2, "mopa_frequency": 60, "pulse_width": 200,
        "processing_light_source": "red",
    })
    assert out == {
        "power": 50, "speed": 1000, "density": 100,
        "passes": 2, "frequency": 60, "pulse_width": 200, "laser": "red",
    }


def test_round_trip_is_identity():
    src = {
        "power": 50, "speed": 1000, "density": 100,
        "repeat": 2, "mopa_frequency": 60, "pulse_width": 200,
        "processing_light_source": "red",
    }
    assert from_profile(to_profile(src)) == src


def test_map_is_bijective_on_renamed_keys():
    # the three renames must not collide
    assert TEXTREG_TO_PROFILE["repeat"] == "passes"
    assert TEXTREG_TO_PROFILE["mopa_frequency"] == "frequency"
    assert TEXTREG_TO_PROFILE["processing_light_source"] == "laser"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_text_reg_vocab.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/xcs_gen_web/text_reg_vocab.py`:

```python
"""TextReg <-> validation-profile field-name vocabulary.

TextReg stores ``repeat``/``mopa_frequency``/``processing_light_source``;
the validation profiles use ``passes``/``frequency``/``laser``. These maps
rename in both directions so TextReg params can be validated/rendered with
the shared profile machinery. Keep in sync with web/src/lib/textRegVocab.ts.
"""

from __future__ import annotations

TEXTREG_TO_PROFILE: dict[str, str] = {
    "repeat": "passes",
    "mopa_frequency": "frequency",
    "processing_light_source": "laser",
}
PROFILE_TO_TEXTREG: dict[str, str] = {v: k for k, v in TEXTREG_TO_PROFILE.items()}


def to_profile(params: dict) -> dict:
    """Rename TextReg field names to profile field names (others passthrough)."""
    return {TEXTREG_TO_PROFILE.get(k, k): v for k, v in params.items()}


def from_profile(params: dict) -> dict:
    """Rename profile field names back to TextReg field names."""
    return {PROFILE_TO_TEXTREG.get(k, k): v for k, v in params.items()}
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_text_reg_vocab.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/text_reg_vocab.py tests/test_text_reg_vocab.py
git commit -m "feat(textreg): python vocab map (TextReg <-> profile)"
```

---

## Task 3: Coerce in the TextReg PUT handlers (TDD)

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `tests/test_validation_endpoints.py` (or wherever TextReg endpoints are tested — search first; if none, create `tests/test_text_reg_coerce.py`)

- [ ] **Step 1: Write the failing test**

First find an existing TextReg endpoint test to copy the client/auth fixture pattern: `grep -rn "text-registration-defaults" tests/`. Using that fixture style, add a test (in the file that already has the TextReg PUT fixtures, or a new `tests/test_text_reg_coerce.py`):

```python
def test_machine_put_coerces_out_of_range(client, auth_headers):
    # F2Ultra:color_engrave frequency max is 150; speed max 15000.
    body = {
        "speed": 99999, "power": 50, "density": 100, "repeat": 2,
        "pulse_width": 7, "mopa_frequency": 99999, "processing_light_source": "red",
    }
    r = client.put("/api/text-registration-defaults/machine/F2Ultra",
                   json=body, headers=auth_headers)
    assert r.status_code == 200
    out = r.json()
    # speed clamped to the profile max; mopa_frequency clamped; pulse_width snapped.
    from xcs_gen import machines
    prof = machines.PROFILES[machines.profile_for("F2Ultra", "color_engrave")]
    assert out["speed"] == prof["speed"]["max"]
    assert out["mopa_frequency"] == prof["frequency"]["max"]
    assert out["pulse_width"] == 6
    assert out["power"] == 50


def test_machine_put_unknown_machine_stores_as_is(client, auth_headers):
    body = {
        "speed": 99999, "power": 50, "density": 100, "repeat": 2,
        "pulse_width": 200, "mopa_frequency": 60, "processing_light_source": "red",
    }
    r = client.put("/api/text-registration-defaults/machine/NoSuchMachine",
                   json=body, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["speed"] == 99999  # no profile -> unchanged
```

(Adapt `client`/`auth_headers` to the actual fixtures in the file you copied from.)

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_text_reg_coerce.py -q` (or the file you added to)
Expected: FAIL — speed not clamped (handler stores raw body).

- [ ] **Step 3: Implement the coercion helper + wire both PUT handlers**

In `src/xcs_gen_web/app.py`, near the TextReg handlers (which start at the `from .repositories import text_reg_defaults as treg_repo` line ~2707, inside `create_app`), add a nested helper (it can close over `_default_mode_for`, defined earlier in `create_app`):

```python
    from xcs_gen import machines as _machines
    from .text_reg_vocab import to_profile as _treg_to_profile, from_profile as _treg_from_profile

    def _coerce_text_reg(machine_id: str, params: dict) -> dict:
        """Clamp/snap TextReg params against the machine's representative-mode
        profile. Unknown machine/mode -> return unchanged."""
        try:
            profile_id = _machines.profile_for(machine_id, _default_mode_for(machine_id))
        except KeyError:
            return params
        coerced = _machines.coerce_against_profile(profile_id, _treg_to_profile(params))
        return _treg_from_profile(coerced)
```

Then in `text_reg_machine_put` (line ~2780), replace `params=body.model_dump(),` with the coerced dict:

```python
        row = treg_repo.upsert_machine(
            owner_id=user_id, machine_id=machine_id,
            params=_coerce_text_reg(machine_id, body.model_dump()),
        )
```

And in `text_reg_material_put` (line ~2827), likewise:

```python
        row = treg_repo.upsert_material(
            owner_id=user_id, machine_id=machine_id,
            material_id=material_id,
            params=_coerce_text_reg(machine_id, body.model_dump()),
        )
```

> NOTE: `_default_mode_for` is the existing nested helper in `create_app` (around line 1288). If it's defined AFTER the TextReg handlers in source order, move the `_coerce_text_reg` definition below it, or hoist `_default_mode_for` above the TextReg block. Verify ordering when you implement.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_text_reg_coerce.py -q`
Expected: PASS.

- [ ] **Step 5: Run the TextReg + machines suites for regressions**

Run: `uv run --active pytest tests/ -k "text_reg or machines or validation" -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py tests/
git commit -m "feat(textreg): coerce saved defaults against the machine profile"
```

---

## Task 4: Frontend vocab map (TDD)

**Files:**
- Create: `web/src/lib/textRegVocab.ts`
- Create: `web/src/lib/textRegVocab.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/textRegVocab.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toProfile, fromProfile } from "./textRegVocab";
import type { TextRegParamsBody } from "../types";

const tr: TextRegParamsBody = {
  power: 50, speed: 1000, density: 100, repeat: 2,
  pulse_width: 200, mopa_frequency: 60, processing_light_source: "red",
};

describe("textRegVocab", () => {
  it("renames to profile vocab", () => {
    expect(toProfile(tr)).toEqual({
      power: 50, speed: 1000, density: 100, passes: 2,
      pulse_width: 200, frequency: 60, laser: "red",
    });
  });
  it("round-trips to identity", () => {
    expect(fromProfile(toProfile(tr))).toEqual(tr);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/lib/textRegVocab.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `web/src/lib/textRegVocab.ts`:

```typescript
import type { TextRegParamsBody } from "../types";

/** TextReg field name -> validation-profile field name. Others passthrough.
 *  Mirror of src/xcs_gen_web/text_reg_vocab.py. */
const TEXTREG_TO_PROFILE: Record<string, string> = {
  repeat: "passes",
  mopa_frequency: "frequency",
  processing_light_source: "laser",
};
const PROFILE_TO_TEXTREG: Record<string, string> = Object.fromEntries(
  Object.entries(TEXTREG_TO_PROFILE).map(([k, v]) => [v, k]),
);

export type ProfileShapedParams = Record<string, number | string>;

/** Rename TextReg fields to profile field names for the shared form/validator. */
export function toProfile(v: TextRegParamsBody): ProfileShapedParams {
  const out: ProfileShapedParams = {};
  for (const [k, val] of Object.entries(v)) out[TEXTREG_TO_PROFILE[k] ?? k] = val as number | string;
  return out;
}

/** Rename profile field names back to TextReg fields for storage/wire. */
export function fromProfile(p: ProfileShapedParams): TextRegParamsBody {
  const out: Record<string, number | string> = {};
  for (const [k, val] of Object.entries(p)) out[PROFILE_TO_TEXTREG[k] ?? k] = val;
  return out as unknown as TextRegParamsBody;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run src/lib/textRegVocab.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/textRegVocab.ts web/src/lib/textRegVocab.test.ts
git commit -m "feat(textreg): frontend vocab map"
```

---

## Task 5: `TextRegParamsEditor` → adapter over `DynamicParamForm` (TDD)

**Files:**
- Modify: `web/src/components/TextRegParamsEditor.tsx`
- Create: `web/src/components/TextRegParamsEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/TextRegParamsEditor.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TextRegParamsBody, ValidationProfile } from "../types";
import { TextRegParamsEditor } from "./TextRegParamsEditor";

const value: TextRegParamsBody = {
  power: 50, speed: 1000, density: 100, repeat: 2,
  pulse_width: 200, mopa_frequency: 60, processing_light_source: "red",
};
const profile: ValidationProfile = {
  power: { kind: "range", min: 1, max: 100, step: 1 },
  pulse_width: { kind: "stepped", values: [2, 6, 60, 200, 500] },
  laser: { kind: "enum", values: ["red", "blue"] },
};

describe("TextRegParamsEditor", () => {
  it("renders the shared form for a profile (power label present)", () => {
    render(<TextRegParamsEditor value={value} onChange={() => {}} profile={profile} />);
    expect(screen.getByText(/power/i)).toBeTruthy();
  });
  it("shows a placeholder when no profile", () => {
    render(<TextRegParamsEditor value={value} onChange={() => {}} profile={null} />);
    expect(screen.getByText(/loading constraints/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/TextRegParamsEditor.test.tsx`
Expected: FAIL — `profile` prop not accepted / compile error.

- [ ] **Step 3: Rewrite the editor (keep `TextRegSourcePill` + `SOURCE_LABELS`)**

In `web/src/components/TextRegParamsEditor.tsx`, replace the imports block + the `TextRegParamsEditor` function (lines 1–96) with the following, **leaving `TextRegSourcePill` and `SOURCE_LABELS` (lines 98–137) unchanged**:

```tsx
import { type ReactNode } from "react";
import { cn } from "../ui";
import { DynamicParamForm } from "./dynamic-form/DynamicParamForm";
import { toProfile, fromProfile } from "../lib/textRegVocab";
import type { TextRegParamsBody, TextRegSource, ValidationProfile } from "../types";

/**
 * Editor for the seven-field "engraved annotation params". A thin adapter:
 * renames TextReg fields to the profile vocabulary, renders the shared
 * DynamicParamForm (constrained widgets), and renames back on change. The
 * active machine's profile is resolved by the parent and passed in (each
 * Library card constrains by its own machine, not the globally-selected one).
 */
export interface TextRegParamsEditorProps {
  value: TextRegParamsBody;
  onChange: (next: TextRegParamsBody) => void;
  disabled?: boolean;
  profile: ValidationProfile | null;
}

export function TextRegParamsEditor({
  value,
  onChange,
  disabled,
  profile,
}: TextRegParamsEditorProps) {
  if (!profile) {
    return (
      <p className="font-mono text-[11px] tracking-[0.04em] text-[color:var(--color-ink-subtle)]">
        Loading constraints…
      </p>
    );
  }
  return (
    <DynamicParamForm
      profile={profile}
      value={toProfile(value)}
      onChange={(next) => onChange(fromProfile(next))}
      disabled={disabled}
    />
  );
}
```

(The `cn` and `ReactNode` imports are retained because `TextRegSourcePill` below uses them. `NumberField`/`Field`/`Select`/`PulseWidthSelect` are removed.)

- [ ] **Step 4: Verify**

Run: `cd web && npx vitest run src/components/TextRegParamsEditor.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean. (tsc will flag the two parent components for the now-required `profile` prop — that's Task 6.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TextRegParamsEditor.tsx web/src/components/TextRegParamsEditor.test.tsx
git commit -m "feat(textreg): editor is a DynamicParamForm adapter"
```

---

## Task 6: Parents resolve + pass the profile

**Files:**
- Modify: `web/src/components/AnnotationParamsSection.tsx`
- Modify: `web/src/components/MaterialTextRegPanel.tsx`

- [ ] **Step 1: AnnotationParamsSection — resolve the test machine's profile**

In `web/src/components/AnnotationParamsSection.tsx`:
- Add import: `import { useCurrentMachine, getValidationProfile, representativeMode } from "../state/machine";`
- Inside the component (after the existing `useState`s), add:
```tsx
  const { registry } = useCurrentMachine();
  const machine = registry?.machines.find((m) => m.id === machineId) ?? null;
  const profile = registry
    ? getValidationProfile(registry, machineId, machine ? representativeMode(machine) : "engrave")
    : null;
```
- In the JSX, pass it to the editor — change `<TextRegParamsEditor value={draft} onChange={setDraft} disabled={isDemo || busy} />` to add `profile={profile}`.

- [ ] **Step 2: MaterialTextRegPanel — keep the full registry + resolve per card**

In `web/src/components/MaterialTextRegPanel.tsx`:
- Change the import `import { getMachines } from "../api/machines";` to also bring the state helpers:
```tsx
import { getMachines } from "../api/machines";
import { getValidationProfile, representativeMode } from "../state/machine";
```
- Add `MachinesPayload` and `ValidationProfile` to the `../types` import.
- Replace the `machines` state with the full registry: change `const [machines, setMachines] = useState<Machine[] | null>(null);` to `const [registry, setRegistry] = useState<MachinesPayload | null>(null);`, and `getMachines().then((p) => setMachines(p.machines))` to `getMachines().then((p) => setRegistry(p))`.
- Update the null/loading guards and the `.map`: `machines === null` → `registry === null`; `machines.map((m) => (...))` → `registry.machines.map((m) => (...))`. Pass `registry={registry}` to `<MachineCard ... />`.
- In `MachineCard`'s props add `registry: MachinesPayload;`. Inside `MachineCard`, compute and pass the profile:
```tsx
  const profile = getValidationProfile(registry, machine.id, representativeMode(machine));
```
- In `MachineCard`'s JSX, add `profile={profile}` to the `<TextRegParamsEditor ... />` call.

- [ ] **Step 2b: Remove the now-unused `Machine` import if tsc flags it**

`MachineCard` still takes `machine: Machine`, so `Machine` is likely still used. Run tsc and only remove imports it flags.

- [ ] **Step 3: Verify**

Run: `cd web && npx tsc --noEmit && npx vitest run src/components 2>&1 | tail -12`
Expected: tsc clean, component tests green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AnnotationParamsSection.tsx web/src/components/MaterialTextRegPanel.tsx
git commit -m "feat(textreg): parents resolve + pass the machine profile"
```

---

## Task 7: Changelog + verification + PR

**Files:**
- Create: `changelog/2026-06-01-textreg-validation.md`

- [ ] **Step 1: Changelog**

Create `changelog/2026-06-01-textreg-validation.md`:
```markdown
---
id: 2026-06-01-textreg-validation
date: 2026-06-01
level: minor
title: Text-registration params respect machine limits
summary: The engraved-annotation (QR/fiducial) params now use the active machine's real constraints, and out-of-range saved defaults are clamped instead of failing at burn.
---
```

- [ ] **Step 2: Full verification**

Run:
```bash
uv run --active pytest tests/ -q 2>&1 | tail -4
cd web && npx tsc --noEmit && npm test 2>&1 | tail -6 && npm run build > /dev/null 2>&1 && echo "web ok"
```
Expected: backend green (modulo the known pre-existing `test_xcs_v2.py::test_faithfulness_bitmap_key_set` flake if present), tsc clean, vitest green, build OK.

- [ ] **Step 3: Browser smoke**

With the dev server running (`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017` after `cd web && npm run build`): open the Library page's "Text & Registration" tab for a material — confirm each machine card renders the constrained widgets (F2 Ultra shows the pulse-width dropdown; a diode machine hides pulse width). Open a Test's Registration tab and confirm the annotation params show the constrained form. Screenshot and read critically.

- [ ] **Step 4: Commit + open PR**

```bash
git add changelog/2026-06-01-textreg-validation.md
git commit -m "docs(changelog): textreg validation"
git push -u origin feat/textreg-validation
gh pr create --draft --base feat/validation-widget-rollout --title "TextReg validation (Phase 3)" --body "Phase 3: text-registration params validated against the machine profile. New backend coerce_against_profile (clamp-mode) + TextReg<->profile vocab map; the TextReg form reuses DynamicParamForm. Stacked on Phase 2 (#116). Spec: docs/superpowers/specs/2026-06-01-textreg-validation-design.md"
```
(If #116 has merged by now, use `--base main`. GitHub auto-retargets when the base merges.)

---

## Self-Review Notes

- **Spec coverage:** vocab map BE+FE (Tasks 2, 4), `coerce_against_profile` with not_applicable/absent passthrough (Task 1), PUT coercion + unknown-machine skip (Task 3), `representativeMode`/`_default_mode_for` profile selection (Tasks 3, 6), TextReg form adapter (Task 5), parents resolve per-card profile (Task 6), changelog + verification (Task 7). Read path / DB schema untouched (no task — correct).
- **Type/name consistency:** `to_profile`/`from_profile` (Python) and `toProfile`/`fromProfile` (TS); `coerce_against_profile(profile_id, params)`; `representativeMode(machine)`; `getValidationProfile(registry, machineId, mode)` used consistently.
- **Note:** `coerce_against_profile` step-snaps `power` to integers (profile `power` has step 1), so a float TextReg power like 14.5 snaps to 14/15 — intended (profile-authoritative), matching the FE `clampToConstraint`.
- **Ordering caveat flagged** in Task 3 Step 3: `_coerce_text_reg` closes over `_default_mode_for`; verify source ordering inside `create_app`.
