# Contour Forge — staged contour-machining strategy generator

**Status:** approved design (2026-05-25)
**Owner:** Jon
**Route:** `#/forge` (experimental test page)

## Purpose

Generate advanced, staged laser-cut **contour strategies** from an uploaded
xTool `.xcs` file. This is not a conventional "cut line" operation. On a 60W
MOPA fibre laser cutting thick brass (e.g. 3mm), the process is repeated
ablation, melting, partial vapourisation and melt ejection — a narrow kerf
becomes self-limiting as ejecta/recast block the trench, energy coupling drops
and heat builds locally. So instead of repeating one line many times, the page
emits a sequence of functional path classes designed to:

- improve initial energy coupling (**seed**),
- create local starter / ejection points (**perforate**),
- progressively deepen the kerf, widening only as needed (**deepen**),
- reduce local heat accumulation via interlacing + direction reversal,
- clean trench walls rather than forcing heat into a sealed slot (**clean**).

The first priority is **correct, inspectable geometry generation + preview**,
not perfect laser parameters. The whole point is to let the user vary the
strategy and compare real-world results, so nothing is hard-coded so tightly
that experimentation is blocked.

## Key decisions (resolved during brainstorming)

1. **Client-side TypeScript only.** Parse, generate, preview and re-emit the
   `.xcs` entirely in the browser. Mirrors the existing gcode-viewer page.
   No new backend endpoints. `.xcs` is plain JSON, and the project has **no
   existing XCS parser** (`src/xcs_gen/builder.py` only *builds* files from its
   own Python model), so there is nothing to reuse server-side anyway.
2. **Offset library for parallel contours.** Use `clipper2-js` (pure-TS, no
   WASM) for robust scrap-side polygon offsets. Confirm import/bundling at
   build; fallback `js-angusj-clipper` (WASM) if pure-TS proves unusable.
3. **Original incise contour is removed (replaced).** The source INTAGLIO
   object is dropped from the exported cut operations; generated stages fully
   replace it. Emboss + model objects are preserved unchanged. The source
   geometry is retained **internally only** for preview.

## XCS format facts (from `samples/xcs/incise_emboss.xcs`)

- `.xcs` is a single JSON document. Top level: `canvas[]`, `device`, `meta`,
  `version`, …
- `canvas[0].displays[]` holds visual objects. Each has geometry: `PATH`
  objects carry a `dPath` SVG string (supports `M/L/Q/C/Z`; the sample's incise
  path uses `M/L/Q/Z` and is **closed**, `isClosePath: true`). `BITMAP` objects
  carry `base64`. `CIRCLE` etc. also occur.
- The **processing mode** per object lives in `device.data`, which is a
  **serialised JS `Map`**: `{ "dataType": "Map", "value": [[id, entry], …] }`.
  Each top-level entry is a process group with a `mode` (e.g.
  `"RELIEF_PROCESS"`) and a nested `displays` Map of
  `displayId -> { isFill, type, processingType, data: { <SCHEMA>: {parameter:{customize:{…}}} } }`.
- **Mode token mapping (this fiber/relief workflow):**
  - **emboss** = `processingType: "RELIEF"` (raised relief; BITMAP in sample)
  - **incise** = `processingType: "INTAGLIO"` (recessed engraving; the closed
    `PATH` — this is the **cut-contour source**)
- The `RELIEF_PROCESS` block carries `"perimeter": <mm>` matching the contour's
  real-world perimeter — used to calibrate path-units → mm (see below).

### Mode classification (with manual override)

Detection lookup, not hard rule:
- incise candidates: `INTAGLIO` (also treat `VECTOR_CUTTING` / score-like as
  incise if present).
- emboss candidates: `RELIEF` (also `VECTOR_ENGRAVING` / fill engrave modes).

The UI lists **every** object with its detected class and a dropdown to
reassign, so misdetection is never silent or fatal.

## Coordinate units (biggest correctness risk)

Beam-width offsets are in **mm** (e.g. 0.05mm), but `dPath` coords are in canvas
units. Calibration:
1. Flatten the incise `dPath` to a polyline and measure its perimeter in path
   units.
2. Divide the `RELIEF_PROCESS.perimeter` (mm) by that to get `mmPerUnit`.
3. Cross-check against the unit convention in `src/xcs_gen/builder.py` (its
   `width`/`scale` comments document bed-mm handling).

All geometry generation happens in **mm space**; results convert back to path
units on serialisation. If calibration can't be derived confidently, surface a
warning and expose a manual `mmPerUnit` override.

## Architecture & modules

### A. Pure geometry/format library — `web/src/lib/forge/` (no React)

- **`xcs.ts`** — `parseXcsFile(buf)`, `findEmbossObjects(xcs)`,
  `findInciseObjects(xcs)`, `extractContourGeometry(inciseObject)`,
  `buildGeneratedXcs(originalXcs, generatedPaths, config)`, `exportXcs(xcs)`.
  Manipulates the JSON `Map` structure directly. Removes the source INTAGLIO
  object from cut ops; preserves emboss + model.
- **`contour.ts`** — `normaliseContour`, `flattenDPath` (M/L/Q/C/Z → polyline
  with bezier flattening), `detectClosedContour`, `inferWindingAndOutside`,
  `segmentContour(contour, segmentLengthMm)`, and a curvature/corner detector
  (`detectCorners(contour, angleThreshold)`).
- **`offset.ts`** — `generateOffsetStack(contour, widthMultiplier, beamWidthMm,
  sideMode)` via `clipper2-js`. `sideMode ∈ {outside, inside, symmetric, flip}`,
  default outside-only/scrap-side biased.
- **`schedule.ts`** — `orderSegmentsInterlaced(segments, stride, reverseMode,
  staggerMode)`: process non-adjacent segments first (stride), reverse
  alternate passes, stagger/rotate start points, avoid repeating the same
  physical start point.
- **`stages.ts`** — `generateSeedPaths`, `generatePerforationPaths`,
  `generateDeepenPaths`, `generateCleanPaths`. Each returns `GeneratedPath[]`.
- **`types.ts`** — shared types incl. `GeneratedPath` metadata:
  `sourceObjectId, generatedClass (seed|perforate|deepen|clean), groupName,
  layerStart, layerEnd, widthMultiplier, offsetMm, sideMode, direction,
  segmentIndex?, operationOrder, enabled`. Metadata is kept internally for
  debug/preview even where `.xcs` can't represent it.

### B. UI layer

- **`web/src/pages/ForgePage.tsx`** — page state machine
  (`idle | loading | ready | error`), config state, debounced regeneration.
- **`web/src/components/forge/`** — `ForgeCanvas` (auto-fit/pan/zoom preview,
  colour-coded path classes), control panels, debug panel, validation panel.
- **`web/src/lib/forge/forge.worker.ts`** — runs `parseXcsFile` once and the
  full generation pipeline on config change (debounced ~150ms), off the main
  thread. Mirrors `parser.worker.ts`. Vite `?worker` import.
- **Routing:** add `{ name: "forge" }` to `router.ts` (`parseRoute`/
  `formatRoute`), lazy page in `App.tsx`, TopBar nav entry.

## Stage algorithms (defaults)

### Stage 1 — Seed (`CUT_01_SEED`)
Surface-conditioning only; **not** a deep cut. Offset stack out to ~**2× beam
width**, **scrap-side only**, **≤5 layers**, configured independently of deeper
stages. *Code comment: seed improves initial coupling by roughening/darkening
the future kerf.*

### Stage 2 — Perforate (`CUT_02_PERFORATE`)
Optional (toggle). Walk the contour at `spacingMm` (default configurable, e.g.
1/2/3mm); at each point emit a **tiny pocket / short micro-segment** (not a big
hole), biased to the scrap side so part dimensions aren't damaged.
`detectCorners` flags vertices with turn-angle > `cornerAngleThreshold` and
high-curvature regions → inject extra perforation density there.
*Code comment: perforate creates distributed starter/ejection points for melt,
vapour and debris.*

### Stage 3 — Deepen (`CUT_03..06_DEEPEN_{A..D}_<from>_<to>_<mult>X`)
Progressive widening, **not** one fat line. Default pass-group schedule
(all editable in the UI table — name, fromLayer, toLayer, widthMultiplier,
enabled):

| Group | Layer range | Width | Purpose |
|-------|-------------|-------|---------|
| A | 0–50    | 1× | start narrow trench (centreline) |
| B | 50–100  | 2× | begin opening once cut started (centreline + 1 outside) |
| C | 100–200 | 4× | counteract self-limiting slot (centreline + stack) |
| D | 200–256 | 8× | final deepening to max depth (wide outside stack) |

Per group: `generateOffsetStack` (scrap-side biased default; symmetric
optional) → `segmentContour(segmentLengthMm)` →
`orderSegmentsInterlaced(stride, reverseAlternatePasses, staggerStartPoint)`.
Emit one path per segment in interlaced order. Offset count derived from
`beamWidthMm` and the group's effective `targetKerfWidthMm`.
Interlace defaults: `reverseAlternatePasses=true`, `staggerStartPoint=true`,
`avoidSameStartPoint=true`. *Code comment: deepen builds depth via progressive
widening + thermal interlacing.*

### Stage 4 — Clean (`CUT_07_CLEAN`)
Optional. Runs along the **trench walls** (inner + outer offset of the final
kerf), not just the centre. Low-energy/cooler **placeholder** params,
configurable pass/layer count. A distinct path class — **not** another deepen
pass. *Code comment: clean removes recast/oxide from walls without forcing more
depth.*

## Export ordering & assembly

Physical process order: **seed → perforate → deepen A → B → C → D → clean**;
within each deepen group, **interlaced segment order** (don't run all passes for
one tiny physical area consecutively). `operationOrder` on each `GeneratedPath`
drives the emit sequence.

`buildGeneratedXcs`:
- Append new `PATH` display objects to `canvas[].displays` (dPath converted from
  mm space back to path units; grouped/named per stage).
- Append matching processing entries to the `device.data` process-group
  `displays` Map: `processingType: "INTAGLIO"`, params **copied from the source
  incise object** (each stage overridable later).
- Remove the source incise display + its `device.data` entry.
- Leave emboss + model objects byte-for-byte intact.

## Validation & error handling

**Hard stop (no silent generation, export disabled):** no file uploaded; parse
failure; no emboss object; no incise object; multiple incise objects with no
target selected; incise object isn't a usable vector/path contour; offset
generation fails.

**Soft / override:** inside-outside winding can't be inferred confidently →
warn and require an explicit side via the `flip` control before export is
enabled; `mmPerUnit` calibration uncertain → warn + manual override.

All states surface in the validation panel. Export button stays disabled until
resolved.

## UI requirements (checklist)

- XCS upload input (+ drag-drop).
- Validation status panel.
- Detected emboss objects / detected incise objects / selected incise picker.
- Preview of original contour + generated seed/perforate/deepen/clean paths,
  **colour-coded by class**.
- Per-stage enable/disable.
- Beam-width input.
- Offset side selector: outside / inside / symmetric / flip.
- Seed: enabled, width multiplier, layer count, outside-only toggle.
- Perforate: enabled, spacing, corner-boost enabled, corner angle threshold,
  pocket size, outside bias.
- Deepen: editable pass-group **table** (name, fromLayer, toLayer,
  widthMultiplier, enabled per row), interlacing enabled, segment length,
  interlace stride, reverse alternate passes, stagger start points,
  outside-only widening.
- Clean: enabled, width/offset selection, number of passes/layers.
- Export button for modified `.xcs`.
- Debug panel: generated path counts, segment counts, offsets, warnings.

The preview must make it visually obvious **which side** the widening lands on
before export.

## Testing

Vitest unit tests for the pure library (colocated `*.test.ts`):
- `flattenDPath` — M/L/Q/Z correctness, closed-path handling.
- `inferWindingAndOutside` — CW/CCW, side selection.
- `segmentContour` + `orderSegmentsInterlaced` — segment lengths, interlace
  stride picks non-adjacent first, alternate-pass reversal, stagger, no repeated
  start point.
- `generateOffsetStack` — offset is on the correct side; count derives from
  beam width × kerf.
- Round-trip: `parseXcsFile → buildGeneratedXcs → exportXcs` against
  `samples/xcs/incise_emboss.xcs` — asserts emboss/model preserved, source
  incise removed, generated INTAGLIO entries present in `device.data` Map in the
  correct order.

Canvas/preview verified manually in Chrome MCP per project convention (UI isn't
"done" at tsc + tests + build green).

## Out of scope (v1 / YAGNI)

- Final tuned laser parameters per stage (placeholders / copied from source).
- Backend persistence of strategies.
- Multi-incise simultaneous generation (one selected target at a time).
- The colour-window/parameter-prediction modelling from other pages.
