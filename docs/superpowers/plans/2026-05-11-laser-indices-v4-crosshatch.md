# Laser Indices v4 + Crosshatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the exposure indices physically honest about crosshatch. Today's v3 formulas use `params.repeat` (= passes) directly, so a crosshatched cell that delivered 2N strokes-of-energy gets stored as N-passes-worth. Bump to v4 where `effective_passes = passes × (crosshatch ? 2 : 1)` feeds into the three pass-dependent indices (TEi, AAi, DSi). Backfill every stored palette entry; thread crosshatch through the propose-test wizard's math + UI.

**Architecture:** Python `compute_indices` gains an optional `crosshatch: bool` kwarg. The `_compute_index_values` adapter reads `crosshatch` from the palette entry's `params_json` (since PR #38 most entries carry it). FE TS port mirrors the Python signature. The propose-test wizard exposes `crosshatch / scan_angle / angle_mode / unidirectional` in the rail as "burn settings", inheriting defaults from the anchor's source test on open. `INDICES_FORMULA_VERSION` bumps to 4 → `recompute_indices` repopulates every palette entry on next call.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, React 18, TS, vitest.

**Spec (inline):** see "Scope" below; no separate spec doc.

---

## Scope

### What v4 changes
- `compute_indices(params, *, crosshatch=False)` — kwarg-only, default False (matches existing call sites that don't pass it).
- `effective_passes = params.repeat × (2 if crosshatch else 1)`.
- Only TEi, AAi, DSi use `effective_passes`; PSm/LSm/PEi/PIi are unchanged (they don't depend on passes).
- `INDICES_FORMULA_VERSION = 4`.
- `_compute_index_values` extracts `crosshatch` from the params dict (`bool(d.get("crosshatch", False))`) and threads it.
- TS port `computeIndices` adds an optional second arg `{ crosshatch?: boolean }`. Same effective-passes substitution.
- The wizard's `partialDerivative` / `computeCurve` / `inverseSolve` / `fillByInverseSolve` take crosshatch via a `LaserContext` (or per-call kwarg) so the math is honest about the user's selected burn settings.

### What v4 does NOT change
- The palette entries' stored `params_json` (passes value stays raw, NOT doubled).
- `ProcessingParams` model (no new field).
- The renderer / converter (already handles crosshatch correctly via stroke duplication).
- The wizard's curve / fill algorithms (just the index-computation kernel inside them).

### Backfill
- `recompute_indices` already only touches rows where `indices_formula_version != INDICES_FORMULA_VERSION`. After the bump, the next CLI invocation flushes every row.
- Add a one-shot startup hook? No — the CLI command is already documented; manual run is fine. (TODO: confirm with the user that this is the deploy pattern.)
- Rows where `params_json` lacks `crosshatch` and the source test had crosshatch=true will be off by 2× until manually corrected. Mitigation: add a `--with-test-fallback` flag to `recompute_indices` that JOINs to tests when crosshatch is missing from params_json. Defer to a follow-up unless we find lots of these.

### Wizard burn-settings UI
- New section in the rail BELOW `PARAMS` titled `BURN SETTINGS`.
- Four controls:
  - `scan_angle` — slider 0–360 (or 4 chips 0/45/90/135).
  - `crosshatch` — checkbox/toggle.
  - `angle_mode` — segmented `FIXED | INCREMENTAL`.
  - `unidirectional` — checkbox/toggle.
- Defaults: fetch anchor's source test on `anchor?.test_id` change, populate `sourceBurnDefaults`. `effectiveBurnSettings = { ...staticDefaults, ...sourceBurnDefaults, ...burnOverrides }`.
- Reset button: existing `↺ reset` clears both `paramOverrides` and `burnOverrides`.

---

## File structure

### Modified
| Path | Why |
|---|---|
| `src/xcs_gen/laser_indices.py` | Add crosshatch kwarg, bump version. |
| `src/xcs_gen_web/repositories/palette.py` | Extract crosshatch in `_compute_index_values`. |
| `tests/test_laser_indices.py` | Add crosshatch-on tests asserting 2× effective passes on TEi/AAi/DSi. |
| `web/src/laser/laserIndices.ts` | Mirror Python signature. Bump version. |
| `web/src/laser/laserIndices.test.ts` | Add fixture parity for crosshatch cases. |
| `web/src/laser/__fixtures__/laser-indices-v4.json` | Replaces `-v3.json`. Add crosshatch=true rows. |
| `scripts/regen_laser_indices_fixtures.py` | Emit crosshatch coverage. |
| `web/src/components/exposure/proposeTestMath.ts` | Thread `crosshatch?: boolean` (or `LaserContext`) through `partialDerivative`, `computeCurve`, `inverseSolve`, `fillByInverseSolve`. |
| `web/src/components/exposure/proposeTestMath.test.ts` | Update tests; add crosshatch-aware cases. |
| `web/src/components/exposure/ExposureProposeRail.tsx` | Add `BURN SETTINGS` section + props. |
| `web/src/components/exposure/ExposureProposeRail.test.tsx` | Cover the new section. |
| `web/src/pages/ExposurePage.tsx` | Burn-settings state, source-test fetch, wire to math + handleCreateTest. |
| `changelog/2026-05-12-laser-indices-v4-crosshatch.md` | New entry. |

### Removed
- `web/src/laser/__fixtures__/laser-indices-v3.json` — replaced by `-v4.json` (same shape).

---

## Conventions per task

- Work in branch `feat/laser-indices-v4-crosshatch`. Branch off main.
- Run from project root.
- After every task: tsc clean, vitest pass, pytest pass (skip `tests/test_storage_s3.py`).
- Each task commits before moving on.
- Don't skip pre-commit hooks.

---

### Task 1: Python `compute_indices` accepts crosshatch + bump version

**Files:**
- Modify: `src/xcs_gen/laser_indices.py`
- Modify: `tests/test_laser_indices.py` (add cases)

- [ ] **Step 1: Read current laser_indices.py**

```bash
cat src/xcs_gen/laser_indices.py
```

- [ ] **Step 2: Add crosshatch kwarg + effective_passes substitution**

Replace the function body. The change: `repeat = params.repeat * 2 if crosshatch else params.repeat`. Use `effective_repeat` in the three pass-dependent formulas (TEi, AAi, DSi). Bump version 3 → 4. Full edited function:

```python
INDICES_FORMULA_VERSION = 4


@dataclass(frozen=True)
class LaserIndices:
    pulse_spacing_mm: float
    line_spacing_mm: float
    pulse_energy_index: float
    pulse_intensity_index: float
    total_exposure_index: float
    ablation_aggression_index: float
    delivery_smoothness_index: float
    formula_version: int
    density_model: str
    power_model: str


def compute_indices(
    params: ProcessingParams,
    *,
    density_model: str = "lpc",
    power_model: str = "controller_percent",
    crosshatch: bool = False,
) -> LaserIndices:
    """Compute derived exposure indices from raw `ProcessingParams`.

    Pass ``crosshatch=True`` when the entry was burned with the test's
    ``crosshatch`` flag on. Crosshatch adds a perpendicular stroke per
    pass, so each cell receives 2× the strokes of energy for the same
    nominal pass count. v4 multiplies ``repeat`` by 2 in that case
    so TEi / AAi / DSi reflect actual delivered energy.

    Raises `ValueError` (naming the offending field) if any input that
    appears in a denominator is zero, or if either model string is not
    the supported value for the current formula version.
    """
    speed = params.speed
    power = params.power
    density = params.density
    freq = params.mopa_frequency
    pw = params.pulse_width
    repeat = params.repeat

    if speed == 0:
        raise ValueError("speed must be non-zero to compute laser indices")
    if freq == 0:
        raise ValueError("mopa_frequency must be non-zero to compute laser indices")
    if density == 0:
        raise ValueError("density must be non-zero to compute laser indices")
    if pw == 0:
        raise ValueError("pulse_width must be non-zero to compute laser indices")

    if density_model != "lpc":
        raise ValueError(
            f"density_model={density_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION} (only 'lpc' is accepted)",
        )

    if power_model != "controller_percent":
        raise ValueError(
            f"power_model={power_model!r} not supported in formula "
            f"version {INDICES_FORMULA_VERSION}",
        )

    effective_repeat = repeat * 2 if crosshatch else repeat

    pulse_spacing_mm = speed / (freq * 1000)
    line_spacing_mm = 10 / density
    pulse_energy_index = power / freq
    pulse_intensity_index = power / (freq * pw)
    total_exposure_index = power * density * effective_repeat / speed
    ablation_aggression_index = total_exposure_index * pulse_intensity_index
    delivery_smoothness_index = total_exposure_index / pulse_intensity_index

    return LaserIndices(
        pulse_spacing_mm=pulse_spacing_mm,
        line_spacing_mm=line_spacing_mm,
        pulse_energy_index=pulse_energy_index,
        pulse_intensity_index=pulse_intensity_index,
        total_exposure_index=total_exposure_index,
        ablation_aggression_index=ablation_aggression_index,
        delivery_smoothness_index=delivery_smoothness_index,
        formula_version=INDICES_FORMULA_VERSION,
        density_model=density_model,
        power_model=power_model,
    )
```

- [ ] **Step 3: Add Python tests for crosshatch**

Find the existing tests file with `compute_indices` coverage. If it doesn't exist, create `tests/test_laser_indices.py`:

```python
import pytest
from xcs_gen.laser_indices import INDICES_FORMULA_VERSION, compute_indices
from xcs_gen.model import ProcessingParams


def _pp(**kwargs):
    return ProcessingParams(
        power=14.6, speed=1152, mopa_frequency=100, density=5000,
        pulse_width=200, repeat=1, **kwargs,
    )


def test_formula_version_is_4():
    assert INDICES_FORMULA_VERSION == 4


def test_crosshatch_doubles_total_exposure_index():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.total_exposure_index == pytest.approx(a.total_exposure_index * 2)


def test_crosshatch_doubles_ablation_aggression_index():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.ablation_aggression_index == pytest.approx(a.ablation_aggression_index * 2)


def test_crosshatch_doubles_delivery_smoothness_index():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.delivery_smoothness_index == pytest.approx(a.delivery_smoothness_index * 2)


def test_crosshatch_leaves_per_pulse_indices_unchanged():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=True)
    assert b.pulse_spacing_mm == pytest.approx(a.pulse_spacing_mm)
    assert b.line_spacing_mm == pytest.approx(a.line_spacing_mm)
    assert b.pulse_energy_index == pytest.approx(a.pulse_energy_index)
    assert b.pulse_intensity_index == pytest.approx(a.pulse_intensity_index)


def test_crosshatch_default_false_matches_no_kwarg():
    a = compute_indices(_pp())
    b = compute_indices(_pp(), crosshatch=False)
    assert a == b
```

- [ ] **Step 4: Verify**

```bash
uv run --active pytest tests/test_laser_indices.py -q
uv run --active pytest --ignore=tests/test_storage_s3.py -q 2>&1 | tail -3
```

Expect: new tests pass. Full suite passes — the version bump may also trip an existing assertion that `INDICES_FORMULA_VERSION == 3`. Search for that constant in tests and update it.

- [ ] **Step 5: Bump CI alembic version assertion if applicable**

```bash
grep -n 'INDICES_FORMULA_VERSION\|formula_version.*3' .github/workflows/ci.yml
```

If found, update to 4. (Likely no match — the alembic-version assertion is for migration revision, not laser indices.)

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/laser_indices.py tests/test_laser_indices.py
git commit -m "$(cat <<'EOF'
feat(laser-indices): v4 — crosshatch doubles effective passes

compute_indices(..., crosshatch=True) multiplies repeat by 2 before
applying it to total_exposure_index, ablation_aggression_index, and
delivery_smoothness_index. Per-pulse indices (PSm, LSm, PEi, PIi)
unchanged.

INDICES_FORMULA_VERSION bumps 3 → 4. recompute_indices in
xcs_gen_web.repositories.palette already gates on version mismatch,
so the next CLI invocation flushes every stored row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Repository `_compute_index_values` reads crosshatch from params

**Files:**
- Modify: `src/xcs_gen_web/repositories/palette.py`
- Test: existing `tests/test_repositories_palette.py` or wherever `recompute_indices` is tested

- [ ] **Step 1: Update the adapter**

In `src/xcs_gen_web/repositories/palette.py`, change `_compute_index_values`:

```python
def _compute_index_values(params: dict[str, Any]) -> dict[str, Any]:
    """Return the dict of laser-index columns + metadata for a
    palette_entries row, computed from a params_json-shaped dict.

    Reads ``crosshatch`` (boolean) from the dict if present. Falls
    back to False — entries without the flag predate PR #38's backfill
    and any with crosshatch=True will need manual correction (or a
    JOIN-based recompute pass).
    """
    crosshatch = bool(params.get("crosshatch", False))
    indices = compute_indices(
        _processing_params_from_palette_dict(params),
        crosshatch=crosshatch,
    )
    return {
        "pulse_spacing_mm": indices.pulse_spacing_mm,
        "line_spacing_mm": indices.line_spacing_mm,
        "pulse_energy_index": indices.pulse_energy_index,
        "pulse_intensity_index": indices.pulse_intensity_index,
        "total_exposure_index": indices.total_exposure_index,
        "ablation_aggression_index": indices.ablation_aggression_index,
        "delivery_smoothness_index": indices.delivery_smoothness_index,
        "indices_formula_version": indices.formula_version,
        "density_model": indices.density_model,
        "power_model": indices.power_model,
    }
```

- [ ] **Step 2: Add test**

In a test file for the repo (search for existing or create):

```python
def test_compute_index_values_doubles_TEi_when_crosshatch_true():
    from xcs_gen_web.repositories.palette import _compute_index_values
    no_xh = _compute_index_values({
        "power": 14.6, "speed": 1152, "frequency": 100, "density": 5000,
        "passes": 1, "pulse_width": 200,
    })
    with_xh = _compute_index_values({
        "power": 14.6, "speed": 1152, "frequency": 100, "density": 5000,
        "passes": 1, "pulse_width": 200, "crosshatch": True,
    })
    assert with_xh["total_exposure_index"] == pytest.approx(
        no_xh["total_exposure_index"] * 2,
    )
    assert with_xh["pulse_intensity_index"] == pytest.approx(
        no_xh["pulse_intensity_index"],
    )
```

- [ ] **Step 3: Verify + commit**

```bash
uv run --active pytest --ignore=tests/test_storage_s3.py -q 2>&1 | tail -3
git add src/xcs_gen_web/repositories/palette.py tests/...
git commit -m "feat(palette repo): thread crosshatch through index computation"
```

---

### Task 3: FE `computeIndices` mirrors Python signature

**Files:**
- Modify: `web/src/laser/laserIndices.ts`
- Modify: `web/src/laser/laserIndices.test.ts`

- [ ] **Step 1: Update the TS port**

```ts
export const INDICES_FORMULA_VERSION = 4 as const;

export interface LaserIndices {
  pulse_spacing_mm: number;
  line_spacing_mm: number;
  pulse_energy_index: number;
  pulse_intensity_index: number;
  total_exposure_index: number;
  ablation_aggression_index: number;
  delivery_smoothness_index: number;
  formula_version: 4;
}

export interface ComputeIndicesOptions {
  /** Set true when the burning test had ``crosshatch`` enabled.
   *  Effective passes = passes × 2; affects TEi, AAi, DSi only. */
  crosshatch?: boolean;
}

export function computeIndices(
  params: LaserParams,
  opts?: ComputeIndicesOptions,
): LaserIndices {
  const { power, speed, frequency, density, passes, pulse_width } = params;
  if (speed === 0) throw new Error("speed must be non-zero to compute laser indices");
  if (frequency === 0) throw new Error("frequency must be non-zero to compute laser indices");
  if (density === 0) throw new Error("density must be non-zero to compute laser indices");
  if (pulse_width === 0) throw new Error("pulse_width must be non-zero to compute laser indices");

  const effectivePasses = passes * (opts?.crosshatch ? 2 : 1);

  return {
    pulse_spacing_mm: speed / (frequency * 1000),
    line_spacing_mm: 10 / density,
    pulse_energy_index: power / frequency,
    pulse_intensity_index: power / (frequency * pulse_width),
    total_exposure_index: (power * density * effectivePasses) / speed,
    ablation_aggression_index:
      (power * density * effectivePasses * power) /
      (speed * frequency * pulse_width),
    delivery_smoothness_index:
      (density * effectivePasses * frequency * pulse_width) / speed,
    formula_version: INDICES_FORMULA_VERSION,
  };
}
```

- [ ] **Step 2: Update test file to match v4**

Change `describe("computeIndices (TS port of compute_indices v3)"` → `v4`. Re-import fixture path (will change to `-v4.json` next task).

- [ ] **Step 3: Add crosshatch test cases**

```ts
it("doubles TEi/AAi/DSi when crosshatch is true", () => {
  const params: LaserParams = {
    power: 14.6, speed: 1152, frequency: 100, density: 5000, passes: 1, pulse_width: 200,
  };
  const a = computeIndices(params);
  const b = computeIndices(params, { crosshatch: true });
  expect(b.total_exposure_index).toBeCloseTo(a.total_exposure_index * 2, 6);
  expect(b.ablation_aggression_index).toBeCloseTo(a.ablation_aggression_index * 2, 6);
  expect(b.delivery_smoothness_index).toBeCloseTo(a.delivery_smoothness_index * 2, 6);
  expect(b.pulse_spacing_mm).toBeCloseTo(a.pulse_spacing_mm, 6);
  expect(b.line_spacing_mm).toBeCloseTo(a.line_spacing_mm, 6);
  expect(b.pulse_energy_index).toBeCloseTo(a.pulse_energy_index, 6);
  expect(b.pulse_intensity_index).toBeCloseTo(a.pulse_intensity_index, 6);
});
```

- [ ] **Step 4: Commit**

```bash
git add web/src/laser/laserIndices.ts web/src/laser/laserIndices.test.ts
git commit -m "feat(laser indices FE): v4 — crosshatch via ComputeIndicesOptions"
```

The fixture parity test will fail until Task 4 regenerates the fixture file. That's expected.

---

### Task 4: Regenerate fixture file with crosshatch coverage

**Files:**
- Modify: `scripts/regen_laser_indices_fixtures.py`
- Delete: `web/src/laser/__fixtures__/laser-indices-v3.json`
- Create: `web/src/laser/__fixtures__/laser-indices-v4.json`
- Modify: `web/src/laser/laserIndices.test.ts` (point import at -v4.json)

- [ ] **Step 1: Extend the generator to emit crosshatch coverage**

Update `scripts/regen_laser_indices_fixtures.py` so each input row may include a `crosshatch` field, threaded into `compute_indices` and surfaced in the JSON output. Add a handful of crosshatch=true rows alongside the existing ones (use 5 of the existing 12 inputs, duplicate with crosshatch=true).

Body (full file):

```python
"""Regenerate web/src/laser/__fixtures__/laser-indices-v4.json from the
Python compute_indices source of truth. Run after any change to the
formulas. The TS port test reads this file and asserts byte-identical
floats (within 1e-6) for each entry.
"""

from __future__ import annotations

import json
from pathlib import Path

from xcs_gen.laser_indices import compute_indices
from xcs_gen.model import ProcessingParams


_INPUT_GRID: list[dict[str, object]] = [
    # (power %, speed mm/s, freq kHz, density lpc, pulse_width ns, passes, crosshatch)
    {"power": 14.6, "speed": 1152, "frequency": 100, "density": 5000,
     "pulse_width": 200, "passes": 1, "crosshatch": False},
    {"power": 30.0, "speed": 800,  "frequency": 60,  "density": 1000,
     "pulse_width": 200, "passes": 2, "crosshatch": False},
    {"power": 50.0, "speed": 4000, "frequency": 200, "density": 3000,
     "pulse_width": 100, "passes": 1, "crosshatch": False},
    {"power": 1.0,  "speed": 100,  "frequency": 60,  "density": 100,
     "pulse_width": 100, "passes": 1, "crosshatch": False},
    {"power": 100.0,"speed": 15000,"frequency": 500, "density": 5000,
     "pulse_width": 200, "passes": 99, "crosshatch": False},
    {"power": 25.5, "speed": 1500, "frequency": 150, "density": 2000,
     "pulse_width": 50,  "passes": 3, "crosshatch": False},
    {"power": 75.0, "speed": 6000, "frequency": 300, "density": 800,
     "pulse_width": 80,  "passes": 5, "crosshatch": False},
    {"power": 12.0, "speed": 250,  "frequency": 80,  "density": 4500,
     "pulse_width": 200, "passes": 1, "crosshatch": False},
    {"power": 60.0, "speed": 2400, "frequency": 250, "density": 1500,
     "pulse_width": 30,  "passes": 4, "crosshatch": False},
    {"power": 8.5,  "speed": 600,  "frequency": 70,  "density": 3500,
     "pulse_width": 200, "passes": 2, "crosshatch": False},
    {"power": 1.0,  "speed": 2,    "frequency": 60,  "density": 1,
     "pulse_width": 30,  "passes": 1, "crosshatch": False},
    {"power": 100.0,"speed": 15000,"frequency": 500, "density": 5000,
     "pulse_width": 200, "passes": 1, "crosshatch": False},
    # Crosshatch=true coverage — five duplicates of the above with the flag on.
    {"power": 14.6, "speed": 1152, "frequency": 100, "density": 5000,
     "pulse_width": 200, "passes": 1, "crosshatch": True},
    {"power": 30.0, "speed": 800,  "frequency": 60,  "density": 1000,
     "pulse_width": 200, "passes": 2, "crosshatch": True},
    {"power": 50.0, "speed": 4000, "frequency": 200, "density": 3000,
     "pulse_width": 100, "passes": 1, "crosshatch": True},
    {"power": 25.5, "speed": 1500, "frequency": 150, "density": 2000,
     "pulse_width": 50,  "passes": 3, "crosshatch": True},
    {"power": 60.0, "speed": 2400, "frequency": 250, "density": 1500,
     "pulse_width": 30,  "passes": 4, "crosshatch": True},
]


def _row(params: dict) -> dict:
    pp = ProcessingParams(
        power=params["power"],
        speed=int(params["speed"]),
        mopa_frequency=int(params["frequency"]),
        density=int(params["density"]),
        pulse_width=int(params["pulse_width"]),
        repeat=int(params["passes"]),
    )
    crosshatch = bool(params.get("crosshatch", False))
    indices = compute_indices(pp, crosshatch=crosshatch)
    return {
        "input": {
            "power": params["power"], "speed": params["speed"],
            "frequency": params["frequency"], "density": params["density"],
            "pulse_width": params["pulse_width"], "passes": params["passes"],
            "crosshatch": crosshatch,
        },
        "expected": {
            "pulse_spacing_mm": indices.pulse_spacing_mm,
            "line_spacing_mm": indices.line_spacing_mm,
            "pulse_energy_index": indices.pulse_energy_index,
            "pulse_intensity_index": indices.pulse_intensity_index,
            "total_exposure_index": indices.total_exposure_index,
            "ablation_aggression_index": indices.ablation_aggression_index,
            "delivery_smoothness_index": indices.delivery_smoothness_index,
            "formula_version": indices.formula_version,
        },
    }


def main() -> None:
    out_path = Path("web/src/laser/__fixtures__/laser-indices-v4.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [_row(p) for p in _INPUT_GRID]
    out_path.write_text(json.dumps(rows, indent=2) + "\n")
    print(f"wrote {len(rows)} fixtures to {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator**

```bash
rm web/src/laser/__fixtures__/laser-indices-v3.json
uv run --active python scripts/regen_laser_indices_fixtures.py
```

Expected: `wrote 17 fixtures to web/src/laser/__fixtures__/laser-indices-v4.json`.

- [ ] **Step 3: Update TS test import**

```ts
import fixtures from "./__fixtures__/laser-indices-v4.json";
```

Update the parity test to pass `{ crosshatch: input.crosshatch }` when iterating:

```ts
const got = computeIndices(f.input, { crosshatch: f.input.crosshatch });
```

(The `Fixture` interface's `input` should include `crosshatch: boolean`.)

- [ ] **Step 4: Verify + commit**

```bash
cd web && npm test -- --run laserIndices.test
git add scripts/regen_laser_indices_fixtures.py \
        web/src/laser/__fixtures__/laser-indices-v4.json \
        web/src/laser/laserIndices.test.ts
git rm web/src/laser/__fixtures__/laser-indices-v3.json
git commit -m "feat(laser indices fixtures): regenerate v4 with crosshatch coverage"
```

---

### Task 5: Thread crosshatch through `proposeTestMath`

**Files:**
- Modify: `web/src/components/exposure/proposeTestMath.ts`
- Modify: `web/src/components/exposure/proposeTestMath.test.ts`

- [ ] **Step 1: Update `partialDerivative`**

Add a 4th argument `crosshatch?: boolean` and use `effectivePasses = passes * (crosshatch ? 2 : 1)` internally for the TEi/AAi/DSi derivatives. For passes-derivative: ∂TEi/∂passes scales by 2 too (because the formula's passes term becomes 2·passes, ∂/∂passes = 2·(power·density/speed)).

```ts
export function partialDerivative(
  indexKey: IndexKey,
  paramKey: ParamKey | "passes" | "pulse_width",
  params: LaserParams,
  crosshatch: boolean = false,
): number {
  const { power, speed, frequency, density, passes, pulse_width } = params;
  const xh = crosshatch ? 2 : 1;
  const effPasses = passes * xh;
  // ... existing switch ...
  // For TEi entries: replace `passes` literal with `effPasses` in non-passes branches,
  // and multiply the passes branch by `xh`.
  // Worked formulas (TEi = power * density * effPasses / speed):
  //   ∂TEi/∂power = density * effPasses / speed
  //   ∂TEi/∂density = power * effPasses / speed
  //   ∂TEi/∂passes = power * density * xh / speed     // chain rule
  //   ∂TEi/∂speed = -power * density * effPasses / (speed*speed)
  // Similarly for AAi (multiply by xh wherever effPasses appears).
  // DSi = density * effPasses * frequency * pulse_width / speed
  //   ∂DSi/∂passes = density * frequency * pulse_width * xh / speed
}
```

Apply the same substitution to AAi and DSi entries. PSm/LSm/PEi/PIi unchanged.

- [ ] **Step 2: Add a partial-derivative test for crosshatch**

```ts
it("partialDerivative ∂TEi/∂passes doubles with crosshatch=true", () => {
  const params: LaserParams = SAMPLE_PARAMS[0];
  const a = partialDerivative("total_exposure_index", "passes", params, false);
  const b = partialDerivative("total_exposure_index", "passes", params, true);
  expect(b).toBeCloseTo(a * 2, 6);
});
```

- [ ] **Step 3: Update `computeCurve` / `inverseSolve` / `fillByInverseSolve`**

Each gains a `crosshatch?: boolean` arg defaulting to false. Inside, pass it through to `computeIndices(params, { crosshatch })` and `partialDerivative(..., crosshatch)`. Default-false makes the existing tests pass unchanged.

- [ ] **Step 4: Verify + commit**

```bash
cd web && npm test -- --run proposeTestMath.test
git add web/src/components/exposure/proposeTestMath.ts \
        web/src/components/exposure/proposeTestMath.test.ts
git commit -m "feat(propose-test math): thread crosshatch through derivatives + solver"
```

---

### Task 6: Burn-settings UI in `ExposureProposeRail`

**Files:**
- Modify: `web/src/components/exposure/ExposureProposeRail.tsx`
- Modify: `web/src/components/exposure/ExposureProposeRail.test.tsx`

- [ ] **Step 1: Add types + props**

```ts
export interface BurnSettings {
  scan_angle: number;        // 0..360
  crosshatch: boolean;
  angle_mode: "fixed" | "incremental";
  unidirectional: boolean;
}

interface Props {
  // ... existing ...
  burnSettings: BurnSettings;
  onBurnSettingChange: <K extends keyof BurnSettings>(key: K, value: BurnSettings[K]) => void;
}
```

- [ ] **Step 2: Add a new section between PARAMS and CELLS**

```tsx
<section data-role="propose-burn-settings">
  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
    Burn settings
  </div>
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center gap-2" data-row="scan_angle">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none">SCAN ANGLE</div>
      <input
        type="range" min={0} max={360} step={1}
        value={burnSettings.scan_angle}
        onChange={(e) => onBurnSettingChange("scan_angle", Number(e.target.value))}
        aria-label="Scan angle"
        className="flex-1"
      />
      <div className="font-mono text-[10px] text-[color:var(--color-ink)] tabular-nums w-[60px] flex-none text-right">
        {burnSettings.scan_angle}°
      </div>
    </div>
    <label className="flex items-center gap-2 cursor-pointer" data-row="crosshatch">
      <input
        type="checkbox" checked={burnSettings.crosshatch}
        onChange={(e) => onBurnSettingChange("crosshatch", e.target.checked)}
        aria-label="Crosshatch"
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)]">CROSSHATCH</span>
    </label>
    <div className="flex items-center gap-2" data-row="angle_mode">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[68px] flex-none">ANGLE MODE</div>
      <div className="flex gap-1 flex-1">
        {(["fixed", "incremental"] as const).map((m) => (
          <button
            key={m} type="button"
            aria-pressed={burnSettings.angle_mode === m}
            onClick={() => onBurnSettingChange("angle_mode", m)}
            className={
              "flex-1 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] rounded-sm border " +
              (burnSettings.angle_mode === m
                ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >{m}</button>
        ))}
      </div>
    </div>
    <label className="flex items-center gap-2 cursor-pointer" data-row="unidirectional">
      <input
        type="checkbox" checked={burnSettings.unidirectional}
        onChange={(e) => onBurnSettingChange("unidirectional", e.target.checked)}
        aria-label="Unidirectional"
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)]">UNIDIRECTIONAL</span>
    </label>
  </div>
</section>
```

- [ ] **Step 3: Add tests covering each control**

```tsx
it("calls onBurnSettingChange when crosshatch toggles", () => {
  const onBurnSettingChange = vi.fn();
  render(<ExposureProposeRail {...defaultProps()} burnSettings={defaultBurnSettings()} onBurnSettingChange={onBurnSettingChange} />);
  const cb = screen.getByLabelText(/Crosshatch/) as HTMLInputElement;
  fireEvent.click(cb);
  expect(onBurnSettingChange).toHaveBeenCalledWith("crosshatch", true);
});
```

Add similar tests for scan_angle (range fireEvent.change), angle_mode (button click), unidirectional.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/exposure/ExposureProposeRail.tsx \
        web/src/components/exposure/ExposureProposeRail.test.tsx
git commit -m "feat(propose-test rail): burn settings — scan_angle, crosshatch, angle_mode, unidirectional"
```

---

### Task 7: Page wiring — fetch source test, burn-settings state, thread through math + create

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add state + fetch**

```ts
type BurnSettings = import("../components/exposure/ExposureProposeRail").BurnSettings;
const STATIC_BURN_DEFAULTS: BurnSettings = {
  scan_angle: 90, crosshatch: false, angle_mode: "fixed", unidirectional: false,
};
const [sourceBurnDefaults, setSourceBurnDefaults] = useState<Partial<BurnSettings>>({});
const [burnOverrides, setBurnOverrides] = useState<Partial<BurnSettings>>({});
const effectiveBurnSettings: BurnSettings = useMemo(() => ({
  ...STATIC_BURN_DEFAULTS, ...sourceBurnDefaults, ...burnOverrides,
}), [sourceBurnDefaults, burnOverrides]);
```

Effect to fetch source test on anchor.test_id change:

```ts
useEffect(() => {
  if (!anchor?.test_id) {
    setSourceBurnDefaults({});
    return;
  }
  let cancelled = false;
  getTest(anchor.test_id).then((t) => {
    if (cancelled) return;
    setSourceBurnDefaults({
      scan_angle: t.spec.base_params.scan_angle ?? STATIC_BURN_DEFAULTS.scan_angle,
      crosshatch: t.spec.crosshatch ?? false,
      angle_mode: t.spec.angle_mode ?? "fixed",
      unidirectional: t.spec.unidirectional ?? false,
    });
  }).catch(() => { /* leave defaults */ });
  return () => { cancelled = true; };
}, [anchor?.test_id]);
```

- [ ] **Step 2: Pass to math + rail**

`preview` memo now passes `effectiveBurnSettings.crosshatch` to `computeCurve` and `fillByInverseSolve`. Rail receives `burnSettings={effectiveBurnSettings}` and `onBurnSettingChange={(k, v) => setBurnOverrides((p) => ({ ...p, [k]: v }))}`.

- [ ] **Step 3: Update reset + close**

The existing `onResetParams` clears `burnOverrides` too. The wizard-close (`closeProposeWizard`) clears both `burnOverrides` and `sourceBurnDefaults`.

- [ ] **Step 4: handleCreateTest writes burn settings**

```ts
const spec: TestSpec = {
  ...seedSpec,
  // ...existing fields...
  crosshatch: effectiveBurnSettings.crosshatch,
  angle_mode: effectiveBurnSettings.angle_mode,
  unidirectional: effectiveBurnSettings.unidirectional,
  base_params: { ...baseParams, scan_angle: effectiveBurnSettings.scan_angle },
};
```

Validation-cell params also get the new fields, so per-cell reproduction respects them.

- [ ] **Step 5: Verify**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "feat(propose-test page): burn-settings state with source-test inheritance"
```

---

### Task 8: Browser walkthrough + recompute + changelog + PR

- [ ] **Step 1: Restart dev server + manual recompute**

```bash
pkill -f 'xcs-gen serve' 2>&1 || true; sleep 1
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
# Trigger backfill — all entries flip from v3 to v4.
uv run --active xcs-gen recompute-indices --force
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 4
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:8017/
```

- [ ] **Step 2: Browser checks**

Open `http://127.0.0.1:8017/?v4=1#/exposure/1`. Confirm:

1. Crosshatched palette entries (if any in your data) now sit at 2× TEi/AAi/DSi compared to before.
2. Click PROPOSE TEST → draw polygon → wizard opens.
3. BURN SETTINGS section visible after PARAMS. Defaults reflect the anchor's source test (e.g. crosshatch on if anchor came from a crosshatched test).
4. Toggle crosshatch in burn settings → cells visibly shift along TEi (~half x-coord if they were on the higher end).
5. Adjust scan_angle / angle_mode / unidirectional → state persists, no visual chart impact (correct — they don't affect indices).
6. CREATE TEST → the new test inherits the burn settings.

- [ ] **Step 3: Author changelog**

`changelog/2026-05-12-laser-indices-v4-crosshatch.md` (level: major). Body explains the formula bump + UI addition + that legacy stored indices may shift for crosshatched entries.

- [ ] **Step 4: Final checks + PR**

```bash
cd web && npx tsc --noEmit && npm test -- --run
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest --ignore=tests/test_storage_s3.py -q 2>&1 | tail -3
git push -u origin feat/laser-indices-v4-crosshatch
gh pr create --draft --title "feat: laser indices v4 + crosshatch + wizard burn settings" \
  --body "..."
```

---

## Self-review

**Spec coverage:** all eight tasks chained.

**Risks:**
- Any caller of `compute_indices` that uses positional args (very rare) breaks. Kwarg-only is safer; the new `crosshatch=False` default means existing callers see no behaviour change.
- Stored palette entries' `crosshatch` field absent in legacy rows: recompute treats them as crosshatch=false. If any legacy crosshatched entries exist, their indices end up off by 2×. Acceptable; mitigation is a follow-up `--with-test-fallback` flag on `recompute_indices`.

**Type consistency:**
- Python: kwarg `crosshatch: bool = False` consistent across all signatures.
- TS: `ComputeIndicesOptions { crosshatch?: boolean }` consistent on the helper, plain `crosshatch?: boolean` arg on the math primitives (`partialDerivative`, `computeCurve`, `inverseSolve`, `fillByInverseSolve`).
- Rail: `BurnSettings { scan_angle, crosshatch, angle_mode, unidirectional }`.
