# Relief — Smoothing Toggle + Range/Background Trims — Design

**Status:** approved design, pre-implementation
**Date:** 2026-06-02
**Branch:** `feat/relief-tone-stretch` (continues the tone-stretch work)

## 1. Goal

Three additions to the Relief page's preprocessing, all building on the
tone-stretch feature (`2026-06-02-relief-tone-stretch-design.md`):

1. **Smoothing optional** — a toggle to disable the smoothing pass, so the user
   can drive only the histogram/stretch tools on the raw heightfield.
2. **Remove initial empty layers** — a toggle that drops the unused bottom of
   the value range (offset `min → 0`), preserving depth differences exactly —
   the "always-good hygiene" step, distinct from the Linear *stretch* (which
   rescales and changes contrast).
3. **Background → transparency** — depth-map PNGs often carry a surrounding
   black background. A toggle replaces near-black pixels (`≤ threshold`) with
   transparency, so the engraver skips them and the background stops skewing
   the stretch.

## 2. Where each runs (and why)

| Feature | Engine | Reason |
|---|---|---|
| Smoothing toggle | backend | gates the existing `smooth_heightfield` call |
| Remove empty layers | client LUT | pure offset on the tone LUT — instant, no round-trip |
| Background → alpha | backend | derived from the (smoothed) grayscale; encoded as an `LA` PNG |

Background removal is backend-side (like CLAHE) because the mask is computed
from the grayscale and baked into the PNG's alpha channel. Its *downstream*
effects (histogram exclusion, stretch, export) are all client-side and mostly
automatic.

## 3. Feature detail

### 3.1 Smoothing optional
- **Backend** `/api/relief/smooth`: new `smooth: bool = Form(True)`. When false,
  skip `smooth_heightfield` — `out = gray` (CLAHE/background still apply if
  requested).
- **Frontend** `ReliefParams` gains `smoothEnabled: boolean` (default `true`).
  `ReliefControls` renders a "Smoothing" enable toggle at the top of the
  Smoothing section; strength/edge/speckle controls are disabled when off.
- The smooth-effect dependency array includes `smoothEnabled` (flipping it
  re-fetches). `reliefSmooth` sends `smooth=<smoothEnabled>`.

### 3.2 Remove initial empty layers
- **Client** `StretchParams` gains `removeEmptyLayers: boolean` (default
  `false`).
- `buildLut`: when on, compute `floor` = lowest **populated** histogram bin
  (background already excluded, see §3.3), and compose an offset `v → clamp(v −
  floor, 0, 255)` *before* the mode curve, using a `floor`-shifted histogram so
  the rescaling modes (linear/gamma/asinh/equalize) are unaffected (their own
  normalization already zeros the floor — the offset cancels). Net visible
  effect is in **None** mode: identity becomes a pure downward offset.
- No backend round-trip.

### 3.3 Background → transparency
- **Backend** `/api/relief/smooth`: new `remove_bg: bool = Form(False)`,
  `bg_threshold: int = Form(8)`, `bg_high: bool = Form(False)`. After smooth
  (+CLAHE):
  - `background_alpha(gray, threshold, high) -> np.ndarray` (uint8): `alpha =
    255` for kept pixels, `0` for background. `high=False`: bg where
    `gray <= threshold`. `high=True`: bg where `gray >= threshold`.
  - When `remove_bg`, encode `LA` via `encode_png_la(gray, alpha) -> bytes`
    (PIL `Image.merge("LA", [L, A])`); otherwise the existing `encode_png` (`L`).
  - Params clamped (snap-don't-reject): `bg_threshold` to `0..255`.
- **Client (automatic):**
  - `histogram()` skips pixels with `alpha < 128` — a black background no longer
    anchors the stretch's black point or the §3.2 `floor`. **No-op when bg
    removal is off** (alpha is 255 everywhere).
  - `applyLut` already copies the alpha channel through unchanged.
  - The smoothed `LA` PNG decodes to an `ImageData` whose transparent pixels
    carry through `smoothedData → cleanedData → cleanedUrl` (re-encoded via
    canvas `toBlob`, which preserves alpha) and the full-res export (same canvas
    pipeline → RGBA PNG, `R=G=B=depth`, `A=mask`).
  - `remove_bg`/`bg_threshold`/`bg_high` ride in `StretchParams` and join the
    smooth-effect deps (exactly as `clahe*` already does).
- **Preview**: a subtle checkerboard backdrop behind the 2D/3D preview host so
  transparent regions read as cut out.

## 4. UI organization

`StretchControls` becomes a two-`Section` card:
- **"Stretch"** — the existing Mode dropdown + per-mode sliders.
- **"Trim"** — *Remove empty layers* (toggle); *Remove background* (toggle +
  threshold slider shown when on, with a one-line black/white-end note via
  `bg_high`).

`smoothEnabled` lives in `ReliefControls` (the smoothing panel). The new backend
trim params (`removeBackground`, `bgThreshold`, `bgHigh`) live in `StretchParams`
— consistent with `clahe*` already being read from there by the backend call.

## 5. Components

- **Backend** `src/xcs_gen_web/relief.py`: add `background_alpha(gray, threshold,
  high)` and `encode_png_la(gray, alpha)`; export both in `__all__`. `app.py`:
  `smooth`, `remove_bg`, `bg_threshold`, `bg_high` form params; skip smooth when
  off; apply alpha + LA encode when on.
- **Frontend** `web/src/components/relief/stretch.ts`: `removeEmptyLayers`,
  `removeBackground`, `bgThreshold`, `bgHigh` on `StretchParams`; `buildLut`
  floor offset; `histogram()` alpha exclusion.
- `web/src/pages/reliefHelpers.ts`: `ReliefParams.smoothEnabled`; `reliefSmooth`
  opts gain `smooth` + `background: { threshold, high }`.
- `web/src/components/relief/StretchControls.tsx`: the "Trim" section.
- `web/src/components/relief/ReliefControls.tsx`: smoothing enable toggle.
- `web/src/pages/ReliefPage.tsx`: deps + wiring (smoothEnabled, bg params in the
  backend call; checkerboard backdrop on the preview host).

## 6. Testing

- **Backend** `tests/test_relief.py`: `background_alpha` masks black (≤T) to 0,
  keeps the rest at 255; `high=True` masks the bright end; `encode_png_la`
  round-trips an `LA` PNG (alpha preserved). `tests/test_relief_route.py`:
  `remove_bg=true` → PNG with an alpha channel; `smooth=false` → 200 + decodable;
  out-of-range `bg_threshold` clamped.
- **Frontend** `stretch.test.ts`: `removeEmptyLayers` offsets None mode
  (`lut[floor]≈0`, `lut[255]≈255−floor`) and is a no-op under Linear; `histogram`
  skips `alpha<128` pixels. Control render tests for the new toggles.
- **Browser (CLAUDE.md mandate):** verify smoothing-off path, empty-layer offset
  (histogram shifts left, no rescale), and background removal (checkerboard
  shows, histogram ignores the background, export PNG has alpha). Screenshot and
  read critically.

## 7. Build sequence

1. Backend `background_alpha` + `encode_png_la` (TDD).
2. Endpoint `smooth` / `remove_bg` / `bg_threshold` / `bg_high` (TDD).
3. `stretch.ts`: `removeEmptyLayers` offset + `histogram` alpha exclusion (TDD).
4. `reliefHelpers.ts`: `smoothEnabled` + `reliefSmooth` opts (TDD).
5. `ReliefControls` smoothing toggle; `StretchControls` Trim section.
6. `ReliefPage` wiring + checkerboard preview backdrop.
7. Browser verification + changelog.

## 8. Out of scope (YAGNI)

- 3D surface treating transparent pixels specially (they render flat-low — fine
  for v1).
- `.xcs` relief alpha semantics (Phase 2).
- A separate "background" colour pick (only black/white extremes, by threshold).
