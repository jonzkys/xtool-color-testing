# Relief — edge & background refinement (design)

**Status:** approved design, pre-implementation
**Date:** 2026-06-17
**Branch:** `feat/relief-edge-background`

**Goal:** Three additions to the Relief page's background/edge stage that give a
carved object a clean, intentional edge instead of the fussy threshold border:
(1) pick the background **colour** with an eyedropper, (2) **trim** a % of the
object outline to shave leftover fuzziness, (3) a non-linear **edge falloff**
(bevel *down* to the floor / rim *up* to the peak) over a % band.

**Architecture:** All three operate on the image arrays in the existing backend
stage (`relief.py` + `POST /api/relief/smooth`, numpy/cv2), extending the current
threshold `background_alpha`. The only client-side piece is the eyedropper
(sample an RGB from the source colour image). Offsets are a **% of the object's
shorter side** — the relief page has no physical (mm) size.

**Tech stack:** Python (numpy + cv2) backend; React + TS relief page; pytest +
vitest.

---

## Current state

- `relief.py` `background_alpha(gray, threshold, high)` → hard 0/255 alpha from a
  grayscale dark (`high=False`) / bright (`high=True`) threshold.
- `POST /api/relief/smooth` exposes `bg_threshold`, `bg_high` (+ smoothing,
  CLAHE). FE `stretchParams.removeBackground / bgThreshold / bgHigh`.
- No edge trim, no falloff, no colour keying. The page is pixel-based (no mm).

## Pipeline order (one round-trip, backend)

```
grayscale (+ retain colour for keying) → smooth_heightfield → CLAHE
  → background mask → trim (erode) → edge falloff (height ramp) → encode LA PNG
```

The background mask (foreground = opaque) is computed once, then trim shrinks it,
then falloff ramps the grayscale height inside a band of the trimmed foreground.
The PNG's alpha = trimmed foreground; its grey = height with falloff applied.

---

## ① Background colour pick

The existing `removeBackground` on/off toggle stays as the **master enable** for
the whole stage. A background **mode** replaces the lone dark/bright toggle:
`dark | bright | colour`. (Trim and falloff operate on the foreground mask, so
they only do anything when background removal is enabled.)

- `dark` / `bright` — the existing grayscale threshold (`background_alpha`,
  unchanged); kept for grayscale depth maps.
- `colour` — chroma key. New pure fn:

  ```python
  def colour_background_alpha(bgr, color_rgb, tolerance) -> np.ndarray  # u8 0/255
  ```

  Background = pixels whose Euclidean RGB distance to `color_rgb` ≤ `tolerance`
  (range 0–441; default 40). Returns the same 0/255 alpha contract as
  `background_alpha`, so trim/falloff/encode are identical downstream.

- The endpoint reads the uploaded image in **colour** (cv2 BGR) and also derives
  grayscale for height; only the mask differs by mode.

**Eyedropper (FE):** an eyedropper button (shown only in `colour` mode) toggles a
"sampling" state; the next click on the source/preview image reads that pixel's
RGB from the colour `ImageData` (`originalData` already exists on the page) and
sets `bgColor`. A swatch shows the picked colour; a `tolerance` slider follows.
Until a colour is picked, `colour` mode removes nothing (all-foreground mask).

## ② Outline trim

New pure fn:

```python
def trim_alpha(alpha, pct) -> np.ndarray
```

- Foreground = `alpha > 0`; `S` = shorter side of the foreground bounding box.
- `radius_px = round(pct/100 × S)`; erode the foreground with an elliptical
  kernel of that radius (`cv2.erode`). The shaved ring becomes transparent.
- `pct ≤ 0` or `radius_px < 1` → identity (no-op).
- **Clamp:** if the erosion would empty the object, skip the trim (return the
  input alpha) — never erase the object.

## ③ Edge falloff

New pure fn:

```python
def edge_falloff(gray, alpha, pct, direction) -> np.ndarray  # new gray
```

- Foreground = `alpha > 0`; `S` = shorter side of its bbox; `band_px = pct/100 × S`.
- `dist = cv2.distanceTransform(foreground_u8, DIST_L2, 3)` — distance from each
  foreground pixel to the nearest background pixel (the trimmed boundary).
- `t = clip(dist / band_px, 0, 1)` (0 at the boundary, 1 at/inside the band edge).
- Curve `c = smoothstep(t) = t²(3 − 2t)` — the "not a straight line" S-ramp.
- `target` = `0` when `direction="down"` (bevel to floor) or `255` when
  `direction="up"` (rim to peak).
- `new_gray = where(foreground, round(target + (gray − target) × c), gray)`.
  At the boundary (`t=0`) the height is the target; at the band's inner edge
  (`t=1`) it is the real height; background pixels are untouched.
- `pct ≤ 0` or `band_px < 1` → identity.

## API additions (`POST /api/relief/smooth`)

New `Form` fields (all optional, defaults = current behaviour):

| field | type / default | meaning |
|---|---|---|
| `bg_mode` | str `"dark"` | `dark` \| `bright` \| `colour` (replaces `bg_high`; FE updated together) |
| `bg_color` | str `""` | `"r,g,b"` for `colour` mode |
| `bg_tolerance` | int `40` | RGB distance for `colour` mode |
| `trim_pct` | float `0` | 0 = off |
| `falloff_pct` | float `0` | 0 = off |
| `falloff_dir` | str `"down"` | `down` \| `up` |

`bg_threshold` stays (used by `dark`/`bright`). Response is the same `LA` PNG.
Trim clamping is silent (object never emptied); no new response shape.

## FE changes

- Relief params gain: `bgMode`, `bgColor: [r,g,b] | null`, `bgTolerance`,
  `trimEnabled` + `trimPct`, `falloffEnabled` + `falloffPct` + `falloffDir`.
- A new **"Edge & background"** controls section (extending the existing
  background controls): mode select; in `colour` mode → eyedropper toggle +
  swatch + tolerance; *Trim outline* (enable + `trim%`); *Edge falloff*
  (enable + direction down/up + `offset%`).
- `reliefSmooth()` API wrapper sends the new form fields.
- The existing debounced preview re-runs the smooth on change (add the new
  params to its deps); the 2D wipe and 3D surface show the result.

## Edge cases

- `colour` mode, no colour picked → no removal (all foreground) until sampled.
- trim/falloff disabled or 0 → identity, so today's output is byte-for-byte
  preserved when the new features are off.
- trim large enough to empty the object → skipped (clamp).
- falloff band ≥ object → the whole object ramps to the target (the user's
  choice); not treated as an error.
- grayscale source in `colour` mode → colour distance still works (R=G=B).

## Testing

**Backend (pytest, synthetic numpy arrays):**
- `colour_background_alpha`: an image with a known-colour background patch → those
  pixels alpha 0, others 255; a pixel just outside `tolerance` stays foreground.
- `trim_alpha`: a filled square → eroded foreground area is smaller and inset by
  ~`radius`; `pct=0` → identity; an over-large `pct` → clamped to non-empty.
- `edge_falloff`: a filled square, `down` → boundary pixels ≈ 0, interior beyond
  the band unchanged, values increase monotonically across the band; `up` →
  boundary ≈ 255; `pct=0` → identity.
- Endpoint smoke test: the new form fields are accepted and an `LA` PNG returns.

**FE (vitest):**
- Pure helper: parse/format `bgColor`; `%` params map through to the request.
- Eyedropper sets `bgColor` from a sampled pixel.
- `reliefSmooth()` includes the new fields in the POST body.

## Build order

1. Backend pure helpers (`colour_background_alpha`, `trim_alpha`, `edge_falloff`)
   + unit tests.
2. Wire them into `/api/relief/smooth` (params, pipeline order) + endpoint test.
3. FE params + `reliefSmooth()` wrapper + the "Edge & background" controls section.
4. FE eyedropper (sample RGB from the source image).
5. Browser-verify on a real depth map (fuzzy-border + coloured-background cases);
   changelog.

## Out of scope (YAGNI)

- A physical (mm) size for the relief page (offsets are % of object).
- A "curve strength"/exponent knob — v1 uses a single smoothstep.
- Multi-colour / sampled-region keying — single picked colour + tolerance only.
