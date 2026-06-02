# Relief Tone-Stretch — Design

**Status:** approved design, pre-implementation
**Date:** 2026-06-02
**Branch:** `feat/relief-tone-stretch` (to be cut from `main`)

## 1. Goal

Add an **experimental tone-stretch** stage to the Relief page. Depth maps
frequently arrive with their values bunched into a narrow band of the 0–255
range — the relief then engraves shallow and flat, and (where the band starts
above 0) wastes passes cutting air before it reaches real geometry. Stretching
the values to fill the palette deepens the relief and reveals compressed
detail.

Borrowed wholesale from astrophotography, where the same operation — pulling the
black/white points and bending the midtones to spread a cramped histogram across
the full range — is routine. Here the "palette" is the engraver's 256 pass-levels.

## 2. The engraving model (why 8-bit *is* the palette)

The xTool machine maps a grayscale image's `0–255` onto *N* engraving
pass-levels **natively** (depth = pass count). The PNG we hand it is `mode="L"`
(8-bit) and the Z-pass quantization tops out at 256 levels. So **256 levels is
the operative palette** — a 16-bit stretch reaches the machine no deeper, and a
16-bit pipeline is explicitly out of scope (§9). "Use the whole palette" means
spreading values across `0..255`.

This also fixes the user's "offset" observation: a depth map whose values start
at, say, 60 makes the machine engrave the whole object until it reaches the real
start-depth. Pulling the black point to 0 (the **Linear** mode) removes that
wasted descent while preserving relative depth.

## 3. Where it sits — *after* smoothing

The stretch is a **tone-mapping stage applied to the already-smoothed
heightfield**, never before it. Two reasons:

- **Correctness (astro best practice):** denoise on the raw data, *then* stretch.
  Stretching first amplifies the very pepper/spike noise the smoother exists to
  remove.
- **Performance:** as a pure post-step on the smoothed image, dragging a stretch
  slider **never re-triggers the backend smooth**. The expensive round-trip only
  re-runs when a *smoothing* param changes (as today).

```
upload → [backend] smooth_heightfield → smoothedData ──┐
                                                        ▼
                                          [client] tone-stretch (LUT)
                                                        ▼
                                          cleanedData (final) → 2D / 3D / inspect / export
```

The backend result becomes an intermediate `smoothedData`; the stretch produces
the **final** `cleanedData`. Every existing consumer (2D wipe, 3D surface,
inspect strip, export) keeps its current interface and simply receives the
post-stretch image.

## 4. Client-side LUT vs backend (what makes it real-time)

Every **monotonic** mode is a **256-entry lookup table** (input gray → output
gray). A LUT is:

- **Instant** — applied to the ≤800px preview `ImageData` in the browser on each
  slider tick, no network.
- **Resolution-independent** — the *identical* LUT applies to the full-res export,
  so **preview ≡ export with zero drift**, because there is exactly one
  implementation (JS). No parallel Python tone-curve to keep in sync.

**CLAHE is the sole exception** — it is spatially adaptive (per-tile histograms +
bilinear blend), not expressible as a single 256-LUT. CLAHE therefore runs on
the **backend** (cv2) via the existing smooth round-trip; in CLAHE mode the
client LUT is the identity map. CLAHE re-runs the backend call on param change,
exactly as smoothing params already do (debounced) — acceptable, and it has few
params.

## 5. Modes & parameters

A `Mode` dropdown plus the active mode's slider(s). **Default `None`** so the
page behaves exactly as today until the user opts in.

| Mode | Transform | Params | Engine |
|---|---|---|---|
| **None** *(default)* | identity | — | — |
| **Linear** | map `[p_low, p_high]` percentiles → `0..255`; preserves relative depth | `clipLowPct`, `clipHighPct` (default 0.1) | client LUT |
| **Gamma** | linear trim, then `out = 255·(in/255)^γ` | `clipPct`, `gamma` (0.2–2.5, default 1.0) | client LUT |
| **Asinh** | linear trim, then astro-style `asinh` lift of low values | `clipPct`, `strength` (0–1, default 0.5) | client LUT |
| **Equalize** | global histogram equalization (CDF → LUT) | — | client LUT |
| **CLAHE** | tile-adaptive local-contrast equalization | `clipLimit` (1–8, default 2), `tiles` (4/8/16, default 8) | **backend** (cv2) |

**Depth-map caveat (surfaced in the UI hint):** percentile clipping discards the
extreme pixels, which on a depth map flattens true peak/valley geometry. Hence
the **conservative 0.1% default** clip — enough to ignore a stray hot pixel,
small enough to keep real extremes. Clip can be set to 0 (true min/max).

**LUT math (the pure functions):**

- **Linear:** `lo, hi = percentile(hist, clipLow, clipHigh)`;
  `lut[v] = clamp(round((v - lo) * 255 / max(1, hi - lo)), 0, 255)`.
- **Gamma:** apply the Linear trim, then `lut[v] = round(255 * (lut_lin[v]/255)^γ)`.
- **Asinh:** apply the Linear trim, then
  `lut[v] = round(255 * asinh(k · x) / asinh(k))` where `x = lut_lin[v]/255` and
  `k` derives from `strength` (e.g. `k = 1 + strength·40`).
- **Equalize:** `cdf = cumsum(hist)`; `lut[v] = round(255 * (cdf[v] - cdf_min) /
  (total - cdf_min))`.
- **None:** `lut[v] = v`.

The source histogram is computed once per smoothed result (the inspect strip
already computes a 256-bin luminance histogram — reuse that path).

## 6. Components

### Frontend (new)
- **`web/src/components/relief/stretch.ts`** — pure, no React. Exports
  `StretchMode`, `StretchParams`, `DEFAULT_STRETCH_PARAMS`,
  `buildLut(params, hist: Uint32Array): Uint8Array` (returns the 256-LUT;
  identity for `none`/`clahe`), `applyLut(src: ImageData, lut): ImageData`
  (maps R/G/B through the LUT, preserves alpha), and `histogram(src): Uint32Array`
  (or reuse the one in `ReliefInspect`, lifted here so both share it).
- **`web/src/components/relief/StretchControls.tsx`** — the `Mode` dropdown +
  conditional per-mode sliders, styled with the existing `Section` / `Field` /
  `Slider` / segmented-control patterns from `ReliefControls`. Patches a shared
  `StretchParams` immutably via `onChange`.

### Frontend (edits)
- **`web/src/pages/ReliefPage.tsx`**
  - Add `stretchParams` state (`DEFAULT_STRETCH_PARAMS`).
  - Rename the backend-result buffer to `smoothedData` / `smoothedUrl`
    (internal); keep `cleanedData` / `cleanedUrl` as the **final post-stretch**
    values the consumers read (minimal blast radius).
  - New effect: when `smoothedData` or a **monotonic** stretch param changes,
    `buildLut` from the smoothed histogram → `applyLut` → set `cleanedData`, and
    re-encode to `cleanedUrl` (canvas `toBlob`, cheap at ≤800px) for the 2D wipe.
  - CLAHE: add `clahe_*` to the **smooth-effect deps** so selecting/tuning CLAHE
    re-runs the backend; in CLAHE mode the LUT step is identity (final = backend
    result).
  - Export: full-res backend smooth (with `clahe_*` when in CLAHE mode) → decode
    → `applyLut` (identity for CLAHE) → `toBlob` → download.
  - Render `<StretchControls>` in the left column beneath `<ReliefControls>`.
- **`web/src/pages/reliefHelpers.ts`** — extend `reliefSmooth` to send optional
  `clahe`, `clahe_clip`, `clahe_tiles` form fields when CLAHE is active.
- **`web/src/components/relief/ReliefInspect.tsx`** — overlay the **active LUT as
  a thin transfer-curve polyline** on the existing histogram (256 points,
  bottom-left → top-right) so the mapping is legible. Accept a `lut?: Uint8Array`
  prop; draw nothing when absent/identity.

### Backend (edits)
- **`src/xcs_gen_web/relief.py`** — add
  `apply_clahe(gray: np.ndarray, clip_limit: float, tiles: int) -> np.ndarray`
  using `cv2.createCLAHE(clipLimit, (tiles, tiles)).apply(gray)`. Pure
  numpy/cv2, single-channel `uint8` in/out, mirrors the existing style.
- **`POST /api/relief/smooth`** in `app.py` — add optional `Form()` fields
  `clahe: bool = False`, `clahe_clip: float = 2.0`, `clahe_tiles: int = 8`.
  Apply `apply_clahe` **after** `smooth_heightfield`, gated on `clahe`. Clamp
  params to legal ranges (project "snap, don't reject" convention).

## 7. UI layout

The left settings column gains a **Stretch (experimental)** section under the
existing smoothing controls:

```
┌ Settings (left) ─────────────┐
│ Smoothing                    │
│   strength ─────             │
│ Edges                        │
│   preserve ☑  threshold ──   │
│ Speckle                      │
│   remove ☑  window [3|5]     │
│ Layers                       │
│   N · Z-descent              │
│ ── Stretch (experimental) ── │
│   Mode  [ Gamma ▾ ]          │
│   Clip %   ───●──   0.1      │
│   Gamma    ──●───   0.65     │
└──────────────────────────────┘
```

The inspect histogram (right column) gains the transfer-curve overlay. No new
preview surface — the 2D wipe, 3D surface, and histogram all reflect the
stretched result for free.

## 8. Testing

- **`web/src/components/relief/stretch.test.ts`** (vitest):
  - `none` → LUT is identity; `applyLut` returns pixels unchanged.
  - `linear` on a synthetic histogram bunched in `[60,180]` → `lut[60]≈0`,
    `lut[180]≈255`, monotonic non-decreasing.
  - `gamma` < 1 lifts midtones (`lut[128] > 128`), > 1 lowers them; monotonic.
  - `asinh` monotonic, lifts low values more than high.
  - `equalize` flattens: applying to a peaked histogram yields a near-uniform
    output histogram (within tolerance).
  - `applyLut` preserves alpha and image dimensions.
- **`tests/test_relief.py`** — `apply_clahe`: output is `uint8`, same shape, and
  increases local contrast on a low-contrast synthetic field (e.g. output range
  ≥ input range); idempotent shape on a flat field (no crash).
- **`tests/test_relief_route.py`** — POST with `clahe=true` → 200, `image/png`,
  decodable, dimensions preserved; out-of-range `clahe_clip`/`clahe_tiles` are
  clamped not rejected.
- **Browser verification (CLAUDE.md mandate):** load `#/relief`, upload a cramped
  depth map, step through each mode, confirm the histogram + curve overlay + 3D
  surface update live and the export matches the preview. Screenshot and read it
  critically before "done".

## 9. Out of scope (YAGNI)

- **16-bit pipeline** — engraver + PNG are 8-bit; 256 levels *is* the palette.
- **Full draggable curves editor** and **draggable histogram handles** — the user
  chose the simpler dropdown + sliders surface.
- **Auto-STF / median-MAD auto black-point** — `Linear` with a clip % covers the
  common case; revisit only if manual clipping proves fiddly.
- **Persisting stretch params** — stateless, like the rest of the Relief page.

## 10. Build sequence

1. **Pure LUT core** (TDD): `stretch.ts` (`buildLut`/`applyLut`/`histogram`) +
   `stretch.test.ts`. No UI, no backend.
2. **Backend CLAHE** (TDD): `relief.py::apply_clahe` + endpoint `clahe_*` params +
   route test.
3. **`StretchControls`** component + wire `stretchParams` into `ReliefPage`
   (monotonic LUT effect, CLAHE deps, export path).
4. **Inspect curve overlay** in `ReliefInspect`.
5. **Browser verification + changelog** (user-visible Relief enhancement).

Steps 1–2 are independently testable; the feature is usable end-to-end after 3.

## 11. Changelog

User-visible enhancement to an existing page → a changelog entry
(`changelog/2026-06-02-relief-tone-stretch.md`), level **minor**, with a
before/after screenshot of a cramped depth map filling the palette.
