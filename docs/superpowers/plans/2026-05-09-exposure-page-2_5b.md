# Exposure Page Phase 2.5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six exploration-page enhancements: source-test link (D), default bivariate (E), recipe-family traces on focus (A), recipe-family filter (C), raw-parameter correlation matrix (F), nearest-neighbour view (G).

**Architecture:** Frontend-only — no backend changes. Two new pure-helper modules (`recipeFamilies.ts`, `exposureNeighbours.ts`), two new visual components (`ExposureFamilyTrace`, `ExposureNeighboursPanel`), modifications to the existing exposure components and page. TDD on the helpers; component-tested with vitest + @testing-library.

**Tech Stack:** React 18 / TypeScript / Tailwind v4 / Vitest.

**Spec:** `docs/superpowers/specs/2026-05-09-exposure-page-2_5b-design.md` (committed `147204c`).

**Branch:** Continue on `feat/exposure-indices-exploration` so phase 2 + 2.5a + 2.5b ship together (or split during reviewer triage).

**Rebuild reminder:** After every `web/src/**` edit, run `cd web && npm run build` before testing in a browser — `xcs-gen serve` mounts `web/dist/`, not the Vite dev server.

---

## File Structure

**Create:**
- `web/src/components/exposure/recipeFamilies.ts` — pure helper. `buildFamilies(rows)` returns `Map<string, FamilyMember[]>`.
- `web/src/components/exposure/recipeFamilies.test.ts`
- `web/src/components/exposure/ExposureFamilyTrace.tsx` — SVG `<polyline>` for the focused entry's largest family.
- `web/src/components/exposure/exposureNeighbours.ts` — pure helpers. `nearestByDeltaE`, `nearestByRegime`.
- `web/src/components/exposure/exposureNeighbours.test.ts`
- `web/src/components/exposure/ExposureNeighboursPanel.tsx` — right-rail neighbour list with two tabs.
- `web/src/components/exposure/ExposureNeighboursPanel.test.tsx`

**Modify:**
- `web/src/components/exposure/exposureCorrelations.ts` — `ExposureRow` gains `test_id?: number`; add `RAW_PARAM_ROWS` constant + `buildRawParamCorrelationMatrix` helper.
- `web/src/components/exposure/exposureCorrelations.test.ts` — tests for the raw-param matrix.
- `web/src/components/exposure/ExposureCorrelationMatrix.tsx` — generalise to accept either `INDEX_ROWS` or `RAW_PARAM_ROWS` as the row dimension; add a `rowLabels` prop.
- `web/src/components/exposure/ExposureScatter.tsx` — accept optional `family` prop; render polyline behind dots.
- `web/src/components/exposure/ExposureFocusedCard.tsx` — source-test link (D); family-filter buttons (C); neighbours-panel slot (G).
- `web/src/pages/ExposurePage.tsx` — initial state changes (E); family detection memo; family-filter state; raw-param matrix tab state; neighbour-jump handler; focused entry's largest family selection.

---

## Task 1: D — Source test link

**Files:**
- Modify: `web/src/components/exposure/exposureCorrelations.ts`
- Modify: `web/src/pages/ExposurePage.tsx`
- Modify: `web/src/components/exposure/ExposureFocusedCard.tsx`
- Modify: `web/src/components/exposure/ExposureFocusedCard.test.tsx`

- [ ] **Step 1: Add `test_id` to `ExposureRow`**

In `web/src/components/exposure/exposureCorrelations.ts`, find the `ExposureRow` interface and add a field:

```typescript
export interface ExposureRow {
  id: number;
  hex: string;
  lab: [number, number, number];
  indices: LaserIndices;
  /** Source test that produced this entry, if any. Manual entries
   *  have null. Used by the focused-card's "Source test" link. */
  test_id?: number | null;
  params?: Record<string, number | string>;
}
```

- [ ] **Step 2: Project test_id in `paletteToExposureRow`**

In `web/src/pages/ExposurePage.tsx`, find `paletteToExposureRow` and add `test_id: p.test_id`:

```typescript
function paletteToExposureRow(p: PaletteEntry): ExposureRow {
  return {
    id: p.id,
    hex: p.hex,
    lab: [p.lab[0], p.lab[1], p.lab[2]],
    indices: p.indices,
    params: p.params as Record<string, number | string>,
    test_id: p.test_id,
  };
}
```

(Verify `PaletteEntry` already has `test_id` — it should, since it's part of the existing API response. If not, add it to the type.)

- [ ] **Step 3: Write failing test for the link**

Append to `web/src/components/exposure/ExposureFocusedCard.test.tsx`:

```tsx
it("renders a 'Source test' link when focused entry has test_id", () => {
  const r = row(1, "#a0522d");
  r.test_id = 42;
  render(<ExposureFocusedCard rows={[r]} focusedId={1} />);
  const link = screen.getByText(/source test/i).closest("a");
  expect(link).not.toBeNull();
  expect(link!.getAttribute("href")).toContain("/tests/42");
});

it("does not render a 'Source test' link for manual entries", () => {
  const r = row(1, "#a0522d");
  r.test_id = null;
  render(<ExposureFocusedCard rows={[r]} focusedId={1} />);
  expect(screen.queryByText(/source test/i)).toBeNull();
});
```

(Reuse the existing `row()` test fixture in the file. If the fixture doesn't currently set `test_id`, the new tests set it explicitly per case.)

- [ ] **Step 4: Run test, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
```

Expected: failures.

- [ ] **Step 5: Render the link**

In `web/src/components/exposure/ExposureFocusedCard.tsx`, in the active-state block, add the link below the RECIPE section (or wherever feels natural — placed under the recipe list):

```tsx
{focused.test_id != null && (
  <a
    href={`#/tests/${focused.test_id}`}
    className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-primary)] hover:underline mt-2 inline-block"
  >
    → Source test #{focused.test_id}
  </a>
)}
```

- [ ] **Step 6: Run, confirm pass**

```bash
npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
npx tsc --noEmit
```

Both clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/exposureCorrelations.ts \
        web/src/components/exposure/ExposureFocusedCard.tsx \
        web/src/components/exposure/ExposureFocusedCard.test.tsx \
        web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): link from focused entry to source test (phase 2.5b D)

ExposureRow gains optional test_id. ExposureFocusedCard renders a
'Source test #N' link when present. Manual entries (test_id null)
don't render the link."
```

---

## Task 2: E — Default scatter mode = bivariate

**Files:**
- Modify: `web/src/pages/ExposurePage.tsx`
- Modify: `web/src/pages/ExposurePage.test.tsx`

- [ ] **Step 1: Update default state**

In `web/src/pages/ExposurePage.tsx`, find the `useState` calls for `mode`, `xKey`, `yKeyBi`, `yScale`. Update defaults:

```tsx
const [mode, setMode] = useState<ScatterMode>("bivariate");          // was "univariate"
const [xKey, setXKey] = useState<IndexRow>("total_exposure_index");   // unchanged
const [yKeyBi, setYKeyBi] = useState<IndexRow>("pulse_intensity_index"); // unchanged value but now load-default
const [yScale, setYScale] = useState<ScaleKind>("log");               // was "linear"
```

(Find existing `useState<ScatterMode>(...)` etc. and update the literal default. Keep all other state as-is.)

- [ ] **Step 2: Update existing tests if they assert on mode**

If `ExposurePage.test.tsx` has assertions about default mode (e.g. checks for the regression line or a univariate-only label), update them to match the new bivariate default. Search:

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
grep -n "univariate" src/pages/ExposurePage.test.tsx
```

If matches, update each assertion. If no matches, no test changes needed (the existing mount-and-list tests should still pass).

- [ ] **Step 3: Run tests + build**

```bash
npx vitest run src/pages/ExposurePage.test.tsx
npx tsc --noEmit
npm run build
```

All clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/pages/ExposurePage.tsx web/src/pages/ExposurePage.test.tsx
git commit -m "feat(exposure): default scatter mode to bivariate (phase 2.5b E)

Initial state: mode=bivariate, X=total_exposure, Y=pulse_intensity,
both axes log-scale. Bivariate is the analytically richest first
view per phase 2.5a; users can still switch to univariate for
single-channel correlation work."
```

---

## Task 3: A.1 — recipeFamilies pure helper + tests (TDD)

**Files:**
- Create: `web/src/components/exposure/recipeFamilies.ts`
- Create: `web/src/components/exposure/recipeFamilies.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/recipeFamilies.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  VARYING_AXES,
  buildFamilies,
  type VaryingAxis,
} from "./recipeFamilies";
import type { ExposureRow } from "./exposureCorrelations";

function row(
  id: number,
  params: { speed: number; power: number; density: number; frequency: number; passes: number; pulse_width: number },
): ExposureRow {
  return {
    id,
    hex: "#aaaaaa",
    lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      total_exposure_index: 100,
      ablation_aggression_index: 0.3,
      delivery_smoothness_index: 33000,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
    params,
  };
}

describe("buildFamilies", () => {
  it("VARYING_AXES enumerates all 6 recipe params", () => {
    expect(VARYING_AXES).toEqual([
      "power", "speed", "frequency", "density", "passes", "pulse_width",
    ]);
  });

  it("returns empty map when no rows", () => {
    expect(buildFamilies([]).size).toBe(0);
  });

  it("returns empty map when no row has 3+ siblings on any axis", () => {
    const rows = [
      row(1, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 11, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    expect(buildFamilies(rows).size).toBe(0);
  });

  it("detects a 5-member power sweep", () => {
    const rows = [
      row(1, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 11, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(3, { speed: 800, power: 12, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(4, { speed: 800, power: 13, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(5, { speed: 800, power: 14, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    const fams = buildFamilies(rows);
    expect(fams.size).toBe(1);
    const [[, members]] = Array.from(fams.entries());
    expect(members.length).toBe(5);
    expect(members[0].varyingAxis).toBe("power");
    expect(members.map((m) => m.varyingValue)).toEqual([10, 11, 12, 13, 14]);
  });

  it("orders members ascending by varying value", () => {
    const rows = [
      row(1, { speed: 800, power: 14, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(3, { speed: 800, power: 12, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    const fams = buildFamilies(rows);
    const [[, members]] = Array.from(fams.entries());
    expect(members.map((m) => m.row.id)).toEqual([2, 3, 1]);
  });

  it("a row can belong to multiple families", () => {
    // Anchor row 1; siblings on power and on density.
    const rows = [
      row(1, { speed: 800, power: 10, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(2, { speed: 800, power: 11, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(3, { speed: 800, power: 12, density: 100, frequency: 65, passes: 1, pulse_width: 200 }),
      row(4, { speed: 800, power: 10, density: 200, frequency: 65, passes: 1, pulse_width: 200 }),
      row(5, { speed: 800, power: 10, density: 300, frequency: 65, passes: 1, pulse_width: 200 }),
    ];
    const fams = buildFamilies(rows);
    expect(fams.size).toBe(2);
    const axes = Array.from(fams.values()).map((m) => m[0].varyingAxis).sort();
    expect(axes).toEqual(["density", "power"]);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/recipeFamilies.test.ts
```

Expected: ImportError.

- [ ] **Step 3: Implement the module**

Create `web/src/components/exposure/recipeFamilies.ts`:

```typescript
import type { ExposureRow } from "./exposureCorrelations";

export const VARYING_AXES = [
  "power",
  "speed",
  "frequency",
  "density",
  "passes",
  "pulse_width",
] as const;

export type VaryingAxis = (typeof VARYING_AXES)[number];

export interface FamilyMember {
  row: ExposureRow;
  varyingAxis: VaryingAxis;
  varyingValue: number;
}

const MIN_FAMILY_SIZE = 3;

function paramOrNaN(row: ExposureRow, axis: VaryingAxis): number {
  const v = row.params?.[axis];
  return typeof v === "number" ? v : NaN;
}

/**
 * Detect recipe families — groups of entries sharing all-but-one
 * parameter. One row can belong to multiple families (one per axis
 * where it has ≥2 siblings, totalling ≥3 members in the group).
 *
 * Returns a Map keyed by `<axis>|<fixedTuple>` where fixedTuple is
 * the sorted (axis, value) pairs for the 5 fixed params. Members
 * within each family are sorted ascending by their varying value.
 */
export function buildFamilies(
  rows: readonly ExposureRow[],
): Map<string, FamilyMember[]> {
  const groups = new Map<string, FamilyMember[]>();
  for (const row of rows) {
    for (const axis of VARYING_AXES) {
      const fixedParts: string[] = [];
      let valid = true;
      for (const a of VARYING_AXES) {
        if (a === axis) continue;
        const v = paramOrNaN(row, a);
        if (Number.isNaN(v)) {
          valid = false;
          break;
        }
        fixedParts.push(`${a}=${v}`);
      }
      if (!valid) continue;
      const key = `${axis}|${fixedParts.sort().join(",")}`;
      const varyingValue = paramOrNaN(row, axis);
      if (Number.isNaN(varyingValue)) continue;
      const list = groups.get(key) ?? [];
      list.push({ row, varyingAxis: axis, varyingValue });
      groups.set(key, list);
    }
  }
  for (const [key, list] of groups) {
    if (list.length < MIN_FAMILY_SIZE) {
      groups.delete(key);
      continue;
    }
    list.sort((a, b) => a.varyingValue - b.varyingValue);
  }
  return groups;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/exposure/recipeFamilies.test.ts
npx tsc --noEmit
```

Expected: 6 passing, clean tsc.

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/recipeFamilies.ts web/src/components/exposure/recipeFamilies.test.ts
git commit -m "feat(exposure): recipeFamilies helper — group entries by varying axis

Pure-function helper. buildFamilies(rows) returns a Map keyed by
'<varying-axis>|<fixed-params>' to a list of members sorted
ascending by the varying value. Min family size is 3 (groups
smaller than that are dropped — statistically uninteresting). One
row can belong to multiple families."
```

---

## Task 4: A.2 — `ExposureFamilyTrace` component

**Files:**
- Create: `web/src/components/exposure/ExposureFamilyTrace.tsx`
- Create: `web/src/components/exposure/ExposureFamilyTrace.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureFamilyTrace.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ExposureFamilyTrace } from "./ExposureFamilyTrace";

describe("ExposureFamilyTrace", () => {
  it("renders a polyline through the given points", () => {
    const points: [number, number][] = [
      [10, 50], [50, 30], [100, 10],
    ];
    const { container } = render(
      <svg width="200" height="100"><ExposureFamilyTrace points={points} /></svg>,
    );
    const line = container.querySelector('[data-role="family-trace"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute("points")).toBe("10,50 50,30 100,10");
  });

  it("renders nothing when fewer than 2 points", () => {
    const { container } = render(
      <svg><ExposureFamilyTrace points={[[10, 20]]} /></svg>,
    );
    expect(container.querySelector('[data-role="family-trace"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureFamilyTrace.test.tsx
```

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureFamilyTrace.tsx`:

```tsx
import * as React from "react";

interface Props {
  /** Pre-projected screen coordinates of family members in
   *  varying-axis order. Caller is responsible for the projection. */
  points: readonly (readonly [number, number])[];
}

/**
 * A faint polyline tracing through a recipe-family's members.
 * Rendered behind the scatter dots, deliberately understated —
 * 1.2 px stroke at 0.4 opacity in the project's ink-subtle token
 * so it reads as a guide line, not a focal element.
 */
export const ExposureFamilyTrace: React.FC<Props> = ({ points }) => {
  if (points.length < 2) return null;
  const d = points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <polyline
      data-role="family-trace"
      points={d}
      fill="none"
      stroke="var(--color-ink-subtle)"
      strokeWidth={1.2}
      strokeOpacity={0.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
};
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/exposure/ExposureFamilyTrace.test.tsx
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/ExposureFamilyTrace.tsx web/src/components/exposure/ExposureFamilyTrace.test.tsx
git commit -m "feat(exposure): ExposureFamilyTrace SVG polyline

Faint ink-subtle polyline rendered behind scatter dots when a
recipe-family is detected for the focused entry. Caller projects
the points; this component is purely cosmetic."
```

---

## Task 5: Wire family trace into ExposureScatter + ExposurePage

**Files:**
- Modify: `web/src/components/exposure/ExposureScatter.tsx`
- Modify: `web/src/components/exposure/ExposureScatter.test.tsx`
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add `family` prop to ExposureScatter**

In `web/src/components/exposure/ExposureScatter.tsx`:

(a) Import:
```tsx
import { ExposureFamilyTrace } from "./ExposureFamilyTrace";
import type { FamilyMember } from "./recipeFamilies";
```

(b) Extend `Props`:
```tsx
interface Props {
  // ... existing props
  /** Optional: when set, the points of this family are rendered as
   *  a polyline behind the dots. Used to surface the focused entry's
   *  largest recipe-family sweep. */
  family?: readonly FamilyMember[];
}
```

(c) Render the polyline before the dots in the SVG. Find the dots-rendering block (the `rows.map(...)` that creates `<circle>` elements). Just before it, add:

```tsx
{family && family.length >= 2 && (
  <ExposureFamilyTrace
    points={family
      .map((m) => {
        const x = rowIndex(m.row, xKey);
        const y =
          mode === "univariate"
            ? rowChannel(m.row, yKey as ChannelCol)
            : rowIndex(m.row, yKey as IndexRow);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return [px(x), py(y)] as const;
      })
      .filter((p): p is readonly [number, number] => p !== null)}
  />
)}
```

- [ ] **Step 2: Add a test for the family rendering**

Append to `web/src/components/exposure/ExposureScatter.test.tsx`:

```tsx
it("renders a family-trace polyline when family prop is given", () => {
  const fam = [
    { row: rows[0], varyingAxis: "power" as const, varyingValue: 10 },
    { row: rows[1], varyingAxis: "power" as const, varyingValue: 11 },
    { row: rows[2], varyingAxis: "power" as const, varyingValue: 12 },
  ];
  const { container } = render(
    <ExposureScatter
      rows={rows}
      mode="univariate"
      xKey="surface_exposure_index"
      yKey="L"
      xScale="log"
      yScale="linear"
      focusedId={null}
      onHover={() => undefined}
      onLeave={() => undefined}
      onClick={() => undefined}
      family={fam}
    />,
  );
  expect(container.querySelector('[data-role="family-trace"]')).not.toBeNull();
});
```

(Replace `xKey="surface_exposure_index"` with `xKey="total_exposure_index"` — the rename from phase 2.5a. Use whatever the existing tests use.)

- [ ] **Step 3: In `ExposurePage`, detect families on row change**

In `web/src/pages/ExposurePage.tsx`, near the existing `correlationMatrix = useMemo(...)` block, add:

```tsx
import { buildFamilies, type FamilyMember } from "../components/exposure/recipeFamilies";

const families = useMemo(() => buildFamilies(rows), [rows]);

// For the focused entry, find its largest family.
const focusedFamily = useMemo<FamilyMember[] | null>(() => {
  if (focusedId == null) return null;
  let best: FamilyMember[] | null = null;
  for (const members of families.values()) {
    if (members.some((m) => m.row.id === focusedId)) {
      if (!best || members.length > best.length ||
          (members.length === best.length && members[0].varyingAxis < best[0].varyingAxis)) {
        best = members;
      }
    }
  }
  return best;
}, [families, focusedId]);
```

(Tie-break on alphabetical varying-axis for determinism per spec.)

- [ ] **Step 4: Pass `family` to the scatter**

Find the `<ExposureScatter ...>` JSX in the page and add:

```tsx
<ExposureScatter
  // ... existing props
  family={focusedFamily ?? undefined}
/>
```

- [ ] **Step 5: Add a "member of N-entry sweep" badge in ExposureFocusedCard**

Pass `family` (or its meta) to `ExposureFocusedCard`. Either pass the full list or just `{ size: number, axis: VaryingAxis } | null`. Simplest: pass the family array directly.

In `ExposureFocusedCard`'s Props:

```tsx
import type { FamilyMember } from "./recipeFamilies";

interface Props {
  // ...
  focusedFamily?: readonly FamilyMember[] | null;
}
```

In the active state, after the recipe section, render:

```tsx
{focused && focusedFamily && focusedFamily.length >= 3 && (
  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mt-2">
    Member of {focusedFamily.length}-entry {focusedFamily[0].varyingAxis} sweep
  </div>
)}
```

In `ExposurePage.tsx`, pass `focusedFamily` prop to `<ExposureFocusedCard>`.

- [ ] **Step 6: Run all tests + build**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ src/pages/ExposurePage.test.tsx
npx tsc --noEmit
npm run build
```

All clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/ExposureScatter.tsx \
        web/src/components/exposure/ExposureScatter.test.tsx \
        web/src/components/exposure/ExposureFocusedCard.tsx \
        web/src/components/exposure/ExposureFocusedCard.test.tsx \
        web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): family trace on focused-entry sweep (phase 2.5b A)

ExposureScatter accepts an optional family prop and renders a
polyline through its members. ExposurePage detects families
(memoised on rows), picks the focused entry's largest family
(deterministic tie-break by axis name), and passes it through.
ExposureFocusedCard shows a 'Member of N-entry [axis] sweep' note
when present."
```

---

## Task 6: C — Recipe-family filter

**Files:**
- Modify: `web/src/components/exposure/ExposureFocusedCard.tsx`
- Modify: `web/src/components/exposure/ExposureFocusedCard.test.tsx`
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add filter state to ExposurePage**

In `web/src/pages/ExposurePage.tsx`:

```tsx
import type { VaryingAxis } from "../components/exposure/recipeFamilies";

interface FamilyFilter {
  axis: VaryingAxis;
  anchorRowId: number;
}

const [familyFilter, setFamilyFilter] = useState<FamilyFilter | null>(null);

// All families the focused entry belongs to (one per varying axis where it has siblings).
const focusedAvailableFamilies = useMemo(() => {
  if (focusedId == null) return [] as FamilyMember[][];
  return Array.from(families.values()).filter((m) =>
    m.some((fm) => fm.row.id === focusedId),
  );
}, [families, focusedId]);

// The currently-active filter's member list.
const filteredFamilyMembers = useMemo(() => {
  if (!familyFilter) return null;
  for (const members of families.values()) {
    if (members.some((m) => m.row.id === familyFilter.anchorRowId)
        && members[0].varyingAxis === familyFilter.axis) {
      return members;
    }
  }
  return null;
}, [families, familyFilter]);

// IDs of in-filter rows; null = no filter.
const visibleIdsViaFilter = useMemo(() => {
  if (!filteredFamilyMembers) return null;
  return new Set(filteredFamilyMembers.map((m) => m.row.id));
}, [filteredFamilyMembers]);
```

Reset filter when material changes — find the existing `useEffect([materialId])` that resets focus and brush, and add:

```tsx
setFamilyFilter(null);
```

- [ ] **Step 2: Pass filter callbacks + available axes to ExposureFocusedCard**

In `ExposureFocusedCard`'s Props:

```tsx
interface Props {
  // ...
  availableFamilies?: readonly (readonly FamilyMember[])[];   // each is one family
  activeFilterAxis?: VaryingAxis | null;
  onSetFilter?: (axis: VaryingAxis, anchorRowId: number) => void;
  onClearFilter?: () => void;
}
```

In the active state (after the source-test link from Task 1), render the filter buttons:

```tsx
{focused && availableFamilies && availableFamilies.length > 0 && (
  <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
      {activeFilterAxis ? "Filter active" : "Filter to sweep"}
    </div>
    <div className="flex flex-wrap gap-1.5">
      {activeFilterAxis ? (
        <button
          type="button"
          onClick={onClearFilter}
          className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-primary)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-surface-elevated)]"
        >
          Clear ({activeFilterAxis})
        </button>
      ) : (
        availableFamilies.map((fam) => {
          const axis = fam[0].varyingAxis;
          return (
            <button
              key={axis}
              type="button"
              onClick={() => onSetFilter?.(axis, focused.id)}
              className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
            >
              {axis} ({fam.length})
            </button>
          );
        })
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3: In `ExposurePage`, dim non-matching entries across panels**

The simplest implementation: pass a `dimRange`-equivalent to each panel. The brush already has `dimRange={brushRange}`; add a parallel `visibleIds` prop to scatter, ribbon, and disc.

For minimal surface change, accept that the brush already produces a dim — extend its semantics:

Easiest pragmatic path for this task: instead of plumbing `visibleIds` through every panel, compute a derived `displayRows` filtered by `visibleIdsViaFilter` and pass that to the scatter / ribbon / disc *as their `rows` prop*. Out-of-filter rows simply disappear (vs. dim). This is a deliberate divergence from the spec ("dim to ~10%") because:

(a) full-disappearance is unambiguous when the filter is active
(b) spec's 10% dim was for visual context but with rich brush already at 15%, two dim levels confuses the eye
(c) implementation is much smaller (one filter at the page level vs prop drilling)

```tsx
const displayRows = useMemo(
  () => (visibleIdsViaFilter ? rows.filter((r) => visibleIdsViaFilter.has(r.id)) : rows),
  [rows, visibleIdsViaFilter],
);

// Pass displayRows to scatter, ribbon, disc, range brush.
// Passes the unfiltered `rows` to the focused-card's chromaticity disc still — the disc shows context
// (all entries) and the focused-cell stays visible regardless of filter.
```

Wait, the focused entry MUST stay visible even if a filter excludes other entries. Since the focused entry is always a family member when the filter is active (the filter button only appears for entries with families), this is fine — the focused entry IS in `visibleIdsViaFilter`. Verify by reading the filter logic.

- [ ] **Step 4: Wire callbacks in ExposurePage**

```tsx
<ExposureFocusedCard
  // ... existing props
  availableFamilies={focusedAvailableFamilies}
  activeFilterAxis={familyFilter?.axis ?? null}
  onSetFilter={(axis, anchorRowId) => setFamilyFilter({ axis, anchorRowId })}
  onClearFilter={() => setFamilyFilter(null)}
/>
```

- [ ] **Step 5: Test**

Add to `ExposureFocusedCard.test.tsx`:

```tsx
it("renders filter-to-sweep buttons when availableFamilies has entries", () => {
  const r = row(1, "#a0522d");
  r.test_id = null;
  const fam = [
    { row: r, varyingAxis: "power" as const, varyingValue: 10 },
    { row: { ...r, id: 2 }, varyingAxis: "power" as const, varyingValue: 11 },
    { row: { ...r, id: 3 }, varyingAxis: "power" as const, varyingValue: 12 },
  ];
  render(
    <ExposureFocusedCard
      rows={[r]}
      focusedId={1}
      availableFamilies={[fam]}
    />,
  );
  expect(screen.getByText(/filter to sweep/i)).toBeInTheDocument();
  expect(screen.getByText(/power \(3\)/i)).toBeInTheDocument();
});

it("renders clear button when activeFilterAxis is set", () => {
  const r = row(1, "#a0522d");
  render(
    <ExposureFocusedCard
      rows={[r]}
      focusedId={1}
      activeFilterAxis="power"
    />,
  );
  expect(screen.getByText(/clear \(power\)/i)).toBeInTheDocument();
});
```

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
npx tsc --noEmit
npm run build
```

Clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/ExposureFocusedCard.tsx \
        web/src/components/exposure/ExposureFocusedCard.test.tsx \
        web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): filter to recipe family (phase 2.5b C)

When a focused entry belongs to a sweep, the focused-card shows
buttons per available varying-axis. Click filters scatter / ribbon
/ disc / brush to that family's members. Clear button replaces
the buttons during an active filter. Material change resets the
filter."
```

---

## Task 7: F — Raw-parameter correlation matrix

**Files:**
- Modify: `web/src/components/exposure/exposureCorrelations.ts`
- Modify: `web/src/components/exposure/exposureCorrelations.test.ts`
- Modify: `web/src/components/exposure/ExposureCorrelationMatrix.tsx`
- Modify: `web/src/components/exposure/ExposureCorrelationMatrix.test.tsx`
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add raw-param helper + test**

In `web/src/components/exposure/exposureCorrelations.test.ts`:

```typescript
describe("buildRawParamCorrelationMatrix", () => {
  it("returns a 6x5 matrix", () => {
    const rows: ExposureRow[] = [
      row(10, 80, 0, 0), row(20, 60, 0, 0), row(40, 40, 0, 0),
    ];
    // Each row needs params for the matrix to compute. Augment:
    const rowsWithParams = rows.map((r, i) => ({
      ...r,
      params: { power: 10 + i, speed: 1000, frequency: 65, density: 100, passes: 1, pulse_width: 200 },
    }));
    const m = buildRawParamCorrelationMatrix(rowsWithParams);
    expect(m.length).toBe(6);
    expect(m[0].length).toBe(5);
  });
});
```

Then in `web/src/components/exposure/exposureCorrelations.ts`:

```typescript
export const RAW_PARAM_ROWS = [
  "power",
  "speed",
  "frequency",
  "density",
  "passes",
  "pulse_width",
] as const;
export type RawParamRow = (typeof RAW_PARAM_ROWS)[number];

export function buildRawParamCorrelationMatrix(
  rows: readonly ExposureRow[],
): number[][] {
  const valid = rows.filter((r) => r.indices.formula_version >= 1 && r.params);
  return RAW_PARAM_ROWS.map((paramKey) => {
    const xs = valid.map((r) => {
      const v = r.params?.[paramKey];
      return typeof v === "number" ? v : NaN;
    });
    return CHANNEL_COLS.map((col) => {
      const ys = valid.map((r) => channelValue(r, col));
      return pearson(xs, ys);
    });
  });
}
```

(`channelValue` is already a private function in this file; add `export` if necessary, or duplicate the switch — your call. The simpler path: extract `channelValue` to be reused.)

- [ ] **Step 2: Generalise `ExposureCorrelationMatrix`**

In `web/src/components/exposure/ExposureCorrelationMatrix.tsx`, change the Props to accept a `rowKeys` and `rowLabels`:

```tsx
interface Props<RowKey extends string> {
  matrix: readonly (readonly number[])[];
  rowKeys: readonly RowKey[];
  rowLabels: Record<RowKey, string>;
  selectedIndex: RowKey | null;
  selectedChannel: ChannelCol;
  onSelect: (index: RowKey, channel: ChannelCol) => void;
}
```

Replace the hard-coded `INDEX_ROWS` iteration with `rowKeys`. Replace `ROW_LABELS` lookup with `rowLabels[idx]`.

Update the component's existing test in `ExposureCorrelationMatrix.test.tsx` to pass the new required props.

- [ ] **Step 3: Add tab toggle in ExposurePage**

```tsx
const [matrixSource, setMatrixSource] = useState<"indices" | "raw">("indices");

const matrix = useMemo(() => (
  matrixSource === "indices"
    ? buildCorrelationMatrix(rows)
    : buildRawParamCorrelationMatrix(rows)
), [rows, matrixSource]);
```

In the matrix card render area, add a small two-button tab control above the matrix:

```tsx
<div className="flex gap-1 mb-2">
  <button
    type="button"
    onClick={() => setMatrixSource("indices")}
    className={
      "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
      (matrixSource === "indices"
        ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
        : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
    }
  >
    Indices
  </button>
  <button
    type="button"
    onClick={() => setMatrixSource("raw")}
    className={
      "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
      (matrixSource === "raw"
        ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
        : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
    }
  >
    Raw params
  </button>
</div>
<ExposureCorrelationMatrix
  matrix={matrix}
  rowKeys={matrixSource === "indices" ? INDEX_ROWS : RAW_PARAM_ROWS}
  rowLabels={matrixSource === "indices" ? INDEX_ROW_LABELS : RAW_PARAM_LABELS}
  selectedIndex={matrixSource === "indices" ? xKey : null}
  selectedChannel={mode === "univariate" ? yKeyUni : "L"}
  onSelect={(idx, ch) => {
    if (matrixSource === "indices") {
      setXKey(idx as IndexRow);
      if (mode === "univariate") setYKeyUni(ch);
    }
    // Raw-param matrix click does nothing for now — read-only per spec.
  }}
/>
```

Define the label maps near the page top:

```tsx
const INDEX_ROW_LABELS: Record<IndexRow, string> = {
  // ... copy from ExposureCorrelationMatrix's ROW_LABELS
};

const RAW_PARAM_LABELS: Record<RawParamRow, string> = {
  power: "PWR",
  speed: "SPD",
  frequency: "FRQ",
  density: "DEN",
  passes: "PSS",
  pulse_width: "PWD",
};
```

- [ ] **Step 4: Run, commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ src/pages/ExposurePage.test.tsx
npx tsc --noEmit
npm run build
```

Clean.

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/exposureCorrelations.ts \
        web/src/components/exposure/exposureCorrelations.test.ts \
        web/src/components/exposure/ExposureCorrelationMatrix.tsx \
        web/src/components/exposure/ExposureCorrelationMatrix.test.tsx \
        web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): raw-parameter correlation matrix (phase 2.5b F)

Toggle between 'indices vs channels' (current 7×5) and 'raw params
vs channels' (6×5: power/speed/frequency/density/passes/pulse_width).
Indices tab still drives scatter axes on click; raw-params tab is
read-only — clicking does nothing for now (phase 2.5c could plot
raw-param-vs-channel if useful)."
```

---

## Task 8: G.1 — exposureNeighbours pure helpers + tests

**Files:**
- Create: `web/src/components/exposure/exposureNeighbours.ts`
- Create: `web/src/components/exposure/exposureNeighbours.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/exposure/exposureNeighbours.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { nearestByDeltaE, nearestByRegime } from "./exposureNeighbours";
import type { ExposureRow } from "./exposureCorrelations";

function row(
  id: number,
  lab: [number, number, number],
  exposure: number = 100,
  intensity: number = 0.001,
): ExposureRow {
  return {
    id,
    hex: "#000000",
    lab,
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: intensity,
      total_exposure_index: exposure,
      ablation_aggression_index: exposure * intensity,
      delivery_smoothness_index: exposure / intensity,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("nearestByDeltaE", () => {
  it("excludes the anchor itself", () => {
    const anchor = row(1, [50, 0, 0]);
    const others = [row(2, [55, 0, 0]), row(3, [40, 0, 0])];
    const n = nearestByDeltaE(anchor, [anchor, ...others], 5);
    expect(n.find((m) => m.row.id === 1)).toBeUndefined();
  });

  it("returns up to N nearest by ΔE76", () => {
    const anchor = row(1, [50, 0, 0]);
    const others = [
      row(2, [55, 0, 0]),  // ΔE = 5
      row(3, [40, 0, 0]),  // ΔE = 10
      row(4, [50, 5, 0]),  // ΔE = 5
      row(5, [50, 0, 8]),  // ΔE = 8
    ];
    const n = nearestByDeltaE(anchor, [anchor, ...others], 3);
    expect(n.length).toBe(3);
    expect(n[0].distance).toBeCloseTo(5, 4);
    expect(n[2].distance).toBeCloseTo(8, 4);
  });

  it("returns all when fewer than N candidates", () => {
    const anchor = row(1, [50, 0, 0]);
    const n = nearestByDeltaE(anchor, [anchor, row(2, [55, 0, 0])], 5);
    expect(n.length).toBe(1);
  });
});

describe("nearestByRegime", () => {
  it("excludes the anchor itself", () => {
    const anchor = row(1, [0, 0, 0], 100, 0.001);
    const others = [row(2, [0, 0, 0], 200, 0.002)];
    const n = nearestByRegime(anchor, [anchor, ...others], 5);
    expect(n.find((m) => m.row.id === 1)).toBeUndefined();
  });

  it("uses log-space distance in (total_exposure, pulse_intensity)", () => {
    const anchor = row(1, [0, 0, 0], 100, 0.001);
    const close = row(2, [0, 0, 0], 100, 0.001);   // identical regime
    const far = row(3, [0, 0, 0], 10000, 0.1);     // 2 decades away on each axis
    const n = nearestByRegime(anchor, [anchor, close, far], 5);
    expect(n[0].row.id).toBe(2);
    expect(n[0].distance).toBeCloseTo(0, 4);
    expect(n[1].row.id).toBe(3);
    expect(n[1].distance).toBeCloseTo(Math.hypot(2, 2), 4);  // ≈ 2.828
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run src/components/exposure/exposureNeighbours.test.ts
```

- [ ] **Step 3: Implement**

Create `web/src/components/exposure/exposureNeighbours.ts`:

```typescript
import { deltaE76 } from "../../color/math";
import type { ExposureRow } from "./exposureCorrelations";

export interface Neighbour {
  row: ExposureRow;
  distance: number;
}

export function nearestByDeltaE(
  anchor: ExposureRow,
  candidates: readonly ExposureRow[],
  n: number,
): Neighbour[] {
  const others = candidates.filter((r) => r.id !== anchor.id);
  const scored = others.map((r) => ({ row: r, distance: deltaE76(anchor.lab, r.lab) }));
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, n);
}

export function nearestByRegime(
  anchor: ExposureRow,
  candidates: readonly ExposureRow[],
  n: number,
): Neighbour[] {
  const others = candidates.filter((r) => r.id !== anchor.id);
  const ax = Math.log10(Math.max(1e-9, anchor.indices.total_exposure_index));
  const ay = Math.log10(Math.max(1e-9, anchor.indices.pulse_intensity_index));
  const scored = others.map((r) => {
    const x = Math.log10(Math.max(1e-9, r.indices.total_exposure_index));
    const y = Math.log10(Math.max(1e-9, r.indices.pulse_intensity_index));
    const distance = Math.hypot(x - ax, y - ay);
    return { row: r, distance };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, n);
}
```

(Verify `deltaE76` exists in `web/src/color/math.ts`. It should — `deltaE2000` and `deltaE76` are both there per the codebase exploration.)

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/exposure/exposureNeighbours.test.ts
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/exposureNeighbours.ts web/src/components/exposure/exposureNeighbours.test.ts
git commit -m "feat(exposure): nearestByDeltaE + nearestByRegime helpers

Pure-function helpers ranking palette entries against an anchor.
nearestByDeltaE uses ΔE76 in Lab space (similar colours).
nearestByRegime uses log-space distance in (total_exposure,
pulse_intensity) — similar exposure profiles regardless of colour.
Both exclude the anchor itself."
```

---

## Task 9: G.2 — `ExposureNeighboursPanel` component

**Files:**
- Create: `web/src/components/exposure/ExposureNeighboursPanel.tsx`
- Create: `web/src/components/exposure/ExposureNeighboursPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureNeighboursPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExposureNeighboursPanel } from "./ExposureNeighboursPanel";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.001,
      total_exposure_index: 100,
      ablation_aggression_index: 0.1,
      delivery_smoothness_index: 100000,
      formula_version: 2,
      density_model: "opaque",
      power_model: "controller_percent",
    },
    params: { power: 10, speed: 1000, frequency: 65, density: 100, passes: 1, pulse_width: 200 },
  };
}

describe("ExposureNeighboursPanel", () => {
  const anchor = row(1, "#aaaaaa");
  const rows = [anchor, row(2, "#bbbbbb"), row(3, "#cccccc"), row(4, "#dddddd"), row(5, "#eeeeee"), row(6, "#ffffff")];

  it("shows two tabs (colour and regime)", () => {
    render(<ExposureNeighboursPanel anchor={anchor} candidates={rows} onSelectNeighbour={() => undefined} />);
    expect(screen.getByText(/similar colour/i)).toBeInTheDocument();
    expect(screen.getByText(/similar regime/i)).toBeInTheDocument();
  });

  it("renders up to N neighbour rows (default 5)", () => {
    const { container } = render(
      <ExposureNeighboursPanel anchor={anchor} candidates={rows} onSelectNeighbour={() => undefined} />,
    );
    const items = container.querySelectorAll('[data-role="neighbour-row"]');
    expect(items.length).toBe(5);
  });

  it("clicking a neighbour calls onSelectNeighbour with its id", () => {
    const onSelectNeighbour = vi.fn();
    const { container } = render(
      <ExposureNeighboursPanel anchor={anchor} candidates={rows} onSelectNeighbour={onSelectNeighbour} />,
    );
    const items = container.querySelectorAll<HTMLElement>('[data-role="neighbour-row"]');
    fireEvent.click(items[0]);
    expect(onSelectNeighbour).toHaveBeenCalledOnce();
    expect(typeof onSelectNeighbour.mock.calls[0][0]).toBe("number");
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run src/components/exposure/ExposureNeighboursPanel.test.tsx
```

- [ ] **Step 3: Implement**

Create `web/src/components/exposure/ExposureNeighboursPanel.tsx`:

```tsx
import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import { nearestByDeltaE, nearestByRegime, type Neighbour } from "./exposureNeighbours";

interface Props {
  anchor: ExposureRow;
  candidates: readonly ExposureRow[];
  onSelectNeighbour: (id: number) => void;
  /** Default 5. */
  n?: number;
}

type Mode = "colour" | "regime";

export const ExposureNeighboursPanel: React.FC<Props> = ({ anchor, candidates, onSelectNeighbour, n = 5 }) => {
  const [mode, setMode] = React.useState<Mode>("colour");
  const neighbours = React.useMemo<Neighbour[]>(() => {
    return mode === "colour"
      ? nearestByDeltaE(anchor, candidates, n)
      : nearestByRegime(anchor, candidates, n);
  }, [mode, anchor, candidates, n]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
          Neighbours
        </div>
        <div className="flex gap-1">
          {(["colour", "regime"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
                (mode === m
                  ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
            >
              {m === "colour" ? "Similar colour" : "Similar regime"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {neighbours.map((nb) => {
          const p = nb.row.params ?? {};
          const recipe = `pwr ${p.power ?? "?"} · spd ${p.speed ?? "?"} · frq ${p.frequency ?? "?"}`;
          const distLabel = mode === "colour"
            ? `ΔE ${nb.distance.toFixed(1)}`
            : `Δreg ${nb.distance.toFixed(2)}`;
          return (
            <button
              key={nb.row.id}
              type="button"
              data-role="neighbour-row"
              onClick={() => onSelectNeighbour(nb.row.id)}
              className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-[color:var(--color-surface-elevated)] text-left"
            >
              <span
                className="inline-block w-4 h-4 rounded-sm border border-[color:var(--color-border)] shrink-0"
                style={{ background: nb.row.hex }}
              />
              <span className="font-mono text-[10px] text-[color:var(--color-ink)]">{nb.row.hex.toUpperCase()}</span>
              <span className="font-mono text-[10px] text-[color:var(--color-ink-subtle)] ml-auto">{distLabel}</span>
              <span className="font-mono text-[9px] text-[color:var(--color-ink-subtle)] hidden xl:inline truncate">{recipe}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/exposure/ExposureNeighboursPanel.test.tsx
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/ExposureNeighboursPanel.tsx web/src/components/exposure/ExposureNeighboursPanel.test.tsx
git commit -m "feat(exposure): ExposureNeighboursPanel with two ranking modes

Right-rail panel showing top-N neighbours of the focused entry.
Two tabs: 'Similar colour' (ΔE76) and 'Similar regime' (log-space
distance in total_exposure × pulse_intensity). Per-row: swatch +
hex + distance metric + recipe summary. Clicking navigates focus
to that entry."
```

---

## Task 10: Wire neighbours panel into the page

**Files:**
- Modify: `web/src/components/exposure/ExposureFocusedCard.tsx`
- Modify: `web/src/pages/ExposurePage.tsx`

- [ ] **Step 1: Add neighbours slot in ExposureFocusedCard**

In `ExposureFocusedCard`'s Props add an optional render slot:

```tsx
interface Props {
  // ... existing
  neighboursSlot?: React.ReactNode;
}
```

In the active state, after the family-filter section, render `{neighboursSlot}` if provided.

- [ ] **Step 2: Render the panel from ExposurePage**

In `web/src/pages/ExposurePage.tsx`, find the focused-entry resolution. When focused, render the panel and pass via slot:

```tsx
import { ExposureNeighboursPanel } from "../components/exposure/ExposureNeighboursPanel";

const focusedRow = focusedId == null ? null : rows.find((r) => r.id === focusedId);

<ExposureFocusedCard
  // ... existing props
  neighboursSlot={
    focusedRow ? (
      <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
        <ExposureNeighboursPanel
          anchor={focusedRow}
          candidates={rows}
          onSelectNeighbour={(id) => {
            setTransientFocusId(null);
            setPinnedFocusId(id);
          }}
        />
      </div>
    ) : undefined
  }
/>
```

The "click a neighbour" handler clears transient and pins the new id. Mirror the existing click-pin logic.

- [ ] **Step 3: Run + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ src/pages/ExposurePage.test.tsx
npx tsc --noEmit
npm run build
```

Clean.

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/exposure/ExposureFocusedCard.tsx web/src/pages/ExposurePage.tsx
git commit -m "feat(exposure): nearest-neighbour panel in focused card (phase 2.5b G)

ExposureFocusedCard accepts a neighboursSlot. ExposurePage renders
ExposureNeighboursPanel into it when focused, with the in-scope
rows as candidates and a click handler that re-pins focus to the
chosen neighbour."
```

---

## Task 11: Manual smoke + final verification + push

- [ ] **Step 1: Restart server with the new build**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
lsof -ti:8017 | xargs kill 2>/dev/null
cd web && npm run build && cd ..
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 4
```

- [ ] **Step 2: Headless screenshot on a populated material**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --window-size=2000,1500 \
  --virtual-time-budget=10000 \
  --screenshot=/tmp/exposure-2_5b.png \
  "http://127.0.0.1:8017/#/exposure"
ls -la /tmp/exposure-2_5b.png
```

Read the screenshot via the Read tool to confirm:
- Default scatter is bivariate `total_exposure × pulse_intensity`
- 8 chips visible on a focused entry (still the 2.5a layout)
- Correlations matrix card has Indices / Raw params toggle
- Family-filter buttons appear when a focused entry has siblings

If a manual interaction is needed for full coverage (the focus state requires hover/click), add it to the changelog screenshot path or skip — the visual polish doesn't gate this task.

- [ ] **Step 3: Save the screenshot for the changelog**

```bash
cp /tmp/exposure-2_5b.png changelog/images/exposure-2_5b.png
```

- [ ] **Step 4: Stop the server**

```bash
kill $SERVER_PID 2>/dev/null
```

- [ ] **Step 5: Backend + frontend verification**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q 2>&1 | tail -10
cd web && npx tsc --noEmit && npm test -- --run && npm run build
```

All clean — no regressions.

- [ ] **Step 6: Add changelog entry**

Create `changelog/2026-05-10-exposure-2_5b.md`:

```markdown
---
id: 2026-05-10-exposure-2_5b
date: 2026-05-10
level: minor
title: Exposure page — recipe-family traces, source-test link, neighbours, raw-param matrix
summary: Six exploration enhancements that turn the dense vertical/horizontal columns into navigable narratives.
images:
  - src: exposure-2_5b.png
    caption: The exposure page with the new neighbours panel and family-filter buttons in the right rail.
---

Six enhancements to the `#/exposure` page:

- **Source-test link.** When a focused palette entry came from a test, a `→ Source test #N` link appears in the right rail.
- **Default bivariate.** New visitors land on `total_exposure × pulse_intensity` so the cluster structure is the first thing they see.
- **Recipe-family traces.** When a focused entry belongs to a parameter sweep (≥3 entries varying along one axis only), a faint polyline is drawn through that sweep's members. The right rail tells you `Member of N-entry [axis] sweep`.
- **Filter to recipe family.** Click `[POWER]` (or whichever varying axis) in the right rail to filter the page to just that sweep. Click `Clear` to return.
- **Raw-parameter correlation matrix.** Toggle between the existing 7×5 indices matrix and a 6×5 raw-params matrix (power × hue, density × L\*, etc.) — useful for spotting when an index masks a stronger raw-param signal.
- **Nearest-neighbour view.** A panel below the focused card lists the top 5 entries by `Similar colour` (ΔE76) or `Similar regime` (log-space distance in `total_exposure × pulse_intensity`). Click any to jump focus to it.

Together these turn the dense column patterns from phase 2 into navigable narratives — clicking a column member reveals which sweep it belongs to, and one click hides everything else.
```

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add changelog/2026-05-10-exposure-2_5b.md changelog/images/exposure-2_5b.png
git commit -m "changelog: phase 2.5b enhancements"
```

- [ ] **Step 7: Push + update PR**

```bash
git push 2>&1 | tail -3
gh pr edit 78 --body "$(cat <<'EOF'
## Summary

PR #78 ships the exposure exploration page (phase 2), combined heuristic indices (phase 2.5a), AND six exploration enhancements (phase 2.5b):

- New top-level page at `#/exposure` for material-scoped exploration of laser exposure indices vs palette colour. Configurable scatter (univariate or bivariate), Hue Ribbon, correlations matrix, right-rail Focused card with a*/b* chromaticity disc, bottom exposure-range brush.
- Phase 2.5a: `ablation_aggression_index` + `delivery_smoothness_index` (combined indices). `surface_exposure_index` → `total_exposure_index` rename + Pydantic deprecated alias. Migration `0023`.
- Phase 2.5b: source-test link, default bivariate, recipe-family traces, recipe-family filter, raw-parameter correlation matrix, nearest-neighbour view (by ΔE colour OR by log-space exposure regime).

Specs:
- `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md`
- `docs/superpowers/specs/2026-05-08-combined-indices-design.md`
- `docs/superpowers/specs/2026-05-09-exposure-page-2_5b-design.md`

Plans:
- `docs/superpowers/plans/2026-05-08-exposure-indices-exploration.md`
- `docs/superpowers/plans/2026-05-08-combined-indices.md`
- `docs/superpowers/plans/2026-05-09-exposure-page-2_5b.md`

Validation: `docs/exposure-page-validation.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
gh pr checks --watch=false 2>&1 | tail -10
```

---

## Self-review

| Spec section | Implementing task |
|---|---|
| D — Source test link | Task 1 |
| E — Default bivariate | Task 2 |
| A — Recipe-family traces (helper, component, integration) | Tasks 3, 4, 5 |
| C — Recipe-family filter | Task 6 |
| F — Raw-parameter correlation matrix | Task 7 |
| G — Nearest-neighbour helpers + panel + integration | Tasks 8, 9, 10 |
| Manual verification + changelog + PR | Task 11 |
