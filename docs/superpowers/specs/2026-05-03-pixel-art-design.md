# Pixel Art — Design Spec

**Date:** 2026-05-03
**Status:** Approved (brainstorm); awaiting implementation plan
**Branch:** TBD (separate from `feat/saved-spectrums`)

## Summary

Add a new page at `#/pixel-art` that decomposes a raster image into a grid
of calibrated, palette-matched rectangles for laser engraving. The user
chooses a material, crops their image to that material's aspect, picks a
grid resolution, and gets a live preview where every cell is one of ≤K
quantised colours. The output is an `.xcs` file (one `Rect` element per
merged rectangle) plus a paired `.svg`.

## Goals

- Give users a way to engrave raster artwork (photos, logos, retro art)
  using the same calibrated-palette workflow that powers SVG Layers.
- Respect XCS's hard ~750-display-element cap *visibly* — surface the
  constraint as a warning the user can resolve in one click, never a
  silent failure.
- Reuse existing primitives (palette match flow, `MergeColorsDialog`,
  materials picker, `Rect` model element) instead of forking them.

## Non-goals (v1)

- **No persistence.** Reload = start over. Mirror SvgLayers; if Saved
  Spectrums proves out for that page, this one comes along.
- **No per-cell editing.** Quantisation is fully driven by sliders + the
  layer panel. No click-a-cell-to-repaint Photoshop-lite mode.
- **No advanced processing types.** Pixel rects are always
  `COLOR_FILL_ENGRAVE`. No hatched-lines, vector-cut, or per-layer scan
  angle. Pixel art is a different medium from vector layers; exposing
  those controls is a footgun on a 1mm rect.
- **No bit-depth / palette-snap mode.** Considered and rejected for v1
  (see "Decisions taken" below). Adaptive k-means + auto-match keeps the
  page useful when the user's palette is sparse, which is the realistic
  starting state.
- **No Guide page entry.** Followup, not blocker.

---

## Decisions taken

| # | Question | Decision | Why |
|---|---|---|---|
| Q1 | How does the user dial in the pixel grid? | **Linked controls** — slider for cells-across, number-input for cell size in mm; changing one updates the other live. Floor at `2 × max(spot_w, spot_h)` for the active machine's laser. | Both numbers are first-class info for laser users; the dual-display rhythm matches Loom. |
| Q2 | How does the image map to the material rect? | **Material WxH + crop overlay** locked to the material's W:H aspect. Selecting a Material from the library prefills WxH (`materials.shape='rect'` carries `width_mm`/`height_mm`). Cells stay square inside the crop. | Pixel art is fundamentally about a physical canvas you've already chosen; a crop tool composes the image into it cleanly. |
| Q3 | What happens when the project would exceed the 750-rect cap? | **Auto-fit, opt-in.** Default K=8. After quantise + rect-merge, if rect-count > 750, show a warning with one-click "Auto-fit to cap" CTA that drops K by 1 and re-runs until under cap (or K=2). Hard error at K=2 still over: "image too detailed — increase cell size." | Workshop-instrument aesthetic: show the gauge, let the user pull the lever. Silent reduction can mask a bad image choice. |
| Q3a | Quantisation algorithm | **k-means in CIE Lab**, k-means++ init, 30-iter cap or ε-convergence on centroid Lab. | Perceptually accurate (Lab matches `deltaE2000` already in `web/src/color/math.ts`); handles photos better than median cut; ~30-50ms typical. |
| Q4 | How much of the SvgLayers panel do we duplicate? | **Simplified panel** — per-colour: enabled toggle, swatch + hex + area %, palette-entry match (with override), material/preset override. No processing-type picker, no hatch passes editor, no scan angle. Always `COLOR_FILL_ENGRAVE`. | Pixel rects don't make sense with hatched lines or vector cuts. Smaller surface = fewer mis-configurations. |
| Q4a | What does "disabled layer" mean? | **Skip-engrave.** Cells assigned to a disabled layer become blank space in the output — the material's natural colour shows through. | Natural support for "use material colour as background" (e.g., dropping the sky-blue layer in a 8-bit-game-style export). Auto-bucket-down (Q3) handles "this colour is too small to matter". |
| Q5 | What interaction beyond declarative inputs? | **Add manual similarity-%-merge** (port `MergeColorsDialog` from SvgLayers). No per-cell editing. | k-means can produce two centroids that are perceptually identical (deltaE ≈ 3-4); the slider lets the user collapse them in one move. Per-cell editing is Photoshop-lite — too much state for v1. |
| Q5a | Persistence v1? | **None** — same as SvgLayers. | Saved Pixel Art is a meaningful followup if usage warrants. |
| Q5b | Image format inputs? | **PNG / JPG / WebP / GIF** (decode first frame). Alpha channel: cells with mean alpha < 30 are tagged "skip" before quantisation. | Logo-on-transparent-bg engraves only the logo. Small extra work, big quality-of-life win. |

---

## Page layout (`web/src/pages/PixelArtPage.tsx`)

Three-pane workshop layout, mirroring `SvgLayersPage` and `LoomPage`:

**Left — Project + grid + palette controls:**
- Project name (filename stem on download).
- Material picker (existing `MaterialPresetPicker` style); selecting a
  material populates `width_mm`, `height_mm`, and shows the laser
  min-cell floor inline.
- **Grid:** linked controls — cells-across slider AND cell-mm number
  input; either updates the other. Floor enforced.
- **Palette:** max-K slider (default 8). Below it, the rect-cap warning
  appears only when post-merge rect count exceeds 750, with an
  "Auto-fit to cap" button.

**Centre — synced canvases:**
- **Top:** Original image with a draggable, aspect-locked crop frame.
  Corner handles to resize (aspect locked); body-drag to pan.
- **Bottom:** Pixelated preview. Internal coordinates are mm (the canvas
  is rendered with a `viewBox` of `0 0 width_mm height_mm`); the preview
  scales to fit the centre pane. Header strip shows live
  `cells × cells · K colours · N rects after merge`. Redraws on every
  input change (debounced ~50ms).

**Right — Colour layers:**
- One row per quantised centroid, ranked by area %.
  - enabled checkbox
  - swatch + hex + area %
  - matched palette entry subtext (or "→ pick palette ▸" if unmatched)
  - per-row ⋯ menu: re-pick palette entry, override material/preset
- Disabled rows render dimmed with "skip-engrave (background)" subtext.
- Bottom actions:
  - **Merge…** — opens the existing `MergeColorsDialog` (similarity-%
    threshold).
  - **Match all** — re-runs auto-match against current palette
    (useful after the user adds new entries mid-flow).
  - **Download .xcs** / **Download .svg** — issue the two POSTs below.

A wireframe of this layout was reviewed during brainstorming — see
`.superpowers/brainstorm/<session>/content/page-layout.html` if the
session is still archived.

---

## Pipeline / data flow

```
                                          ┌── ImageBitmap ──┐
[Image upload] ─► decode ─────────────────┤                 │
                                          │ OffscreenCanvas │
[Material + crop frame] ──┐               └─────────────────┘
[Cells-across slider]     │  on change (debounced ~50ms):
[Max-K slider]            │
                          ▼
   (a) sample crop at grid resolution → mean RGB per cell
       (alpha < 30 ⇒ "skip" sentinel)
   (b) k-means in CIE Lab on cell colours → label per cell
   (c) greedy max-rectangle covering of same-label cells
       → output rectangles in cell coords
   (d) cell_xy × cell_mm → mm-space rectangles
   (e) if rect-count > 750: enable "Auto-fit to cap" warning state

[Preview canvas] ◄── paint mm-space rects with centroid colours
[Layer panel]    ◄── swatches/areas/match-state from labels + centroids

[Download .xcs]  ─► POST /api/pixel-art        ─► .xcs bytes
[Download .svg]  ─► POST /api/pixel-art/svg    ─► .svg text
```

The backend never sees the image — the rect list is the wire format.
Server CPU stays low; live preview is automatic.

---

## Wire format (FastAPI schemas)

Add to `src/xcs_gen_web/schemas.py`:

```python
class PixelArtLayerSpec(BaseModel):
    color: str                       # hex; key referenced by rects
    enabled: bool
    base_params: BaseParams
    material_id: Optional[str] = None
    palette_entry_id: Optional[int] = None  # audit/debug only

class PixelArtRectSpec(BaseModel):
    x: float                         # mm, bed-space (relative to crop origin)
    y: float
    width: float
    height: float
    color: str                       # references a layer by hex

class PixelArtRequest(BaseModel):
    name: str
    material_id: str                 # bound material for this project
    width_mm: float                  # cropped engraving width on bed
    height_mm: float
    start_x: float
    start_y: float
    cell_mm: float                   # informational only
    rects: list[PixelArtRectSpec]
    layers: list[PixelArtLayerSpec]
```

Mm-space on the wire (not cell-coords) so the backend has no cell-grid
context to keep in mind. `cell_mm` is informational only — useful for
debug logs and changelog entries.

---

## Backend converter

New module: `src/xcs_gen_web/pixel_art_converter.py` (~80 lines). Mirrors
`svg_layers_converter.py`: `build_*_project` returns the populated
`XCSProject`; a `*_to_xcs_bytes` wrapper runs `build_xcs` + `json.dumps`.

```python
def build_pixel_art_project(req: PixelArtRequest) -> XCSProject:
    enabled = {l.color: l for l in req.layers if l.enabled}
    project = XCSProject()
    for r in req.rects:
        layer = enabled.get(r.color)
        if layer is None:
            continue                      # skip-engrave
        project.elements.append(Rect(
            x=req.start_x + r.x,
            y=req.start_y + r.y,
            width=r.width,
            height=r.height,
            params=_to_processing_params(layer.base_params),
            processing_type="COLOR_FILL_ENGRAVE",
            layer_color=r.color,
        ))
    if not project.elements:
        raise ValueError("No enabled rects — enable at least one colour.")
    return project


def pixel_art_to_xcs_bytes(req: PixelArtRequest) -> bytes:
    project = build_pixel_art_project(req)
    return json.dumps(build_xcs(project), separators=(",", ":")).encode("utf-8")


def pixel_art_to_svg(req: PixelArtRequest) -> str:
    """Serialise the (already-merged) rects to a standalone SVG."""
    enabled = {l.color for l in req.layers if l.enabled}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {req.width_mm} {req.height_mm}" '
        f'width="{req.width_mm}mm" height="{req.height_mm}mm">'
    ]
    for r in req.rects:
        if r.color not in enabled:
            continue
        parts.append(
            f'<rect x="{r.x}" y="{r.y}" width="{r.width}" '
            f'height="{r.height}" fill="{r.color}"/>'
        )
    parts.append("</svg>")
    return "".join(parts)
```

Two new routes added directly to `src/xcs_gen_web/app.py` (alongside the
48 existing `@app.post` handlers; this codebase doesn't yet split into
routers — keep the convention):

- `POST /api/pixel-art` → returns `.xcs` bytes; `Content-Disposition`
  uses `request.name`. Mirrors `/api/svg-layers`.
- `POST /api/pixel-art/svg` → returns `.svg` text. The `fill` on each
  `<rect>` is the centroid hex (the layer key), **not** the matched
  palette entry's colour — the SVG is meant as a faithful preview of
  the pixelation, with laser params living in the `.xcs`.

---

## Algorithms (the three real ones)

| Algorithm | Where | Notes |
|---|---|---|
| **k-means in CIE Lab** | browser, ~30-50ms | k-means++ init; 30-iter cap or ε-convergence on centroid Lab. Reuses `web/src/color/math.ts::hexToLab` + `deltaE2000`. |
| **Centroid → palette entry auto-match** | browser, instant | `deltaE2000` lookup pattern from `SvgLayersPage`. Closest entry within active machine's palette wins; user can override. |
| **Greedy max-rectangle covering** | browser, ~5-15ms | For each label: scan grid for the largest uncovered rectangle of that label; emit; mark covered; repeat. Near-optimal for typical pixel art (large flat regions cover in 1-2 rects). |
| **Cap-fit fallback** | browser, on demand | If output rect-count > 750 and user clicks Auto-fit: drop K by 1, re-run from k-means; loop until under cap or K=2. If K=2 still over: hard error "image too detailed — increase cell size." |

---

## Tests

| Layer | File | Coverage |
|---|---|---|
| Backend converter | `tests/test_pixel_art_converter.py` | Fixed `(rects, layers)` → expected `Rect` count, `processing_type`, `layer_color`. Skip-engrave: disabled layer → its rects dropped. Beam-width validator wired. Mm-space arithmetic with `start_x/start_y` offsets. |
| Backend route | `tests/test_pixel_art_route.py` | `POST /api/pixel-art` returns valid `.xcs` bytes; `POST /api/pixel-art/svg` returns parseable SVG with the expected `viewBox` + rect count + fill colours. |
| Frontend logic | `web/src/components/pixelArtMath.test.ts` | k-means convergence on a small fixture grid; rect-merge correctness on hand-labeled grids (single-colour grid → 1 rect; checkerboard → cells equal in count); cap-fit loop terminates at K=2. |
| E2E (Playwright) | added to existing harness | Upload → adjust grid → match palette → download `.xcs` golden path. Same shape as the SvgLayers regression run. |

---

## Navigation, changelog, copy

- **Route:** add `pixel-art` to `web/src/router.ts` (alongside `loom`,
  `svg-layers`).
- **TopBar:** insert between SVG Layers and Spectrum.
- **Page name:** "Pixel Art".
- **Changelog:** major-level `changelog/2026-MM-DD-pixel-art.md` with a
  hero screenshot of the page in action. Workshop-instrument register —
  active verbs, concrete numbers (e.g. "Decomposes a raster into ≤K
  calibrated colour rects, capped under XCS's 750-element budget.").
  Drop the screenshot in `changelog/images/`.
- **Guide page entry:** deferred to a followup PR.

---

## File / module map

```
src/xcs_gen_web/
  pixel_art_converter.py      NEW   build_pixel_art_project, pixel_art_to_xcs_bytes, pixel_art_to_svg
  schemas.py                  EDIT  add 3 PixelArt* models
  app.py                      EDIT  register POST /api/pixel-art and /api/pixel-art/svg (no routers/ split)

web/src/pages/
  PixelArtPage.tsx            NEW   the page component

web/src/components/
  PixelArtCanvas.tsx          NEW   crop + preview canvases (split or one component, TBD in plan)
  PixelArtLayerPanel.tsx      NEW   right-side panel (re-uses MergeColorsDialog, palette UI)
  pixelArtMath.ts             NEW   k-means, rect-merge, cap-fit (pure functions)
  pixelArtMath.test.ts        NEW   vitest

web/src/
  router.ts                   EDIT  add 'pixel-art' route
  components/TopBar.tsx       EDIT  add nav entry
  generate.ts (or sibling)    EDIT  add postPixelArtGenerate / postPixelArtSvg

tests/
  test_pixel_art_converter.py NEW
  test_pixel_art_route.py     NEW

changelog/
  2026-MM-DD-pixel-art.md     NEW
  images/pixel-art-hero.png   NEW

alembic/                      NO CHANGE   (no DB)
```

No DB migrations — no persistence in v1 means no schema work, which
also means no CI alembic-version bump per the gotcha in `CLAUDE.md`.

---

## Open / followup items (out of scope)

- Saved Pixel Art (DB-backed persistence) — pair with the planned Saved
  SvgLayers work.
- Bit-depth / palette-snap mode — interesting alternative if we observe
  users wanting to engrave directly from their calibrated palette
  without the centroid step. Rejected for v1 because it requires a
  populated palette.
- Per-cell repaint editor — only if usage shows users wanting it.
- Guide page entry — followup PR, doesn't block ship.
