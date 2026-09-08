# Relief — 8/16-bit depth maps

**Status:** design approved (brainstorm 2026-06-21)
**Page:** `#/relief` (`ReliefPage`) + standalone `#/depth-maps` (`DepthMapsStandalone`).

## Goal

Let the Relief tool produce **true high-precision depth maps** — selectable **8-bit or 16-bit** PNG — via a toggle at the top of the page. 16-bit removes the 256-level "terracing"/banding on engraved relief slopes by carrying genuine sub-256 precision through the pipeline and emitting a real 16-bit PNG. Precision is preserved **input → output**: the final export renders the whole pipeline on the backend at float precision from the *original* source bytes, so a 16-bit source stays 16-bit and an 8-bit source still gains smooth gradients from the float processing.

## Decisions (brainstorm)

- **True precision**, not a 16-bit container — the processing must carry >256 levels.
- **Input + output** precision: don't pre-flatten the source to an 8-bit canvas before processing.
- **Approach A — backend renders the export.** The export already round-trips to the backend (`/api/relief/smooth`) for smoothing/CLAHE/background; the browser canvas physically can't emit 16-bit. So the *entire* final render moves to the backend at float precision, returning the chosen bit depth. The live on-screen preview stays the fast client-side 8-bit approximation (the screen is 8-bit anyway).
- **Toggle at top of page**, default **16-bit**, persisted to `localStorage`. Affects export only.
- **16-bit export is single-channel grayscale.** PNG supports 16-bit+alpha but PIL's support is awkward and depth maps for engraving are grayscale; with background removal, cleared regions flatten to the depth floor (0) instead of transparency. 8-bit keeps the `LA` transparency option.

## Current state (verified)

- **Relief is the only depth-map feature.** `web/src/pages/ReliefPage.tsx` + backend `POST /api/relief/smooth` (`src/xcs_gen_web/app.py` → `src/xcs_gen_web/relief.py`). The exported PNG is a **user download** (`relief.png`); it is read *from* `.xs` on import (`web/src/lib/relief/xsImport.ts`) but never written into `.xcs`/`.xs`.
- **Everything is 8-bit today:**
  - Backend `relief.py`: `encode_png` (`Image.fromarray(gray, mode="L")`) and `encode_png_la` (`Image.merge("LA", ...)`), both from `uint8` numpy arrays; `smooth_heightfield` works in `uint8`.
  - Frontend export (`ReliefPage.tsx::onExport`, ~lines 512–578): re-encodes the full-res `workingSource` to an **8-bit** canvas PNG → POSTs to `/api/relief/smooth` (`reliefSmooth` in `web/src/pages/reliefHelpers.ts`) → gets an 8-bit PNG → applies the **client tone LUT** (`buildLut`/`applyLut` on 8-bit `ImageData`, from `web/src/components/relief/stretch.ts`) → `canvas.toBlob("image/png")` → downloads.
  - Browser canvas / `ImageData` / `toBlob` are inherently 8-bit → three 8-bit chokepoints: the source re-encode, the backend processing, and the client LUT + final encode.
- **Tone modes** (`StretchMode` in `stretch.ts`): `none | linear | gamma | asinh | equalize | clahe`. CLAHE is resolved on the backend (its client LUT is identity); the other four are applied as a 256-entry client LUT built from the smoothed image's histogram. `buildLut(p, hist)` / `applyLut(src, lut)` / `histogram(src)` are the reference implementations.
- **Params** that define a render:
  - Smoothing (`ReliefParams`, `reliefHelpers.ts`): `strength`, `edgePreserve`, `edgeThreshold`, `spikeRemoval`, `medianKsize` (3|5), `smoothEnabled`.
  - Tone (`StretchParams`, `stretch.ts`): `mode`, `clipLowPct`, `clipHighPct`, `clipPct`, `gamma`, `asinhStrength`, `removeEmptyLayers`, `claheClipLimit`, `claheTiles`.
  - Background (`bgOpts()` in `ReliefPage.tsx`): `subtractions[]`, `shapeInternal`, `perimeterPct`, `trimPct`, `falloffPct`, `falloffMode`, `falloffTarget`, `falloffIntensity`.
  - Canvas: `expandPct` + a derived `padColor` (currently applied client-side via `padToCanvas`).

## Architecture (Approach A)

Two distinct paths, clean responsibilities:

- **Preview path (unchanged):** client downscales → `/api/relief/smooth` (8-bit) → client tone LUT (8-bit) → on-screen. Fast, instant tone tweaks. No behavioural change.
- **Export path (new, full-precision):** the frontend sends the **original source bytes** + the full param set + `bit_depth` to a new **`POST /api/relief/export`**; the backend runs the complete pipeline in float32 and returns the final 8- or 16-bit PNG; the frontend downloads it. The client tone-LUT/canvas export steps are removed (the backend produces the final pixels).

## Part 1 — Backend high-precision render

### `relief.py` — float pipeline
Refactor the relief operations to run in **float32** internally (normalized 0–1), quantizing only at encode:

1. **Decode at native depth.** `Image.open(bytes)`; map to single-channel grayscale preserving bit depth (8-bit `L` → 0–255; 16-bit `I;16`/`I` → 0–65535), normalize to float 0–1. Non-grayscale sources → luminance.
2. **Pad** (expand-canvas) at full precision — replaces the 8-bit `padToCanvas` for export. Border filled with the (normalized) `pad_color`.
3. **Smooth** — existing bilateral / edge-aware / median spike-removal, on float32 (`cv2.bilateralFilter` accepts float32; `cv2.medianBlur` supports float for ksize 3/5).
4. **Tone** — CLAHE stays cv2 (16-bit-capable). The four monotonic modes (`linear`, `gamma`, `asinh`, `equalize`) are implemented in numpy on the float image, **matching `stretch.ts::buildLut` exactly** (percentile clips for `linear`, `pow` for `gamma`, `asinh` stretch, histogram equalization for `equalize`; plus the `removeEmptyLayers` behaviour under `none`). Parity is locked with unit tests (Part 4).
5. **Background removal** — existing logic, on the float image; alpha as float.
6. **Quantize + encode:**
   - 8-bit: `L` / `LA` (unchanged behaviour, incl. transparency).
   - 16-bit: scale float→`uint16` and encode single-channel **`I;16`**; if background removal produced alpha, composite the transparent regions onto the depth floor (0) first (no alpha channel in 16-bit output).

Keep `encode_png` / `encode_png_la` for the 8-bit preview path; add the 16-bit encode + the float pipeline for export.

### `app.py` — new route
`POST /api/relief/export` accepting the original file plus all render params (smooth + tone + background + `expand_pct`/`pad_color`) and `bit_depth` (8|16); returns the rendered PNG. `/api/relief/smooth` is unchanged (preview).

## Part 2 — Frontend toggle + rewired export

- **Toggle:** a segmented "BIT DEPTH · 8 | 16" control in the `ReliefPage` `Toolbar` trailing area. State `bitDepth: 8 | 16`, default 16, persisted to `localStorage`. Tooltip: "16-bit = smoother depth gradation, ~2× file size; 8-bit = maximum compatibility." Affects export only.
- **`reliefExport(originalBytes, params, bitDepth)`** helper in `reliefHelpers.ts`: multipart POST to `/api/relief/export` with the original bytes + the full param set + `bit_depth`; resolves the rendered PNG blob.
- **`onExport`** rewired: instead of re-encoding the canvas + calling `reliefSmooth` + client LUT, it calls `reliefExport` with the **original source bytes** and downloads the result. Filename `relief-16bit.png` when 16-bit, else `relief.png`. The existing export error UI surfaces backend failures.

## Part 3 — Input precision

- Keep the **original source bytes** in `ReliefPage` state — the uploaded `File`, or the depth bytes extracted by `xsImport` — and send *those* to `/export` (not a canvas re-encode). Padding/expand is done server-side from those bytes.
- The frontend `padToCanvas` / downscale remain for the **preview** only.
- This guarantees a 16-bit source (e.g. a 3D-render depth PNG, or a 16-bit Studio `.xs` relief) is decoded and processed at 16-bit; 8-bit sources gain smoothness from the float processing.

## Limitation

16-bit export is **single-channel grayscale only** — background-removed regions flatten to the depth floor (0) rather than transparency. This matches how depth maps are consumed for engraving (background = floor). 8-bit retains the `LA` transparency path.

## Testing

- **pytest (`tests/test_relief.py`, `tests/test_relief_route.py`):**
  - 16-bit decode → process → `I;16` encode round-trip: output mode is 16-bit and a smooth gradient yields **>256 distinct levels** (proves true precision, not a container).
  - Tone-curve **parity**: backend `linear`/`gamma`/`asinh`/`equalize` curves match `stretch.ts::buildLut` within tolerance on shared test vectors.
  - 8-bit path unchanged (existing tests stay green).
  - 16-bit + background → grayscale output, transparent regions flattened to 0 (no alpha).
  - `/api/relief/export` route: returns the requested bit depth.
- **vitest (`web/src/pages/reliefHelpers.test.ts`):** `reliefExport` posts `bit_depth` + the original bytes + params; the toggle renders, updates state, and persists to `localStorage`.
- **Browser golden path:** upload → toggle 16-bit → export → confirm the downloaded PNG is genuinely 16-bit and visibly smoother; 8-bit export still works; preview is unaffected.

## File structure

```
src/xcs_gen_web/relief.py            MOD  float32 pipeline; numpy tone modes; 16-bit (I;16) encode
src/xcs_gen_web/app.py               MOD  POST /api/relief/export (full-precision render + bit_depth)
web/src/pages/ReliefPage.tsx         MOD  bit-depth toggle (top), rewired onExport using original bytes
web/src/pages/reliefHelpers.ts       MOD  reliefExport() helper
web/src/components/relief/stretch.ts  REF  parity reference for the ported tone curves (unchanged)
tests/test_relief.py                 MOD  16-bit round-trip, tone parity, grayscale-flatten
tests/test_relief_route.py           MOD  /export route + bit_depth
web/src/pages/reliefHelpers.test.ts  MOD  reliefExport params + toggle/persistence
changelog/2026-06-21-relief-16bit.md NEW  minor entry
```

## Notes / deviations

- The tone curves now live in two places (TS preview + numpy export); **parity unit tests** are the guard. (Alternative considered: the client sends a high-res LUT — rejected because `linear`/`equalize` are histogram-dependent on the full-res smoothed data, which lives on the backend in Approach A.)
- The depth map remains a user-download artifact; this work does not touch `.xcs`/`.xs` serialization.
- Scope is the Relief page; no other feature produces depth maps.
