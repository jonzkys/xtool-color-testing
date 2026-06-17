# Spiral Cut — per-path duration heatmap (design)

**Goal:** A read-only diagnostic colour mode on the Spiral Cut preview that tints
each generated cut path by its true cut duration, so features under- or
over-served by the current params — especially the wide size range of internal
detail on parts like the rose — are visible at a glance, before any tuning.

**Architecture:** A new accurate-scale canvas renders the real generated spiral
polylines, each stroked in a colour mapped from its per-path duration on a log
scale. A `Colour: Class | Duration` toggle swaps it in for the existing
schematic. Pure helpers (duration + heatmap colour) are shared with the
estimator so the numbers reconcile.

**Tech stack:** React + Canvas2D, Tailwind v4 (Workshop Instrument), existing
`lib/forge` pure modules + vitest.

---

## Why

- Internal-detail features span a wide size range; one shared speed/passes can't
  suit all of them. **Before** auto-tuning we need to *see* the spread on real
  parts — instrument first, tune second.
- Today the only preview (`SpiralCanvas`) colours by class (external pink /
  internal amber) on an exaggerated, **not-to-scale** schematic and carries no
  time information.
- The data already exists: `spiralPathLength()` gives per-path length, and the
  estimator already computes per-path spiral seconds (`passes × length ÷ speed`).
  We surface that per path instead of only summing it.

## Scope

- **IN (Phase 1):** the heatmap view + toggle + legend. Read-only.
- **OUT (deferred to its own spec — Phase 2):** any change to cut params
  (size-aware speed / passes tuning). The user's gut is speed+passes, ideally
  speed-only; this viz is what decides it from real data.

## The metric

Per spiral path — **how long one pass of it takes**:

```
seconds = pathLength ÷ speed   (a single pass, NOT × passes)
```

where `speed` is the path's **resolved group param** (`CUT_08_SPIRAL` vs
`CUT_09_SPIRAL_DETAIL`), resolved the SAME way the estimator does. Multiply by
passes (+ the estimator's per-pass overhead) to recover the headline "estimated
cut time" total. Per-pass traversal time is the intuitive per-feature number:
low = the laser crosses it quickest (small features), high = slow. (Earlier draft
used total all-passes dwell; switched to single-pass per user request — the log
colouring is near-identical since passes is uniform, but the legend reads as
seconds-per-pass.)

Within a single path duration is uniform (constant speed), so each path is a
solid tint; the *set* of paths forms the heatmap across the part. (This matches
"gradient-fill the path lines" — the gradient is across features, not within a
stroke.)

## Rendering — accurate real paths

A `Colour: Class | Duration` segmented toggle on the preview:

- **Class** (default): the existing `SpiralCanvas` schematic, unchanged.
- **Duration:** a new `SpiralDurationCanvas` that draws the ACTUAL generated
  spiral polylines (`result.paths`, mm space), bbox-fit to the canvas, each
  stroked in its duration colour. At fit-zoom the dense ~0.04 mm-pitch spiral
  reads as a filled blob per feature — which is exactly what a heatmap wants:
  one colour-coded blob per feature, with honest geometry.

## Colour scale & normalisation

- The dynamic range is large (a petal vs the whole silhouette), so normalise on a
  **log** scale:
  `t = clamp01( (ln d − ln dMin) / (ln dMax − ln dMin) )`; if `dMax ≈ dMin`,
  `t = 0.5`.
- Sequential scale, short→long reads as **watch → safe**. Three anchors (hex
  tunable during the frontend-design pass; concrete starting values so there is
  no placeholder), linear-RGB lerp between adjacent stops:
  - `t = 0.0` → `#e2483d` (red — shortest / watch)
  - `t = 0.5` → `#f59e0b` (amber)
  - `t = 1.0` → `#4b7f9e` (steel — longest / safe)
- **Legend:** a horizontal gradient strip beneath the canvas; left label `dMin`,
  right label `dMax` via the existing `fmtDuration`, with a median tick. A short
  caption ("colour = total laser time per feature; red = least").

## Components / files

- **New `web/src/lib/forge/heatmap.ts`** (pure, unit-tested):
  - `logNormalize(values: number[]): number[]` — per the formula above.
  - `durationColor(t: number): string` — the 3-stop RGB lerp → `#rrggbb`.
- **`web/src/lib/forge/estimate.ts`** — export a shared
  `spiralPathDurations(paths, config, source): { path: GeneratedPath; seconds: number }[]`
  that reuses the estimator's stage-param resolution + `spiralSeconds` (extract
  the currently-private pieces as needed) so viz and estimate agree by
  construction.
- **New `web/src/components/forge/SpiralDurationCanvas.tsx`** — props:
  `{ paths: GeneratedPath[]; config: ForgeConfig; source?: StageParams; width; height }`.
  Computes durations, bbox-fits, strokes each path in `durationColor`, draws the
  legend. Decimates polylines **for display only** (colour is per-path, so
  decimation never affects the metric).
- **`web/src/pages/SpiralPage.tsx`** — a `colourMode: "class" | "duration"`
  state, the toggle control, and the canvas swap. `result.paths` + `config`
  (+ source params) are already in scope.

## Data flow

`SpiralPage` already holds `result.paths` and `config`. In Duration mode it
passes the spiral paths + config (+ source `StageParams`) to
`SpiralDurationCanvas`, which calls `spiralPathDurations`, log-normalises, and
strokes + legends.

## Edge cases

- 0 paths → render nothing / "no cut paths"; 1 path → `t = 0.5`, legend shows the
  single value.
- Degenerate speed → guarded (`speed ≥ 1`), as the estimator already does.
- Very heavy parts (thousands of points) → display-only decimation keeps the draw
  cheap; metric uses full length.

## Testing

- `heatmap.test.ts`: `logNormalize` spreads a wide range, clamps to [0,1], and
  returns 0.5 for all-equal input; `durationColor` is monotone between anchors
  and exact at the endpoints.
- estimate test: `spiralPathDurations` totals equal the spiral stage's estimate
  seconds, and respect per-group (`CUT_08` vs `CUT_09`) speed/passes.
- `SpiralDurationCanvas` smoke test (jsdom): renders without throwing for a few
  paths and the legend shows the min and max labels.

## Forward-compatibility

`spiralPathDurations` is exactly the hook Phase-2 size-aware tuning will modulate
(per-path speed/passes). Once that lands, the same heatmap becomes the live
feedback loop — no rework.
