# Spiral SVG round-trip (import + export)

**Date:** 2026-06-13
**Status:** design approved; implementing on `feat/spiral-svg` (stacked on `feat/cut-geometry-help`)
**Verify on:** http://127.0.0.1:8017/#/spiral

## Goal
Import an `.svg` as a spiral cut, and export the cut as `.svg` — reusing the
existing server-side SVG→XCS converter and the Forge pipeline rather than
synthesizing documents by hand.

## Import (`.svg` → spiral)
Reuse **`/api/svg-stack`** with `processing_type: "VECTOR_CUTTING"` — Forge's
classifier treats `VECTOR_CUTTING` as an incise cut target
(`INCISE_TYPES = {INTAGLIO, VECTOR_CUTTING}`, xcs.ts:5), so the converter's
output drops straight into the existing worker.

Flow (all client glue, no engine/worker changes):
1. On an `.svg` upload, read the text; derive `width_mm` (below).
2. `POST /api/svg-stack` `{ name, svg_content, width_mm, height_mm:null,
   start_x:10, start_y:10, base_params: defaultBaseParams(), material_id,
   processing_type:"VECTOR_CUTTING", scan_angle:90, stack_passes:1,
   stack_step_deg:90, subtract_overlaps:false, format:"xcs" }` → returns
   `.xcs` bytes. New `svgStackToBytes(request)` in `generate.ts` (POST →
   `ArrayBuffer`, sibling of `svgStackAndDownload`).
3. Feed the bytes into the Forge worker via a new `useForgeEngine.loadBuffer(buf,
   fileName)` (refactored out of `handleFile`) → existing `parse` → the SVG
   shapes come back as `VECTOR_CUTTING` targets.
4. **Target pick:** SpiralPage already lists targets + radio; enhance the
   auto-select to choose the **largest** target (by source-contour bbox area)
   when there are several, instead of only auto-selecting when exactly one.

Inputs:
- `material_id`: `listMaterials()` on mount → active/first material id (Loom's
  pattern). Only seeds the source doc's params, which the spiral export
  overrides — any valid id is fine; block SVG import with a clear message if no
  material exists.
- `base_params`: `defaultBaseParams()` — likewise overridden on export.
- `width_mm`: parse the SVG's `width`/`height` attrs; if they carry real units
  (mm/cm/in) convert to mm; otherwise default **100 mm** (never treat unitless
  px as mm — would blow past the 500 mm cap). Clamp 1–500. A size-override
  control is a follow-up, not v1.

## Export (spiral → `.svg`)
Page-side, no worker change. New `buildSpiralSvg(paths, fileName)` in
`web/src/lib/forge/svgExport.ts`: union bbox over the generated paths, emit
`<svg xmlns width="{w}mm" height="{h}mm" viewBox="minX minY w h">` with one
`<path d=… fill="none" stroke="#000">` per arm (reusing `contourToDPath` from
xcs.ts; y-down already matches SVG). Download via a Blob (`image/svg+xml`,
`spiral.svg`).

## Output format matrix
Because svg-stack gives an SVG import a **real `parsed.raw`**, every source can
export to any format. Add `.svg` as a third output option:
- `FormatToggle` made generic (`<T extends string>`, `formats?: readonly T[]`,
  default `["xs","xcs"]`) so ForgePage is unchanged and SpiralPage passes
  `["xs","xcs","svg"]`.
- SpiralPage export: `svg` → `buildSpiralSvg` + download (page-side); `xs`/`xcs`
  → existing `exportAs` (worker). Local `SpiralExportFormat = "xs"|"xcs"|"svg"`;
  the worker's `ForgeFormat` is untouched.

## Files
| File | Change |
|---|---|
| `web/src/generate.ts` | add `svgStackToBytes(request) → ArrayBuffer` |
| `web/src/hooks/useForgeEngine.ts` | extract `loadBuffer(buf, fileName)`; `handleFile` delegates |
| `web/src/lib/forge/svgExport.ts` | **new** — `buildSpiralSvg` |
| `web/src/components/FormatToggle.tsx` | generic + `formats` prop (back-compatible) |
| `web/src/pages/SpiralPage.tsx` | `.svg` upload branch (→ svg-stack → loadBuffer), materials fetch, width derivation, largest-target auto-select, 3-way format + svg export |

No backend, engine, worker-protocol, or `.xcs`/`.xs` lib changes.

## Testing & changelog
- `tsc` clean; existing suite unaffected; add a `buildSpiralSvg` unit test
  (valid svg string, viewBox, one path per arm) and an `svgWidthMm` test.
- Browser-verify on 8017: import a sample `.svg` → ready, target auto-picked,
  schematic renders, estimate populates; export `.svg` (opens/round-trips),
  and `.xs`/`.xcs` still export from the SVG source. Deprecated Forge + the
  `.xcs`/`.xs` upload path unaffected.
- **Major** changelog entry (new capability): SVG in/out on Spiral.

## Risks
- svg-stack needs the backend (same as Loom/SVG-layers — fine).
- A stroke-only / open-path SVG yields a non-confident winding; the pipeline
  already warns and the user can flip `side`. Documented, not blocking.
- `width_mm` derivation is best-effort; size-override UI is a noted follow-up.
