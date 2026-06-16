# Spiral Cut Duration Heatmap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Duration" colour mode to the Spiral Cut preview that draws the real generated spiral paths, each tinted by its cut duration, so the size spread of internal detail is visible before any param tuning.

**Architecture:** A pure `heatmap.ts` (log-normalise + colour) and an exported `spiralPathDurations()` in `estimate.ts` (reuses the estimator's own per-path math, so numbers reconcile) feed a new accurate-scale `SpiralDurationCanvas`. `SpiralPage` gets a `Class | Duration` toggle that swaps the schematic for the heatmap.

**Tech stack:** React + Canvas2D, Tailwind v4, existing `lib/forge` pure modules, vitest + @testing-library/react.

---

## Spec

`docs/superpowers/specs/2026-06-16-spiral-duration-heatmap-design.md`

## File structure

- **Create `web/src/lib/forge/heatmap.ts`** — pure colour mapping: `HEAT_STOPS`, `logNormalize(values)`, `durationColor(t)`. No deps. Owns: how a number becomes a colour.
- **Create `web/src/lib/forge/heatmap.test.ts`** — unit tests for the above.
- **Modify `web/src/lib/forge/estimate.ts`** — export `spiralPathDurations(paths, config, source)`, reusing the module-private `effectiveRate` + `spiralSeconds`. Owns: per-path duration, consistent with the estimate.
- **Modify `web/src/lib/forge/estimate.test.ts`** (create if absent → `web/src/lib/forge/duration.test.ts`) — reconciliation + per-group tests for `spiralPathDurations`.
- **Create `web/src/components/forge/SpiralDurationCanvas.tsx`** — accurate render of real paths tinted by duration + legend. Owns: the heatmap view.
- **Create `web/src/components/forge/SpiralDurationCanvas.test.tsx`** — jsdom smoke test (legend / empty state).
- **Modify `web/src/pages/SpiralPage.tsx`** — `colourMode` state, the toggle, the canvas swap, `sourceParams`.
- **Create `changelog/2026-06-16-spiral-duration-heatmap.md`** — minor changelog entry.

YAGNI note: the spec mentioned a "median tick" on the legend — intentionally dropped for v1. Min/max labels + the gradient strip convey the scale; a tick is not worth the extra code now.

---

### Task 1: Heatmap colour module

**Files:**
- Create: `web/src/lib/forge/heatmap.ts`
- Test: `web/src/lib/forge/heatmap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/forge/heatmap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { logNormalize, durationColor, HEAT_STOPS } from "./heatmap";

describe("logNormalize", () => {
  it("returns [] for empty input", () => {
    expect(logNormalize([])).toEqual([]);
  });

  it("maps all-equal values to 0.5", () => {
    expect(logNormalize([5, 5, 5])).toEqual([0.5, 0.5, 0.5]);
  });

  it("spreads a wide range log-evenly to [0,1]", () => {
    const t = logNormalize([1, 10, 100]); // ln: 0, ln10, 2ln10 → 0, 0.5, 1
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[1]).toBeCloseTo(0.5, 6);
    expect(t[2]).toBeCloseTo(1, 6);
  });

  it("keeps every result within [0,1]", () => {
    for (const v of logNormalize([0.2, 3, 7, 250, 9000])) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("durationColor", () => {
  it("hits the stop hexes exactly at 0, 0.5, 1", () => {
    expect(durationColor(0)).toBe(HEAT_STOPS[0].hex);
    expect(durationColor(0.5)).toBe(HEAT_STOPS[1].hex);
    expect(durationColor(1)).toBe(HEAT_STOPS[2].hex);
  });

  it("clamps out-of-range t to the endpoints", () => {
    expect(durationColor(-3)).toBe(durationColor(0));
    expect(durationColor(9)).toBe(durationColor(1));
  });

  it("interpolates between stops (0.25 differs from both ends of its segment)", () => {
    const c = durationColor(0.25);
    expect(c).not.toBe(HEAT_STOPS[0].hex);
    expect(c).not.toBe(HEAT_STOPS[1].hex);
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/heatmap.test.ts`
Expected: FAIL — cannot resolve `./heatmap`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/forge/heatmap.ts`:

```ts
// web/src/lib/forge/heatmap.ts
// Pure colour mapping for the spiral duration heatmap. No DOM, no deps.

/** Heat scale anchors: short/least (red) → mid (amber) → long/most (steel). */
export const HEAT_STOPS = [
  { t: 0, hex: "#e2483d", rgb: [226, 72, 61] as [number, number, number] },
  { t: 0.5, hex: "#f59e0b", rgb: [245, 158, 11] as [number, number, number] },
  { t: 1, hex: "#4b7f9e", rgb: [75, 127, 158] as [number, number, number] },
] as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Log-normalise values to [0,1] so a wide dynamic range (a tiny feature vs the
 * whole silhouette) stays legible. Fewer than two distinct values → 0.5 each.
 */
export function logNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const EPS = 1e-9;
  const ls = values.map((v) => Math.log(Math.max(EPS, v)));
  let lo = Infinity, hi = -Infinity;
  for (const l of ls) { if (l < lo) lo = l; if (l > hi) hi = l; }
  if (!(hi > lo)) return values.map(() => 0.5);
  return ls.map((l) => clamp01((l - lo) / (hi - lo)));
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, "0");

/** Map t∈[0,1] to a heat colour via HEAT_STOPS (red→amber→steel). Clamps t. */
export function durationColor(t: number): string {
  const tc = clamp01(t);
  let i = 0;
  while (i < HEAT_STOPS.length - 2 && tc > HEAT_STOPS[i + 1].t) i++;
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
  const span = b.t - a.t || 1;
  const f = (tc - a.t) / span;
  const r = lerp(a.rgb[0], b.rgb[0], f);
  const g = lerp(a.rgb[1], b.rgb[1], f);
  const bl = lerp(a.rgb[2], b.rgb[2], f);
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/heatmap.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/forge/heatmap.ts web/src/lib/forge/heatmap.test.ts
git commit -m "feat(forge): heatmap colour module (log-normalise + duration colour)"
```

---

### Task 2: Per-path duration helper (reconciles with the estimate)

**Files:**
- Modify: `web/src/lib/forge/estimate.ts` (add an export near the bottom, before `export { fmtDuration }` at line 168)
- Test: `web/src/lib/forge/duration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/forge/duration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spiralPathDurations, estimateForge } from "./estimate";
import { SPIRAL_CUT } from "./presets";
import { STAGE_GROUPS } from "./config";
import type { ForgeConfig, GeneratedPath, Pt } from "./types";

function mkPath(groupName: string, pts: Pt[]): GeneratedPath {
  return {
    sourceObjectId: "o", generatedClass: "spiral", groupName,
    layerStart: 0, layerEnd: 1, widthMultiplier: 1, offsetMm: 0.8,
    sideMode: "outside", operationOrder: 0, enabled: true, rings: [pts],
  };
}
// A horizontal segment of the given length (so pathLength is exact).
const seg = (len: number): Pt[] => [{ x: 0, y: 0 }, { x: len, y: 0 }];

describe("spiralPathDurations", () => {
  it("computes passes × length / speed (+ per-pass overhead) for a main path", () => {
    const cfg: ForgeConfig = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 10;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 100 };
    const out = spiralPathDurations([mkPath(STAGE_GROUPS.spiral, seg(50))], cfg, undefined);
    expect(out).toHaveLength(1);
    // 10 × (50/100 + 0.01) = 10 × 0.51 = 5.1
    expect(out[0].seconds).toBeCloseTo(5.1, 6);
  });

  it("resolves detail (CUT_09) speed independently of main (CUT_08)", () => {
    const cfg: ForgeConfig = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 10;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 100 };
    cfg.stageParams[STAGE_GROUPS.spiralDetail] = { speed: 50 };
    const main = spiralPathDurations([mkPath(STAGE_GROUPS.spiral, seg(50))], cfg, undefined)[0];
    const detail = spiralPathDurations([mkPath(STAGE_GROUPS.spiralDetail, seg(50))], cfg, undefined)[0];
    // detail at half the speed → ~double the per-pass cut time
    expect(detail.seconds).toBeGreaterThan(main.seconds);
    expect(detail.seconds).toBeCloseTo(10 * (50 / 50 + 0.01), 6); // 10.1
  });

  it("filters to spiral paths only", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    const notSpiral: GeneratedPath = { ...mkPath(STAGE_GROUPS.spiral, seg(10)), generatedClass: "clean" };
    expect(spiralPathDurations([notSpiral], cfg, undefined)).toHaveLength(0);
  });

  it("totals reconcile with the spiral stages in estimateForge", () => {
    const cfg = structuredClone(SPIRAL_CUT);
    cfg.spiral.passes = 7;
    cfg.stageParams[STAGE_GROUPS.spiral] = { ...cfg.stageParams[STAGE_GROUPS.spiral], speed: 120 };
    const paths = [mkPath(STAGE_GROUPS.spiral, seg(80)), mkPath(STAGE_GROUPS.spiralDetail, seg(12))];
    const part: Pt[][] = [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }]];
    const est = estimateForge(paths, part, cfg, undefined);
    const stageSecs = est.stages
      .filter((s) => s.generatedClass === "spiral")
      .reduce((a, s) => a + s.seconds, 0);
    const helperSecs = spiralPathDurations(paths, cfg, undefined).reduce((a, d) => a + d.seconds, 0);
    expect(helperSecs).toBeCloseTo(stageSecs, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/forge/duration.test.ts`
Expected: FAIL — `spiralPathDurations` is not exported.

- [ ] **Step 3: Write the implementation**

In `web/src/lib/forge/estimate.ts`, add this export immediately above the final `export { fmtDuration };` (line 168). It reuses the module-private `resolveStageParams` (imported at top), `effectiveRate`, and `spiralSeconds`, mirroring the exact expressions in `estimateForge`'s spiral branch (lines 119–122):

```ts
/**
 * Per spiral path: its cut duration in seconds, resolved the SAME way the
 * estimator's spiral branch does (group params over source, falling back to the
 * working regime). Non-spiral paths are dropped. Σ(seconds) equals the spiral
 * stages' seconds in `estimateForge` by construction, so the heatmap and the
 * headline cut-time agree. This is also the hook a future size-aware tuning pass
 * modulates (per-path speed/passes).
 */
export function spiralPathDurations(
  paths: GeneratedPath[],
  config: ForgeConfig,
  source: StageParams | undefined,
): { path: GeneratedPath; seconds: number }[] {
  const resolved = resolveStageParams(config);
  return paths
    .filter((p) => p.generatedClass === "spiral")
    .map((p) => {
      const sp = resolved[p.groupName] ?? {};
      const rate = effectiveRate(sp, source);
      const passes = (sp.passes as number | undefined) ?? rate.repeat;
      const speed = (sp.speed as number | undefined) ?? rate.speedMmS;
      return { path: p, seconds: spiralSeconds(p, passes, speed) };
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/forge/duration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/forge/estimate.ts web/src/lib/forge/duration.test.ts
git commit -m "feat(forge): spiralPathDurations — per-path cut time, reconciles with estimate"
```

---

### Task 3: SpiralDurationCanvas component

**Files:**
- Create: `web/src/components/forge/SpiralDurationCanvas.tsx`
- Test: `web/src/components/forge/SpiralDurationCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/forge/SpiralDurationCanvas.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpiralDurationCanvas } from "./SpiralDurationCanvas";
import { SPIRAL_CUT } from "../../lib/forge/presets";
import { STAGE_GROUPS } from "../../lib/forge/config";
import type { GeneratedPath, Pt } from "../../lib/forge/types";

function mkPath(groupName: string, len: number): GeneratedPath {
  const pts: Pt[] = [{ x: 0, y: 0 }, { x: len, y: 0 }, { x: len, y: len }];
  return {
    sourceObjectId: "o", generatedClass: "spiral", groupName,
    layerStart: 0, layerEnd: 1, widthMultiplier: 1, offsetMm: 0.8,
    sideMode: "outside", operationOrder: 0, enabled: true, rings: [pts],
  };
}

describe("SpiralDurationCanvas", () => {
  it("renders the legend when there are paths", () => {
    const paths = [mkPath(STAGE_GROUPS.spiral, 100), mkPath(STAGE_GROUPS.spiralDetail, 6)];
    render(<SpiralDurationCanvas paths={paths} config={SPIRAL_CUT} width={300} height={200} />);
    expect(screen.getByText(/time \/ feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/no cut paths/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no spiral paths", () => {
    render(<SpiralDurationCanvas paths={[]} config={SPIRAL_CUT} width={300} height={200} />);
    expect(screen.getByText(/no cut paths/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/forge/SpiralDurationCanvas.test.tsx`
Expected: FAIL — cannot resolve `./SpiralDurationCanvas`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/forge/SpiralDurationCanvas.tsx`:

```tsx
// web/src/components/forge/SpiralDurationCanvas.tsx
//
// Accurate-scale heatmap of the REAL generated spiral paths: each path stroked
// in a colour mapped (log scale) from its cut duration, so under-served small
// features (red) and over-served large ones (steel) are visible at a glance.
// Read-only diagnostic — mirrors SpiralCanvas's canvas/DPR setup but draws the
// true polylines (result.paths) rather than the not-to-scale schematic.
import { useEffect, useMemo, useRef } from "react";
import type { ForgeConfig, GeneratedPath, StageParams } from "../../lib/forge/types";
import { spiralPathDurations, fmtDuration } from "../../lib/forge/estimate";
import { logNormalize, durationColor, HEAT_STOPS } from "../../lib/forge/heatmap";

export interface SpiralDurationCanvasProps {
  paths: GeneratedPath[];
  config: ForgeConfig;
  source?: StageParams;
  width: number;
  height: number;
}

export function SpiralDurationCanvas({ paths, config, source, width, height }: SpiralDurationCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const data = useMemo(() => {
    const durs = spiralPathDurations(paths, config, source);
    const seconds = durs.map((d) => d.seconds);
    const t = logNormalize(seconds);
    let dMin = Infinity, dMax = -Infinity;
    for (const s of seconds) { if (s < dMin) dMin = s; if (s > dMax) dMax = s; }
    return { durs, t, dMin: Number.isFinite(dMin) ? dMin : 0, dMax: Number.isFinite(dMax) ? dMax : 0 };
  }, [paths, config, source]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { durs, t } = data;
    if (durs.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { path } of durs) for (const ring of path.rings) for (const p of ring) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return;

    const pad = 22;
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = pad + (width - 2 * pad - w * scale) / 2 - minX * scale;
    const oy = pad + (height - 2 * pad - h * scale) / 2 - minY * scale;
    const X = (x: number) => x * scale + ox;
    const Y = (y: number) => y * scale + oy;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(0.6, 1 / dpr);
    ctx.globalAlpha = 0.9;
    durs.forEach(({ path }, i) => {
      ctx.strokeStyle = durationColor(t[i]);
      for (const ring of path.rings) {
        if (ring.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(X(ring[0].x), Y(ring[0].y));
        for (let j = 1; j < ring.length; j++) ctx.lineTo(X(ring[j].x), Y(ring[j].y));
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }, [data, width, height]);

  const has = data.durs.length > 0;
  const gradientCss = `linear-gradient(to right, ${HEAT_STOPS.map((s) => s.hex).join(", ")})`;

  return (
    <div className="relative h-full w-full">
      <canvas ref={ref} style={{ width, height }} className="block rounded bg-[var(--color-surface)]" />
      {has ? (
        <div className="pointer-events-none absolute left-3 right-3 bottom-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-subtle)]">
          <span>{fmtDuration(data.dMin)}</span>
          <span className="h-2 flex-1 rounded-[2px]" style={{ background: gradientCss }} aria-hidden />
          <span>{fmtDuration(data.dMax)}</span>
          <span className="ml-1 normal-case tracking-[0.06em] text-[var(--color-ink-muted)]">time / feature · red = least</span>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-3 bottom-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-subtle)]">
          no cut paths
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/forge/SpiralDurationCanvas.test.tsx`
Expected: PASS (2 tests). (jsdom's canvas `getContext` returns null; the effect's `if (!ctx) return` guards it, so only the DOM legend is asserted.)

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/forge/SpiralDurationCanvas.tsx web/src/components/forge/SpiralDurationCanvas.test.tsx
git commit -m "feat(forge): SpiralDurationCanvas — accurate per-path duration heatmap + legend"
```

---

### Task 4: Wire the Class | Duration toggle into SpiralPage

**Files:**
- Modify: `web/src/pages/SpiralPage.tsx`

- [ ] **Step 1: Add the import**

After the existing `import { SpiralControls } ...` line (≈ line 32), add:

```tsx
import { SpiralDurationCanvas } from "../components/forge/SpiralDurationCanvas";
```

Ensure `StageParams` is in the forge types import. Find the existing `import type { ... } from "../lib/forge/types";` and add `StageParams` to its list (it already imports `ForgeConfig`, `Contour`, etc. — add `StageParams` if not present).

- [ ] **Step 2: Add the colour-mode state**

Next to the other `useState` hooks in the component body (near `const [canvasSize, setCanvasSize] = useState(...)`, ≈ line 90), add:

```tsx
const [colourMode, setColourMode] = useState<"class" | "duration">("class");
```

- [ ] **Step 3: Add `sourceParams` (the estimator's source for the selected target)**

Next to the existing `intaglioTarget` memo (≈ line 269), add:

```tsx
// Source incise params for the selected target — fed to the duration heatmap so
// its per-path times resolve the same way the estimate does.
const sourceParams = useMemo<StageParams | undefined>(() => {
  if (state.kind !== "ready" || !selectedIncise) return undefined;
  return state.objects.find((o) => o.id === selectedIncise)?.params;
}, [state, selectedIncise]);
```

- [ ] **Step 4: Add the toggle + swap the canvas**

Replace the canvas wrapper block (currently lines 400–415):

```tsx
              <Card variant="inset" padded={false} className="min-w-0 min-h-0 p-2">
                <div ref={canvasWrapRef} className="h-full w-full min-h-0 min-w-0 overflow-hidden">
                  <SpiralCanvas
                    source={sourceContour}
                    channelWidthMm={config.spiral.channelWidthMm}
                    pitchMm={config.spiral.pitchMm}
                    side={config.spiral.side}
                    intaglio={intaglioTarget}
                    splitNecks={config.spiral.splitNecks}
                    neckThresholdPct={config.spiral.neckThresholdPct}
                    neckOverlapMm={config.spiral.neckOverlapMm}
                    width={canvasSize.w}
                    height={canvasSize.h}
                  />
                </div>
              </Card>
```

with:

```tsx
              <Card variant="inset" padded={false} className="min-w-0 min-h-0 p-2">
                <div ref={canvasWrapRef} className="relative h-full w-full min-h-0 min-w-0 overflow-hidden">
                  {/* Colour mode: class (schematic) vs duration (heatmap) */}
                  <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-[10px] uppercase tracking-[0.12em]">
                    {(["class", "duration"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setColourMode(m)}
                        aria-pressed={colourMode === m}
                        className={`px-2 py-1 transition-colors ${
                          colourMode === m
                            ? "bg-[var(--color-primary)] text-[var(--color-surface)]"
                            : "text-[var(--color-ink-muted)] hover:text-[var(--color-primary)]"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {colourMode === "duration" ? (
                    <SpiralDurationCanvas
                      paths={result?.paths ?? []}
                      config={config}
                      source={sourceParams}
                      width={canvasSize.w}
                      height={canvasSize.h}
                    />
                  ) : (
                    <SpiralCanvas
                      source={sourceContour}
                      channelWidthMm={config.spiral.channelWidthMm}
                      pitchMm={config.spiral.pitchMm}
                      side={config.spiral.side}
                      intaglio={intaglioTarget}
                      splitNecks={config.spiral.splitNecks}
                      neckThresholdPct={config.spiral.neckThresholdPct}
                      neckOverlapMm={config.spiral.neckOverlapMm}
                      width={canvasSize.w}
                      height={canvasSize.h}
                    />
                  )}
                </div>
              </Card>
```

- [ ] **Step 5: Typecheck + full test suite**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Build + browser-verify (CLAUDE.md requires a real-browser check)**

Run: `cd web && npm run build`
Then load `http://127.0.0.1:8017/#/spiral`, upload a varied part (e.g. `Amelia.xs` at 36.7 mm, split-detail on), and:
- Click the `duration` toggle → preview swaps to the accurate heatmap; small detail features read red/warm, the silhouette cool; legend shows min→max via `fmtDuration`.
- Click `class` → schematic returns unchanged.
- Confirm no console errors (the benign favicon 404 aside).
Screenshot and read it critically before marking done.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/SpiralPage.tsx
git commit -m "feat(forge): Class | Duration toggle on the Spiral preview"
```

---

### Task 5: Changelog + final verification

**Files:**
- Create: `changelog/2026-06-16-spiral-duration-heatmap.md`

- [ ] **Step 1: Write the changelog entry**

Create `changelog/2026-06-16-spiral-duration-heatmap.md`:

```markdown
---
id: 2026-06-16-spiral-duration-heatmap
date: 2026-06-16
level: minor
title: Spiral Cut — duration heatmap to spot under-served detail
summary: A new Class | Duration toggle on the preview tints every cut path by how long the laser actually spends on it (passes × length ÷ speed, log-scaled). Small internal-detail features that get the least time show red; the main silhouette reads cool — so you can see which features need attention before tuning params.
---
```

- [ ] **Step 2: Final full verification**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-06-16-spiral-duration-heatmap.md
git commit -m "docs(changelog): Spiral duration heatmap"
```

---

## Self-review notes (author)

- **Spec coverage:** metric (Task 2), accurate real-path render (Task 3), log normalisation + colour scale + legend (Tasks 1 & 3), Class|Duration toggle (Task 4), all-paths scope (component draws every spiral path passed in), reconciliation-with-estimate (Task 2 reconciliation test), forward-compat hook (`spiralPathDurations`). Edge cases: empty/single path (logNormalize → 0.5; component empty state), degenerate speed (`spiralSeconds` clamps `speed ≥ 1`). Median tick intentionally dropped (YAGNI; noted above).
- **Type consistency:** `spiralPathDurations(paths, config, source) → { path, seconds }[]`; `logNormalize(number[]) → number[]`; `durationColor(number) → string`; `HEAT_STOPS[i].hex/.rgb/.t` used identically across Tasks 1/3; `SpiralDurationCanvasProps` matches the call site in Task 4.
- **No placeholders:** every code step is complete and runnable.
