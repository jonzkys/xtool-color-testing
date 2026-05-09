# Exposure Right-Rail Expansion + Advanced Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double the exposure page's right rail and stand up an advanced filter panel — per-param range sliders, test/lineage/kind picker, source/validated, recipe-family status, outliers/brush — with URL persistence and a chart-side pill bar that always shows what's active. Fix the existing source-checkbox staleness bug as a side effect.

**Architecture:** Consolidate all filter state into a single `ActiveFilters` value with a pure `applyFilters(rows, filters, testsById)` derivation. Server fetch (`listPaletteEntries` + `listTests`) runs once per material; everything else is client-side memoised. URL hash query params encode `ActiveFilters` so the page round-trips through the location bar.

**Tech Stack:** React 18 + TypeScript + Tailwind v4 + vitest + @testing-library/react. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-11-exposure-rail-filters-design.md`

---

## File structure

**New (web/src/components/exposure/):**
- `exposureFilters.ts` — `ActiveFilters` type, `DEFAULT_FILTERS`, `applyFilters`, `dataRanges`, `TestSummary` shape, `lineageTestIds` resolver.
- `exposureFiltersUrl.ts` — `encodeFilters`, `decodeFilters`, `useFiltersUrlSync` hook.
- `ExposureRangeSlider.tsx` — dual-handle slider with click-to-edit numeric labels + log-scale auto-detect.
- `ExposureFilterPills.tsx` — active-filter pill bar above the chart.
- `ExposureFocusedIndices.tsx` — single-column indices chip stack for the right rail's left column.
- `ExposureFilterPanel.tsx` — composes Source/Validated, Test, Range×6, Family status, Outliers/Brush, Reset-all.
- Tests for each of the above (see individual tasks).

**Modified (web/src/):**
- `types.ts` — `TestRecord` gains `source_test_id`, `parent_test_id`, `tag`; `PaletteEntry` gains `derived_from_entry_id`.
- `pages/ExposurePage.tsx` — biggest churn: replace ad-hoc `useState` filter hooks with a single `ActiveFilters` reducer; restructure right rail into two columns; mount the new components; wire URL sync; remove left-rail Sources section; drop `validated_only` from the server fetch.
- `components/exposure/ExposureScatter.tsx` — `trimOutliers` is now read from `ActiveFilters` via the page; the prop wiring is unchanged but the toggle moves OUT of the above-chart toolbar.

**Modified — changelog:**
- `changelog/2026-05-12-exposure-rail-filters.md`.

---

### Task 1: Frontend types — `source_test_id`, `parent_test_id`, `tag`, `derived_from_entry_id`

PR #81 added these fields server-side; the frontend types haven't been updated. Tighten them so the new filter panel can read them without TS errors.

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/types.test.ts` (small structural test) OR fold into an existing `*.test.ts` if the project keeps frontend type tests grouped.

- [ ] **Step 1: Read the current types**

```bash
sed -n '180,330p' /Users/jonzky/Documents/XTools/Reverse/web/src/types.ts
```

Confirm `TestRecord` (around line 189) has no `source_test_id`/`parent_test_id`/`tag`, and `PaletteEntry` (around line 281) has no `derived_from_entry_id`.

- [ ] **Step 2: Update `TestRecord` and `PaletteEntry`**

In `web/src/types.ts`, modify `TestRecord` (line ~189). Add three optional fields just before the closing `}`:

```ts
export interface TestRecord {
  // ... existing fields ...
  ingested?: boolean;

  /** For kind=validation tests, the test whose harvested palette is
   *  being validated. Auto-set by the backend when validation cells
   *  are persisted. NULL on sweep tests or when the source cells span
   *  multiple tests. */
  source_test_id?: number | null;
  /** Fork lineage. Set when a test is copied/iterated from another. */
  parent_test_id?: number | null;
  /** Short campaign/grouping label (≤64 chars). */
  tag?: string | null;
}
```

Modify `PaletteEntry` (line ~281). Add right after `validated_residual_de`:

```ts
export interface PaletteEntry {
  // ... existing fields ...
  validated_residual_de?: number | null;

  /** For entries produced by ingesting cross-material validation
   *  results, the original entry the validation was run against.
   *  NULL on sweep entries and on validation entries whose source has
   *  been deleted. */
  derived_from_entry_id?: number | null;

  // ... rest unchanged ...
}
```

- [ ] **Step 3: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS (the additions are optional, no existing consumer breaks).

- [ ] **Step 4: Run the existing test suite**

```bash
cd web && npm test -- --run
```

Expected: PASS (no behavioural change).

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts
git commit -m "$(cat <<'EOF'
types: surface PR #81 lineage fields on TestRecord + PaletteEntry

TestRecord gains source_test_id/parent_test_id/tag; PaletteEntry
gains derived_from_entry_id. All optional so existing consumers
still typecheck.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `exposureFilters.ts` — `ActiveFilters` + `applyFilters`

The pure-function core of the redesign. Every filter the page knows about derives a single output set from `(rows, filters, testsById)`.

**Files:**
- Create: `web/src/components/exposure/exposureFilters.ts`
- Create: `web/src/components/exposure/exposureFilters.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/exposureFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  dataRanges,
  lineageTestIds,
  type ActiveFilters,
  type TestSummary,
} from "./exposureFilters";
import type { PaletteEntry } from "../../types";

function entry(over: Partial<PaletteEntry> & { id: number }): PaletteEntry {
  return {
    id: over.id,
    test_id: over.test_id ?? null,
    machine_id: "F2Ultra",
    material_id: 1,
    x_value: null, y_value: null,
    hex: "#000000",
    lab: [50, 0, 0],
    params: { speed: 600, power: 50, density: 100,
              frequency: 30, pulse_width: 200, passes: 1 },
    sigma: 0,
    source: "averaged",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "",
    indices: {
      pulse_spacing_mm: 0.02, line_spacing_mm: 0.1,
      pulse_energy_index: 1.67, pulse_intensity_index: 0.0083,
      total_exposure_index: 8.33, ablation_aggression_index: 0.069,
      delivery_smoothness_index: 1004,
      formula_version: 3, density_model: "lpc",
      power_model: "controller_percent",
    },
    ...over,
  } as PaletteEntry;
}

const TESTS: ReadonlyMap<number, TestSummary> = new Map([
  [10, { id: 10, name: "sweep-A", kind: "sweep",
         source_test_id: null, parent_test_id: null }],
  [20, { id: 20, name: "validate-A", kind: "validation",
         source_test_id: 10, parent_test_id: null }],
  [30, { id: 30, name: "iter-A", kind: "sweep",
         source_test_id: null, parent_test_id: 10 }],
]);

describe("applyFilters", () => {
  it("default filters return every row", () => {
    const rows = [entry({ id: 1 }), entry({ id: 2, source: "manual" })];
    expect(applyFilters(rows, DEFAULT_FILTERS, TESTS).map(r => r.id))
      .toEqual([1, 2]);
  });

  it("source set excludes other sources", () => {
    const rows = [
      entry({ id: 1, source: "averaged" }),
      entry({ id: 2, source: "manual" }),
      entry({ id: 3, source: "single_result" }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["averaged"]) };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("validatedOnly drops non-validated entries", () => {
    const rows = [
      entry({ id: 1, is_validated: true }),
      entry({ id: 2, is_validated: false }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("range filter excludes rows whose param is outside [min, max]", () => {
    const rows = [
      entry({ id: 1, params: { ...entry({id:1}).params, power: 20 } }),
      entry({ id: 2, params: { ...entry({id:2}).params, power: 50 } }),
      entry({ id: 3, params: { ...entry({id:3}).params, power: 90 } }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 30, max: 70 } } };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([2]);
  });

  it("range with missing param drops the row", () => {
    const rows = [
      entry({ id: 1, params: {} as Record<string, number | string> }),
      entry({ id: 2, params: { ...entry({id:2}).params, power: 50 } }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 30, max: 70 } } };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([2]);
  });

  it("test_id filter restricts to that test's entries", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),
      entry({ id: 2, test_id: 20 }),
      entry({ id: 3, test_id: null }),
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testId: 10 };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("test_id + source lineage extends to the source test's entries", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),     // source of test 20
      entry({ id: 2, test_id: 20 }),     // selected test
      entry({ id: 3, test_id: 30 }),     // unrelated
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testId: 20,
      testLineage: new Set(["source"]) };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1, 2]);
  });

  it("test_id + parent lineage extends to the parent test's entries", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),     // parent of test 30
      entry({ id: 2, test_id: 30 }),     // selected test
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testId: 30,
      testLineage: new Set(["parent"]) };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1, 2]);
  });

  it("kind filter narrows to sweeps or validations", () => {
    const rows = [
      entry({ id: 1, test_id: 10 }),     // sweep
      entry({ id: 2, test_id: 20 }),     // validation
      entry({ id: 3, test_id: null }),   // manual entry
    ];
    const f: ActiveFilters = { ...DEFAULT_FILTERS, testKind: "sweep" };
    expect(applyFilters(rows, f, TESTS).map(r => r.id)).toEqual([1]);
  });

  it("manual entries (test_id=null) survive a kind filter when kind=all", () => {
    const rows = [
      entry({ id: 1, test_id: null }),
      entry({ id: 2, test_id: 20 }),
    ];
    expect(applyFilters(rows, DEFAULT_FILTERS, TESTS).map(r => r.id))
      .toEqual([1, 2]);
  });

  it("regression: source set is honoured without re-fetching", () => {
    // Reproduces the bug from the existing page: applying a source
    // filter on a fixed `rows` array yields the right subset, no
    // server roundtrip required.
    const rows = [
      entry({ id: 1, source: "averaged" }),
      entry({ id: 2, source: "manual" }),
    ];
    const f1: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["averaged"]) };
    const f2: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["manual"]) };
    expect(applyFilters(rows, f1, TESTS).map(r => r.id)).toEqual([1]);
    expect(applyFilters(rows, f2, TESTS).map(r => r.id)).toEqual([2]);
  });
});

describe("lineageTestIds", () => {
  it("returns just the test id when no lineage extensions", () => {
    expect(lineageTestIds(20, new Set(), TESTS)).toEqual(new Set([20]));
  });
  it("adds source_test_id when 'source' lineage requested", () => {
    expect(lineageTestIds(20, new Set(["source"]), TESTS))
      .toEqual(new Set([10, 20]));
  });
  it("adds parent_test_id when 'parent' lineage requested", () => {
    expect(lineageTestIds(30, new Set(["parent"]), TESTS))
      .toEqual(new Set([10, 30]));
  });
  it("ignores lineage when source/parent_test_id is null", () => {
    expect(lineageTestIds(10, new Set(["source", "parent"]), TESTS))
      .toEqual(new Set([10]));
  });
});

describe("dataRanges", () => {
  it("returns min/max for each param across rows", () => {
    const rows = [
      entry({ id: 1, params: { speed: 200, power: 10, density: 50,
                               frequency: 30, pulse_width: 100, passes: 1 } }),
      entry({ id: 2, params: { speed: 800, power: 80, density: 200,
                               frequency: 60, pulse_width: 400, passes: 4 } }),
    ];
    const r = dataRanges(rows);
    expect(r.speed).toEqual({ min: 200, max: 800 });
    expect(r.power).toEqual({ min: 10, max: 80 });
    expect(r.density).toEqual({ min: 50, max: 200 });
  });

  it("returns null for params that no row carries", () => {
    const rows = [entry({ id: 1, params: { power: 50 } })];
    const r = dataRanges(rows);
    expect(r.speed).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/exposureFilters.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `exposureFilters.ts`**

```ts
import type { PaletteEntry } from "../../types";
import type { ExposureRow } from "./exposureCorrelations";
import type { VaryingAxis } from "./recipeFamilies";

export type SourceKind = "averaged" | "single_result" | "manual";

export interface ParamRange {
  /** Lower bound, inclusive. NULL = no lower bound. */
  min: number | null;
  /** Upper bound, inclusive. NULL = no upper bound. */
  max: number | null;
}

export type FilterableParam =
  | "power" | "speed" | "frequency"
  | "pulse_width" | "density" | "passes";

export const FILTERABLE_PARAMS: readonly FilterableParam[] = [
  "power", "speed", "frequency", "pulse_width", "density", "passes",
];

export interface ActiveFilters {
  sources: ReadonlySet<SourceKind>;
  validatedOnly: boolean;
  trimOutliers: boolean;
  brushRange: readonly [number, number] | null;
  family: { axis: VaryingAxis; anchorRowId: number } | null;
  testId: number | null;
  /** Single-step lineage extensions — not transitive. */
  testLineage: ReadonlySet<"source" | "parent">;
  testKind: "sweep" | "validation" | "all";
  paramRanges: Partial<Record<FilterableParam, ParamRange>>;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  sources: new Set<SourceKind>(["averaged", "single_result", "manual"]),
  validatedOnly: false,
  trimOutliers: true,
  brushRange: null,
  family: null,
  testId: null,
  testLineage: new Set(),
  testKind: "all",
  paramRanges: {},
};

export interface TestSummary {
  id: number;
  name: string;
  kind: "sweep" | "validation";
  source_test_id: number | null;
  parent_test_id: number | null;
}

/** Resolve which test ids are "in" given a base test + lineage flags.
 *  Single-step only — does not chase chains transitively. */
export function lineageTestIds(
  testId: number,
  lineage: ReadonlySet<"source" | "parent">,
  testsById: ReadonlyMap<number, TestSummary>,
): ReadonlySet<number> {
  const out = new Set<number>([testId]);
  const t = testsById.get(testId);
  if (!t) return out;
  if (lineage.has("source") && t.source_test_id != null) {
    out.add(t.source_test_id);
  }
  if (lineage.has("parent") && t.parent_test_id != null) {
    out.add(t.parent_test_id);
  }
  return out;
}

function paramValue(
  e: PaletteEntry, k: FilterableParam,
): number | null {
  // Backend stores numbers; the type permits string | number for
  // legacy laser/angle fields, but the six FilterableParam keys are
  // all numeric.
  const v = e.params?.[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function inRange(v: number, r: ParamRange): boolean {
  if (r.min != null && v < r.min) return false;
  if (r.max != null && v > r.max) return false;
  return true;
}

/** Pure derivation: rows + filters + tests corpus → ExposureRow[].
 *  Order: source/validated/kind/test+lineage drops first, range
 *  checks, then recipe-family, then brush. trimOutliers is NOT
 *  applied here — it's a display-tuning flag the scatter consumes
 *  directly. */
export function applyFilters(
  rows: readonly PaletteEntry[],
  f: ActiveFilters,
  testsById: ReadonlyMap<number, TestSummary>,
): ExposureRow[] {
  const acceptedTestIds = f.testId == null
    ? null
    : lineageTestIds(f.testId, f.testLineage, testsById);

  const out: ExposureRow[] = [];
  for (const e of rows) {
    if (e.indices == null) continue;
    if (!f.sources.has(e.source)) continue;
    if (f.validatedOnly && !e.is_validated) continue;
    if (f.testKind !== "all") {
      if (e.test_id == null) continue;
      const t = testsById.get(e.test_id);
      if (!t || t.kind !== f.testKind) continue;
    }
    if (acceptedTestIds && (e.test_id == null || !acceptedTestIds.has(e.test_id))) {
      continue;
    }
    let outOfRange = false;
    for (const k of FILTERABLE_PARAMS) {
      const r = f.paramRanges[k];
      if (!r) continue;
      if (r.min == null && r.max == null) continue;
      const v = paramValue(e, k);
      if (v == null) { outOfRange = true; break; }
      if (!inRange(v, r)) { outOfRange = true; break; }
    }
    if (outOfRange) continue;

    out.push({
      id: e.id,
      hex: e.hex,
      lab: [e.lab[0], e.lab[1], e.lab[2]],
      indices: e.indices,
      params: e.params,
      test_id: e.test_id,
    });
  }

  // brushRange is a band on total_exposure_index; drop rows outside it.
  if (f.brushRange) {
    const [lo, hi] = f.brushRange;
    return out.filter((r) => {
      const v = r.indices.total_exposure_index;
      return Number.isFinite(v) && v >= lo && v <= hi;
    });
  }

  // Recipe-family is applied at a higher layer in ExposurePage today
  // (it depends on the families map computed elsewhere). We don't
  // resolve it here so this function stays parameterised by data
  // alone. ExposurePage applies family filtering after applyFilters.
  return out;
}

/** Per-param min/max across the current rows (raw param values).
 *  Returns null when no row carries the param. */
export function dataRanges(
  rows: readonly PaletteEntry[],
): Record<FilterableParam, { min: number; max: number } | null> {
  const out: Record<FilterableParam, { min: number; max: number } | null> = {
    power: null, speed: null, frequency: null,
    pulse_width: null, density: null, passes: null,
  };
  for (const k of FILTERABLE_PARAMS) {
    let lo = Infinity, hi = -Infinity;
    for (const e of rows) {
      const v = e.params?.[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo !== Infinity) out[k] = { min: lo, max: hi };
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/exposureFilters.test.ts
```

Expected: PASS for all describes.

- [ ] **Step 5: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/exposureFilters.ts \
        web/src/components/exposure/exposureFilters.test.ts
git commit -m "$(cat <<'EOF'
feat(exposure): pure-function ActiveFilters + applyFilters

ActiveFilters consolidates every existing per-feature useState into a
single value: sources, validated, trimOutliers, brush, family, testId,
testLineage, testKind, paramRanges. applyFilters is a pure derivation
from (rows, filters, testsById) → ExposureRow[].

Test matrix covers source/validated/range/test+lineage/kind/manual-
entry/missing-param + a regression case locking in the source-checkbox
non-staleness behaviour for the upcoming page rewrite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `exposureFiltersUrl.ts` — encode/decode + sync hook

**Files:**
- Create: `web/src/components/exposure/exposureFiltersUrl.ts`
- Create: `web/src/components/exposure/exposureFiltersUrl.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/exposureFiltersUrl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  encodeFilters, decodeFilters,
} from "./exposureFiltersUrl";
import { DEFAULT_FILTERS, type ActiveFilters } from "./exposureFilters";

function roundTrip(f: ActiveFilters): ActiveFilters {
  return decodeFilters(encodeFilters(f));
}

describe("encodeFilters", () => {
  it("returns empty string for default filters", () => {
    expect(encodeFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("encodes a single param range as p=10..40", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } } };
    expect(encodeFilters(f)).toBe("p=10..40");
  });

  it("encodes half-open ranges", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      paramRanges: { density: { min: 100, max: null } } };
    expect(encodeFilters(f)).toBe("d=100..");
  });

  it("encodes test id + lineage + kind", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      testId: 42, testLineage: new Set(["source", "parent"]),
      testKind: "validation" };
    const q = encodeFilters(f);
    expect(q).toContain("test=42");
    expect(q).toContain("lin=source,parent");
    expect(q).toContain("kind=validation");
  });

  it("omits sources when all three are checked (default)", () => {
    expect(encodeFilters(DEFAULT_FILTERS)).not.toContain("src=");
  });

  it("encodes sources subset", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS,
      sources: new Set(["averaged"]) };
    expect(encodeFilters(f)).toBe("src=averaged");
  });
});

describe("round-trip", () => {
  for (const [name, f] of [
    ["default", DEFAULT_FILTERS],
    ["range power", { ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } } }],
    ["multi-param ranges", { ...DEFAULT_FILTERS,
      paramRanges: {
        power: { min: 10, max: 40 },
        density: { min: 100, max: null },
        speed: { min: null, max: 1000 },
      } }],
    ["test + lineage + kind", { ...DEFAULT_FILTERS,
      testId: 42, testLineage: new Set(["source"]),
      testKind: "sweep" }],
    ["sources subset + validated", { ...DEFAULT_FILTERS,
      sources: new Set(["averaged", "manual"]),
      validatedOnly: true }],
    ["brush", { ...DEFAULT_FILTERS,
      brushRange: [1.2, 18] }],
    ["trimOutliers off", { ...DEFAULT_FILTERS, trimOutliers: false }],
  ] as Array<[string, ActiveFilters]>) {
    it(`round-trips ${name}`, () => {
      const out = roundTrip(f);
      expect(out).toEqual(f);
    });
  }
});

describe("decodeFilters - liberal parsing", () => {
  it("ignores unknown keys", () => {
    expect(decodeFilters("foo=bar&p=10..40")).toEqual({
      ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } },
    });
  });

  it("malformed range falls back to no constraint", () => {
    expect(decodeFilters("p=garbage")).toEqual(DEFAULT_FILTERS);
  });

  it("unknown lineage value is dropped", () => {
    expect(decodeFilters("test=42&lin=garbage").testLineage)
      .toEqual(new Set());
  });

  it("unknown kind falls back to all", () => {
    expect(decodeFilters("kind=garbage").testKind).toBe("all");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/exposureFiltersUrl.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `exposureFiltersUrl.ts`**

```ts
import { useEffect, useRef } from "react";
import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type FilterableParam, type ParamRange,
  type SourceKind,
} from "./exposureFilters";

const PARAM_KEY: Record<FilterableParam, string> = {
  power: "p", speed: "s", frequency: "f",
  pulse_width: "pw", density: "d", passes: "r",
};

const KEY_PARAM: Record<string, FilterableParam> = Object.fromEntries(
  Object.entries(PARAM_KEY).map(([k, v]) => [v, k as FilterableParam])
) as Record<string, FilterableParam>;

function encodeRange(r: ParamRange): string | null {
  if (r.min == null && r.max == null) return null;
  return `${r.min ?? ""}..${r.max ?? ""}`;
}

function decodeRange(s: string): ParamRange | null {
  const m = s.match(/^(-?\d*\.?\d*)\.\.(-?\d*\.?\d*)$/);
  if (!m) return null;
  const min = m[1] === "" ? null : Number(m[1]);
  const max = m[2] === "" ? null : Number(m[2]);
  if ((min != null && !Number.isFinite(min)) ||
      (max != null && !Number.isFinite(max))) return null;
  if (min == null && max == null) return null;
  return { min, max };
}

const ALL_SOURCES = new Set<SourceKind>(["averaged", "single_result", "manual"]);

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function encodeFilters(f: ActiveFilters): string {
  const parts: string[] = [];

  // Param ranges
  for (const k of FILTERABLE_PARAMS) {
    const r = f.paramRanges[k];
    if (!r) continue;
    const encoded = encodeRange(r);
    if (encoded) parts.push(`${PARAM_KEY[k]}=${encoded}`);
  }

  if (!setsEqual(f.sources, ALL_SOURCES)) {
    parts.push(`src=${[...f.sources].join(",")}`);
  }
  if (f.validatedOnly) parts.push("val=1");
  if (f.testId != null) parts.push(`test=${f.testId}`);
  if (f.testLineage.size > 0) {
    parts.push(`lin=${[...f.testLineage].join(",")}`);
  }
  if (f.testKind !== "all") parts.push(`kind=${f.testKind}`);
  if (f.brushRange) {
    parts.push(`brush=${f.brushRange[0]}..${f.brushRange[1]}`);
  }
  if (!f.trimOutliers) parts.push("trim=0");

  return parts.join("&");
}

export function decodeFilters(query: string): ActiveFilters {
  const params = new URLSearchParams(query);
  const out: ActiveFilters = {
    ...DEFAULT_FILTERS,
    sources: new Set(DEFAULT_FILTERS.sources),
    testLineage: new Set(),
    paramRanges: {},
  };

  for (const [key, value] of params.entries()) {
    if (key in KEY_PARAM) {
      const r = decodeRange(value);
      if (r) (out.paramRanges as Record<FilterableParam, ParamRange>)[KEY_PARAM[key]] = r;
      continue;
    }
    if (key === "src") {
      const kinds = value.split(",").filter(
        (v): v is SourceKind =>
          v === "averaged" || v === "single_result" || v === "manual",
      );
      if (kinds.length > 0) out.sources = new Set(kinds);
      continue;
    }
    if (key === "val") {
      out.validatedOnly = value === "1";
      continue;
    }
    if (key === "test") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out.testId = n;
      continue;
    }
    if (key === "lin") {
      const flags = value.split(",").filter(
        (v): v is "source" | "parent" => v === "source" || v === "parent",
      );
      out.testLineage = new Set(flags);
      continue;
    }
    if (key === "kind") {
      if (value === "sweep" || value === "validation" || value === "all") {
        out.testKind = value;
      }
      continue;
    }
    if (key === "brush") {
      const r = decodeRange(value);
      if (r && r.min != null && r.max != null) {
        out.brushRange = [r.min, r.max];
      }
      continue;
    }
    if (key === "trim") {
      out.trimOutliers = value !== "0";
      continue;
    }
    // unknown keys: silently ignored
  }

  return out;
}

/** Two-way sync between ActiveFilters state and the URL hash query
 *  string. Reads on mount; writes on every state change via
 *  history.replaceState. The router treats everything before the first
 *  `?` as the route, so this doesn't trigger renavigation. */
export function useFiltersUrlSync(
  state: ActiveFilters,
  setState: (f: ActiveFilters) => void,
): void {
  const initialised = useRef(false);

  // Read once on mount.
  useEffect(() => {
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const decoded = decodeFilters(hash.slice(qIdx + 1));
      setState(decoded);
    }
    initialised.current = true;
    // We deliberately ignore setState's identity below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write on every state change after mount.
  useEffect(() => {
    if (!initialised.current) return;
    const encoded = encodeFilters(state);
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    const route = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    const next = encoded ? `${route}?${encoded}` : route;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [state]);
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/exposureFiltersUrl.test.ts
```

Expected: PASS for all describes.

- [ ] **Step 5: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/exposureFiltersUrl.ts \
        web/src/components/exposure/exposureFiltersUrl.test.ts
git commit -m "$(cat <<'EOF'
feat(exposure): URL hash sync for ActiveFilters

encode/decode round-trip every filter dimension through short keys
(p=10..40, test=42, lin=source,parent, etc.). useFiltersUrlSync hook
reads once on mount and writes on every state change via
history.replaceState — no renavigation, hash router still parses up
to the first '?'.

Liberal decode: unknown keys ignored, malformed values fall back to
defaults, matching the project's snap-rather-than-422 pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ExposureRangeSlider.tsx` — dual-handle slider component

**Files:**
- Create: `web/src/components/exposure/ExposureRangeSlider.tsx`
- Create: `web/src/components/exposure/ExposureRangeSlider.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/ExposureRangeSlider.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureRangeSlider } from "./ExposureRangeSlider";

describe("ExposureRangeSlider", () => {
  it("renders the param name and the data caption", () => {
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: null, max: null }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/POWER/)).toBeInTheDocument();
    expect(screen.getByText(/data: 10–80/)).toBeInTheDocument();
  });

  it("renders current bound values when set", () => {
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("clicking a bound value swaps it for an editable input", () => {
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText("20"));
    const input = screen.getByDisplayValue("20") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("number");
  });

  it("Enter on the editable input commits the new value via onChange", () => {
    const onChange = vi.fn();
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("20"));
    const input = screen.getByDisplayValue("20") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ min: 30, max: 60 });
  });

  it("Escape on the editable input reverts (no onChange)", () => {
    const onChange = vi.fn();
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("20"));
    const input = screen.getByDisplayValue("20") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking the reset button clears both bounds", () => {
    const onChange = vi.fn();
    render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 10, max: 80 }}
        value={{ min: 20, max: 60 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/reset power/i));
    expect(onChange).toHaveBeenCalledWith({ min: null, max: null });
  });

  it("auto-detects log scale when domain ratio > 100", () => {
    // density 5..5000 (1000× range) → log scale on
    const { container } = render(
      <ExposureRangeSlider
        param="density"
        domain={{ min: 5, max: 5000 }}
        value={{ min: null, max: null }}
        onChange={() => undefined}
      />,
    );
    const root = container.querySelector('[data-log-scale="true"]');
    expect(root).not.toBeNull();
  });

  it("uses linear scale when domain ratio <= 100", () => {
    const { container } = render(
      <ExposureRangeSlider
        param="power"
        domain={{ min: 1, max: 100 }}
        value={{ min: null, max: null }}
        onChange={() => undefined}
      />,
    );
    const root = container.querySelector('[data-log-scale="false"]');
    expect(root).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureRangeSlider.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureRangeSlider.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { FilterableParam, ParamRange } from "./exposureFilters";

interface Props {
  param: FilterableParam;
  domain: { min: number; max: number };
  value: ParamRange;
  onChange: (next: ParamRange) => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQUENCY",
  pulse_width: "PULSE WIDTH",
  density: "DENSITY",
  passes: "PASSES",
};

const PARAM_UNIT: Record<FilterableParam, string> = {
  power: "%",
  speed: "mm/s",
  frequency: "kHz",
  pulse_width: "ns",
  density: "lpc",
  passes: "",
};

function isLogScale(domain: { min: number; max: number }): boolean {
  return domain.min > 0 && domain.max / domain.min > 100;
}

function valueToFraction(
  v: number, domain: { min: number; max: number }, log: boolean,
): number {
  if (log) {
    const lo = Math.log10(domain.min);
    const hi = Math.log10(domain.max);
    return (Math.log10(Math.max(domain.min, v)) - lo) / (hi - lo);
  }
  return (v - domain.min) / (domain.max - domain.min);
}

function fractionToValue(
  f: number, domain: { min: number; max: number }, log: boolean,
): number {
  const clamped = Math.min(1, Math.max(0, f));
  if (log) {
    const lo = Math.log10(domain.min);
    const hi = Math.log10(domain.max);
    return Math.pow(10, lo + clamped * (hi - lo));
  }
  return domain.min + clamped * (domain.max - domain.min);
}

function fmt(n: number): string {
  if (Math.abs(n) >= 100 || Number.isInteger(n)) return n.toFixed(0);
  return n.toFixed(2);
}

interface BoundLabelProps {
  value: number;
  onCommit: (next: number) => void;
}

function BoundLabel({ value, onCommit }: BoundLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  if (editing) {
    return (
      <input
        type="number"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (Number.isFinite(n)) onCommit(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = Number(draft);
            if (Number.isFinite(n)) onCommit(n);
            setEditing(false);
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="w-12 font-mono text-[10px] tabular-nums px-1 py-0.5 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
      />
    );
  }

  return (
    <button
      type="button"
      className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink)] cursor-text hover:text-[color:var(--color-primary)]"
      onClick={() => setEditing(true)}
    >
      {fmt(value)}
    </button>
  );
}

export function ExposureRangeSlider({ param, domain, value, onChange }: Props) {
  const log = isLogScale(domain);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<"min" | "max" | null>(null);

  const minVal = value.min ?? domain.min;
  const maxVal = value.max ?? domain.max;
  const minFrac = valueToFraction(minVal, domain, log);
  const maxFrac = valueToFraction(maxVal, domain, log);

  const handleDrag = (clientX: number) => {
    if (!trackRef.current || !dragging.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    const v = fractionToValue(f, domain, log);
    if (dragging.current === "min") {
      onChange({ min: Math.min(v, maxVal), max: value.max });
    } else {
      onChange({ min: value.min, max: Math.max(v, minVal) });
    }
  };

  useEffect(() => {
    if (!dragging.current) return;
    const move = (e: PointerEvent) => handleDrag(e.clientX);
    const up = () => { dragging.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const startDrag = (which: "min" | "max") => () => { dragging.current = which; };

  return (
    <div
      className="flex flex-col gap-1.5"
      data-log-scale={log ? "true" : "false"}
    >
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
        <span className="font-semibold text-[color:var(--color-ink-subtle)]">
          {PARAM_LABEL[param]}{PARAM_UNIT[param] ? ` (${PARAM_UNIT[param]})` : ""}
        </span>
        <button
          type="button"
          aria-label={`reset ${param}`}
          onClick={() => onChange({ min: null, max: null })}
          className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-ink)]"
        >
          ×
        </button>
      </div>

      <div className="relative h-5 px-2" ref={trackRef}>
        <div className="absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[color:var(--color-border)]" />
        <div
          className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[color:var(--color-primary)]"
          style={{ left: `calc(${minFrac * 100}% + 8px)`,
                   right: `calc(${(1 - maxFrac) * 100}% + 8px)` }}
        />
        <button
          type="button"
          aria-label={`${param} min handle`}
          onPointerDown={startDrag("min")}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--color-primary)] bg-[color:var(--color-surface)]"
          style={{ left: `calc(${minFrac * 100}% + 8px)` }}
        />
        <button
          type="button"
          aria-label={`${param} max handle`}
          onPointerDown={startDrag("max")}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:var(--color-primary)] bg-[color:var(--color-surface)]"
          style={{ left: `calc(${maxFrac * 100}% + 8px)` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <BoundLabel
          value={minVal}
          onCommit={(n) => onChange({ min: n, max: value.max })}
        />
        <BoundLabel
          value={maxVal}
          onCommit={(n) => onChange({ min: value.min, max: n })}
        />
      </div>

      <div className="font-mono text-[9px] text-[color:var(--color-ink-subtle)]">
        data: {fmt(domain.min)}–{fmt(domain.max)}
      </div>
    </div>
  );
}
```

(Important: replace the literal `–` in the JSX above with the actual `–` character when you paste it. The plan-document parser may render it ambiguously.)

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureRangeSlider.test.tsx
```

Expected: PASS for all 8 cases.

- [ ] **Step 5: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/ExposureRangeSlider.tsx \
        web/src/components/exposure/ExposureRangeSlider.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureRangeSlider component

Dual-handle slider with click-to-edit numeric labels, log-scale auto-
detect for >100x domain ratios, and a reset button. Used by the new
filter panel for the six raw-param range filters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ExposureFilterPills.tsx` — pill bar above the chart

**Files:**
- Create: `web/src/components/exposure/ExposureFilterPills.tsx`
- Create: `web/src/components/exposure/ExposureFilterPills.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/ExposureFilterPills.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureFilterPills } from "./ExposureFilterPills";
import { DEFAULT_FILTERS, type ActiveFilters } from "./exposureFilters";

describe("ExposureFilterPills", () => {
  it("renders nothing for default filters", () => {
    const { container } = render(
      <ExposureFilterPills
        filters={DEFAULT_FILTERS}
        entryCount={42}
        onClearOne={() => undefined}
        onClearAll={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one pill per active param range", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS,
      paramRanges: {
        power: { min: 10, max: 40 },
        density: { min: 100, max: null },
      },
    };
    render(
      <ExposureFilterPills filters={f} entryCount={10}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/POWER 10–40/)).toBeInTheDocument();
    expect(screen.getByText(/DENSITY ≥100/)).toBeInTheDocument();
  });

  it("renders test pill with lineage suffix", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS, testId: 42,
      testLineage: new Set(["source"]),
    };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/TEST #42 \(\+source\)/)).toBeInTheDocument();
  });

  it("renders entry count and Clear all link", () => {
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS, validatedOnly: true,
    };
    render(
      <ExposureFilterPills filters={f} entryCount={42}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(screen.getByText(/42 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Clear all/)).toBeInTheDocument();
  });

  it("clicking the x on a pill calls onClearOne with the dimension key", () => {
    const onClearOne = vi.fn();
    const f: ActiveFilters = {
      ...DEFAULT_FILTERS,
      paramRanges: { power: { min: 10, max: 40 } },
    };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={onClearOne} onClearAll={() => undefined} />,
    );
    fireEvent.click(screen.getByLabelText(/clear power/i));
    expect(onClearOne).toHaveBeenCalledWith("range:power");
  });

  it("clicking Clear all calls onClearAll", () => {
    const onClearAll = vi.fn();
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={() => undefined} onClearAll={onClearAll} />,
    );
    fireEvent.click(screen.getByText(/Clear all/));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("trimOutliers is NOT shown as a pill", () => {
    const f: ActiveFilters = { ...DEFAULT_FILTERS, trimOutliers: false };
    const { container } = render(
      <ExposureFilterPills filters={f} entryCount={1}
        onClearOne={() => undefined} onClearAll={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

(Replace `–` with `–` and `≥` with `≥` when pasting into the file.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run src/components/exposure/ExposureFilterPills.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureFilterPills.tsx`**

```tsx
import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type FilterableParam,
} from "./exposureFilters";

export type ClearKey =
  | "sources" | "validated" | "testId" | "testKind"
  | "family" | "brush"
  | `range:${FilterableParam}`;

interface Props {
  filters: ActiveFilters;
  entryCount: number;
  onClearOne: (key: ClearKey) => void;
  onClearAll: () => void;
}

const PARAM_LABEL: Record<FilterableParam, string> = {
  power: "POWER", speed: "SPEED", frequency: "FREQUENCY",
  pulse_width: "PULSE WIDTH", density: "DENSITY", passes: "PASSES",
};

function fmtRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${min}–${max}`;
  if (min != null) return `≥${min}`;
  if (max != null) return `≤${max}`;
  return "";
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isDefault(f: ActiveFilters): boolean {
  // trimOutliers is not pillable, so we ignore it for "default" check.
  return (
    setsEqual(f.sources, DEFAULT_FILTERS.sources) &&
    !f.validatedOnly &&
    f.brushRange == null &&
    f.family == null &&
    f.testId == null &&
    f.testKind === "all" &&
    Object.values(f.paramRanges).every((r) => !r ||
      (r.min == null && r.max == null))
  );
}

interface PillProps {
  text: string;
  ariaLabel: string;
  onClear: () => void;
}

function Pill({ text, ariaLabel, onClear }: PillProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-primary)]">
      {text}
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        className="ml-0.5 text-[color:var(--color-primary)] hover:text-[color:var(--color-ink)]"
      >
        ×
      </button>
    </span>
  );
}

export function ExposureFilterPills({
  filters: f, entryCount, onClearOne, onClearAll,
}: Props) {
  if (isDefault(f)) return null;

  const pills: { text: string; key: string; clear: () => void }[] = [];

  if (!setsEqual(f.sources, DEFAULT_FILTERS.sources)) {
    pills.push({
      text: `SOURCE: ${[...f.sources].join(", ")}`,
      key: "sources",
      clear: () => onClearOne("sources"),
    });
  }
  if (f.validatedOnly) {
    pills.push({
      text: "VALIDATED ONLY",
      key: "validated",
      clear: () => onClearOne("validated"),
    });
  }
  for (const k of FILTERABLE_PARAMS) {
    const r = f.paramRanges[k];
    if (!r || (r.min == null && r.max == null)) continue;
    pills.push({
      text: `${PARAM_LABEL[k]} ${fmtRange(r.min, r.max)}`,
      key: `range:${k}`,
      clear: () => onClearOne(`range:${k}`),
    });
  }
  if (f.testId != null) {
    const lineage: string[] = [];
    if (f.testLineage.has("source")) lineage.push("source");
    if (f.testLineage.has("parent")) lineage.push("parent");
    const suffix = lineage.length ? ` (+${lineage.join(",+")})` : "";
    pills.push({
      text: `TEST #${f.testId}${suffix}`,
      key: "testId",
      clear: () => onClearOne("testId"),
    });
  }
  if (f.testKind !== "all") {
    pills.push({
      text: f.testKind.toUpperCase(),
      key: "testKind",
      clear: () => onClearOne("testKind"),
    });
  }
  if (f.family) {
    pills.push({
      text: `FAMILY: ${f.family.axis} sweep`,
      key: "family",
      clear: () => onClearOne("family"),
    });
  }
  if (f.brushRange) {
    pills.push({
      text: `EXPOSURE ${f.brushRange[0]}–${f.brushRange[1]}`,
      key: "brush",
      clear: () => onClearOne("brush"),
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap py-1.5 px-1">
      {pills.map((p) => (
        <Pill
          key={p.key}
          text={p.text}
          ariaLabel={`clear ${p.key.replace("range:", "")}`}
          onClear={p.clear}
        />
      ))}
      <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
        <span>{entryCount} entries</span>
        <button
          type="button"
          onClick={onClearAll}
          className="text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)]"
        >
          Clear all
        </button>
      </span>
    </div>
  );
}
```

(Same Unicode caveat: replace `–` with `–`, `≥` with `≥`, `≤` with `≤` when pasting.)

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureFilterPills.test.tsx
```

Expected: PASS for all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureFilterPills.tsx \
        web/src/components/exposure/ExposureFilterPills.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureFilterPills component

Pure derivation from ActiveFilters + entry count: one removable pill
per active filter dimension, plus an entry count and Clear all link
on the right. Renders nothing for default filters. trimOutliers is
deliberately not pilled (display-tuning, not a content filter).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `ExposureFocusedIndices.tsx` — single-column indices stack

**Files:**
- Create: `web/src/components/exposure/ExposureFocusedIndices.tsx`
- Create: `web/src/components/exposure/ExposureFocusedIndices.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureFocusedIndices.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExposureFocusedIndices } from "./ExposureFocusedIndices";
import type { ExposureRow } from "./exposureCorrelations";

const ROW: ExposureRow = {
  id: 1, hex: "#000",
  lab: [50, 0, 0],
  indices: {
    pulse_spacing_mm: 0.05, line_spacing_mm: 0.1,
    pulse_energy_index: 1.67, pulse_intensity_index: 0.0083,
    total_exposure_index: 8.33, ablation_aggression_index: 0.069,
    delivery_smoothness_index: 1004,
    formula_version: 3, density_model: "lpc",
    power_model: "controller_percent",
  },
};

describe("ExposureFocusedIndices", () => {
  it("renders a placeholder when no row is focused", () => {
    render(<ExposureFocusedIndices row={null} />);
    expect(screen.getByText(/focus an entry/i)).toBeInTheDocument();
  });

  it("renders all 7 index labels when a row is focused", () => {
    render(<ExposureFocusedIndices row={ROW} />);
    expect(screen.getByText(/pulse spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/line spacing/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse energy/i)).toBeInTheDocument();
    expect(screen.getByText(/pulse intensity/i)).toBeInTheDocument();
    expect(screen.getByText(/total exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/ablation aggression/i)).toBeInTheDocument();
    expect(screen.getByText(/delivery smoothness/i)).toBeInTheDocument();
  });

  it("renders the line_spacing_mm value with a mm suffix", () => {
    render(<ExposureFocusedIndices row={ROW} />);
    // formatted value contains "0.1" and "mm"
    const candidates = screen.getAllByText(/0\.1.*mm/);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/exposure/ExposureFocusedIndices.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureFocusedIndices.tsx`**

```tsx
import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  row: ExposureRow | null;
}

interface ChipProps {
  label: string;
  value: string;
}

function fmtNum(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(sig);
}

function Chip({ label, value }: ChipProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-1 rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] font-semibold text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

export function ExposureFocusedIndices({ row }: Props) {
  if (row == null) {
    return (
      <p className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)] leading-relaxed">
        Focus an entry to see its indices.
      </p>
    );
  }
  const i = row.indices;
  return (
    <div className="flex flex-col gap-1">
      <Chip label="Pulse spacing" value={`${fmtNum(i.pulse_spacing_mm)} mm`} />
      <Chip label="Line spacing" value={`${fmtNum(i.line_spacing_mm ?? NaN)} mm`} />
      <Chip label="Pulse energy" value={fmtNum(i.pulse_energy_index)} />
      <Chip label="Pulse intensity" value={fmtNum(i.pulse_intensity_index)} />
      <Chip label="Total exposure" value={fmtNum(i.total_exposure_index)} />
      <Chip label="Ablation aggression" value={fmtNum(i.ablation_aggression_index)} />
      <Chip label="Delivery smoothness" value={fmtNum(i.delivery_smoothness_index)} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureFocusedIndices.test.tsx
```

Expected: PASS for all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureFocusedIndices.tsx \
        web/src/components/exposure/ExposureFocusedIndices.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureFocusedIndices single-column chip stack

Promotes the seven derived indices into the right rail's left column
(under the focused card), so they're visible at a glance instead of
buried at the bottom of a chip grid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ExposureFilterPanel.tsx` — composes everything

**Files:**
- Create: `web/src/components/exposure/ExposureFilterPanel.tsx`
- Create: `web/src/components/exposure/ExposureFilterPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureFilterPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExposureFilterPanel } from "./ExposureFilterPanel";
import { DEFAULT_FILTERS, type ActiveFilters, type TestSummary } from "./exposureFilters";

const NOOP = () => undefined;

const TESTS: TestSummary[] = [
  { id: 10, name: "sweep-A", kind: "sweep",
    source_test_id: null, parent_test_id: null },
  { id: 20, name: "validate-A", kind: "validation",
    source_test_id: 10, parent_test_id: null },
];

describe("ExposureFilterPanel", () => {
  it("renders the six section headings", () => {
    render(
      <ExposureFilterPanel
        filters={DEFAULT_FILTERS}
        onChange={NOOP}
        tests={TESTS}
        dataRanges={{
          power: { min: 1, max: 100 }, speed: { min: 200, max: 1000 },
          frequency: { min: 30, max: 60 }, pulse_width: { min: 100, max: 400 },
          density: { min: 50, max: 5000 }, passes: { min: 1, max: 4 },
        }}
      />,
    );
    expect(screen.getByText(/source/i)).toBeInTheDocument();
    expect(screen.getByText(/test/i)).toBeInTheDocument();
    expect(screen.getByText(/range/i)).toBeInTheDocument();
    expect(screen.getByText(/family/i)).toBeInTheDocument();
    expect(screen.getByText(/outliers/i)).toBeInTheDocument();
    expect(screen.getByText(/clear all/i)).toBeInTheDocument();
  });

  it("Reset all calls onChange with DEFAULT_FILTERS", () => {
    const onChange = vi.fn();
    const f: ActiveFilters = { ...DEFAULT_FILTERS, validatedOnly: true };
    render(
      <ExposureFilterPanel filters={f} onChange={onChange} tests={TESTS}
        dataRanges={{
          power: null, speed: null, frequency: null,
          pulse_width: null, density: null, passes: null,
        }} />,
    );
    fireEvent.click(screen.getByText(/clear all/i));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });

  it("toggling validated only calls onChange with validatedOnly=true", () => {
    const onChange = vi.fn();
    render(
      <ExposureFilterPanel filters={DEFAULT_FILTERS} onChange={onChange}
        tests={TESTS} dataRanges={{
          power: null, speed: null, frequency: null,
          pulse_width: null, density: null, passes: null,
        }} />,
    );
    fireEvent.click(screen.getByLabelText(/validated only/i));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS, validatedOnly: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/exposure/ExposureFilterPanel.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `ExposureFilterPanel.tsx`**

```tsx
import {
  DEFAULT_FILTERS, FILTERABLE_PARAMS,
  type ActiveFilters, type FilterableParam,
  type SourceKind, type TestSummary,
} from "./exposureFilters";
import { ExposureRangeSlider } from "./ExposureRangeSlider";

interface Props {
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  tests: readonly TestSummary[];
  dataRanges: Record<FilterableParam, { min: number; max: number } | null>;
}

const SOURCE_OPTIONS: SourceKind[] = ["averaged", "single_result", "manual"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold">
        {title}
      </h3>
      <div className="h-[1px] bg-[color:var(--color-border)]" />
      {children}
    </section>
  );
}

export function ExposureFilterPanel({
  filters: f, onChange, tests, dataRanges,
}: Props) {
  const setSources = (next: ReadonlySet<SourceKind>) =>
    onChange({ ...f, sources: next });
  const setRange = (k: FilterableParam, r: typeof f.paramRanges[FilterableParam]) =>
    onChange({ ...f, paramRanges: { ...f.paramRanges, [k]: r } });

  return (
    <div className="flex flex-col gap-4">
      <Section title="Source / validated">
        <div className="flex flex-col gap-1">
          {SOURCE_OPTIONS.map((s) => (
            <label key={s} className="flex items-center gap-2 font-mono text-[10.5px]">
              <input
                type="checkbox"
                checked={f.sources.has(s)}
                onChange={(e) => {
                  const next = new Set(f.sources);
                  if (e.target.checked) next.add(s); else next.delete(s);
                  setSources(next);
                }}
              />
              {s}
            </label>
          ))}
          <label className="flex items-center gap-2 font-mono text-[10.5px]">
            <input
              type="checkbox"
              checked={f.validatedOnly}
              onChange={(e) =>
                onChange({ ...f, validatedOnly: e.target.checked })}
              aria-label="validated only"
            />
            validated only
          </label>
        </div>
      </Section>

      <Section title="Test">
        <select
          className="font-mono text-[10.5px] px-1 py-1 rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
          value={f.testId ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            onChange({ ...f, testId: v, testLineage: new Set() });
          }}
        >
          <option value="">All tests</option>
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.id} · {t.name} · {t.kind}
            </option>
          ))}
        </select>
        {f.testId != null && (
          <div className="flex flex-col gap-1 pl-2">
            {(["source", "parent"] as const).map((tag) => (
              <label key={tag} className="flex items-center gap-2 font-mono text-[10.5px]">
                <input
                  type="checkbox"
                  checked={f.testLineage.has(tag)}
                  onChange={(e) => {
                    const next = new Set(f.testLineage);
                    if (e.target.checked) next.add(tag); else next.delete(tag);
                    onChange({ ...f, testLineage: next });
                  }}
                />
                + {tag} test
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          {(["all", "sweep", "validation"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ ...f, testKind: k })}
              className={
                "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
                (f.testKind === k
                  ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
            >
              {k}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Ranges">
        <div className="flex flex-col gap-3">
          {FILTERABLE_PARAMS.map((k) => {
            const dr = dataRanges[k];
            if (!dr) return null;
            return (
              <ExposureRangeSlider
                key={k}
                param={k}
                domain={dr}
                value={f.paramRanges[k] ?? { min: null, max: null }}
                onChange={(r) => setRange(k,
                  (r.min == null && r.max == null) ? undefined : r)}
              />
            );
          })}
        </div>
      </Section>

      <Section title="Recipe family">
        {f.family ? (
          <div className="flex items-center gap-2 font-mono text-[10.5px]">
            <span>{f.family.axis} sweep</span>
            <button
              type="button"
              onClick={() => onChange({ ...f, family: null })}
              className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
            >
              clear
            </button>
          </div>
        ) : (
          <p className="font-mono text-[9.5px] italic text-[color:var(--color-ink-subtle)]">
            Set from the focused card.
          </p>
        )}
      </Section>

      <Section title="Outliers / brush">
        <label className="flex items-center gap-2 font-mono text-[10.5px]">
          <input
            type="checkbox"
            checked={f.trimOutliers}
            onChange={(e) =>
              onChange({ ...f, trimOutliers: e.target.checked })}
          />
          trim 1%/99%
        </label>
        {f.brushRange ? (
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span>brush: {f.brushRange[0]}–{f.brushRange[1]}</span>
            <button
              type="button"
              onClick={() => onChange({ ...f, brushRange: null })}
              className="ml-auto text-[color:var(--color-ink-subtle)] hover:text-[color:var(--color-primary)]"
            >
              clear
            </button>
          </div>
        ) : null}
      </Section>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_FILTERS)}
        className="font-mono text-[10px] uppercase tracking-[0.18em] py-1.5 rounded-sm border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
      >
        Clear all filters
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/components/exposure/ExposureFilterPanel.test.tsx
```

Expected: PASS for all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/exposure/ExposureFilterPanel.tsx \
        web/src/components/exposure/ExposureFilterPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): ExposureFilterPanel composes filter sections

Six sections in a single column: Source/Validated, Test, Ranges (×6
sliders), Recipe family status, Outliers/Brush, Clear all. Pure
controlled component — every change calls onChange with the next
ActiveFilters. No internal state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `ExposurePage` — state unification + server fetch rewrite

Migrates the page from ~6 separate `useState` filter hooks to a single `ActiveFilters` reducer. Drops the `validated_only` query param from the server fetch (filtering moves client-side); fetches the test list in parallel for lineage resolution.

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx` (state + fetch + filtered-rows derivation)
- Modify: `web/src/pages/ExposurePage.test.tsx` (existing tests adapt)

- [ ] **Step 1: Read the current state plumbing**

```bash
grep -n 'useState\|const filtered\|setFilter\|sourceFilter\|validatedOnly\|familyFilter\|brushRange\|trimOutliers\|listPaletteEntries' web/src/pages/ExposurePage.tsx | head -30
```

Note: the existing code uses ~6 separate state hooks (`sourceFilter`, `validatedOnly`, `familyFilter`, `brushRange`, `trimOutliers`, plus pickers). The fetch effect at ~line 200 calls `listPaletteEntries({ material_id, validated_only: validatedOnly })` then filters the result by `sourceFilter` inside `.then`.

- [ ] **Step 2: Replace state with `ActiveFilters` + load tests in parallel**

In `web/src/pages/ExposurePage.tsx`:

A. Add imports near the top:

```tsx
import {
  applyFilters,
  dataRanges,
  DEFAULT_FILTERS,
  FILTERABLE_PARAMS,
  type ActiveFilters,
  type FilterableParam,
  type TestSummary,
} from "../components/exposure/exposureFilters";
import { useFiltersUrlSync } from "../components/exposure/exposureFiltersUrl";
import { listTests } from "../api/tests";
```

B. Replace the existing six filter `useState` hooks with a single one:

```tsx
const [filters, setFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);
useFiltersUrlSync(filters, setFilters);
```

DELETE these lines (and any setters that referenced them):

```tsx
const [sourceFilter, setSourceFilter] = useState<...>(...);
const [validatedOnly, setValidatedOnly] = useState(false);
const [familyFilter, setFamilyFilter] = useState<FamilyFilter | null>(null);
const [brushRange, setBrushRange] = useState<...>(null);
const [trimOutliers, setTrimOutliers] = useState<boolean>(true);
// (matrixSource state STAYS — it's not a filter)
```

C. Add a `tests` state and load it alongside palette entries:

```tsx
const [tests, setTests] = useState<TestSummary[]>([]);

useEffect(() => {
  if (materialId === null) return;
  let cancelled = false;
  setRowsLoading(true);
  setRowsError(null);

  Promise.all([
    listPaletteEntries({ material_id: materialId }),  // dropped validated_only
    listTests({ material_id: materialId }),
  ])
    .then(([entries, fetchedTests]) => {
      if (cancelled) return;
      setRows(entries.filter((e) => e.indices != null));
      setTests(fetchedTests.map((t): TestSummary => ({
        id: t.id, name: t.name, kind: t.kind,
        source_test_id: t.source_test_id ?? null,
        parent_test_id: t.parent_test_id ?? null,
      })));
      setRowsLoading(false);
    })
    .catch((err) => {
      if (cancelled) return;
      setRowsError(err instanceof Error ? err.message : "Failed to load");
      setRowsLoading(false);
    });

  return () => { cancelled = true; };
}, [materialId]);
```

NOTE: `rows` state changes from `ExposureRow[]` to `PaletteEntry[]` (the unfiltered superset). Adjust the type.

D. Reset filters when material changes:

```tsx
useEffect(() => {
  if (materialId !== null) setFilters(DEFAULT_FILTERS);
}, [materialId]);
```

(Add this AFTER the fetch effect; the URL sync hook will then write an empty query to the hash automatically.)

E. Replace the `displayRows` derivation. Currently it filters `rows` based on multiple state values; now it's:

```tsx
const testsById = useMemo(
  () => new Map(tests.map((t) => [t.id, t])),
  [tests],
);

const filteredRows = useMemo(
  () => applyFilters(rows, filters, testsById),
  [rows, filters, testsById],
);

// Apply recipe-family filter on top (kept here because family is
// resolved against the families map, not testsById):
const displayRows = useMemo(() => {
  if (!filters.family) return filteredRows;
  const fam = families.get(/* compute key from filters.family.anchorRowId */);
  return fam
    ? filteredRows.filter((r) => fam.some((m) => m.row.id === r.id))
    : filteredRows;
}, [filteredRows, filters.family, families]);
```

(Replace `families.get(...)` with the actual family-member lookup the existing code uses. If the existing recipe-family resolution is awkward to fit here, leave it as a separate filtering step that consumes `displayRows` — the goal is the same: filter chained correctly. Reuse whatever logic was there pre-rewrite.)

F. The `dataRanges` for the filter panel:

```tsx
const ranges = useMemo(() => dataRanges(rows), [rows]);
```

G. Anywhere the old `sourceFilter` / `validatedOnly` / `familyFilter` / `brushRange` / `trimOutliers` were read, route through `filters.<key>` and write through `setFilters((prev) => ({ ...prev, <key>: <value> }))`.

H. The above-chart "Trim outliers" toggle button is REMOVED (it moves into the filter panel). The mode toggle (univariate/bivariate) stays.

- [ ] **Step 3: Update `ExposurePage.test.tsx`**

Find any test that reads from the OLD individual-state shape. Most likely the existing tests don't deeply assert state structure; they go through DOM. Adjust where needed — typically just dropping references to the removed top-bar Trim button.

- [ ] **Step 4: Run tests**

```bash
cd web && npx vitest run src/pages/ExposurePage.test.tsx
```

Expected: PASS. If failures emerge, they're likely about either (a) the removed trim toggle (drop the assertion) or (b) tests that did `listPaletteEntries({ validated_only: true })` mock expectations — change to expect no `validated_only` in the call args.

- [ ] **Step 5: Run the full frontend suite**

```bash
cd web && npm test -- --run
```

Expected: PASS for everything.

- [ ] **Step 6: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/ExposurePage.tsx web/src/pages/ExposurePage.test.tsx
git commit -m "$(cat <<'EOF'
refactor(exposure): unify filter state into ActiveFilters reducer

Replace six per-feature useState hooks (sourceFilter, validatedOnly,
familyFilter, brushRange, trimOutliers, plus matrixSource untouched)
with a single ActiveFilters value derived through applyFilters.

Server fetch drops the validated_only query param — filtering becomes
purely client-side, fixing the existing source-checkbox staleness
bug as a side effect (the bug was rooted in the deps array
deliberately excluding sourceFilter, leaving stale entries cached).

Adds a parallel listTests fetch so the test/lineage filter has the
testsById corpus it needs. Switches `rows` state from ExposureRow[]
(filtered) to PaletteEntry[] (unfiltered superset).

URL sync via useFiltersUrlSync — refreshing the page or pasting a
link restores the active filters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `ExposurePage` — right rail two-column restructure + new components wiring

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Wire in the new components**

A. Add imports:

```tsx
import { ExposureFilterPanel } from "../components/exposure/ExposureFilterPanel";
import { ExposureFilterPills, type ClearKey } from "../components/exposure/ExposureFilterPills";
import { ExposureFocusedIndices } from "../components/exposure/ExposureFocusedIndices";
```

B. Build the `onClearOne` callback for the pill bar:

```tsx
const handleClearOne = useCallback((key: ClearKey) => {
  setFilters((prev) => {
    if (key === "sources") return { ...prev, sources: DEFAULT_FILTERS.sources };
    if (key === "validated") return { ...prev, validatedOnly: false };
    if (key === "testId") return { ...prev, testId: null, testLineage: new Set() };
    if (key === "testKind") return { ...prev, testKind: "all" };
    if (key === "family") return { ...prev, family: null };
    if (key === "brush") return { ...prev, brushRange: null };
    if (key.startsWith("range:")) {
      const k = key.slice("range:".length) as FilterableParam;
      const next = { ...prev.paramRanges };
      delete next[k];
      return { ...prev, paramRanges: next };
    }
    return prev;
  });
}, []);
```

C. REPLACE the existing `Filter active` banner block above the scatter (around line 595 in the pre-rewrite source) with the new pill bar:

```tsx
<ExposureFilterPills
  filters={filters}
  entryCount={displayRows.length}
  onClearOne={handleClearOne}
  onClearAll={() => setFilters(DEFAULT_FILTERS)}
/>
```

The old `{familyFilter && (...)}` block is gone — its content is now one of the pills.

D. REMOVE the `Sources` section from the LEFT rail. Find the block:

```tsx
<RailSection title="Sources">
  <div className="flex flex-col gap-0.5">
    {(["averaged", "single_result", "manual"] as const).map((src) => ( ... ))}
    <RailCheckbox checked={validatedOnly} ... />
  </div>
</RailSection>
```

Delete it entirely. Source/validated controls live in the new filter panel only.

E. RESTRUCTURE the right rail. Find the existing `<aside className="w-60 ...">` block (around line 737) and replace its inner content layout:

```tsx
<aside className="shrink-0 flex flex-col xl:flex-row gap-4 px-4 py-5 border-l border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-y-auto"
       style={{ width: 480 }}>
  {/* LEFT COLUMN: Stats / Focused / Indices */}
  <div className="flex-1 min-w-0 flex flex-col gap-4">
    <section>
      <RailHeading>Stats</RailHeading>
      <MetalBar variant="soft" className="mb-3" />
      {/* … existing Stats content unchanged … */}
    </section>

    <section>
      {/* … existing Focused/Pinned card + neighbours unchanged … */}
    </section>

    <section>
      <RailHeading>Indices</RailHeading>
      <MetalBar variant="soft" className="mb-3" />
      <ExposureFocusedIndices row={focusedRow} />
    </section>
  </div>

  {/* RIGHT COLUMN: Filters */}
  <div className="flex-1 min-w-0 flex flex-col gap-4">
    <section>
      <RailHeading>Filters</RailHeading>
      <MetalBar variant="soft" className="mb-3" />
      <ExposureFilterPanel
        filters={filters}
        onChange={setFilters}
        tests={tests}
        dataRanges={ranges}
      />
    </section>
  </div>
</aside>
```

`xl:flex-row flex-col` makes the columns side-by-side at ≥1280px and stacked otherwise — handles narrow viewports.

F. The above-chart toolbar: REMOVE the `Trim outliers` button. The mode toggle stays.

```tsx
<div className="flex items-center gap-2 px-5 pt-3 pb-2.5 border-b ...">
  <span>Mode</span>
  <div role="tablist">{ /* unchanged */ }</div>
  {mode === "bivariate" && (<span>...</span>)}
  {/* DELETE the trim-outliers button */}
</div>
```

Trim toggle now lives in the filter panel's "Outliers / brush" section.

G. Update the scatter component invocation: pass `trimOutliers={filters.trimOutliers}` (read from filters now), and `dimRange={filters.brushRange}`.

- [ ] **Step 2: Build for visual verification**

```bash
cd web && npm run build > /dev/null 2>&1 && echo build-ok
```

Expected: `build-ok`.

- [ ] **Step 3: Run all frontend tests**

```bash
cd web && npm test -- --run
```

Expected: PASS.

- [ ] **Step 4: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ExposurePage.tsx
git commit -m "$(cat <<'EOF'
feat(exposure): doubled right rail + filter panel + pill bar wiring

Right rail expands to 480px and splits into two columns at >=1280px:
Stats + Focused/Pinned + Neighbours + Indices on the left, the new
ExposureFilterPanel on the right. Stacks single-column on narrower
viewports.

Above-chart pill bar replaces the single 'Filter active' banner; one
removable pill per active dimension plus entry count + Clear all.
Trim outliers toggle moves out of the above-chart toolbar into the
filter panel's Outliers/Brush section.

Left rail's Sources block removed — moved into the filter panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Browser verification + changelog + push

**Files:**
- Create: `changelog/2026-05-12-exposure-rail-filters.md`

- [ ] **Step 1: Seed real data + start the dev server**

```bash
uv run --active python scripts/seed_from_prod.py \
  --api-key fsp9KYfD7zRUL507 --wipe
sqlite3 ~/.xcs-gen/app.db "UPDATE materials SET owner_id=0; UPDATE tests SET owner_id=0; UPDATE palette_entries SET owner_id=0;"
cd web && npm run build > /dev/null 2>&1
cd /Users/jonzky/Documents/XTools/Reverse
pkill -f 'xcs-gen serve' 2>&1 || true
sleep 1
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
sleep 4
curl -s -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:8017/
```

- [ ] **Step 2: Browser walkthrough**

Open `http://127.0.0.1:8017/#/exposure/1`. Verify:

1. The right rail is visibly wider (≈480px on a wide window) with two columns; on a narrow window the right column wraps below the left.
2. The new "Indices" section appears in the left column, populated when an entry is focused, placeholder otherwise.
3. The right column shows the Filters panel with Source/Validated, Test, Ranges (six sliders), Recipe family, Outliers/Brush, Clear all.
4. The left rail no longer has a Sources section.
5. Toggling a source checkbox in the filter panel immediately updates the chart entry count (this is the bug-fix proof). Toggling validated only does the same.
6. Setting a power range in the slider updates the chart and adds a `POWER 10–40 ×` pill above the scatter. Click `×` clears that pill.
7. URL hash updates to `#/exposure/1?p=10..40&val=1` etc. as filters change. Refresh the page; filters survive.
8. Selecting a specific test from the test dropdown narrows entries; the lineage checkboxes appear and extend the set when toggled.
9. The kind toggle switches between sweep / validation / all.
10. "Clear all filters" + the "Clear all" link in the pill bar both reset every filter.
11. Switching material via the left rail clears all filters and the URL query.

If any step fails, fix in place before continuing.

- [ ] **Step 3: Stop the dev server**

```bash
pkill -f 'xcs-gen serve' 2>&1
```

- [ ] **Step 4: Author the changelog**

Create `changelog/2026-05-12-exposure-rail-filters.md`:

```markdown
---
id: 2026-05-12-exposure-rail-filters
date: 2026-05-12
level: major
title: Exposure — advanced filters + doubled right rail
summary: Per-param range filters, a test/lineage/kind picker, and an active-filter pill bar that always shows what's restricting the chart.
---

The exposure page used to mix interpretation controls (axis pickers,
mode toggle) with a thin set of filter checkboxes bolted onto the
left rail. There was no way to restrict the chart to a comparable
subset — no per-test filter, no parameter-range filter, no kind
filter — and the existing source-checkbox toggle was buggy
(toggling a source after the initial fetch left the page lying
about what it was showing).

This release rebuilds the right rail and the filter system from
scratch:

- **Doubled right rail with two columns.** Stats, focused entry,
  neighbours, and the seven derived indices live on the left; a
  full filter panel lives on the right.
- **Per-parameter range sliders.** Six dual-handle sliders for
  power, speed, frequency, pulse-width, density, and passes. Click
  a label to type a precise number; auto-detected log scale for
  high-ratio params like density.
- **Test / lineage / kind filter.** Pick a specific test, optionally
  extend the set with `+ source test` or `+ parent test` (single-
  step, not transitive), or filter to sweep-only / validation-only
  tests across the corpus.
- **Active-filter pill bar above the chart.** Every active filter
  shows up as a removable pill with the live entry count. Clear all
  resets everything.
- **URL-shareable filters.** Filter state round-trips through the
  hash, so you can paste `#/exposure/1?test=42&p=10..40` to a
  colleague and they'll see exactly what you saw.
- **The source-checkbox bug is fixed.** Filtering moved to a single
  pure derivation, so toggling source/validated checkboxes
  immediately updates the chart.

`trim outliers` moves into the filter panel; the Sources block in
the left rail is gone.

Tag-based filtering and `derived_from_entry_id` lineage in the
focused card are out of scope here — both are cheap follow-ups now
that the data already exists from the previous release.
```

- [ ] **Step 5: Commit changelog**

```bash
git add changelog/2026-05-12-exposure-rail-filters.md
git commit -m "$(cat <<'EOF'
changelog: exposure right-rail expansion + advanced filters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final pre-PR checks**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && npm run build > /dev/null 2>&1 && echo build-ok
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q 2>&1 | tail -5
```

Expected: tsc clean, vitest all pass, build OK, pytest passes (the 5 known-broken `test_storage_s3.py` failures are unrelated and pre-existing).

- [ ] **Step 7: Push branch + open draft PR**

```bash
git push -u origin feat/exposure-rail-filters
gh pr create --draft --title "feat: exposure right-rail expansion + advanced filters" --body "$(cat <<'EOF'
## Summary
- Right rail doubles to 480px and splits into two columns: Stats/Focused/Neighbours/Indices on the left, the new ExposureFilterPanel on the right.
- All filter state consolidates into a single ActiveFilters reducer; applyFilters is a pure function with full unit-test coverage. The existing source-checkbox staleness bug is fixed as a side effect of moving filtering to a single client-side derivation (regression test added).
- New filter dimensions: per-param range sliders (power, speed, frequency, pulse_width, density, passes — log-scale auto-detected), specific test picker with single-step source/parent lineage extensions, sweep/validation/all kind toggle.
- New pill bar above the scatter shows every active filter as a removable chip plus the entry count + Clear all link. trimOutliers is deliberately not pilled (display-tuning, not a content filter).
- URL hash query string round-trips ActiveFilters so refreshing the page or pasting a link restores filters exactly.
- Left rail's Sources block removed (controls moved to the filter panel).

Spec: `docs/superpowers/specs/2026-05-11-exposure-rail-filters-design.md`
Plan: `docs/superpowers/plans/2026-05-11-exposure-rail-filters.md`

## Test plan
- [x] `cd web && npm test` — all vitest tests pass
- [x] `cd web && npx tsc --noEmit` — clean
- [x] `cd web && npm run build` — succeeds
- [x] `uv run --active pytest tests/ -q` — backend green (mod the 5 pre-existing S3 failures)
- [x] Browser walk-through on `#/exposure/1` after seeding from prod (1049 entries) — verified: rail widens to two columns, source toggle works (no stale data), range sliders filter live, pill bar updates, URL persists, lineage extension toggles work, Clear all resets every dimension
- [ ] CI: backend, frontend, MySQL migration (no schema change), docker, CodeQL

## Out of scope
- Tag-based filtering — schema added in PR #81; UI is a cheap follow-up.
- `derived_from_entry_id` UI in the focused card — separate polish task.
- Saved filter presets — URL sharing covers most use cases.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

Expected: PR opened. Note its number.

- [ ] **Step 8: Watch CI**

```bash
gh pr checks <PR-NUMBER> --watch
```

If anything fails, fix and push.

---

## Self-review

**Spec coverage:**
- Right rail doubled + two-column layout — Task 9. ✓
- Filter panel content (Source/Test/Ranges/Family/Outliers/Reset) — Task 7. ✓
- Range sliders w/ click-to-edit + log auto-detect — Task 4. ✓
- Pill bar above the chart — Tasks 5 + 9 (wiring). ✓
- ActiveFilters reducer + applyFilters — Task 2. ✓
- URL persistence — Task 3 + Task 8 (sync hook wired into the page). ✓
- Source-checkbox bug fix as side effect — Tasks 2 (regression test) + 8 (the actual rewrite). ✓
- Material change clears filters — Task 8. ✓
- testsById fetch in parallel — Task 8. ✓
- Indices promoted to right rail — Tasks 6 + 9. ✓
- Frontend types updated — Task 1. ✓
- Changelog — Task 10. ✓

**Placeholder scan:** the unicode caveats in Tasks 4 and 5 (`replace – with –` etc.) are deliberate — the plan-document parser's handling of literal en-dashes / `≥` / `≤` inside code fences is unreliable, and noting it inline is more honest than risking a copy-paste error in the implementation. No TBDs or vague "handle edge cases" placeholders.

**Type consistency:** `ActiveFilters` shape is identical across Tasks 2, 3, 5, 7, 8. `TestSummary` declared in Task 2 used in Tasks 7, 8. `FilterableParam` declared in Task 2 used in Tasks 4, 5, 7. `ClearKey` declared in Task 5 used in Task 9. `ExposureRow` referenced as the existing import in Task 6 (no redefine). Method signatures match across tasks.
