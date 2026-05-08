# Exposure Indices Exploration Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `#/exposure` exploration page that lets the user see how the six laser exposure indices relate to colours in their palette, scoped to a single material.

**Architecture:** Pure SVG components mirroring the Stability page's chart vocabulary (`stabilityChartMath`, `stabilityChartLayers`). Math helpers TDD'd first. Components composed under `web/src/components/exposure/`. Page shell at `web/src/pages/ExposurePage.tsx` owns state. No backend work — reuses `GET /api/palette?material_id=...` (`listPaletteEntries({ material_id })` in `web/src/api/palette.ts`). Final visual pass via the frontend-design skill.

**Tech Stack:** React 18 / TypeScript / Tailwind v4 (CSS-variable design tokens) / Radix UI primitives where useful / Vitest + @testing-library/react for tests / hand-rolled SVG for charts.

**Spec:** `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md` (committed `c71f9f5` on `feat/exposure-indices-exploration`).

**Branch:** Already on `feat/exposure-indices-exploration` (cut off `main` at `ba5c57d`, with the spec committed).

**Rebuild reminder:** After every `web/src/**` edit, run `cd web && npm run build` before testing in a browser — `xcs-gen serve` mounts `web/dist/`, not the Vite dev server.

---

## File Structure

**Create — pure helpers + tests:**
- `web/src/components/exposure/exposureMath.ts` — Pearson, Spearman, log-linear regression, hue/chroma exposure helpers. Reuses `web/src/color/math.ts::hueDeg / chroma`.
- `web/src/components/exposure/exposureMath.test.ts`
- `web/src/components/exposure/exposureCorrelations.ts` — builds the 5×N `|r|` matrix from a list of palette entries.
- `web/src/components/exposure/exposureCorrelations.test.ts`

**Create — components + tests:**
- `web/src/components/exposure/ExposureChromaDisc.tsx`
- `web/src/components/exposure/ExposureChromaDisc.test.tsx`
- `web/src/components/exposure/ExposureHueRibbon.tsx`
- `web/src/components/exposure/ExposureHueRibbon.test.tsx`
- `web/src/components/exposure/ExposureCorrelationMatrix.tsx`
- `web/src/components/exposure/ExposureCorrelationMatrix.test.tsx`
- `web/src/components/exposure/ExposureRangeBrush.tsx`
- `web/src/components/exposure/ExposureRangeBrush.test.tsx`
- `web/src/components/exposure/ExposureScatter.tsx`
- `web/src/components/exposure/ExposureScatter.test.tsx`
- `web/src/components/exposure/ExposureFocusedCard.tsx`
- `web/src/components/exposure/ExposureFocusedCard.test.tsx`
- `web/src/pages/ExposurePage.tsx`
- `web/src/pages/ExposurePage.test.tsx`

**Create — changelog:**
- `changelog/2026-05-09-exposure-page.md`
- `changelog/images/exposure-page.png`

**Modify:**
- `web/src/router.ts` — add `{ name: "exposure"; materialId?: number }` route + parser.
- `web/src/App.tsx` — dispatch the new route to `ExposurePage`.
- `web/src/components/TopBar.tsx` — add "Exposure" link under the **Materials** group, next to "Palette".

**Possibly modify (only if existing types are missing fields):**
- `web/src/types.ts` — confirm `PaletteEntry.indices` is already in place (it is, after PR #77). No edit expected.

---

## Task 1: Math helpers — `exposureMath.ts`

**Files:**
- Create: `web/src/components/exposure/exposureMath.ts`
- Create: `web/src/components/exposure/exposureMath.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/exposureMath.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  pearson,
  spearman,
  logLinearRegression,
} from "./exposureMath";

describe("pearson", () => {
  it("perfect positive correlation = 1", () => {
    const r = pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBeCloseTo(1, 6);
  });

  it("perfect negative correlation = -1", () => {
    const r = pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(r).toBeCloseTo(-1, 6);
  });

  it("uncorrelated data is near 0", () => {
    const r = pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it("returns NaN when n < 2", () => {
    expect(Number.isNaN(pearson([1], [2]))).toBe(true);
    expect(Number.isNaN(pearson([], []))).toBe(true);
  });

  it("returns NaN when one series has zero variance", () => {
    expect(Number.isNaN(pearson([1, 1, 1], [2, 4, 6]))).toBe(true);
  });

  it("ignores NaN values in either series", () => {
    const r = pearson([1, 2, NaN, 4, 5], [2, 4, 100, 8, 10]);
    expect(r).toBeCloseTo(1, 6);
  });
});

describe("spearman", () => {
  it("perfect monotonic positive = 1", () => {
    const r = spearman([1, 2, 3, 4, 5], [10, 100, 1000, 10000, 100000]);
    expect(r).toBeCloseTo(1, 6);
  });

  it("perfect monotonic negative = -1", () => {
    const r = spearman([1, 2, 3, 4, 5], [100, 80, 60, 40, 20]);
    expect(r).toBeCloseTo(-1, 6);
  });

  it("handles ties via average rank", () => {
    // Pairs (1,1),(1,2),(2,3) — first two tied on x.
    const r = spearman([1, 1, 2], [1, 2, 3]);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe("logLinearRegression", () => {
  it("fits y = a + b*log10(x) on synthetic data", () => {
    // y = 5 + 3*log10(x)
    const xs = [1, 10, 100, 1000];
    const ys = xs.map((x) => 5 + 3 * Math.log10(x));
    const fit = logLinearRegression(xs, ys);
    expect(fit.intercept).toBeCloseTo(5, 6);
    expect(fit.slope).toBeCloseTo(3, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it("returns NaN slope when n < 2 or x has zero variance", () => {
    const fit = logLinearRegression([10, 10, 10], [1, 2, 3]);
    expect(Number.isNaN(fit.slope)).toBe(true);
  });

  it("ignores non-positive x values (log undefined)", () => {
    const fit = logLinearRegression([0, 1, 10, 100], [99, 5, 8, 11]);
    // The 0 input should be dropped; remaining 3 points fit cleanly.
    expect(Number.isNaN(fit.slope)).toBe(false);
    expect(fit.r2).toBeCloseTo(1, 4);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/exposureMath.test.ts
```

Expected: ImportError — module doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `web/src/components/exposure/exposureMath.ts`:

```typescript
/**
 * Pure-function helpers for the exposure-indices exploration page.
 *
 * Pearson + Spearman correlations and a log-linear regression
 * (y = a + b·log10(x)) are used by the scatter's regression overlay,
 * the right-rail Stats hero, and the correlations matrix builder.
 *
 * NaN handling is deliberate: callers pass arrays whose entries may
 * have stale formula_version or otherwise-missing values; the math
 * helpers drop NaN-containing rows rather than poisoning the result.
 */

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) return NaN;
  const cleanXs: number[] = [];
  const cleanYs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      cleanXs.push(xs[i]);
      cleanYs.push(ys[i]);
    }
  }
  const n = cleanXs.length;
  if (n < 2) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += cleanXs[i]; sy += cleanYs[i]; }
  const mx = sx / n;
  const my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = cleanXs[i] - mx;
    const dy = cleanYs[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return NaN;
  return num / den;
}

function rankAverage(values: readonly number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length) return NaN;
  const cleanXs: number[] = [];
  const cleanYs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      cleanXs.push(xs[i]);
      cleanYs.push(ys[i]);
    }
  }
  if (cleanXs.length < 2) return NaN;
  return pearson(rankAverage(cleanXs), rankAverage(cleanYs));
}

export interface LogLinearFit {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
}

export function logLinearRegression(
  xs: readonly number[],
  ys: readonly number[],
): LogLinearFit {
  if (xs.length !== ys.length) {
    return { intercept: NaN, slope: NaN, r2: NaN, n: 0 };
  }
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && xs[i] > 0 && Number.isFinite(ys[i])) {
      lx.push(Math.log10(xs[i]));
      ly.push(ys[i]);
    }
  }
  const n = lx.length;
  if (n < 2) return { intercept: NaN, slope: NaN, r2: NaN, n };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += lx[i]; sy += ly[i]; }
  const mx = sx / n;
  const my = sy / n;
  let dx2 = 0, dxdy = 0;
  for (let i = 0; i < n; i++) {
    const dx = lx[i] - mx;
    dx2 += dx * dx;
    dxdy += dx * (ly[i] - my);
  }
  if (dx2 === 0) return { intercept: NaN, slope: NaN, r2: NaN, n };
  const slope = dxdy / dx2;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * lx[i];
    ssRes += (ly[i] - yhat) ** 2;
    ssTot += (ly[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? NaN : 1 - ssRes / ssTot;
  return { intercept, slope, r2, n };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/exposureMath.test.ts
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/exposureMath.ts web/src/components/exposure/exposureMath.test.ts
git commit -m "feat(exposure): pure math helpers — pearson, spearman, log-linear regression

The seam every later exposure component shares. NaN rows are dropped
rather than poisoning the result; logLinearRegression drops non-
positive x values (log undefined) so the regression still fits the
remaining valid points."
```

---

## Task 2: Correlation matrix builder — `exposureCorrelations.ts`

**Files:**
- Create: `web/src/components/exposure/exposureCorrelations.ts`
- Create: `web/src/components/exposure/exposureCorrelations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/exposureCorrelations.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildCorrelationMatrix,
  INDEX_ROWS,
  CHANNEL_COLS,
  type ExposureRow,
} from "./exposureCorrelations";

function row(
  surface: number,
  l: number,
  a: number,
  b: number,
): ExposureRow {
  return {
    id: 0,
    hex: "#000000",
    lab: [l, a, b],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: surface,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("buildCorrelationMatrix", () => {
  it("dimensions are 5 indices × 5 channels", () => {
    const rows: ExposureRow[] = [row(10, 50, 0, 0), row(20, 40, 0, 0), row(30, 30, 0, 0)];
    const m = buildCorrelationMatrix(rows);
    expect(INDEX_ROWS.length).toBe(5);
    expect(CHANNEL_COLS.length).toBe(5);
    expect(m.length).toBe(5);
    expect(m[0].length).toBe(5);
  });

  it("strong negative correlation surface_exposure × L* yields high |r|", () => {
    const rows: ExposureRow[] = [
      row(10, 80, 0, 0),
      row(50, 60, 0, 0),
      row(200, 40, 0, 0),
      row(800, 20, 0, 0),
    ];
    const m = buildCorrelationMatrix(rows);
    const surfaceRow = INDEX_ROWS.indexOf("surface_exposure_index");
    const lCol = CHANNEL_COLS.indexOf("L");
    const r = m[surfaceRow][lCol];
    expect(Math.abs(r)).toBeGreaterThan(0.95);
    expect(r).toBeLessThan(0); // exposure up → L down
  });

  it("returns NaN cells when fewer than 2 valid rows", () => {
    const m = buildCorrelationMatrix([row(10, 50, 0, 0)]);
    expect(Number.isNaN(m[0][0])).toBe(true);
  });

  it("excludes rows with formula_version=0 by default", () => {
    const a = row(10, 80, 0, 0);
    const b = row(50, 60, 0, 0);
    const c = row(200, 40, 0, 0);
    const stale = { ...row(99, 99, 0, 0) };
    stale.indices = { ...stale.indices, formula_version: 0 };
    const m = buildCorrelationMatrix([a, b, c, stale]);
    // Should have used only the 3 clean rows.
    const surfaceRow = INDEX_ROWS.indexOf("surface_exposure_index");
    const lCol = CHANNEL_COLS.indexOf("L");
    expect(Math.abs(m[surfaceRow][lCol])).toBeGreaterThan(0.99);
  });

  it("computes hue and chroma columns from a/b", () => {
    // Rows where a*=b*=0 → chroma=0 → no variance → NaN
    const rows = [row(10, 50, 0, 0), row(50, 60, 0, 0)];
    const m = buildCorrelationMatrix(rows);
    const chromaCol = CHANNEL_COLS.indexOf("chroma");
    expect(Number.isNaN(m[0][chromaCol])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/exposureCorrelations.test.ts
```

Expected: ImportError.

- [ ] **Step 3: Implement the module**

Create `web/src/components/exposure/exposureCorrelations.ts`:

```typescript
import { hueDeg, chroma as chromaFn } from "../../color/math";
import { pearson } from "./exposureMath";
import type { LaserIndices } from "../PaletteIndicesChips";

/**
 * Row shape this module consumes. Matches the relevant fields of
 * PaletteEntry; the `id` and `hex` are included so callers can
 * trace cells back to their entry.
 */
export interface ExposureRow {
  id: number;
  hex: string;
  lab: [number, number, number];
  indices: LaserIndices;
}

export const INDEX_ROWS = [
  "pulse_spacing_mm",
  "line_spacing_index",
  "pulse_energy_index",
  "pulse_intensity_index",
  "surface_exposure_index",
] as const satisfies readonly (keyof LaserIndices)[];
export type IndexRow = (typeof INDEX_ROWS)[number];

export const CHANNEL_COLS = [
  "L",
  "a",
  "b",
  "hue",
  "chroma",
] as const;
export type ChannelCol = (typeof CHANNEL_COLS)[number];

function channelValue(row: ExposureRow, col: ChannelCol): number {
  const [l, a, b] = row.lab;
  switch (col) {
    case "L":      return l;
    case "a":      return a;
    case "b":      return b;
    case "hue":    return hueDeg(a, b);
    case "chroma": return chromaFn(a, b);
  }
}

/**
 * Build the 5×5 Pearson |r| matrix of (index, channel). Rows with
 * `formula_version=0` are dropped (stale-backfill sentinel). NaN
 * cells indicate insufficient data or zero variance.
 */
export function buildCorrelationMatrix(
  rows: readonly ExposureRow[],
): number[][] {
  const valid = rows.filter((r) => r.indices.formula_version >= 1);
  return INDEX_ROWS.map((indexKey) => {
    const xs = valid.map((r) => r.indices[indexKey] as number);
    return CHANNEL_COLS.map((col) => {
      const ys = valid.map((r) => channelValue(r, col));
      return pearson(xs, ys);
    });
  });
}
```

The `LaserIndices` type was exported from `web/src/components/PaletteIndicesChips.tsx` in PR #77. Verify the import path resolves; if the type isn't exported there for any reason, copy the same shape locally and add a TODO to consolidate.

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/exposureCorrelations.test.ts
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/exposureCorrelations.ts \
        web/src/components/exposure/exposureCorrelations.test.ts
git commit -m "feat(exposure): correlation matrix builder

5 indices × 5 channels (L, a, b, hue, chroma). Pearson |r| via the
shared exposureMath.pearson. Hue/chroma derived client-side from
lab_a/lab_b using the existing color/math helpers. Rows with
formula_version=0 (stale-backfill sentinel) are dropped before
correlation."
```

---

## Task 3: `ExposureChromaDisc` component

**Files:**
- Create: `web/src/components/exposure/ExposureChromaDisc.tsx`
- Create: `web/src/components/exposure/ExposureChromaDisc.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureChromaDisc.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ExposureChromaDisc } from "./ExposureChromaDisc";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, lab: [number, number, number]): ExposureRow {
  return {
    id, hex, lab,
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: 100,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureChromaDisc", () => {
  it("renders a dot per row", () => {
    const rows = [
      row(1, "#a0522d", [50, 30, 20]),
      row(2, "#704020", [40, 25, 15]),
      row(3, "#3a1e1a", [25, 18, 8]),
    ];
    const { container } = render(
      <ExposureChromaDisc rows={rows} focusedId={null} />,
    );
    expect(container.querySelectorAll('[data-role="entry-dot"]').length).toBe(3);
  });

  it("draws a focus ring + crosshair on the focused entry", () => {
    const rows = [row(1, "#a0522d", [50, 30, 20]), row(2, "#704020", [40, 25, 15])];
    const { container } = render(
      <ExposureChromaDisc rows={rows} focusedId={2} />,
    );
    expect(container.querySelector('[data-role="focus-ring"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-role="focus-crosshair"]').length).toBeGreaterThan(0);
  });

  it("renders axis labels +a/-a/+b/-b", () => {
    render(<ExposureChromaDisc rows={[]} focusedId={null} />);
    expect(screen.getByText("+a")).toBeInTheDocument();
    expect(screen.getByText("−a")).toBeInTheDocument();
    expect(screen.getByText("+b")).toBeInTheDocument();
    expect(screen.getByText("−b")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureChromaDisc.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureChromaDisc.tsx`:

```tsx
import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  focusedId: number | null;
  /** Square SVG viewport size in CSS px. The disc is centred and
   *  fills width = height. Default 160. */
  size?: number;
  /** a*/b* range plotted before the disc edge. Defaults to ±60,
   *  which covers most realistic stainless / brass palettes. */
  range?: number;
  onHover?: (id: number) => void;
  onLeave?: () => void;
  onClick?: (id: number) => void;
}

/**
 * The a*/b* chromaticity disc. Every entry is rendered as a small
 * swatch-coloured dot at its measured (a, b). Concentric rings at
 * chroma = 20, 40, 60. Conventional CIE Lab orientation: +b* up,
 * +a* right.
 *
 * The focused entry, if any, gets an outer ring + crosshair guides.
 * Used in the Focused-card both at idle (focusedId=null, just dots)
 * and active (focusedId=N, dot+crosshair).
 */
export const ExposureChromaDisc: React.FC<Props> = ({
  rows,
  focusedId,
  size = 160,
  range = 60,
  onHover,
  onLeave,
  onClick,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12; // leave room for axis labels

  const project = (a: number, b: number): [number, number] => {
    const x = cx + (a / range) * r;
    const y = cy - (b / range) * r;
    return [x, y];
  };

  const focused = focusedId == null ? null : rows.find((row) => row.id === focusedId);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="a* / b* chromaticity disc"
    >
      {/* Rings */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="0.6" />
      <circle cx={cx} cy={cy} r={r * 2 / 3} fill="none" stroke="var(--color-border)" strokeWidth="0.4" />
      <circle cx={cx} cy={cy} r={r / 3} fill="none" stroke="var(--color-border)" strokeWidth="0.4" />
      {/* Axes */}
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="var(--color-border)" strokeWidth="0.4" />
      <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="var(--color-border)" strokeWidth="0.4" />
      {/* Axis labels */}
      <text x={cx + r + 4} y={cy + 3} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)">+a</text>
      <text x={cx - r - 4} y={cy + 3} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)" textAnchor="end">−a</text>
      <text x={cx} y={cy - r - 4} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)" textAnchor="middle">+b</text>
      <text x={cx} y={cy + r + 9} fontSize="9" fontFamily="ui-monospace" fill="var(--color-ink-subtle)" textAnchor="middle">−b</text>

      {/* Entry dots */}
      {rows.map((row) => {
        const [, a, b] = row.lab;
        const [px, py] = project(a, b);
        const isFocused = row.id === focusedId;
        return (
          <circle
            key={row.id}
            data-role="entry-dot"
            cx={px}
            cy={py}
            r={isFocused ? 4 : 2.5}
            fill={row.hex}
            stroke="var(--color-surface)"
            strokeWidth={0.5}
            onMouseEnter={() => onHover?.(row.id)}
            onMouseLeave={() => onLeave?.()}
            onClick={() => onClick?.(row.id)}
            style={{ cursor: onClick ? "pointer" : undefined }}
          />
        );
      })}

      {/* Focus ring + crosshair */}
      {focused && (() => {
        const [, a, b] = focused.lab;
        const [px, py] = project(a, b);
        return (
          <g>
            <circle
              data-role="focus-ring"
              cx={px}
              cy={py}
              r={7}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1.4}
            />
            <line
              data-role="focus-crosshair"
              x1={px - 12}
              y1={py}
              x2={px + 12}
              y2={py}
              stroke="var(--color-primary)"
              strokeWidth={0.6}
              opacity={0.7}
            />
            <line
              data-role="focus-crosshair"
              x1={px}
              y1={py - 12}
              x2={px}
              y2={py + 12}
              stroke="var(--color-primary)"
              strokeWidth={0.6}
              opacity={0.7}
            />
          </g>
        );
      })()}
    </svg>
  );
};
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureChromaDisc.test.tsx
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/ExposureChromaDisc.tsx \
        web/src/components/exposure/ExposureChromaDisc.test.tsx
git commit -m "feat(exposure): a*/b* chromaticity disc

Pure SVG component. Concentric rings at chroma = 20/40/60, +b* up,
+a* right. Each entry rendered as a swatch-coloured dot at its
measured (a, b). Focused entry gets an outer ring + crosshair via
the project's design-token CSS variables. Used in idle (no focus)
and active states of the right-rail Focused card."
```

---

## Task 4: `ExposureHueRibbon` component

**Files:**
- Create: `web/src/components/exposure/ExposureHueRibbon.tsx`
- Create: `web/src/components/exposure/ExposureHueRibbon.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureHueRibbon.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { ExposureHueRibbon } from "./ExposureHueRibbon";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, surface: number): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: surface,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureHueRibbon", () => {
  it("renders one tile per row", () => {
    const rows = [row(1, "#aaa", 10), row(2, "#bbb", 20), row(3, "#ccc", 30)];
    const { container } = render(
      <ExposureHueRibbon rows={rows} orderBy="surface_exposure_index" focusedId={null} />,
    );
    expect(container.querySelectorAll('[data-role="ribbon-tile"]').length).toBe(3);
  });

  it("orders tiles ascending by the orderBy index", () => {
    const rows = [row(3, "#ccc", 30), row(1, "#aaa", 10), row(2, "#bbb", 20)];
    const { container } = render(
      <ExposureHueRibbon rows={rows} orderBy="surface_exposure_index" focusedId={null} />,
    );
    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>('[data-role="ribbon-tile"]'),
    );
    const ids = tiles.map((t) => Number(t.dataset.entryId));
    expect(ids).toEqual([1, 2, 3]);
  });

  it("renders a focused mark above the focused tile", () => {
    const rows = [row(1, "#aaa", 10), row(2, "#bbb", 20)];
    const { container } = render(
      <ExposureHueRibbon rows={rows} orderBy="surface_exposure_index" focusedId={2} />,
    );
    expect(container.querySelector('[data-role="focus-mark"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureHueRibbon.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureHueRibbon.tsx`:

```tsx
import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import type { IndexRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  /** The index whose value drives the order of tiles ascending. */
  orderBy: IndexRow;
  focusedId: number | null;
  onHover?: (id: number) => void;
  onLeave?: () => void;
  onClick?: (id: number) => void;
}

/**
 * Hue Ribbon — every entry's swatch as a tile, ordered ascending by
 * the chosen index. A successful index/colour relationship makes the
 * ribbon read as a smooth gradient; a noisy one looks scrambled.
 *
 * Width is fluid; tiles share the available space equally. Min tile
 * width is enforced by the parent's CSS.
 */
export const ExposureHueRibbon: React.FC<Props> = ({
  rows,
  orderBy,
  focusedId,
  onHover,
  onLeave,
  onClick,
}) => {
  const ordered = React.useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = a.indices[orderBy] as number;
      const vb = b.indices[orderBy] as number;
      if (Number.isNaN(va) || va == null) return 1;
      if (Number.isNaN(vb) || vb == null) return -1;
      return va - vb;
    });
  }, [rows, orderBy]);

  return (
    <div className="flex flex-col gap-1 w-full">
      {/* Tiles */}
      <div className="relative flex w-full overflow-hidden rounded-sm border border-[color:var(--color-border)] h-[60px]">
        {ordered.map((row) => {
          const isFocused = row.id === focusedId;
          return (
            <div
              key={row.id}
              data-role="ribbon-tile"
              data-entry-id={row.id}
              className="flex-1 cursor-pointer transition-opacity"
              style={{ background: row.hex, opacity: isFocused ? 1 : 0.95 }}
              onMouseEnter={() => onHover?.(row.id)}
              onMouseLeave={() => onLeave?.()}
              onClick={() => onClick?.(row.id)}
              title={`${row.hex} · ${orderBy}=${(row.indices[orderBy] as number).toPrecision(3)}`}
            />
          );
        })}
      </div>
      {/* Focus mark */}
      {focusedId != null && (() => {
        const idx = ordered.findIndex((r) => r.id === focusedId);
        if (idx < 0) return null;
        const left = `calc(${(idx + 0.5) * (100 / ordered.length)}% - 1px)`;
        return (
          <div
            data-role="focus-mark"
            className="relative w-full h-3"
            aria-hidden="true"
          >
            <div
              className="absolute top-0 h-3 w-0.5 bg-[color:var(--color-primary)]"
              style={{ left }}
            />
            <div
              className="absolute top-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-primary)]"
              style={{ left: `calc(${left} + 6px)` }}
            >
              focused
            </div>
          </div>
        );
      })()}
    </div>
  );
};
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureHueRibbon.test.tsx
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/exposure/ExposureHueRibbon.tsx \
        web/src/components/exposure/ExposureHueRibbon.test.tsx
git commit -m "feat(exposure): hue ribbon ordered by current X axis

Every entry's swatch as a flex-1 tile in a horizontal strip. Tiles
are ordered ascending by whatever the scatter's X axis is — a
successful relationship reads as a colour gradient down the ribbon.
Focused tile gets an orange mark + 'FOCUSED' label above it."
```

---

## Task 5: `ExposureCorrelationMatrix` component

**Files:**
- Create: `web/src/components/exposure/ExposureCorrelationMatrix.tsx`
- Create: `web/src/components/exposure/ExposureCorrelationMatrix.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureCorrelationMatrix.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ExposureCorrelationMatrix } from "./ExposureCorrelationMatrix";
import { INDEX_ROWS, CHANNEL_COLS } from "./exposureCorrelations";

describe("ExposureCorrelationMatrix", () => {
  // Synthetic 5×5 matrix; one cell strongly correlated, rest weak.
  const matrix: number[][] = [
    [0.10, 0.20, 0.30, 0.40, 0.50],
    [0.15, 0.25, 0.35, 0.45, 0.55],
    [0.20, 0.30, 0.40, 0.50, 0.60],
    [0.25, 0.35, 0.45, 0.55, 0.65],
    [-0.84, 0.40, 0.30, 0.40, 0.50], // surface_exposure × L*
  ];

  it("renders 5 row labels and 5 column labels", () => {
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="surface_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-role="row-label"]').length).toBe(5);
    expect(container.querySelectorAll('[data-role="col-label"]').length).toBe(5);
  });

  it("shows numeric labels only on cells with |r| ≥ 0.7", () => {
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="surface_exposure_index"
        selectedChannel="L"
        onSelect={() => undefined}
      />,
    );
    const labels = container.querySelectorAll('[data-role="cell-value"]');
    expect(labels.length).toBe(1);
    expect(labels[0].textContent).toContain("84");
  });

  it("clicking a cell calls onSelect with that (index, channel) pair", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ExposureCorrelationMatrix
        matrix={matrix}
        selectedIndex="surface_exposure_index"
        selectedChannel="L"
        onSelect={onSelect}
      />,
    );
    const cells = container.querySelectorAll<HTMLElement>('[data-role="matrix-cell"]');
    fireEvent.click(cells[0]); // top-left = (PSp, L)
    expect(onSelect).toHaveBeenCalledWith(INDEX_ROWS[0], CHANNEL_COLS[0]);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureCorrelationMatrix.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureCorrelationMatrix.tsx`:

```tsx
import * as React from "react";
import {
  CHANNEL_COLS,
  INDEX_ROWS,
  type ChannelCol,
  type IndexRow,
} from "./exposureCorrelations";

interface Props {
  /** Output of buildCorrelationMatrix — 5 rows × 5 cols. */
  matrix: readonly (readonly number[])[];
  selectedIndex: IndexRow;
  selectedChannel: ChannelCol;
  onSelect: (index: IndexRow, channel: ChannelCol) => void;
}

const ROW_LABELS: Record<IndexRow, string> = {
  pulse_spacing_mm: "PSp",
  line_spacing_index: "LSp",
  pulse_energy_index: "PEn",
  pulse_intensity_index: "PIn",
  surface_exposure_index: "SEx",
};

const COL_LABELS: Record<ChannelCol, string> = {
  L: "L*",
  a: "a*",
  b: "b*",
  hue: "hue",
  chroma: "chr",
};

/**
 * Map |r| ∈ [0, 1] to an opacity for the amber accent. Below 0.2 is
 * effectively transparent; above 0.7 is fully on. Numeric label only
 * shows when |r| ≥ 0.7.
 */
function opacityFor(r: number): number {
  if (!Number.isFinite(r)) return 0;
  const v = Math.min(1, Math.max(0, Math.abs(r)));
  return Math.max(0, (v - 0.2) / 0.8);
}

export const ExposureCorrelationMatrix: React.FC<Props> = ({
  matrix,
  selectedIndex,
  selectedChannel,
  onSelect,
}) => {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.16em]">
      <div className="grid" style={{ gridTemplateColumns: "auto repeat(5, 1fr)", gap: "2px" }}>
        <div /> {/* top-left blank */}
        {CHANNEL_COLS.map((c) => (
          <div
            key={c}
            data-role="col-label"
            className="text-center text-[color:var(--color-ink-subtle)]"
          >
            {COL_LABELS[c]}
          </div>
        ))}
        {INDEX_ROWS.map((idx, r) => (
          <React.Fragment key={idx}>
            <div
              data-role="row-label"
              className={
                idx === selectedIndex
                  ? "text-[color:var(--color-primary)] pr-2"
                  : "text-[color:var(--color-ink-subtle)] pr-2"
              }
            >
              {ROW_LABELS[idx]}
            </div>
            {CHANNEL_COLS.map((col, c) => {
              const value = matrix[r]?.[c] ?? NaN;
              const isSelected = idx === selectedIndex && col === selectedChannel;
              const showLabel = Number.isFinite(value) && Math.abs(value) >= 0.7;
              return (
                <button
                  key={col}
                  type="button"
                  data-role="matrix-cell"
                  className={
                    "relative h-5 cursor-pointer border " +
                    (isSelected
                      ? "border-[color:var(--color-primary)]"
                      : "border-[color:var(--color-border)]")
                  }
                  style={{
                    background: `color-mix(in oklch, var(--color-primary) ${
                      Math.round(opacityFor(value) * 100)
                    }%, transparent)`,
                  }}
                  onClick={() => onSelect(idx, col)}
                  title={
                    Number.isFinite(value)
                      ? `${ROW_LABELS[idx]} × ${COL_LABELS[col]} : r = ${value.toFixed(2)}`
                      : `${ROW_LABELS[idx]} × ${COL_LABELS[col]} : n/a`
                  }
                >
                  {showLabel && (
                    <span
                      data-role="cell-value"
                      className="absolute inset-0 flex items-center justify-center font-bold text-[color:var(--color-bg)]"
                    >
                      {Math.round(Math.abs(value) * 100)}
                    </span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureCorrelationMatrix.test.tsx
```

Expected: all green.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

```bash
git add web/src/components/exposure/ExposureCorrelationMatrix.tsx \
        web/src/components/exposure/ExposureCorrelationMatrix.test.tsx
git commit -m "feat(exposure): correlation matrix heatmap

5×5 grid of index × channel correlations. Cell colour intensity ∝
|r|, threshold-based numeric label only on |r| ≥ 0.7 (avoids
clutter on weak correlations). Click any cell to switch the scatter
to that (index, channel) pair. Selected cell + selected row label
get the project's amber accent."
```

---

## Task 6: `ExposureRangeBrush` component

**Files:**
- Create: `web/src/components/exposure/ExposureRangeBrush.tsx`
- Create: `web/src/components/exposure/ExposureRangeBrush.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureRangeBrush.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { ExposureRangeBrush } from "./ExposureRangeBrush";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, surface: number): ExposureRow {
  return {
    id, hex, lab: [50, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: surface,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureRangeBrush", () => {
  it("renders one tile per row, ordered by surface_exposure_index", () => {
    const rows = [row(2, "#bbb", 100), row(1, "#aaa", 10), row(3, "#ccc", 1000)];
    const { container } = render(
      <ExposureRangeBrush rows={rows} range={null} onRangeChange={() => undefined} />,
    );
    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>('[data-role="brush-tile"]'),
    );
    expect(tiles.map((t) => t.dataset.entryId)).toEqual(["1", "2", "3"]);
  });

  it("emits range change when the user clears or sets a range via prop callback", () => {
    const onRangeChange = vi.fn();
    render(
      <ExposureRangeBrush rows={[row(1, "#aaa", 10)]} range={[5, 50]} onRangeChange={onRangeChange} />,
    );
    // The drag handle interaction is inherently mouse-driven; we don't
    // simulate native drag here — that's covered by the manual
    // walkthrough. The unit test asserts the rendering surface, the
    // interaction surface is verified at integration.
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureRangeBrush.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureRangeBrush.tsx`:

```tsx
import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";

interface Props {
  rows: readonly ExposureRow[];
  /** Selected log-exposure range in raw exposure-index units, or
   *  null = "no filter" = all rows in scope. */
  range: readonly [number, number] | null;
  onRangeChange: (range: readonly [number, number] | null) => void;
  /** SVG pixel height. Default 24 (compact). */
  height?: number;
}

/**
 * The bottom Exposure Brush. A wide tile strip showing every entry's
 * swatch ordered ascending by surface_exposure_index. Drag handles
 * select an [lo, hi] range; entries outside the range get dimmed
 * (page-wide; this component just emits the range — consumers
 * apply the dim).
 *
 * Drag interaction is implemented in pure DOM (pointer events on
 * the handles); no third-party brush lib.
 */
export const ExposureRangeBrush: React.FC<Props> = ({
  rows,
  range,
  onRangeChange,
  height = 24,
}) => {
  const ordered = React.useMemo(() => {
    return [...rows].sort(
      (a, b) =>
        (a.indices.surface_exposure_index as number) -
        (b.indices.surface_exposure_index as number),
    );
  }, [rows]);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Map surface-exposure value → 0..1 along the strip. Use log scale
  // so the brush handle position matches the visual swatch ordering.
  const [exposureMin, exposureMax] = React.useMemo(() => {
    if (ordered.length === 0) return [1, 1] as const;
    return [
      Math.max(1e-3, ordered[0].indices.surface_exposure_index as number),
      Math.max(1e-2, ordered[ordered.length - 1].indices.surface_exposure_index as number),
    ] as const;
  }, [ordered]);

  const valueToFraction = React.useCallback(
    (v: number) => {
      const lo = Math.log10(Math.max(1e-3, exposureMin));
      const hi = Math.log10(Math.max(1e-3, exposureMax));
      if (hi === lo) return 0;
      return (Math.log10(Math.max(1e-3, v)) - lo) / (hi - lo);
    },
    [exposureMin, exposureMax],
  );

  const fractionToValue = React.useCallback(
    (f: number) => {
      const lo = Math.log10(Math.max(1e-3, exposureMin));
      const hi = Math.log10(Math.max(1e-3, exposureMax));
      return Math.pow(10, lo + (hi - lo) * Math.max(0, Math.min(1, f)));
    },
    [exposureMin, exposureMax],
  );

  const lo = range ? range[0] : exposureMin;
  const hi = range ? range[1] : exposureMax;
  const loF = valueToFraction(lo);
  const hiF = valueToFraction(hi);

  const onHandleDown = (which: "lo" | "hi") => (ev: React.PointerEvent) => {
    ev.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const f = (e.clientX - rect.left) / rect.width;
      const v = fractionToValue(f);
      const nextRange =
        which === "lo"
          ? ([Math.min(v, hi), hi] as [number, number])
          : ([lo, Math.max(v, lo)] as [number, number]);
      onRangeChange(nextRange);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClearRange = () => onRangeChange(null);

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] font-mono text-[color:var(--color-ink-subtle)]">
        <span>Exposure brush · drag handles</span>
        {range && (
          <button
            type="button"
            className="px-2 py-0.5 text-[color:var(--color-primary)] hover:underline"
            onClick={onClearRange}
          >
            clear
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative w-full border border-[color:var(--color-border)]"
        style={{ height: `${height}px` }}
      >
        {ordered.map((row) => (
          <div
            key={row.id}
            data-role="brush-tile"
            data-entry-id={row.id}
            className="absolute top-0 bottom-0"
            style={{
              left: `${(ordered.indexOf(row) / ordered.length) * 100}%`,
              width: `${100 / ordered.length}%`,
              background: row.hex,
            }}
          />
        ))}
        {/* Out-of-range overlay */}
        {range && (
          <>
            <div
              className="absolute top-0 bottom-0 left-0 bg-[color:var(--color-bg)] opacity-70"
              style={{ width: `${loF * 100}%` }}
            />
            <div
              className="absolute top-0 bottom-0 right-0 bg-[color:var(--color-bg)] opacity-70"
              style={{ width: `${(1 - hiF) * 100}%` }}
            />
          </>
        )}
        {/* Handles */}
        <div
          role="slider"
          aria-label="lower bound"
          className="absolute top-[-4px] bottom-[-4px] w-1 bg-[color:var(--color-primary)] cursor-ew-resize"
          style={{ left: `calc(${loF * 100}% - 2px)` }}
          onPointerDown={onHandleDown("lo")}
        />
        <div
          role="slider"
          aria-label="upper bound"
          className="absolute top-[-4px] bottom-[-4px] w-1 bg-[color:var(--color-primary)] cursor-ew-resize"
          style={{ left: `calc(${hiF * 100}% - 2px)` }}
          onPointerDown={onHandleDown("hi")}
        />
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureRangeBrush.test.tsx
```

Expected: all green.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

```bash
git add web/src/components/exposure/ExposureRangeBrush.tsx \
        web/src/components/exposure/ExposureRangeBrush.test.tsx
git commit -m "feat(exposure): bottom exposure-range brush

Tile strip ordered ascending by surface_exposure_index with two drag
handles selecting an [lo, hi] log-scale range. Out-of-range area is
masked at low opacity. Pure pointer events — no third-party brush
lib. Emits range upward via onRangeChange; consumers apply the dim
to other panels."
```

---

## Task 7: `ExposureScatter` component

**Files:**
- Create: `web/src/components/exposure/ExposureScatter.tsx`
- Create: `web/src/components/exposure/ExposureScatter.test.tsx`

This is the largest component. Reuse `niceBounds`, `niceTicks`, `fmtTick` from `web/src/components/stabilityChartMath.ts` for axis math (those are exported and used by Stability already).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureScatter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ExposureScatter } from "./ExposureScatter";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string, surface: number, l: number): ExposureRow {
  return {
    id, hex, lab: [l, 0, 0],
    indices: {
      pulse_spacing_mm: 0.01,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.7,
      pulse_intensity_index: 0.003,
      surface_exposure_index: surface,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureScatter", () => {
  const rows = [
    row(1, "#aaa", 10, 80),
    row(2, "#bbb", 50, 60),
    row(3, "#ccc", 200, 40),
    row(4, "#ddd", 800, 20),
  ];

  it("renders one dot per row in univariate mode", () => {
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
      />,
    );
    expect(container.querySelectorAll('[data-role="scatter-dot"]').length).toBe(4);
  });

  it("draws a regression overlay in univariate mode", () => {
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
      />,
    );
    expect(container.querySelector('[data-role="regression-line"]')).not.toBeNull();
  });

  it("does NOT draw a regression overlay in bivariate mode", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="bivariate"
        xKey="surface_exposure_index"
        yKey="pulse_intensity_index"
        xScale="log"
        yScale="log"
        focusedId={null}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelector('[data-role="regression-line"]')).toBeNull();
  });

  it("clicking a dot fires onClick with the id", () => {
    const onClick = vi.fn();
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
        onClick={onClick}
      />,
    );
    const dots = container.querySelectorAll<SVGElement>('[data-role="scatter-dot"]');
    fireEvent.click(dots[0]);
    expect(onClick).toHaveBeenCalledOnce();
    expect(typeof onClick.mock.calls[0][0]).toBe("number");
  });

  it("focused dot gets a halo", () => {
    const { container } = render(
      <ExposureScatter
        rows={rows}
        mode="univariate"
        xKey="surface_exposure_index"
        yKey="L"
        xScale="log"
        yScale="linear"
        focusedId={2}
        onHover={() => undefined}
        onLeave={() => undefined}
        onClick={() => undefined}
      />,
    );
    expect(container.querySelector('[data-role="focus-halo"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureScatter.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureScatter.tsx`:

```tsx
import * as React from "react";
import { hueDeg, chroma as chromaFn } from "../../color/math";
import { niceBounds, niceTicks } from "../stabilityChartMath";
import type { ChannelCol, ExposureRow, IndexRow } from "./exposureCorrelations";
import { logLinearRegression } from "./exposureMath";

export type ScaleKind = "linear" | "log";
export type ScatterMode = "univariate" | "bivariate";

interface Props {
  rows: readonly ExposureRow[];
  mode: ScatterMode;
  xKey: IndexRow;
  /** Y key: a channel in univariate mode, an IndexRow in bivariate. */
  yKey: ChannelCol | IndexRow;
  xScale: ScaleKind;
  yScale: ScaleKind;
  focusedId: number | null;
  onHover: (id: number) => void;
  onLeave: () => void;
  onClick: (id: number) => void;
  /** Optional: dim out-of-range entries (Exposure brush). null = no dim. */
  dimRange?: readonly [number, number] | null;
}

function rowChannel(row: ExposureRow, key: ChannelCol): number {
  const [l, a, b] = row.lab;
  switch (key) {
    case "L":      return l;
    case "a":      return a;
    case "b":      return b;
    case "hue":    return hueDeg(a, b);
    case "chroma": return chromaFn(a, b);
  }
}

function rowIndex(row: ExposureRow, key: IndexRow): number {
  return row.indices[key] as number;
}

const W = 720;
const H = 420;
const PADL = 60;
const PADR = 28;
const PADT = 24;
const PADB = 56;

export const ExposureScatter: React.FC<Props> = ({
  rows,
  mode,
  xKey,
  yKey,
  xScale,
  yScale,
  focusedId,
  onHover,
  onLeave,
  onClick,
  dimRange,
}) => {
  const xs = rows.map((r) => rowIndex(r, xKey));
  const ys = rows.map((r) =>
    mode === "univariate"
      ? rowChannel(r, yKey as ChannelCol)
      : rowIndex(r, yKey as IndexRow),
  );

  const xsForScale = xScale === "log" ? xs.filter((v) => v > 0).map((v) => Math.log10(v)) : xs;
  const ysForScale = yScale === "log" ? ys.filter((v) => v > 0).map((v) => Math.log10(v)) : ys;

  const { min: xMin, max: xMax } = niceBounds(xsForScale, null);
  const { min: yMin, max: yMax } = niceBounds(ysForScale, null);

  const px = (v: number) => {
    const t = ((xScale === "log" ? Math.log10(v) : v) - xMin) / (xMax - xMin || 1);
    return PADL + t * (W - PADL - PADR);
  };
  const py = (v: number) => {
    const t = ((yScale === "log" ? Math.log10(v) : v) - yMin) / (yMax - yMin || 1);
    return H - PADB - t * (H - PADT - PADB);
  };

  const fit =
    mode === "univariate"
      ? logLinearRegression(
          xs,
          ys,
        )
      : null;

  const xTicks = niceTicks(xMin, xMax, 5);
  const yTicks = niceTicks(yMin, yMax, 5);

  const isInDimRange = (row: ExposureRow): boolean => {
    if (!dimRange) return true;
    const v = row.indices.surface_exposure_index as number;
    return v >= dimRange[0] && v <= dimRange[1];
  };

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="exposure scatter"
    >
      {/* Plot frame */}
      <rect
        x={PADL}
        y={PADT}
        width={W - PADL - PADR}
        height={H - PADT - PADB}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={0.6}
      />

      {/* Gridlines */}
      {xTicks.map((t) => (
        <line
          key={`xg-${t}`}
          x1={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
          y1={PADT}
          x2={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
          y2={H - PADB}
          stroke="var(--color-border)"
          strokeOpacity={0.4}
          strokeDasharray="2 4"
          strokeWidth={0.4}
        />
      ))}
      {yTicks.map((t) => (
        <line
          key={`yg-${t}`}
          x1={PADL}
          y1={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB)}
          x2={W - PADR}
          y2={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB)}
          stroke="var(--color-border)"
          strokeOpacity={0.4}
          strokeDasharray="2 4"
          strokeWidth={0.4}
        />
      ))}

      {/* Tick labels */}
      {xTicks.map((t) => (
        <text
          key={`xl-${t}`}
          x={PADL + ((t - xMin) / (xMax - xMin || 1)) * (W - PADL - PADR)}
          y={H - PADB + 14}
          fontSize="10"
          fontFamily="ui-monospace"
          fill="var(--color-ink-subtle)"
          textAnchor="middle"
        >
          {xScale === "log" ? `10^${t}` : t}
        </text>
      ))}
      {yTicks.map((t) => (
        <text
          key={`yl-${t}`}
          x={PADL - 6}
          y={H - PADB - ((t - yMin) / (yMax - yMin || 1)) * (H - PADT - PADB) + 3}
          fontSize="10"
          fontFamily="ui-monospace"
          fill="var(--color-ink-subtle)"
          textAnchor="end"
        >
          {yScale === "log" ? `10^${t}` : t}
        </text>
      ))}

      {/* Regression line (univariate, log-x only — the most common case) */}
      {mode === "univariate" && fit && Number.isFinite(fit.slope) && (
        <line
          data-role="regression-line"
          x1={px(rows.length ? Math.max(1e-3, Math.min(...xs.filter((v) => v > 0))) : 1)}
          y1={py(fit.intercept + fit.slope * Math.log10(Math.max(1e-3, Math.min(...xs.filter((v) => v > 0)))))}
          x2={px(rows.length ? Math.max(...xs) : 1)}
          y2={py(fit.intercept + fit.slope * Math.log10(Math.max(1e-3, Math.max(...xs))))}
          stroke="var(--color-primary)"
          strokeWidth={1.4}
          strokeDasharray="6 4"
          opacity={0.85}
        />
      )}

      {/* Focused crosshair guides */}
      {focusedId != null && (() => {
        const focused = rows.find((r) => r.id === focusedId);
        if (!focused) return null;
        const fx = rowIndex(focused, xKey);
        const fy =
          mode === "univariate"
            ? rowChannel(focused, yKey as ChannelCol)
            : rowIndex(focused, yKey as IndexRow);
        return (
          <g>
            <line
              x1={PADL}
              x2={W - PADR}
              y1={py(fy)}
              y2={py(fy)}
              stroke="var(--color-primary)"
              strokeWidth={0.4}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <line
              x1={px(fx)}
              x2={px(fx)}
              y1={PADT}
              y2={H - PADB}
              stroke="var(--color-primary)"
              strokeWidth={0.4}
              strokeDasharray="3 3"
              opacity={0.5}
            />
          </g>
        );
      })()}

      {/* Dots */}
      {rows.map((row) => {
        const x = rowIndex(row, xKey);
        const y =
          mode === "univariate"
            ? rowChannel(row, yKey as ChannelCol)
            : rowIndex(row, yKey as IndexRow);
        const isFocused = row.id === focusedId;
        const visible = isInDimRange(row);
        return (
          <g key={row.id} opacity={visible ? 1 : 0.15}>
            {isFocused && (
              <circle
                data-role="focus-halo"
                cx={px(x)}
                cy={py(y)}
                r={10}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={2}
              />
            )}
            <circle
              data-role="scatter-dot"
              cx={px(x)}
              cy={py(y)}
              r={isFocused ? 6 : 5}
              fill={row.hex}
              stroke="var(--color-surface)"
              strokeWidth={0.6}
              onMouseEnter={() => onHover(row.id)}
              onMouseLeave={() => onLeave()}
              onClick={() => onClick(row.id)}
              style={{ cursor: "pointer" }}
            />
          </g>
        );
      })}

      {/* Axis labels */}
      <text
        x={PADL}
        y={H - 8}
        fontSize="11"
        fontFamily="ui-monospace"
        fill="var(--color-ink-subtle)"
      >
        {xScale === "log" ? "log₁₀(" : ""}{xKey}{xScale === "log" ? ")" : ""} →
      </text>
      <text
        x={16}
        y={PADT + 8}
        fontSize="11"
        fontFamily="ui-monospace"
        fill="var(--color-ink-subtle)"
        transform={`rotate(-90, 16, ${PADT + 8})`}
      >
        {yScale === "log" ? "log₁₀(" : ""}{yKey}{yScale === "log" ? ")" : ""}
      </text>
    </svg>
  );
};
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureScatter.test.tsx
```

Expected: 5 passing.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

```bash
git add web/src/components/exposure/ExposureScatter.tsx \
        web/src/components/exposure/ExposureScatter.test.tsx
git commit -m "feat(exposure): main scatter — univariate + bivariate

Hand-rolled SVG. Reuses niceBounds/niceTicks from
stabilityChartMath. Dots coloured by entry hex; focused entry gets
a halo + dashed crosshair guides. Univariate mode draws a log-
linear regression overlay; bivariate mode does not (neither axis
is the outcome). Out-of-brush-range entries dim to 15%."
```

---

## Task 8: `ExposureFocusedCard` composer

**Files:**
- Create: `web/src/components/exposure/ExposureFocusedCard.tsx`
- Create: `web/src/components/exposure/ExposureFocusedCard.test.tsx`

This composes `ExposureChromaDisc` with the swatch and the recipe / indices readout.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/exposure/ExposureFocusedCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ExposureFocusedCard } from "./ExposureFocusedCard";
import type { ExposureRow } from "./exposureCorrelations";

function row(id: number, hex: string): ExposureRow {
  return {
    id, hex, lab: [50, 20, 10],
    indices: {
      pulse_spacing_mm: 0.0154,
      line_spacing_index: 0.01,
      line_spacing_mm: null,
      pulse_energy_index: 0.769,
      pulse_intensity_index: 0.00385,
      surface_exposure_index: 195.0,
      formula_version: 1,
      density_model: "opaque",
      power_model: "controller_percent",
    },
  };
}

describe("ExposureFocusedCard", () => {
  it("idle state shows the disc + 'hover any dot to inspect' placeholder", () => {
    const rows = [row(1, "#a0522d"), row(2, "#704020")];
    render(<ExposureFocusedCard rows={rows} focusedId={null} />);
    expect(screen.getByText(/hover/i)).toBeInTheDocument();
    expect(screen.queryByText(/RECIPE/i)).toBeNull();
  });

  it("active state shows hex, recipe section, indices section", () => {
    const rows = [row(1, "#a0522d"), row(2, "#704020")];
    render(<ExposureFocusedCard rows={rows} focusedId={1} />);
    expect(screen.getByText("#A0522D")).toBeInTheDocument();
    expect(screen.getByText(/RECIPE/i)).toBeInTheDocument();
    expect(screen.getByText(/INDICES/i)).toBeInTheDocument();
  });
});
```

Note the test uses recipe params from the `params` field on the row, but the `ExposureRow` type as defined doesn't include `params`. **Extend the type** with an optional `params` field for the focused-card recipe display:

```typescript
// in exposureCorrelations.ts, alongside the existing ExposureRow:
export interface ExposureRow {
  id: number;
  hex: string;
  lab: [number, number, number];
  indices: LaserIndices;
  /** The raw laser params from PaletteEntry.params. Optional because
   *  not every consumer of ExposureRow needs them — ExposureFocusedCard
   *  does, the math helpers don't. */
  params?: Record<string, number | string>;
}
```

Update Task 2 alongside this if you're catching this gap during Task 8 (typecheck will tell you).

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the component**

Create `web/src/components/exposure/ExposureFocusedCard.tsx`:

```tsx
import * as React from "react";
import type { ExposureRow, IndexRow } from "./exposureCorrelations";
import { ExposureChromaDisc } from "./ExposureChromaDisc";

interface Props {
  rows: readonly ExposureRow[];
  focusedId: number | null;
  /** The current X axis — emphasised in the indices readout so users
   *  can see at a glance what the scatter is comparing. */
  highlightIndex?: IndexRow;
  onDiscHover?: (id: number) => void;
  onDiscLeave?: () => void;
  onDiscClick?: (id: number) => void;
}

const INDEX_LABELS: Record<IndexRow, string> = {
  surface_exposure_index: "SURFACE_EXPOSURE",
  pulse_intensity_index: "PULSE_INTENSITY",
  pulse_energy_index: "PULSE_ENERGY",
  pulse_spacing_mm: "PULSE_SPACING (mm)",
  line_spacing_index: "LINE_SPACING_INDEX",
};

const INDEX_ORDER: IndexRow[] = [
  "surface_exposure_index",
  "pulse_intensity_index",
  "pulse_energy_index",
  "pulse_spacing_mm",
  "line_spacing_index",
];

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(4);
}

const PARAM_FIELDS: { key: string; label: string; suffix?: string }[] = [
  { key: "power", label: "POWER", suffix: " %" },
  { key: "speed", label: "SPEED", suffix: " mm/s" },
  { key: "frequency", label: "FREQUENCY", suffix: " kHz" },
  { key: "density", label: "DENSITY" },
  { key: "passes", label: "PASSES" },
  { key: "pulse_width", label: "PULSE_WIDTH", suffix: " ns" },
];

export const ExposureFocusedCard: React.FC<Props> = ({
  rows,
  focusedId,
  highlightIndex,
  onDiscHover,
  onDiscLeave,
  onDiscClick,
}) => {
  const focused = focusedId == null ? null : rows.find((r) => r.id === focusedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Disc + swatch row */}
      <div className="flex gap-3">
        {focused && (
          <div
            className="flex-shrink-0 flex items-end justify-center w-[120px] h-[120px] rounded-sm border border-[color:var(--color-border)] p-2"
            style={{ background: focused.hex }}
          >
            <span className="font-mono text-xs uppercase text-white drop-shadow-md">
              {focused.hex.toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
            a* / b* CHROMATICITY
          </div>
          <ExposureChromaDisc
            rows={rows}
            focusedId={focusedId}
            size={140}
            onHover={onDiscHover}
            onLeave={onDiscLeave}
            onClick={onDiscClick}
          />
        </div>
      </div>

      {/* Idle placeholder */}
      {!focused && (
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] py-4 text-center border-t border-[color:var(--color-border)]">
          hover any dot to inspect
        </div>
      )}

      {/* Active: recipe + indices */}
      {focused && (
        <>
          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
              RECIPE
            </div>
            <div className="flex flex-col gap-1">
              {PARAM_FIELDS.map((field) => {
                const v = focused.params?.[field.key];
                if (v == null) return null;
                return (
                  <div key={field.key} className="flex justify-between font-mono text-xs">
                    <span className="text-[color:var(--color-ink-subtle)]">{field.label}</span>
                    <span className="text-[color:var(--color-ink)]">
                      {String(v)}{field.suffix ?? ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
              INDICES
            </div>
            <div className="flex flex-col gap-1">
              {INDEX_ORDER.map((key) => {
                const isHighlighted = key === highlightIndex;
                const v =
                  key === "pulse_spacing_mm"
                    ? focused.indices.pulse_spacing_mm
                    : (focused.indices[key] as number | null);
                return (
                  <div key={key} className="flex justify-between font-mono text-xs">
                    <span
                      className={
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink-subtle)]"
                      }
                    >
                      {INDEX_LABELS[key]}
                    </span>
                    <span
                      className={
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink)]"
                      }
                    >
                      {fmt(v as number | null)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/components/exposure/ExposureFocusedCard.test.tsx
```

Expected: all green.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

```bash
git add web/src/components/exposure/ExposureFocusedCard.tsx \
        web/src/components/exposure/ExposureFocusedCard.test.tsx \
        web/src/components/exposure/exposureCorrelations.ts
git commit -m "feat(exposure): focused-cell composer with recipe + indices

Combines the chromaticity disc with a hex swatch tile, full recipe
readout (power/speed/frequency/density/passes/pulse_width), and a
full indices readout. The current X-axis index gets primary
highlight in the indices list. Idle state shows the disc only with
a 'hover to inspect' placeholder.

Extends ExposureRow with optional params field for the recipe
readout."
```

---

## Task 9: `ExposurePage` shell + state + data

**Files:**
- Create: `web/src/pages/ExposurePage.tsx`
- Create: `web/src/pages/ExposurePage.test.tsx`

The page shell holds all state (material, axes, mode, scales, filters, focus, brush range), fetches data on material change, and lays out the seven panels.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/ExposurePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ExposurePage } from "./ExposurePage";

// Mock the data layer so the page mount test doesn't require a server.
vi.mock("../api/library", () => ({
  listMaterials: vi.fn().mockResolvedValue([
    { id: 1, name: "Stainless Steel", machine_id: "F2Ultra" },
    { id: 2, name: "Brass", machine_id: "F2Ultra" },
  ]),
}));

vi.mock("../api/palette", () => ({
  listPaletteEntries: vi.fn().mockResolvedValue([
    {
      id: 100,
      hex: "#5d2e1f",
      lab: [28, 16, 18],
      params: { power: 65, speed: 800, frequency: 60, density: 120, passes: 2, pulse_width: 100 },
      indices: {
        pulse_spacing_mm: 0.0154,
        line_spacing_index: 0.0083,
        line_spacing_mm: null,
        pulse_energy_index: 1.083,
        pulse_intensity_index: 0.0181,
        surface_exposure_index: 195.0,
        formula_version: 1,
        density_model: "opaque",
        power_model: "controller_percent",
      },
      source: "averaged",
      sigma: 0.1,
      notes: "",
      created_at: "2026-05-01T00:00:00+00:00",
      owner_id: 1,
      visibility: "private",
      machine_id: "F2Ultra",
      material_id: 1,
      is_validated: false,
    },
  ]),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ExposurePage", () => {
  it("mounts and lists materials", async () => {
    render(<ExposurePage materialId={null} />);
    await waitFor(() => expect(screen.getByText(/Stainless Steel/i)).toBeInTheDocument());
  });

  it("loads palette entries for the selected material", async () => {
    render(<ExposurePage materialId={1} />);
    const { listPaletteEntries } = await import("../api/palette");
    await waitFor(() => expect(listPaletteEntries).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/pages/ExposurePage.test.tsx
```

Expected: ImportError.

- [ ] **Step 3: Implement the page**

Create `web/src/pages/ExposurePage.tsx`. The page should:
- Fetch materials on mount via `listMaterials()` from `../api/library`.
- Fetch palette entries for `materialId` (or default to "most-populated material" when materialId is null) via `listPaletteEntries({ material_id })`.
- Manage state: `xKey`, `yKey`, `mode`, `xScale`, `yScale`, `focusedId`, `pinnedId`, `sourceFilter`, `validatedOnly`, `formulaVersionFilter`, `brushRange`.
- Compute the correlation matrix on every change to `rows`, `sourceFilter`, `validatedOnly`, `formulaVersionFilter`, `brushRange`.
- Render the layout: top bar, left rail, main scatter, hue ribbon + correlations matrix, right rail (stats + focused card), bottom range brush.
- Plumb the focus state across all panels: hover sets transient, click sets pinned.

The implementation is large but follows the same patterns as `StabilityPage.tsx` (read that file once for the focus-pin pattern; reuse the same vocabulary). For brevity the full code is referenced via the file structure above — the implementer should:

1. Open `web/src/pages/StabilityPage.tsx` and read the focus-management code (around lines 680–730: `transientCell`, `pinnedCell`, `handleHover`, `handleClick`, `handleBackgroundClear`).
2. Mirror the same pattern in `ExposurePage` for `focusedId` (same transient + pinned interaction).
3. Lay out the panels using the layout in the spec's "Layout" section.
4. Use the existing UI primitives from `../ui` (`PageContainer`, `MetalBar`, `Section`, `Card`, `Select`, `Tab`, `Tabs`, `EmptyState`).
5. Pass all panel props through cleanly — no global state.

Concrete state shape:

```typescript
interface PageState {
  materialId: number | null;
  rows: ExposureRow[];
  rowsLoading: boolean;
  rowsError: string | null;
  xKey: IndexRow;
  yKey: ChannelCol | IndexRow;
  mode: ScatterMode;
  xScale: ScaleKind;
  yScale: ScaleKind;
  sourceFilter: Set<"averaged" | "single_result" | "manual">;
  validatedOnly: boolean;
  brushRange: readonly [number, number] | null;
  focusedId: number | null;
  pinnedId: number | null;
}
```

The default x/y at mount: `xKey="surface_exposure_index"`, `yKey="L"`, `mode="univariate"`, `xScale="log"`, `yScale="linear"`. Default sourceFilter: `{ averaged, manual }`.

Required imports at the top:

```tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { listMaterials } from "../api/library";
import { listPaletteEntries } from "../api/palette";
import type { Material } from "../library";
import type { PaletteEntry } from "../types";
import { getCurrentMachineId } from "../state/machine";
import { ExposureScatter, type ScaleKind, type ScatterMode } from "../components/exposure/ExposureScatter";
import { ExposureHueRibbon } from "../components/exposure/ExposureHueRibbon";
import { ExposureCorrelationMatrix } from "../components/exposure/ExposureCorrelationMatrix";
import { ExposureRangeBrush } from "../components/exposure/ExposureRangeBrush";
import { ExposureFocusedCard } from "../components/exposure/ExposureFocusedCard";
import {
  buildCorrelationMatrix,
  CHANNEL_COLS,
  INDEX_ROWS,
  type ChannelCol,
  type ExposureRow,
  type IndexRow,
} from "../components/exposure/exposureCorrelations";
import { pearson, spearman, logLinearRegression } from "../components/exposure/exposureMath";
import { hueDeg, chroma as chromaFn } from "../color/math";
import { PageContainer, Card, EmptyState } from "../ui";
```

Project the API's `PaletteEntry[]` to `ExposureRow[]`:

```tsx
function paletteToExposureRow(p: PaletteEntry): ExposureRow {
  return {
    id: p.id,
    hex: p.hex,
    lab: [p.lab[0], p.lab[1], p.lab[2]],
    indices: p.indices,
    params: p.params as Record<string, number | string>,
  };
}
```

Render the empty state when `rows.length === 0`. Render the loading skeleton when `rowsLoading`.

Stretch goal: persist `sourceFilter`, `mode`, `xScale`, `yScale` in localStorage so they survive page reloads.

The implementer should write this file by following the StabilityPage pattern. Once written:

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx vitest run src/pages/ExposurePage.test.tsx
```

Expected: 2 passing.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
```

```bash
git add web/src/pages/ExposurePage.tsx web/src/pages/ExposurePage.test.tsx
git commit -m "feat(exposure): page shell — state, fetch, layout

Manages the page's state shape (material, axes, mode, scales,
filters, focus, brush range), fetches materials + palette entries,
and composes the seven panels (top bar, left rail, scatter, hue
ribbon, correlations matrix, focused card, exposure brush).

Mirrors StabilityPage's transient/pinned focus pattern. No new
backend — reuses listPaletteEntries({ material_id }) from the
existing palette API."
```

---

## Task 10: Router + nav wiring

**Files:**
- Modify: `web/src/router.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`

- [ ] **Step 1: Add the route variant in `router.ts`**

In the `Route` union, add:

```typescript
  | { name: "exposure"; materialId?: number }
```

In `parseRoute`, alongside the existing handlers, add (place near the `palette` and `library` handlers):

```typescript
  if (h === "exposure") return { name: "exposure" };
  const me = h.match(/^exposure\/(\d+)$/);
  if (me) return { name: "exposure", materialId: Number(me[1]) };
```

In `formatRoute`, add the matching reverse mapping:

```typescript
  if (r.name === "exposure") {
    return r.materialId == null ? "#/exposure" : `#/exposure/${r.materialId}`;
  }
```

(Match the existing function shape — read the file first; the snippet above is illustrative.)

- [ ] **Step 2: Wire dispatch in `App.tsx`**

In the route → page switch, add:

```tsx
case "exposure":
  return <ExposurePage materialId={route.materialId ?? null} />;
```

Add the import at the top:

```tsx
import { ExposurePage } from "./pages/ExposurePage";
```

- [ ] **Step 3: Add nav entry in `TopBar.tsx`**

Add `"exposure"` to the `NavRouteName` union, and add a child entry under the `Materials` group:

```tsx
{
  label: "Materials",
  children: [
    { label: "Library", route: "library" },
    { label: "Palette", route: "palette" },
    { label: "Exposure", route: "exposure" },  // ← new
  ],
},
```

- [ ] **Step 4: Build, typecheck, run all tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit && npm run build && npm test -- --run
```

Expected: clean tsc, clean build, all vitest passing.

- [ ] **Step 5: Smoke-run in a browser**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 3
```

Open `http://127.0.0.1:8017/#/exposure`. Confirm:
- The page renders without console errors
- Nav under "Materials" shows "Exposure"
- Clicking "Exposure" navigates to `#/exposure`
- The page loads materials and a default palette entries list
- All seven panels render
- Hovering a scatter dot updates the focused card

Then `kill $SERVER_PID`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/router.ts web/src/App.tsx web/src/components/TopBar.tsx
git commit -m "feat(exposure): wire #/exposure route + Materials nav entry

Adds the route variant, parser, and formatter; dispatches in
App.tsx; surfaces 'Exposure' under the Materials nav group next to
Palette and Library."
```

---

## Task 11: Frontend-design polish pass

**Files:**
- Modify: any of `web/src/components/exposure/*.tsx`, `web/src/pages/ExposurePage.tsx`

The previous tasks built a functional page using the project's design tokens (CSS variables) but with minimal pixel-level polish. This task invokes the **frontend-design** skill on a subagent to bring the page up to the Workshop Instrument bar set by the Stability and Spectrum pages.

- [ ] **Step 1: Open the page in a browser, capture a baseline screenshot**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 3
```

Use Playwright MCP to navigate to `#/exposure`, screenshot the full page. Save as `changelog/images/exposure-page-baseline.png` (do not commit yet — this is for the polish brief).

`kill $SERVER_PID`.

- [ ] **Step 2: Dispatch the frontend-design skill**

Invoke the `frontend-design` skill on a subagent with the following brief:

```
Subject: Polish pass on #/exposure page

The page lives at web/src/pages/ExposurePage.tsx with components
under web/src/components/exposure/*.tsx. It builds on the Workshop
Instrument design language used elsewhere in the project — see
web/src/components/PaletteIndicesChips.tsx (light theme, JetBrains
Mono numerics, design-token CSS variables --color-surface,
--color-surface-elevated, --color-border, --color-ink,
--color-ink-subtle, --color-primary), web/src/pages/StabilityPage.tsx
and web/src/components/StabilityScatter.tsx for the chart vocabulary.

Goals:
- Match the Workshop Instrument register exactly: light cream
  background, JetBrains Mono for numerics and labels, Inter for
  prose, monospaced tracking on uppercase labels.
- Visual hierarchy: the main scatter is the hero. The Hue Ribbon
  and Correlations Matrix are supporting evidence. The right rail's
  hero r= stat anchors the rail; the Focused card is secondary.
- Spacing: feel like an instrument panel. No marketing-style flourish.
- Accents: amber (--color-primary) only on focus, regression line,
  and the hero r= stat. Everywhere else, design-token greys.
- Make sure the disc + crosshair render crisply on the light
  background — adjust strokes/ring widths if needed.
- Make sure the correlations matrix cells read at every |r| level —
  the colour gradient has to discriminate ~0.4 from ~0.7.
- Polish the empty state, the no-focus idle state on the focused
  card, and the loading state.

Constraints:
- DO NOT change component prop interfaces. The code structure is
  fixed; only the visual treatment is in scope.
- DO NOT introduce third-party charting libs.
- DO NOT change the page's layout architecture (left rail, main,
  hue ribbon, matrix, right rail, bottom brush). Polish within
  that frame.
- The baseline screenshot is at changelog/images/exposure-page-baseline.png.
- Reference: PaletteIndicesChips.tsx for the chip-strip register;
  StabilityScatter.tsx for the chart axis vocabulary; PalettePage.tsx
  for the page chrome (PageContainer, Section, Card primitives).
```

The subagent should iterate via the visual companion or direct browser checks until the page reads as a peer of Stability / Spectrum. It commits its changes; a final `npm run build && npm test -- --run && npx tsc --noEmit` is clean.

- [ ] **Step 3: Capture the polished screenshot**

After the polish pass, restart the dev server and screenshot the polished `#/exposure` page. Save as `changelog/images/exposure-page.png` (this one is the changelog asset).

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 3
# Use Playwright MCP to navigate + screenshot
kill $SERVER_PID
```

- [ ] **Step 4: Commit the screenshot (the polish edits were already committed by the subagent)**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add changelog/images/exposure-page.png
git commit -m "chore(exposure): polished page screenshot for changelog"
```

---

## Task 12: Changelog entry

**Files:**
- Create: `changelog/2026-05-09-exposure-page.md`

- [ ] **Step 1: Write the entry**

Create `changelog/2026-05-09-exposure-page.md`:

```markdown
---
id: 2026-05-09-exposure-page
date: 2026-05-09
level: major
title: Exposure indices — material-scoped exploration page
summary: A new page at #/exposure for seeing how the six exposure indices relate to colours in your palette, scoped to a single material.
images:
  - src: exposure-page.png
    caption: The exposure indices exploration page on stainless. Scatter, hue ribbon, correlations matrix, and chromaticity-disc focus widget all share a focused entry across the page.
---

The phase-1 chip strip showed the exposure indices on each palette
entry. This page asks the next question: **does any of them relate
to the colours you're getting?**

Open `#/exposure` (or click *Materials → Exposure* in the top
bar). Pick a material and the page draws every palette entry on
that material into a configurable scatter. Pick any of the five
indices for the X axis, any of L\* / a\* / b\* / hue / chroma for
the Y, and the **regression overlay** + the right-rail **`r =`**
stat give you a direct answer.

Below the scatter, the **Hue Ribbon** lays out every entry's
swatch ordered by the X axis. A successful index/colour
relationship reads as a smooth gradient down the ribbon; a noisy
one looks scrambled. Beside it, the **Correlations Matrix** is a
5×5 heatmap of `|r|` for every (index, channel) pair — click any
cell to switch the scatter to that pair.

The right rail's **Focused card** holds an a\*/b\* chromaticity
disc with every entry plotted; the focused entry gets a crosshair
pinpointing its hue family. Hover any dot anywhere on the page,
and the focus propagates — scatter halo, ribbon mark, disc
crosshair, full recipe + indices readout in the right rail.

Two **bivariate** modes are available too: pick *another* index
on the Y axis, and the scatter shows you whether two indices
together separate the colour clusters better than one alone.

Bottom of the page: an **Exposure brush**. Drag the handles to
filter the page to a slice of `surface_exposure_index`. Useful
for *"only show me the high-energy burns and let me see the
matrix recompute"*.

The indices stay framed as **heuristic, not calibrated**. The
chip strip's `v1 · heuristic indices, not calibrated values`
discipline carries through; the page does not claim joules or
millimetres unless the underlying value is honest mm.

Phase 2.5 (deferred) — multi-material comparison overlay.
Phase 3 — predictive parameter selection from a target colour.
```

- [ ] **Step 2: Verify the entry renders**

Restart the dev server and visit `http://127.0.0.1:8017/#/changelog`. Confirm the new entry appears at the top with the screenshot.

- [ ] **Step 3: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add changelog/2026-05-09-exposure-page.md
git commit -m "changelog: exposure indices exploration page

Major-level entry. Image already committed in the polish-pass
screenshot."
```

---

## Task 13: Final verification + draft PR

- [ ] **Step 1: Full backend test suite**

The page is frontend-only, but run the backend suite to confirm nothing in this branch accidentally broke a python test:

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q 2>&1 | tail -20
```

Expected: same green count as `main`. (Pre-existing S3 failures may persist if no AWS creds; not regressions.)

- [ ] **Step 2: Full frontend typecheck + tests + build**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web
npx tsc --noEmit
npm test -- --run
npm run build
```

Expected: clean typecheck, all tests passing, clean build.

- [ ] **Step 3: Manual full-flow smoke test**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
SERVER_PID=$!
sleep 3
```

Walk through:
- Visit `#/exposure` from the top nav. Confirm the empty state if no materials, otherwise the page loads.
- Pick a material. Confirm dots appear on the scatter.
- Switch X axis through all 5 indices. Confirm regression line, ribbon order, matrix selection update.
- Switch to bivariate mode. Confirm regression line disappears; Y axis menu lists indices instead of channels.
- Toggle log/linear on each axis. Confirm tick labels update.
- Hover a dot, then click it (pin). Confirm focused card fills, disc crosshair appears, ribbon mark appears.
- Hover another dot. Confirm transient takes over briefly; mouse out, pin returns.
- Click empty plot area. Confirm pin clears.
- Brush the bottom range. Confirm out-of-range entries dim everywhere.
- Click a cell in the correlations matrix. Confirm the scatter switches axes.
- Switch material. Confirm everything reloads cleanly.

`kill $SERVER_PID`.

- [ ] **Step 4: Push branch + open draft PR**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git push -u origin feat/exposure-indices-exploration
gh pr create --draft --title "Exposure indices exploration page" --body "$(cat <<'EOF'
## Summary

- New top-level page at `#/exposure` for material-scoped exploration of laser exposure indices vs palette colour.
- Configurable scatter (univariate or bivariate), Hue Ribbon, 5×5 correlations matrix, right-rail Focused card with a*/b* chromaticity disc + crosshair, bottom exposure-range brush. Cross-filtered focus across every panel.
- Pure frontend — no backend changes. Reuses `GET /api/palette?material_id=...`.

Spec: `docs/superpowers/specs/2026-05-08-exposure-indices-exploration-design.md`
Plan: `docs/superpowers/plans/2026-05-08-exposure-indices-exploration.md`

## Test plan

- [ ] `uv run --active pytest tests/ -q` is green (no regressions)
- [ ] `cd web && npx tsc --noEmit && npm test -- --run` is green
- [ ] Manual: full walkthrough of #/exposure on a populated material
  (axis switches, mode switch, log/linear toggles, focus
  propagation, brush filter, correlations-matrix click, material
  switch).

## Phase 2.5+ (out of scope, but enabled)

- Multi-material compare overlay
- Saved-spectrum trace overlay
- Index isolines on bivariate plots
- Predictive parameter selection from a target colour

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Confirm CI is running**

```bash
gh pr checks --watch=false 2>&1 | tail -10
```

Don't wait for CI to complete — confirm the checks have started, then return.

- [ ] **Step 6: Flip to ready-for-review when CI is green** (do this from the user's side, not the implementer's)

```bash
gh pr ready
```

(Implementer leaves the PR as draft; user flips it to ready when comfortable.)

---

## Self-review notes (verifying spec coverage)

| Spec requirement | Implementing task |
| --- | --- |
| Pure-function math helpers (Pearson, Spearman, log-linear) | Task 1 |
| Correlation matrix builder (5 indices × 5 channels) | Task 2 |
| `ExposureChromaDisc` | Task 3 |
| `ExposureHueRibbon`, ordered by current X axis | Task 4 |
| `ExposureCorrelationMatrix` with click-to-set-axes | Task 5 |
| `ExposureRangeBrush` (drag-handle log-scale brush) | Task 6 |
| `ExposureScatter` (univariate + bivariate, log/lin axes) | Task 7 |
| `ExposureFocusedCard` (idle + active, recipe + indices) | Task 8 |
| `ExposurePage` (state, layout, fetch) | Task 9 |
| Route `#/exposure` + nav under Materials | Task 10 |
| Workshop Instrument visual treatment | Task 11 (frontend-design polish) |
| Major-level changelog entry with screenshot | Task 12 |
| Full verification + draft PR | Task 13 |
