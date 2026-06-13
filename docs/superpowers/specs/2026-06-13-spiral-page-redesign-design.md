# Spiral page redesign — schematic render, side panes, cut-appropriate controls

**Date:** 2026-06-13
**Status:** design approved; implementing on `feat/spiral-redesign`
**Builds on:** the Cut/Spiral split (PR #130, on `main`).
**Verify on:** the local backend at http://127.0.0.1:8017 (serves `web/dist`).

## Goal

Make the Spiral page legible and cut-specific: show what the spiral actually
does to the part (visible concentric lines, not a solid "blob"), drop the
forge-engrave metrics/controls that are meaningless for a vector cut, and
tighten the layout to three clean panes with no bottom section.

## Decisions (locked with user 2026-06-13)

- **Schematic spiral render** (not literal-zoom): the literal toolpath is ~20
  arms 0.04 mm apart and collapses to a solid band at fit-to-part zoom. Show a
  legible, exaggerated-pitch schematic instead.
- **Defer all SVG** (upload + download) to a separate follow-up PR.
- Density and the generic "Descend at Z-axis" group are engrave-only and come
  out of the spiral laser controls (user correction); focus descent is the
  cut's Z mechanism.
- Debug moves to the **left**; Laser & focus moves to the **right rail**; the
  bottom docked tray is removed.
- Implementation uses the `frontend-design` skill — creative, polished.

## 1. Layout

Viewport-pinned cockpit (unchanged shell). Ready-state body:

- **Top:** `ForgeEstimateStrip` in a trimmed `variant="spiral"` (below).
- **Left rail (248px, scrolls):** `ForgeSourcePanel` (validation / cut target /
  preserved) → **Debug** (trimmed, `spiral` variant). Debug moves here from the
  right.
- **Center (1fr):** canvas only — the schematic spiral hero, full height. The
  single-checkbox "spiral" legend is removed (one class); replaced by the
  schematic caption drawn in-canvas.
- **Right rail (332px, scrolls):** `SpiralControls` "Cut geometry" → **Laser &
  focus** (moved up from the bottom tray) → "Setup & calibration" (collapsed).
- **Bottom docked tray:** removed.

## 2. Schematic spiral render (`SpiralCanvas`, new)

A focused replacement for `ForgeCanvas` on this page. Pure presentation —
**no pipeline/worker/types changes.** Computed client-side from the cut contour
(`sourceContour`, already in mm space on the page) + `config.spiral`:

- Concentric arms via `offsetRegion(part, dist)` (web/src/lib/forge/offset.ts —
  synchronous clipper-lib, main-thread safe). Emit ~6–7 rings at **exaggerated
  proportional spacing**: total schematic band = `max(channelWidthMm,
  partMinDim × ~0.06)`, rings evenly spaced across it on the scrap side per
  `side` (`sign = side === "inside" ? -1 : 1`). `offsetRegion` returns `[]` when
  an offset collapses → stop and draw what fits. Memoised on
  `(contour, channelWidthMm, side)`; ~6 offsets of a simple contour is cheap.
- Draw: the part outline (faint), the concentric arms (crisp 1-device-px,
  outer→inner weight/alpha for depth, brand pink), a continuous spiral **guide**
  connecting the arms with a direction arrowhead at the start, and an in-canvas
  caption **"schematic · ~N arms · {pitch} mm pitch"** (true N = `ceil(channel/
  pitch)`). Fix the existing DPR line-width bug (stroke at `1/dpr` in the scaled
  context). Fit-to-bbox with padding, devicePixelRatio-aware (reuse the current
  `ForgeCanvas` transform math).
- Creative (frontend-design): animated draw-on of the spiral on load/regen,
  subtle glow, the workshop-blueprint register. Legible at any zoom; honestly
  labelled schematic.
- Empty/again states: if `sourceContour` is null, draw nothing (page shows the
  empty state). If offsets all collapse, draw just the outline + caption.

`ForgeCanvas` is left unchanged (still used by the deprecated Forge page).

## 3. Trimmed metrics

Shared components gain a spiral flag so the deprecated **Forge page is
unaffected** (it keeps the full panels).

- **`ForgeEstimateStrip` `variant="spiral"`:** keep the cut-time hero, "% of
  incise", and baseline. **Drop** the per-stage share bar + chip row (single
  stage), and the **pockets / bands / budget** footer chips. Pierces → a small
  "continuous ✓" indicator (one path) or dropped.
- **`ForgeDebugPanel` `spiral` prop:** keep mm/unit (+ confident flag) and
  warnings. **Replace** the five-class path-count line with **spiral arm/path
  count + total channel length (mm)** (length from `spiralPathLength` over the
  arm, or summed). **Drop** the scan-angle row entirely; drop the
  `optimizeScanAngle` prop wiring on the Spiral page.

## 4. Laser & focus — cut mode

Reuse `ForgeStageParams` (keeps the machine-profile widgets in one place) with a
new **`cutMode`** prop, locked to the spiral group as today:

- **Drop Density** (`NUMERIC_FIELDS` `density` — engrave lines/cm).
- **Drop the generic "Descend at Z-axis" group** and its Total-depth /
  Depth@256 readouts. Focus descent (`spiral.focusStepMm` /
  `focusIntervalPasses`) stays as the only Z control.
- **Single "Passes"** — keep `spiral.passes` (the relabelled layer-count field
  that the engine reads as the vector repeat) and drop the profile's duplicate
  `passes` range field in cut mode.
- Net controls: Power · Frequency · Speed · Pulse width · Laser · Passes ·
  Focus descent (per-step / every-N-passes).

`cutMode` is off by default, so the deprecated Forge stage tabs are unchanged.

## 5. Files

| File | Change |
|---|---|
| `web/src/components/forge/SpiralCanvas.tsx` | **new** — schematic spiral render |
| `web/src/pages/SpiralPage.tsx` | layout: debug left, laser/focus right, canvas-only center, no bottom tray; use SpiralCanvas + trimmed strip/debug; drop legend + optimizeScanAngle wiring |
| `web/src/components/forge/ForgeStageParams.tsx` | `cutMode` prop (drop density, drop Z-descent group, single passes) |
| `web/src/components/forge/ForgeEstimateStrip.tsx` | `variant="spiral"` (drop stage bar/chips, pockets, bands, budget) |
| `web/src/components/forge/ForgeDebugPanel.tsx` | `spiral` prop (mm/unit + spiral count/length + warnings; drop scan-angle + 4 classes) |
| `web/src/components/forge/SpiralControls.tsx` | unchanged (Cut geometry + Setup) |

`web/src/lib/forge/*`, `forge.worker`, `ForgeCanvas`, and the deprecated Forge
page are **untouched**.

## 6. Testing & changelog

- `tsc` clean; existing suite green (`ForgeStageParams.test.tsx` — confirm
  `cutMode` off keeps current behaviour; add a case for `cutMode` hiding
  density/Z-descent if practical).
- Browser-verify at 1440×900 on 8017: Spiral page upload→ready — schematic
  shows separated concentric lines + direction + caption; estimate/debug
  trimmed; laser controls have no density/Z-descent, one Passes; layout has no
  bottom section. Regression-check `#/forge` (full panels intact).
- **Minor** changelog entry (visible polish): "Spiral page — clearer schematic
  preview + cut-only controls".

## 7. Deferred — SVG round-trip (separate PR)

- **Download (S):** spiral polylines → SVG via the existing `contourToDPath`
  (xcs.ts:274) + a `<svg viewBox>` wrapper, built page-side from `result.paths`;
  reuse `downloadBuf` with `image/svg+xml`. Could be a quick standalone PR.
- **Upload (M):** SVG → contour adapter (`splitSubpaths` reuse + primitive→d +
  transform baking + units/viewBox→mmPerUnit) and a synthetic `ParsedXcs` branch
  in `forge.worker`. Real unknowns: cut-target selection from an unmarked SVG
  (reuse `detectSvgLayers` + a picker), and the in→out format matrix
  (`buildGeneratedXcs` reads `parsed.raw`, which an SVG lacks). Needs its own
  design pass.
