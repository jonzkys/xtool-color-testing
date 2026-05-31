# Relief Depth-Map Smoothing — Design

**Status:** approved design, pre-implementation
**Date:** 2026-05-31
**Branch:** `feat/relief-depth-smoothing`

## 1. Goal

Take a grayscale **depth map** and smooth it so it engraves cleanly — killing
pixel-level noise and over-sharp transitions — **while preserving legitimate
sharp drops**. The output is a cleaned grayscale heightfield (Phase 1) and,
later, a generated `.xcs` relief job (Phase 2).

## 2. The engraving model (why this is "just" heightfield cleanup)

The xTool machine maps a grayscale image's `0–255` onto *N* pass-levels
**natively**: depth = how many times it re-passes a pixel, all passes share the
same params, with an optional Z descent every *X* layers. We do **not** decide
per-layer params or slice anything — the machine does. **Our only job is to
produce a clean grayscale heightfield** plus the pass-through *N* / Z-descent
settings. "Roughness between layers" is therefore overwhelmingly *input noise
crossing the machine's quantization thresholds* — clean the field and the
banding/speckle goes with it.

## 3. The three artifacts (what we're fixing)

```
1-D slice through the depth map (height = pass count):

(a) PIXEL OSCILLATION      (b) BOUNDARY ALIASING        (c) OVER-SHARP RISER
 ▁▇▂▇▁▇▂                    gentle ramp crossing a        near-vertical wall with
 single-pixel up/down       quantize line → jagged        no flat "tread" → engraves
 spikes → pit/bump          terrace edge + speckle        rough. ≠ a *legitimate*
 surface = rough            where pixels straddle it      sharp drop, which we KEEP
```

- **(a)** = high-frequency noise / single-pixel spikes → median pre-pass.
- **(b)** = mostly a consequence of (a)+(c); a clean field quantizes cleanly.
- **(c)** = protected by the **guard rail**: a large change echoed by neighbours
  along a contour is a real edge (keep); a large change isolated to one pixel is
  a spike (remove).

## 4. Scope

**Phase 1 (this spec's primary deliverable).** A new **Relief** page: import a
grayscale depth map → tune smoothing with a live before/after + 3D preview →
**export the cleaned grayscale PNG**. Backend does the smoothing (OpenCV).

**Phase 2 (designed here, built after Phase 1 lands).** Emit an `.xcs` directly
with the cleaned image as a `RELIEF` BITMAP object + pass-through `zLayers` /
`zDecline`. **Feasibility confirmed** (§10) — the BITMAP + RELIEF infrastructure
already exists.

**Non-goals / parked (§14):** layer-aware label-space cleanup, TV/L0 "stylized"
mode, browser-worker preview.

## 5. Architecture

```
┌─ Browser (Relief page) ───────────────┐      ┌─ Backend (FastAPI) ──────────┐
│ upload depth map → ImageBitmap+canvas │      │ POST /api/relief/smooth      │
│                                       │      │  multipart: file + params    │
│ on param change (debounced):          │ ───▶ │  decode → grayscale →        │
│   downscale to ≤800px, POST preview   │      │  smooth_heightfield(cv2) →   │
│   ◀── cleaned preview PNG ────────────│ ◀─── │  PNG bytes (Response)        │
│ render: 2D split  +  3D surface       │      │                              │
│ on export: POST full-res → PNG        │      │ heavy render gated by a      │
│            (Phase 2: → .xcs)          │      │ bounded semaphore            │
└───────────────────────────────────────┘      └──────────────────────────────┘
```

- **Smoothing runs server-side in OpenCV** (`opencv-contrib-python-headless` is
  already a hard dep; `capture_pipeline.py` uses cv2). No new heavy deps.
- **Stateless endpoint** — no DB / no `test_id`/owner. Image in → cleaned image
  out. (Unlike the capture/results flow, which persists.)
- **Preview = downscaled** (≤800px longest edge, sent by the client) for
  responsiveness; **export = full-res**. The client scales the spatial smoothing
  param by the downscale ratio so *preview ≈ export* (see §6 note).
- **Latency tradeoff accepted:** a debounced backend round-trip per tune. A
  browser-worker instant preview is a later upgrade (§14), not v1.

## 6. The smoothing pipeline (algorithm)

Pure function, backend: `smooth_heightfield(gray: np.ndarray, p: ReliefSmoothParams) -> np.ndarray`
(single-channel `uint8` in, single-channel `uint8` out).

```
1. SPIKE REMOVAL  (p.spike_removal, default on)
   cv2.medianBlur(gray, p.median_ksize)        # 3×3 — kills single-pixel oscillation

2. EDGE-AWARE SMOOTH
   cv2.bilateralFilter(d=0,                             # 0 = derive window from sigmaSpace
                       sigmaColor = p.edge_threshold,   # ← the guard rail
                       sigmaSpace = p.strength)         # ← smoothing radius
   (the bilateral range-sigma already refuses to smooth across a jump > edge_threshold)

3. GUARD-RAIL FREEZE  (p.edge_preserve, default on) — belt & suspenders
   g = |Sobel|; mask = dilate(g > p.edge_threshold)
   out = where(mask, original_gray, smoothed)   # hard-guarantee real sharp drops survive
```

**Why both bilateral *and* an explicit freeze:** bilateral's edge preservation is
a soft function of `sigmaColor`; the explicit gradient mask makes "preserve edges
sharper than X" a *hard guarantee*, not a tuning artifact — which is exactly the
user-facing promise of the guard rail.

**Distinguishing a real drop from a spike** = magnitude **+** spatial coherence:
the median removes isolated spikes first (step 1), so by step 3 a surviving large
gradient is one echoed by its neighbours = a real edge → frozen.

**Preview≈export note:** `sigmaSpace` is in *pixels*, so smoothing a downscaled
preview with the full-res pixel sigma over-smooths. The **client scales
`strength` by the preview downscale ratio** before the preview call, and sends
the full-res value for export. (Documented in `reliefHelpers.ts`.)

### Params — `ReliefSmoothParams` (Pydantic, schemas.py)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `strength` | int | 8 | bilateral `sigmaSpace` (spatial radius) |
| `edge_preserve` | bool | **true** | enable the guard rail (range-sigma + freeze mask) |
| `edge_threshold` | int (1–255) | 40 | preserve edges whose intensity jump exceeds this (~16% of full depth at the default; lower = preserve more edges, higher = smooth more) |
| `spike_removal` | bool | true | median pre-pass |
| `median_ksize` | int (3 or 5) | 3 | median window |
| `target_layers` | int (2–256) | 256 | **preview-only** in Phase 1 (banding overlay); pass-through in Phase 2 |
| `z_descent_per_layers` | int ≥ 0 | 0 | **pass-through** to Phase 2 export (0 = off) |

Validators follow the project's "snap legacy values rather than reject" convention
(clamp out-of-range to the nearest legal value).

## 7. Components

Each unit has one purpose, a clear interface, and is independently testable.

### Backend
- **`src/xcs_gen_web/relief.py`** — `smooth_heightfield(gray, params)` (pure
  numpy/cv2, no HTTP); `to_grayscale_u8(bgr)`; `encode_png(gray) -> bytes`.
  Mirrors `capture_pipeline.py`'s cv2 style. *Depends on:* cv2, numpy, PIL.
- **`POST /api/relief/smooth`** in `app.py` — `def` handler (multipart
  `file: UploadFile` + smoothing params as `Form()` scalar fields). Reads
  bytes → `decode_image_bytes` (reuse from `capture_pipeline`) →
  `to_grayscale_u8` → `smooth_heightfield` → `encode_png` →
  `Response(content=png, media_type="image/png")`. Full-res path acquires a
  bounded semaphore (reuse the capture semaphore pattern); preview path is light.
  Body cap = existing 20 MiB middleware.
- **`ReliefSmoothParams`** in `schemas.py` (table above).

### Frontend
- **`web/src/pages/ReliefPage.tsx`** — orchestrator (state, debounced preview
  call, export). Layout mirrors `PixelArtPage` (left settings / centre preview /
  right actions).
- **`web/src/pages/reliefHelpers.ts`** — `decodeFile()` (reuse from
  `pixelArtHelpers`), `downscaleForPreview(bitmap, maxEdge)`,
  `scaleParamsForPreview(params, ratio)`, `reliefSmooth(file, params): Promise<Blob>`
  (multipart POST → blob), `reliefSmoothAndDownload(...)`.
- **`web/src/components/relief/ReliefCompare2D.tsx`** — before/after split canvas
  with a drag handle; reuses the GcodeCanvas/ForgeCanvas **auto-fit + devicePixelRatio**
  pattern. Optional N-level banding overlay.
- **`web/src/components/relief/ReliefSurface3D.tsx`** — three.js displaced-plane
  surface (§8). **`three` is dynamically imported inside this component** so it
  only loads on this page.
- **`web/src/components/relief/ReliefControls.tsx`** — param sliders/toggles
  (`Card`/`Section`/`Field`/`NumberField` from `web/src/ui/`).
- **`web/src/components/relief/ReliefInspect.tsx`** — histogram + gradient map +
  "% pixels changed" strip (the "show me what changed" affordance).

### Registration (per the verified pattern)
- `router.ts`: `| { name: "relief" }` + `parseRoute`/`formatRoute` cases (`#/relief`).
- `App.tsx`: `const ReliefPage = lazy(() => import("./pages/ReliefPage").then(m => ({ default: m.ReliefPage })))` + title case + Suspense gate.
- `TopBar.tsx`: add `{ label: "Relief", route: "relief" }` to the **Engraving** nav group + `"relief"` to the nav-route union.

## 8. 3D render

- **three.js**, added to `web/package.json`, **dynamically imported inside
  `ReliefSurface3D`** (never at App.tsx module scope) so Rollup code-splits it to
  the Relief chunk only. (vite has no `manualChunks`; defaults are fine — verify
  the main chunk doesn't grow after build.)
- A `PlaneGeometry` subdivided to **≤256×256** segments, displaced by the
  heightfield (sampled/downsampled to the mesh grid — full-res image is untouched
  for export). Directional light + ambient; `OrbitControls` for rotate/tilt/zoom.
- **Toggle Original ↔ Cleaned** on the same surface — the headline way to *see*
  the smoothing (ridges flatten, real edges stay crisp).
- Update displacement on a debounce; reuse geometry, swap the displacement
  attribute/texture. Call `renderer.setPixelRatio(devicePixelRatio)`.
- **Fallback:** a no-dep canvas **hillshade** (normals + Lambert light) is the
  cheap alternative if three.js proves heavy; can later be draped as the surface
  texture.

## 9. UI layout (Workshop-Instrument)

```
┌ Relief ─────────────────────────────────────────────────────────────────┐
│ [ Upload depth map ]                          [ Export cleaned PNG ]      │
├──────────────┬──────────────────────────────────────┬────────────────────┤
│ Settings     │  Preview   [ 2D split | 3D surface ]  │  Inspect           │
│  Smoothing   │                                       │   histogram        │
│   strength── │   ◀ original | cleaned ▶  (slider)    │   gradient map      │
│   edge keep ☑│        or orbitable 3D surface         │   % changed        │
│   threshold─ │        [ Original | Cleaned ] toggle   │                    │
│   despike  ☑ │        [ ☐ show N-level banding ]      │  (Phase 2:         │
│  Layers      │                                       │   Export .xcs)     │
│   N · Zdesc  │                                       │                    │
└──────────────┴──────────────────────────────────────┴────────────────────┘
```
FE built via the **`frontend-design` agent** (CLAUDE.md mandate for new pages).

## 10. Phase 2 — `.xcs` relief export (feasibility CONFIRMED)

The model already supports raster relief:
- `Bitmap` class (`model.py:112-132`) + `build_bitmap_display()`
  (`builder.py:100-179`) base64-embed a PNG into a `BITMAP` display.
- `samples/xcs/incise_emboss.xcs` has a real **`RELIEF`** processing entry with
  the exact param block: `zLayers`, `zDecline`, `sliceNumber` (256),
  `reliefCleanUp`, `cleanUpLayers/Power/Speed/Density`, `processAngle`,
  `zAxisMove`. xcs.ts already classifies `RELIEF` as emboss.

**Phase 2 work:** (1) add `RELIEF` to `ProcessingParams`/`_build_processing_data`
with those fields; (2) `depth_map_to_relief_bitmap(gray, width_mm, height_mm, params) -> Bitmap`;
(3) a `POST /api/relief/xcs` endpoint + `reliefXcsAndDownload`; (4) tests that
emit a minimal RELIEF `.xcs` and re-parse it via `xcs.ts`. **Risks** (carry into
the Phase 2 plan): 8-bit quantization can lose detail on float depth maps (offer
higher pixel res); real device semantics of `zDecline`/`zLayers` are best-effort
defaults pending tuning data; large depth maps → multi-MB `.xcs` (warn > 2K×2K).

## 11. Error handling

- Non-image / undecodable upload → 400 with a clear message; UI shows an error
  banner (not a wedged "loading").
- Empty / 1×1 image → 422 (validators).
- Oversized upload → existing 20 MiB middleware returns 413; UI surfaces it.
- cv2 failure → 500, logged (Sentry already wired); UI banner.
- `three.js` chunk load failure → Suspense/error boundary falls back to the 2D
  view with a notice.

## 12. Testing (reuse existing patterns)

- **`tests/test_relief.py`** — `smooth_heightfield` on synthetic heightfields
  (PIL builders + `tmp_path`, like `test_image.py`): a single-pixel spike is
  removed; a real step edge ≥ `edge_threshold` is preserved (bit-for-bit in the
  frozen region); a monotonic ramp gains **no new reversals**; output stays
  `uint8` 0–255. Use tolerances, not exact equality (cv2 float drift).
- **`tests/test_relief_route.py`** — `TestClient(create_app())` + `fresh_db`:
  POST a small PNG → 200, `image/png`, decodable; bad upload → 400; oversized →
  413/422.
- **`web/src/pages/reliefHelpers.test.ts`** — `scaleParamsForPreview` math;
  `downscaleForPreview` ratio; `makeImageData` synthetic fixtures (reuse the
  `pixelArtImage.test.ts` helper).
- **`web/src/components/relief/*.test.tsx`** — render ReliefControls/Compare2D
  (jsdom; canvas draw assertions kept light, structure-level).
- Changelog entry (major — new page) with a screenshot; verify in a real browser
  (Chrome MCP) before "done".

## 13. Build sequence

1. **Backend core** (TDD): `relief.py::smooth_heightfield` + tests. *No UI yet.*
2. **Endpoint**: `/api/relief/smooth` + `ReliefSmoothParams` + route test.
3. **Page shell + registration**: `ReliefPage` (upload + 2D before/after via
   backend) wired into router/App/TopBar — *usable end-to-end, PNG export.*
4. **Controls + inspect strip** (`frontend-design`): params, guard rail, banding
   overlay, histogram/gradient/%changed.
5. **3D surface**: `three.js` dep + `ReliefSurface3D` (lazy), Original/Cleaned
   toggle; confirm code-split via build output.
6. **Polish + changelog + browser verification.**
7. **(Phase 2, separate spec/plan)** `.xcs` relief export.

Each of 1–6 is independently shippable; the feature is useful from step 3.

## 14. Parked / out of scope

- **Layer-aware label-space cleanup** (hysteresis quantize + sub-k-px island
  removal + min step-run-length). Add only if testing shows residual terracing
  after the field denoise. (Approach "C" from brainstorming.)
- **TV-L1 / L0 "stylized relief" mode** (Approach "B") — needs scikit-image or a
  custom impl; not core.
- **Browser-worker instant preview** — latency upgrade over the backend round-trip.
- **Editing relief params back in Forge** — Phase 3.
