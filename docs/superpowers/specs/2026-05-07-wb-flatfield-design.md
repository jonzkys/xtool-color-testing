# WB Flat-Field via Perimeter Clean-Pass Strip — Design Spec

**Date:** 2026-05-07
**Status:** Approved (brainstorm); awaiting implementation plan
**Branch:** `feat/wb-flatfield` (worktree: `.worktrees/wb-flatfield`)
**Predecessor:** `feat/wb-calibration` (PR #71). This spec replaces that
approach. The previous branch is preserved on origin for reference.

## Summary

Burn a thin clean-pass strip around the perimeter of every test plate
— 4 line segments, one between each adjacent pair of registration
markers. At ingest, sample each strip's RGB at many points, pool
to four edge-mean anchors, and bilinear-interpolate a per-cell gain
across the colour grid. Multiplying each cell's measured RGB by that
gain neutralises both colour cast (camera-WB drift, lighting
temperature) AND spatial brightness variance (specular gradients,
flash falloff) that the prior chromaticity-only path couldn't touch.

Replaces the previous **3-coloured-calibration-patches + ceremony
wizard + canonical-RGB measurement flow** with a single per-material
setting (`clean_pass_params`) driving an automatic, every-test-plate
correction.

## Goals

- Cross-session colour consistency at the cell-sampling stage:
  the same engraved cell should produce the same hex/Lab regardless
  of which plate-shot it was sampled from.
- **Spatial correction** — the dominant noise on stainless is the
  specular highlight band crossing the plate. Edge-anchored
  flat-fielding lets that be detected and corrected, where
  chromaticity-only (a single global ratio) cannot.
- Zero per-material setup beyond a clean-pass recipe (which the
  user was filling in anyway). No ceremony, no wizard, no canonical-
  RGB measurement.
- Failure-tolerant: when fiducials or strips fail, fall back through
  chromaticity-only → skip exactly as today.

## Non-goals (v1)

- **No anchored mode.** Drops the 3-patch + canonical-RGB approach
  from the previous branch. Future could resurrect it for substrates
  where the perimeter approach genuinely doesn't deliver enough
  correction, but v1 commits to flat-field-only.
- **No higher-order interpolation** (RBF, thin-plate spline). Bilinear
  on 4 edge anchors is the v1 surface. Refine if observed noise
  warrants it.
- **No per-substrate canonical neutral library.** v1 ships with one
  hardcoded constant (derived from `samples/color/*` empirical work);
  per-material override is a follow-up.
- **No automatic backfill** of historic results. Users can re-shoot
  + re-ingest selectively via the existing button.

---

## Architecture

### High-level flow

```
[burn time]                                  [ingest time]

generate_gradient(material) ──▶ test plate    photo upload ──▶ decode + warp
       │                            │                                │
       ▼                            ▼                                ▼
  compute_layout                burn:                          fiducial detect
  + perimeter strip               • markers                        │
  emission                        • perimeter strip                ▼
                                  • colour grid                sample 4 strips
                                                              (~25 pts each)
                                                                    │
                                                                    ▼
                                                              pool → 4 edge means
                                                                    │
                                                                    ▼
                                                              bilinear flat-field
                                                                    │
                                                                    ▼
                                                              per-cell gain →
                                                              corrected swatch
```

### Vertical layout on the plate

```
y=0                                                       (top)
  ┌─────────────────────────────────────────────────────────┐
  │ [QR]                              [ArUco-TR]            │  marker row
  │      ── summary text (sweep / fixed / suffix) ──        │  summary band
  │      ──────── top perimeter strip ────────              │  strip band
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │ [colour grid]                                           │  the gradient
  │                                                         │
  ├─────────────────────────────────────────────────────────┤
  │      ──────── bottom perimeter strip ─────              │  strip band
  │ [ArUco-BL]                       [ArUco-BR]             │  marker row
  └─────────────────────────────────────────────────────────┘
                                                          (bottom)
```

Vertically along the left and right edges, the strip runs from below
the top marker to above the bottom marker, sitting in the existing
margin between markers and the grid edge.

The summary text and the top strip share the marker-row band but
do not overlap: summary text sits ABOVE the strip in burn-space (at
`y ≈ qr.y`), strip sits BELOW it (at `y ≈ qr.y + qr.size + margin`).

---

## Decisions taken

| # | Question | Decision | Why |
|---|---|---|---|
| Q1 | Replace 3-patch calibration with what? | **Perimeter clean-pass strip** (4 edges). | Multiple sample points around the plate let us interpolate spatial brightness variance — the dominant noise source on reflective substrates. The previous 3-patch approach measured colour cast only. |
| Q2 | Strip emit triggered when? | **Per-material `wb_supported` flag, default true.** | Reuses an existing column, gives the user opt-out for unusual substrates, doesn't require explicit per-material configuration for the common path. |
| Q3 | Strip width | **3 mm.** | Wide enough that a 1.5 mm interior sampling box has half a millimetre of clearance on each side, narrow enough to feel light. |
| Q4 | Sample density per strip | **~2 mm step → ~25 points for a 50 mm strip.** Each point: 1.5 mm interior box, top-25% specular reject. | Robust against single-pixel noise (fingerprint, scratch); each strip pools to one edge-mean RGB. |
| Q5 | Interpolation | **Bilinear on 4 edge anchors.** | Captures monotonic gradients in any direction. Fast, simple, well-understood. Higher-order is a v2 if needed. |
| Q6 | Canonical neutral | **One hardcoded RGB per substrate kind.** v1 ships with a stainless value (~`(160, 160, 145)` derived from existing `samples/color/*` empirical mean). | One number, easy to refine. Per-material override later if substrates with different reflectance need different anchors. |
| Q7 | Fallback cascade | **flat-field → chromaticity → skip.** | Same shape as before. ≥3 strips usable → flat-field; otherwise chromaticity-only on unburned-around-markers; otherwise raw. |

---

## Data model

### `materials` (additions — branch starts off main, no WB columns yet)

| Column | Action | Notes |
|---|---|---|
| `wb_supported` | **add** (Boolean, default `1`) | Opt-out for substrates that can't tolerate clean-pass (rare). |
| `clean_pass_params_json` | **add** (Text, nullable) | Single source of truth for the perimeter-strip burn parameters. NULL means "use the per-substrate default from `calibration_defaults.py`". |

### `results` (additions)

| Column | Status | New semantics |
|---|---|---|
| `wb_mode` | add (`String(16)`, nullable) | One of: `"flatfield"`, `"chromaticity"`, `"skipped"`, `"disabled"`. NULL on legacy rows. |
| `wb_anchor_rgb_json` | add (`Text`, nullable) | flat-field: list of 4 `[R, G, B]` (top, right, bottom, left in that order). chromaticity: single `[R, G, B]`. |
| `wb_correction_json` | add (`Text`, nullable) | flat-field: list of 4 `{x_mm, y_mm, R, G, B}` (anchor positions + measured RGBs, so the field can be re-derived offline). chromaticity: per-channel `[sR, sG, sB]`. |
| `wb_canonical_id` | add (`String(64)`, nullable) | Versioning hook — bump when the canonical neutral constant changes (e.g., `"v1.steel-default.2026-05-07"`). |

### Migration

`alembic/versions/0021_wb_flatfield.py` adds the 2 new material
columns + 4 new result columns. All nullable (or with sensible
server defaults), so legacy rows are valid without backfill. Bumps
CI head check from `0020` → `0021`.

---

## Algorithm — strip sampling + flat-field

```
input: warped_frame (BGR), marker positions, material clean-pass on
output: corrected_frame OR fallback to chromaticity / skip

1. Compute strip geometry from layout:
     top_strip:    line from QR.right_centre   → ArUco_TR.left_centre
     right_strip:  line from ArUco_TR.bottom   → ArUco_BR.top
     bottom_strip: line from ArUco_BR.left     → ArUco_BL.right
     left_strip:   line from ArUco_BL.top      → QR.bottom_centre
   Each strip carries its (x_start, y_start, x_end, y_end) in
   burn-space mm and a width of 3 mm.

2. For each strip:
     n_samples = ceil(strip_length_mm / 2.0)   # ~one sample per 2 mm
     for i in range(n_samples):
         t = i / (n_samples - 1)
         (cx, cy) = lerp((x_start, y_start), (x_end, y_end), t)
         px_box = 1.5 mm × 1.5 mm box centred on (cx, cy)
         pixels = warped_frame[px_box.y0:px_box.y1, px_box.x0:px_box.x1]
         lum = 0.299*R + 0.587*G + 0.114*B
         keep = pixels[lum <= percentile(lum, 75)]      # specular reject
         point_mean[i] = mean(keep, axis=0)             # (R, G, B)

     # Reject outliers > 2σ from the strip's per-channel mean
     edge_mean = mean(point_means without 2σ outliers, axis=0)
     edge_anchor[strip_id] = (anchor_x_mm, anchor_y_mm, edge_mean)

3. Count usable strips (those that produced a non-empty edge_mean
   — i.e., at least one sample point survived specular rejection):
     n_usable < 3  →  abort to chromaticity-only fallback
     n_usable ≥ 3  →  flat-field path. When exactly 3 strips usable,
                      synthesise the missing edge as the mean of the
                      remaining 3 so the bilinear blend has 4 anchors
                      to read from.

4. Bilinear flat-field across the grid bbox:
     For each cell at (cell_x_mm, cell_y_mm):
         interpolated_rgb = bilinear_blend(
             top, right, bottom, left, anchor positions,
             query_pos=(cell_x_mm, cell_y_mm),
         )
     gain_per_channel = canonical_neutral / interpolated_rgb
     # Cell sampling: when reading the cell's interior pixels,
     # multiply the measured RGB by gain (clipped to 0..255 in float
     # space, only quantised at the very end).

5. Persist: wb_mode="flatfield",
            wb_anchor_rgb_json=[top, right, bottom, left],
            wb_correction_json=[{x, y, R, G, B}, ...]   # 4 entries
```

### Bilinear blend (4 edge anchors)

Treat the grid bbox as a unit square (u, v ∈ [0, 1]) where:
- u = (cell_x - grid_x_min) / grid_w
- v = (cell_y - grid_y_min) / grid_h

The 4 edge anchors sit at the midpoints of each side:
- top:    (u=0.5, v=0)
- bottom: (u=0.5, v=1)
- left:   (u=0,   v=0.5)
- right:  (u=1,   v=0.5)

For a cell at (u, v), per-channel interpolation uses the standard
inverse-distance bilinear formulation:

```
horiz_lerp = (1 - u) * left + u * right
vert_lerp  = (1 - v) * top  + v * bottom
edge_rgb   = (horiz_lerp + vert_lerp) / 2
```

— that's a simple "cross" blend that gives equal weight to the two
nearer edges. Smoother than nearest-edge, simpler than full bilinear
in 2D (which would need corner anchors we don't have).

### Canonical neutral

For v1: hardcoded constant `(160, 160, 145)` — the cross-photo median
unburned-material RGB observed in the `samples/color/*` empirical
work, normalised to G=160. The actual chromatic ratio matches the
observed B/G ≈ 0.91 from that work.

Refinement path: per-substrate constant on the materials table,
defaulting to the global value. v2.

---

## Where it slots in

### Burn time (test plate emission)

`src/xcs_gen/generators.py::generate_gradient` gains a single
optional kwarg:

```python
perimeter_strip_params: ProcessingParams | None = None,
```

When non-None, `compute_layout` is called with `with_perimeter_strip
=True`, the resulting `layout.perimeter_strip` carries the 4 strip
geometries, and `render_perimeter_strip(...)` emits 4 `Rect`
elements (one per strip).

`src/xcs_gen_web/converter.py::project_to_xcs[_bytes]` looks up the
material's `clean_pass_params` (when `wb_supported` is true) and
threads it through.

### Ingest time

`src/xcs_gen_web/services/capture.py::run_capture` already calls
`compute_layout`. With `wb_supported`, it also gets the strip
geometry. After the warp, `correct_with_flatfield_or_fallback` runs:

```python
def correct_with_flatfield_or_fallback(
    frame_bgr,
    *,
    px_per_mm,
    perimeter_strips,        # list of {x0, y0, x1, y1, side: "top"|...}
    grid_bbox,               # (x_min, y_min, x_max, y_max) in mm
    canonical_neutral,       # (R, G, B)
    markers,                 # for chromaticity fallback
    enabled: bool,
) -> CorrectionOutcome:
```

Returns the same `CorrectionOutcome` shape as today (so
`update_wb_state` and downstream code don't need to change), with
`mode` ∈ `"flatfield" | "chromaticity" | "skipped" | "disabled"`.

### Storage

`update_wb_state` already accepts arbitrary `correction` and
`anchor_rgb` payloads — just JSON. No repo changes needed beyond
adapting the route's `wb` projection if helpful.

---

## UI surfaces (final shape)

| Surface | Change |
|---|---|
| `MaterialEditDialog` | Calibration section trims to: `wb_supported` toggle + clean-pass `BaseParamsEditor`. Drops the 3-patch list, the "Calibrate" button, and the wizard launcher. |
| `CalibrationWizard.tsx` | **Delete.** No more ceremony. |
| `ResultDebugDialog` | Keep the WB badge + diagnostic panel. Add `FLATFIELD` (green pill) as a new mode label. |
| `ResultDetailDialog` | Keep "Re-ingest with WB" button. |
| `StabilityPage` | Keep the A/B toggle. The reverse-apply helper grows a flatfield branch (per-cell inverse gain from the 4 stored anchors). Anchored branch stays for legacy data. |
| Calibration ceremony API routes | **Delete:** `POST /api/materials/{id}/calibration/test-xcs`, `POST /api/materials/{id}/calibration/measure`, `POST /api/materials/{id}/calibration/measure-photo`. |
| `GET/PATCH /api/materials/{id}/calibration` | Keep, but the response/body shrinks to `{wb_supported, clean_pass_params}`. |

---

## Tests

| Layer | File | Coverage |
|---|---|---|
| Pure functions | `src/xcs_gen_web/wb_correction.py` (rewritten) + `tests/test_wb_correction.py` (rewritten) | Bilinear edge-anchor interpolation. Specular-rejection on synthetic strips. ≥3-strips fallback boundary. Reverse-application of the gain (for the stability A/B path). |
| Layout | `src/xcs_gen/capture/layout.py` + `tests/test_capture_perimeter_strip.py` (renamed) | Strip positions match the inter-marker band. Strip lengths scale with grid size. Strip absent when `with_perimeter_strip=False`. |
| Marker render | `src/xcs_gen/capture/marker_render.py` | `render_perimeter_strip` emits 4 `Rect` elements at the right positions with the supplied params. |
| Live pipeline | `tests/test_capture_pipeline_wb.py` (adapted) | Synthetic warped frame with planted strip pixels → orchestrator picks flat-field. Strip pixels too low contrast → falls back to chromaticity. |
| Generator integration | `tests/test_generator_wb.py` (new, small) | `generate_gradient(perimeter_strip_params=…)` adds 4 Rects to the project; `=None` doesn't. |
| Repository | existing tests | Continue to round-trip the wb_* columns; no schema-shape changes beyond `wb_mode` value set. |

Acceptance fixture: re-shooting `samples/grey/in/IMG_788*` against
the new pipeline; cells should sample within ±2 RGB units of each
other across the 5 photos (current spread is much wider).

---

## File / module map

> Branch starts off `main`, where none of the prior WB-calibration
> code exists. Everything below is either NEW or EDITs on existing
> mainline files. There is nothing to delete from the mainline.

```
src/xcs_gen_web/
  wb_correction.py            NEW   flatfield_correct, chromaticity_correct,
                                    sampling helpers, orchestrator
  calibration_defaults.py     NEW   default_clean_pass(substrate)
  capture_pipeline.py         EDIT  add correct_with_flatfield_or_fallback +
                                    low-contrast preprocessing variant for stainless
  services/capture.py         EDIT  sample 4 edges from layout.perimeter_strip,
                                    persist edge means + positions, run flat-field
  services/xcs.py             EDIT  look up material's clean_pass_params + wb_supported,
                                    plumb to project_to_xcs_bytes
  converter.py                EDIT  add calibration_by_material_id kwarg, plumb
                                    perimeter_strip_params into generate_gradient
  schemas.py                  EDIT  add MaterialCalibrationConfig (wb_supported +
                                    clean_pass_params), ResultWBState; extend
                                    MaterialResponse + ResultResponse
  app.py                      EDIT  add GET/PATCH /api/materials/{id}/calibration
                                    (slim shape: wb_supported + clean_pass_params),
                                    pass through wb in _result_to_response
  repositories/materials.py   EDIT  read/write 2 new columns + update_material_calibration
                                    helper
  repositories/results.py     EDIT  read/write 4 new columns + nested wb dict in _row +
                                    update_wb_state helper

src/xcs_gen/capture/
  layout.py                   EDIT  add PerimeterStrip dataclass, with_perimeter_strip
                                    kwarg + position math
  marker_render.py            EDIT  add render_perimeter_strip (4 Rect emit)

src/xcs_gen/
  generators.py               EDIT  add perimeter_strip_params kwarg, emit strip when
                                    set, push gradient_start_y so summary text clears
                                    the strip band

alembic/versions/
  0021_wb_flatfield.py        NEW   add 2 cols on materials + 4 cols on results

.github/workflows/ci.yml      EDIT  bump alembic head check 0020 → 0021

web/src/
  components/MaterialEditDialog.tsx   EDIT   add Calibration section
                                              (wb_supported toggle + BaseParamsEditor)
  components/BaseParamsEditor.tsx     NEW    extracted from existing inline editors
  components/WBBadge.tsx              NEW    pill: FLATFIELD / CHROMA / RAW / DISABLED
  components/ResultDebugDialog.tsx    EDIT   render WBBadge + diagnostic panel
  components/ResultDetailDialog.tsx   EDIT   "Re-ingest with WB" button
  pages/StabilityPage.tsx             EDIT   A/B toggle + reverse-apply (flatfield branch)
  api/wbCalibration.ts                NEW    getMaterialCalibration,
                                              patchMaterialCalibration, reingestResult
  types.ts                            EDIT   add MaterialCalibrationConfig,
                                              ResultWBState, extend Material + Result

tests/
  test_wb_correction.py            NEW   chromaticity, flat-field, fallback cascade,
                                          edge-anchor interpolation
  test_capture_perimeter_strip.py  NEW   layout positions, render_perimeter_strip
  test_capture_pipeline_wb.py      NEW   pipeline wrapper + flat-field on synthetic frame
  test_calibration_defaults.py     NEW   default_clean_pass(substrate)
  test_materials_calibration_api.py NEW  GET/PATCH calibration round-trip
  test_results_reingest_api.py     NEW   reingest route 404 + happy path
  test_generator_wb.py             NEW   perimeter_strip_params plumbs through to project
  test_capture_pipeline.py         EDIT  bump _preprocessing_variants count test

changelog/
  2026-05-07-wb-flatfield.md      NEW   minor-level entry
  changelog/images/wb-flatfield-hero.png  NEW
```

---

## Open / followup items (out of scope)

- **Per-substrate canonical neutral library.** v1 ships one constant
  for stainless. Other substrates (anodised, brass, coloured anodise)
  with different reflectance characteristics need their own anchor.
- **Higher-order interpolation.** Thin-plate spline or RBF on more
  sample points per strip if the bilinear flat-field misses
  curvature in real photos. Implementation surface is small; deferred
  until measured needed.
- **Per-cell quality flag.** When the interpolation gain at a cell
  is above 2× or below 0.5×, that cell's reading is suspect — the
  gain extrapolated past what the perimeter could constrain. Could
  flag those swatches in the result UI.
- **Anchored mode resurrection.** If we find materials where the
  perimeter approach genuinely doesn't deliver enough correction,
  the `feat/wb-calibration` branch is preserved on origin for
  comparison.
- **Drift dashboard.** Histogram of per-result edge-mean RGBs across
  recent ingests would surface "the bulb has changed colour" or
  "camera has fogged" kinds of degradation.
