# Pixel Art — Neighbouring-Cell Merge (single-shape output)

**Date:** 2026-06-03
**Status:** Approved (brainstorm); awaiting implementation plan
**Branch:** `feat/pixel-art-cell-merge`
**Builds on:** `docs/superpowers/specs/2026-05-03-pixel-art-design.md`

## Summary

The Pixel Art page currently exports **one rectangle per cell**
(`PixelArtPage.tsx` — *"One PixelArtRectSpec per cell (not merged)"*).
The backend groups those rects by colour into one compound `Path` per
colour layer, so a solid 50×50 block of one colour ships as **2,500
abutting square subpaths**. In an editor (and on the laser's vector
view) those internal cell seams are real geometry — the user sees a
grid of squares, not a shape.

This change merges contiguous same-colour cells into a **single clean
outline per connected region** (a rectilinear polygon, with holes
handled by `evenodd`). The grid of squares collapses into the actual
shapes the picture is made of, with far fewer vertices.

The merge logic was *designed into* the original spec ("after quantise +
rect-merge") and a greedy implementation (`greedyRectCover` / `capFit`)
was even written and tested — but the shipped code solved XCS's
~750-display-element cap a different way (one compound `Path` per
colour), so the merge was left unwired and `greedyRectCover` is dead
code today. We replace that dead code with a true contour trace; greedy
rectangles were rejected because abutting rectangles still leave seams
(see "Decisions taken" Q1).

## Goals

- Each connected region of a colour becomes **one merged outline** —
  no internal cell seams. The literal "single shape" the user asked for.
- Dramatically fewer subpaths / vertices per layer → smaller `.xs`/`.xcs`,
  snappier in xTool Studio, cleaner vector geometry.
- Show the effect **in-app** before download: a stat readout and a
  "Shapes" preview view that strokes the merged outlines.
- Keep `.xcs` and `.svg` output identical-by-construction (one geometry
  source).

## Non-goals

- **No change to quantisation, palette match, crop, materials, or the
  layer panel's existing controls.** Only the geometry of the export +
  its preview/affordances change.
- **No persistence** — unchanged from the page's v1 design (reload =
  start over), so the request-schema change needs no migration or
  back-compat shim.
- **No greedy-rectangle fallback mode.** One merge algorithm (contour),
  one toggle (on/off). Greedy rects don't meet the "single shape" goal.
- **No curve fitting / smoothing of the staircase outline.** Merged
  outlines follow the pixel boundary exactly (axis-aligned steps). A
  smoothing pass is a possible followup, not this change.

---

## Decisions taken

| # | Question | Decision | Why |
|---|---|---|---|
| Q1 | Greedy rectangles or true contour? | **Contour trace** — boundary-walk each colour's cell-mask into closed loops. | Greedy rects tile a region with several abutting rectangles; the shared edges are still real geometry → still a grid, not "one shape". Contour gives a single outline per region. |
| Q2 | On by default, or opt-in? | **Toggle "Merge cells", default ON.** | Strictly better output for a `COLOR_FILL_ENGRAVE`, so default on; toggle gives an A/B + an escape hatch for any pathological image. |
| Q3 | How much in-app feedback? | **Stat readout + a `[ Fill ] [ Shapes ]` preview view.** | The flat colour fill looks identical merged or not; the user needs to *see* outlines to trust the toggle without round-tripping through xTool. |
| Q4 | Diagonal (checkerboard) pinch — merge or split? | **4-connected foreground (split).** Corner-only-touching cells stay separate shapes. | Avoids self-touching / zero-width-pinch polygons that some fill engines and the laser path-planner handle poorly. |
| Q5 | Where does the merge run? | **Frontend** (`pixelArtMath.ts`). Backend becomes a thin serialiser. | The "Shapes" preview needs the loops in the browser anyway; computing once on the FE feeds both preview and export, and unifies the two backend serialisers. |
| Q6 | Schema shape | **Replace `rects` with `shapes` (per-colour `loops`).** | No persistence ⇒ a clean rename is fine (CLAUDE.md: no compat shim until code is in users' hands). Loops are the natural unit for both merge-on and merge-off. |
| Q7 | Changelog level | **Major + before/after screenshot.** | Visually compelling change to an existing flagship page. |

---

## Architecture

```
image → sample → k-means (Lab) → labels[]    ← UNCHANGED
                                     │
                                     ▼
   pixelArtMath.cellsToLoops(labels, cols, rows)   ← NEW (contour trace)
                                     │  Map<label, Loop[]>   (Loop = [col,row] corners)
                    ┌────────────────┼─────────────────────┐
                    ▼                ▼                     ▼
        Shapes preview overlay   buildRequest()       stat readout
        (stroke loops, SVG)      (scale → mm,         (cells → shapes·verts)
                                  one PixelArtShapeSpec
                                  per enabled colour)
                                     │
                                     ▼
                    POST /api/pixel-art  /  /svg
                                     │
                                     ▼
        pixel_art_converter  → one Path per colour from provided loops
        (thin serialiser; XCS translates by start_x/y, SVG 0-based)
```

The geometry algorithm has exactly one home (`pixelArtMath.ts`) and one
consumer contract (`loops` in local mm). Preview, `.xcs`, and `.svg` all
derive from the same loops, so they cannot drift.

---

## The contour algorithm — `cellsToLoops`

`web/src/components/pixelArtMath.ts` (pure; replaces `greedyRectCover` +
`capFit`).

```
cellsToLoops(labels: number[], cols: number, rows: number)
  → Map<number, Loop[]>          // label → list of closed loops
type Loop = Array<[number, number]>   // integer corner coords in cell units
```

Per enabled label (`labels[i] >= 0`):

1. **Edge collection.** For each inside cell, emit a unit boundary edge
   on any of its 4 sides where the neighbour is a *different* label,
   a skip cell (`-1`), or the grid edge. Edges are emitted **directed**
   so the inside is consistently on one side (e.g. inside-on-left) — this
   is what lets the stitch produce correctly-wound loops.
2. **Stitch into loops.** Index edges by their start corner; walk
   start→end repeatedly to form closed loops, consuming edges as used.
   At a corner where 4 boundary edges meet (a diagonal **pinch**),
   choose the outgoing edge by a fixed turn rule that keeps the
   **foreground 4-connected** → the two diagonal cells resolve into two
   separate loops, never a self-touching polygon.
3. **Collapse colinear vertices.** Drop any vertex whose two incident
   segments are colinear. A 1×50 strip → 4 corners, not 200.
4. Internal boundaries are collected the same way as outer ones, so a
   ring-shaped region yields an outer loop **and** a hole loop; `evenodd`
   fill (already used) renders the hole with no winding bookkeeping.

Complexity: O(cells) edge collection + O(edges) stitch per grid; well
under the existing pipeline budget even at `MAX_GRID_CELLS = 65536`.

**Merge OFF** path: instead of `cellsToLoops`, emit one 4-corner square
loop per enabled cell. Same `Loop[]` output type ⇒ identical downstream
code (request builder, backend, preview), so the backend never learns
whether geometry was merged.

---

## Data contract

`src/xcs_gen_web/schemas.py`:

- **Remove** `PixelArtRectSpec`. **Add** `PixelArtShapeSpec`:
  - `color: str` — centroid hex (layer key), as today.
  - `loops: list[list[tuple[float, float]]]` — closed loops, points in
    **local mm** (0-based, matching today's rect coordinates). A loop is
    implicitly closed (last point → first).
- `PixelArtRequest.rects` → `PixelArtRequest.shapes: list[PixelArtShapeSpec]`.
  Everything else (`layers`, `width_mm`, `height_mm`, `start_x/y`,
  `cell_mm`, `name`, `material_id`, `format`) is unchanged.

Frontend types (`web/src/types.ts` — `PixelArtRectSpec` at L532,
`PixelArtRequest.rects` at L548) mirror the rename.

---

## Backend serialiser — `pixel_art_converter.py`

`build_pixel_art_project` and `pixel_art_to_svg` are rewritten to consume
`shapes` instead of `rects`:

- Group is no longer needed — each `PixelArtShapeSpec` is already one
  colour. For each shape whose colour maps to an **enabled** layer:
  - Build `d` by joining, per loop, `M x,y L x,y … Z` (translate every
    point by `start_x/start_y` for XCS; **0-based** for SVG — preserving
    today's behaviour where the SVG `viewBox` is `0 0 w h`).
  - One `Path` per colour: `is_close_path=True`,
    `is_compound_path = total_loops > 1`, `fill_rule="evenodd"`,
    `processing_type="COLOR_FILL_ENGRAVE"`, `layer_color=color`, bbox
    (`x/y/width/height`) from the min/max of all loop points.
- Empty result (no enabled shapes) → same `ValueError` as today.

No route changes; `pixel_art_to_xcs_bytes` / the `/api/pixel-art` +
`/api/pixel-art/svg` handlers are untouched.

---

## UI

- **"Merge cells" toggle** — in `PixelArtLayerPanel.tsx` (action row,
  near the existing controls), default **ON**. Drives whether
  `buildRequest` uses `cellsToLoops` or per-cell square loops, and which
  geometry the preview/stat reflect.
- **Bottom-preview view toggle** `[ Fill ] [ Shapes ]` in
  `PixelArtCanvas.tsx`:
  - *Fill* — today's flat-colour canvas (`putImageData`), unchanged.
  - *Shapes* — the same flat canvas **plus** an absolutely-positioned
    SVG overlay (sized to the canvas) that strokes each enabled colour's
    merged loops with a thin accent line. Only enabled colours are
    stroked (matches what exports). The overlay consumes the same
    `Map<label, Loop[]>` as the export.
- **Stat readout** — replace today's "one rect per enabled cell" line
  with `{cells} cells → {shapes} shapes · {verts} verts`, where
  `shapes` = total merged loop count across enabled colours and `verts`
  = total loop vertices. Shows the win at a glance.

---

## Tests

| Layer | File | Coverage |
|---|---|---|
| Contour core | `web/src/components/pixelArtMath.test.ts` | solid grid → 1 loop / 4 verts; L-shape → 1 loop / 6 verts; ring → 2 loops (outer + hole); 1×N strip → 4 verts (colinear collapse); checkerboard of a label → N separate single-cell loops (no diagonal merge); corner-pinch (2 diagonal cells) → 2 loops; skip cells (`-1`) excluded. |
| Request builder | existing `PixelArtPage.test.tsx` | merge ON → `shapes[].loops` are merged; merge OFF → one square loop per enabled cell; disabled colour omitted; mm scaling by `cellMm`. |
| Backend converter | `tests/` (pixel-art converter test) | `shapes` → one `Path` per colour, correct `d`, `evenodd`, `is_compound_path`, bbox; start offset applied for XCS, **not** SVG; disabled layer dropped; empty → `ValueError`. |
| Canvas/UI | `PixelArtCanvas.test.tsx` | Fill/Shapes toggle renders overlay only in Shapes; overlay strokes only enabled colours; stat readout text. |
| Manual (CLAUDE.md rule) | Chrome MCP | Load page, upload a photo, screenshot **Fill vs Shapes**, confirm the grid collapses into clean outlines; spot-check a downloaded `.svg`. |

---

## File / module map

```
web/src/components/
  pixelArtMath.ts          EDIT  + cellsToLoops; − greedyRectCover, capFit, CoverRect, CapFitResult
  pixelArtMath.test.ts     EDIT  contour tests in, greedy/capfit tests out
  PixelArtCanvas.tsx       EDIT  [ Fill ] [ Shapes ] view + SVG outline overlay
  PixelArtLayerPanel.tsx   EDIT  "Merge cells" toggle (default on)
  PixelArtCanvas.test.tsx  EDIT  toggle + overlay coverage

web/src/pages/
  PixelArtPage.tsx         EDIT  buildRequest → loops; thread mergeEnabled + view state; stat readout
  PixelArtPage.test.tsx    EDIT  request-builder coverage

web/src/
  types.ts                 EDIT  PixelArtRectSpec → PixelArtShapeSpec; PixelArtRequest.rects → shapes
  generate.ts              NO CHANGE  (pixelArtAndDownload / pixelArtSvgAndDownload take PixelArtRequest as-is)

src/xcs_gen_web/
  schemas.py               EDIT  PixelArtRectSpec → PixelArtShapeSpec; request.rects → shapes
  pixel_art_converter.py   EDIT  serialise loops (XCS + SVG)

tests/
  test_pixel_art_*.py      EDIT  shapes-based fixtures

changelog/
  2026-06-03-pixel-art-cell-merge.md   NEW  major, before/after image
  images/pixel-art-merge-*.png         NEW

alembic/                   NO CHANGE   (no DB / no migration / no CI version bump)
```

After `web/src/**` edits: `cd web && npm run build` (the backend serves
`web/dist/`, not the Vite dev server).

---

## Followups (out of scope)

- **Outline smoothing** — optional pass to round/round-off the staircase
  boundary (e.g. corner-cut or curve fit) for organic shapes.
- **Per-shape stats in the layer panel** — show merged-shape count per
  colour row, not just the global total.
- **Greedy-rect mode** — only if a user surfaces a case where rectangle
  tiling beats a single contour (none anticipated for fill engrave).
