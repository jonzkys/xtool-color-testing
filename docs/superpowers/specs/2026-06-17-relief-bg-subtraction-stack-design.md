# Relief — connected-area subtraction + stacked background subtractions

**Date:** 2026-06-17
**Status:** Approved (design)

## Summary

Two additions to the Relief / Depth Maps background-subtraction controls:

1. **"Pick area" (connected-component) method** — like the colour picker, a click
   samples a colour, but only the **single contiguous region containing the
   clicked point** is removed (pixels within the colour tolerance, reachable from
   the seed). Identically-coloured regions elsewhere in the image are left intact.

2. **"Subtract another"** — the single background subtraction becomes a **list**
   of subtraction operations whose masks **union** together. Lets a user remove
   the outer background *and* one or more internal features (e.g. an internal
   pocket of a different colour) in one pass.

Both are user-visible Relief enhancements (minor changelog).

## Motivation

The current background removal keys out *all* pixels matching one criterion
(a dark/bright luminance cut, or all pixels within RGB distance of a picked
colour), producing a single alpha mask. That can't:

- remove one background blob while keeping a same-coloured region elsewhere
  (e.g. a logo's interior that happens to match the surround); or
- combine two different removals (outer black background + an interior feature
  that is a different colour).

## Decisions (from brainstorming)

- **Area scope:** one click removes **one** contiguous region. To remove more
  regions, add another subtraction. (No multi-seed accumulation in a single op.)
- **Edge shaping vs. internal holes:** edge shaping (smooth / trim / falloff)
  defaults to the **outer silhouette only**; a new **"Shape internal edges"**
  toggle opts in to shaping internal-hole boundaries too. The fill-holes logic
  is simple, so the toggle is cheap and leaves room to refine internal-detail
  handling later.
- **Architecture:** model the stack as a **list of subtraction ops** sent as a
  JSON field; the backend unions the per-op masks. The `/api/relief/smooth`
  request shape changes (flat `bg_*` fields → a `subtractions` JSON field), but
  our SPA is the only consumer and FE+BE ship together, so no compat shim is
  added (matches the project's "rename + update, no shim" norm). Stretch params
  are **not** persisted, so the `StretchParams` reshape needs no migration.

## Data model

### Frontend (`web/src/components/relief/stretch.ts`)

```ts
export type SubMethod = "dark" | "bright" | "colour" | "area";

export interface Subtraction {
  method: SubMethod;
  /** dark/bright luminance cut (0..255). */
  threshold: number;
  /** colour/area: the picked RGB; null until sampled. */
  color: [number, number, number] | null;
  /** colour/area: Euclidean RGB distance (0..441). */
  tolerance: number;
  /** area: fractional (0..1) seed click in source-image space; null until picked. */
  seedX: number | null;
  seedY: number | null;
}
```

`StretchParams`:
- **removes** `bgMode`, `bgThreshold`, `bgColor`, `bgTolerance`.
- **adds** `subtractions: Subtraction[]` (default: a single `dark` op,
  `threshold: 8`, `tolerance: 40`, `color/seed: null`).
- **adds** `shapeInternal: boolean` (default `false`).

A `defaultSubtraction(method?): Subtraction` helper supplies sensible defaults
for new rows.

### Backend (`src/xcs_gen_web/relief.py`)

A `Subtraction` dataclass mirrors the FE shape:

```python
@dataclass(frozen=True)
class Subtraction:
    method: str                       # "dark" | "bright" | "colour" | "area"
    threshold: int = 8                # dark/bright
    color: tuple[int, int, int] | None = None
    tolerance: float = 40.0
    seed: tuple[float, float] | None = None  # fractional (x, y) in 0..1
```

`parse_subtractions(json_str) -> list[Subtraction]` parses the JSON array,
**tolerantly** (clamps thresholds 0..255, tolerance 0..441, coerces/snaps bad
values, drops entries missing a usable method) rather than 422'ing — matching
the project's "validators snap legacy values" pattern. A malformed top-level
payload yields `[]` (no removal), never an error.

## Backend algorithm

All masks are boolean arrays, `True` = background (to be removed).

New pure helpers in `relief.py`:

- `threshold_background_mask(gray, threshold, high) -> bool[H,W]`
  — `gray <= t` (dark) or `gray >= t` (bright). (Refactor of `background_alpha`.)
- `colour_background_mask(bgr, color_rgb, tolerance) -> bool[H,W]`
  — Euclidean RGB distance `<= tolerance`. (Refactor of `colour_background_alpha`.)
- `area_background_mask(bgr, color_rgb, tolerance, seed_xy) -> bool[H,W]`
  — `colour_background_mask`, then keep only the **connected component
  (8-connectivity) containing the seed pixel**:
  ```python
  cand = colour_background_mask(bgr, color_rgb, tolerance)
  num, labels = cv2.connectedComponents(cand.astype(np.uint8), connectivity=8)
  # Resolve the fractional seed the SAME way the FE eyedropper samples colour
  # (floor, fraction clamped to [0, 1)) so the seed lands on exactly the pixel
  # whose colour was picked — resolution-independent (preview or full-res).
  x = min(W - 1, floor(clamp(seed_x, 0, 0.999999) * W))
  y = min(H - 1, floor(clamp(seed_y, 0, 0.999999) * H))
  lbl = labels[y, x]
  return labels == lbl if lbl != 0 else np.zeros_like(cand)
  ```
  Seed pixel not in the colour range (`lbl == 0`) → empty mask (op contributes
  nothing). `seed_xy is None` → empty mask.
- `combine_backgrounds(masks: list[bool[H,W]]) -> alpha uint8[H,W]`
  — `bg = OR(masks)`; `alpha = where(bg, 0, 255)`. Empty list → all-foreground
  (255) i.e. no removal (caller treats as "no alpha").
- `split_internal_holes(alpha) -> (solid_alpha uint8, holes bool[H,W])`
  — internal holes = background pixels **not reachable from the image border**.
  Fill-holes via `cv2.floodFill` on the inverted mask from a padded border seed;
  `holes = background AND NOT outer_background`; `solid_alpha` = `alpha` with
  holes filled to 255.

Backgrounds resolve against the **colour** image (`bgr`) for colour/area and the
**smoothed gray** (`out`) for dark/bright — same inputs as today.

### Pipeline change in `/api/relief/smooth` (`app.py`)

Replace the flat `bg_mode/bg_threshold/bg_color/bg_tolerance` Form fields with:

```python
subtractions: str = Form("[]")     # JSON array of Subtraction
shape_internal: bool = Form(False)
```

Flow (unchanged except the masking + the hole split):

1. smooth (optional) → `out`.
2. `subs = parse_subtractions(subtractions)`. If `remove_bg` and `subs`:
   build a mask per op (`area`/`colour` from `bgr`, `dark`/`bright` from `out`,
   skipping ops with no usable colour/seed), `alpha = combine_backgrounds(masks)`.
   If every op contributed nothing → `alpha = None` (no removal).
3. CLAHE (optional), masked by `alpha` as today.
4. If `alpha is not None`, edge shaping:
   - `shape_internal == False` (default): `solid, holes = split_internal_holes(alpha)`;
     run `smooth_perimeter` / `trim_alpha` / `edge_falloff` on `solid`; then
     re-punch holes (`alpha[holes] = 0`) hard-edged. With no internal holes this
     is byte-identical to today.
   - `shape_internal == True`: run the shaping on `alpha` directly (all
     boundaries), as today.
   - Encode `LA` PNG.
5. else encode plain PNG.

`remove_bg` stays the master switch (FE only sends a non-empty `subtractions`
when removal is on).

## Frontend

### API client (`web/src/pages/reliefHelpers.ts`)

`reliefSmooth(..., opts.background)` becomes:

```ts
background?: {
  subtractions: Subtraction[];
  perimeterPct: number; trimPct: number;
  falloffPct: number; falloffMode: "inward" | "outward";
  falloffTarget: number; falloffIntensity: number;
  shapeInternal: boolean;
};
```

Posts `remove_bg=true`, `subtractions=<JSON>` (each op serialised as
`{method, threshold, color:[r,g,b]|null, tolerance, seedX, seedY}`),
`shape_internal`, and the existing edge-shaping fields.

### Page (`web/src/pages/ReliefPage.tsx`)

- `bgOpts()` builds the new `background` payload from `stretchParams.subtractions`
  (+ edge shaping + `shapeInternal`); deps updated.
- Eyedropper: `pickingColor: boolean` → `pickingFor: number | null` (the row
  index being picked). The existing fractional-click handler (`onPickFraction`,
  and the wrapper click handler) resolves `(fx, fy)`; on pick it sets
  `subtractions[pickingFor].color` (sampled RGB) **and** `seedX/seedY = fx/fy`
  (seed stored for every pick; the backend only uses it for `area`), then clears
  `pickingFor`.
- `padColorFor(stretchParams)` reads `subtractions[0]` (bright → white,
  colour/area with a picked colour → that colour, else black).

### Controls (`web/src/components/relief/CutoutControls.tsx`)

Under "Remove background":
- A list of **subtraction rows**. Each row:
  - Method `SelectField`: Dark threshold / Bright threshold / Pick colour / **Pick area**.
  - dark/bright → Threshold `Slider`.
  - colour/area → "Pick from image" / "Pick area from image" button + colour
    swatch + value/seed indicator + Tolerance `Slider`.
  - A remove **×** button (shown when more than one row).
- A **"+ Subtract another"** button below the list (appends `defaultSubtraction()`).
- "Edge shaping" section unchanged, plus a **"Shape internal edges"** `Toggle`
  (bound to `shapeInternal`, default off).

`CutoutControlsProps` gains `onPickColor: (index: number) => void` (the row to
pick for) replacing the no-arg version.

## File structure

- `src/xcs_gen_web/relief.py` — new mask helpers, `Subtraction`,
  `parse_subtractions`, `combine_backgrounds`, `split_internal_holes`; keep the
  old `background_alpha`/`colour_background_alpha` as thin wrappers if still used,
  else remove.
- `src/xcs_gen_web/app.py` — `/api/relief/smooth` Form fields + pipeline.
- `web/src/components/relief/stretch.ts` — `Subtraction`, `SubMethod`,
  reshaped `StretchParams`, `defaultSubtraction`.
- `web/src/pages/reliefHelpers.ts` — `reliefSmooth` payload.
- `web/src/pages/ReliefPage.tsx` — `bgOpts`, picker state, `padColorFor`.
- `web/src/components/relief/CutoutControls.tsx` — row list UI.
- Tests: `tests/test_relief.py` (pure mask/parse helpers),
  `tests/test_relief_route.py` (route — migrate the existing flat-`bg_*` tests to
  the new `subtractions` JSON field, add stacked + area cases),
  `web/src/components/relief/stretch.test.ts` (new),
  `web/src/pages/reliefHelpers.test.ts` (extend),
  `web/src/components/relief/controls.test.tsx` (extend).

## Testing

**Backend**
- `area_background_mask`: two same-colour blobs, seed in one → only that blob's
  pixels are `True`; seed on a non-matching pixel → empty mask.
- `combine_backgrounds`: union of two disjoint masks; empty list → all 255.
- `split_internal_holes`: a ring (foreground with an enclosed background hole) →
  `holes` marks the interior; border-connected background is not a hole.
- Default `shape_internal=False` with an internal hole: shaping runs on the
  filled silhouette and the hole is re-punched (alpha 0 there).
- `parse_subtractions`: clamps out-of-range threshold/tolerance, snaps bad
  values, drops method-less entries, malformed JSON → `[]`.
- Route (`test_relief_route.py`): a single-op `subtractions` returns an `LA`
  PNG (replacing the flat-field tests); a two-op stack (dark + area) returns
  `LA`; an empty/no-usable-op `subtractions` returns a plain PNG; out-of-range
  values in the JSON are clamped, not 422'd.

**Frontend**
- `stretch.ts`: `DEFAULT_STRETCH_PARAMS.subtractions` has one `dark` op;
  `shapeInternal === false`; `defaultSubtraction` shape.
- `reliefHelpers.ts`: `reliefSmooth` posts `subtractions` JSON (with seed/color)
  and `shape_internal` when background is supplied.
- `controls.test.tsx`: rows render per method; "Subtract another" appends a row;
  × removes a row (hidden with one row); picker button calls `onPickColor(index)`.

**Browser** (golden path)
- Load a depth map with an outer background and an internal feature; add a dark
  outer subtraction + a "Pick area" subtraction on the internal feature; confirm
  only the clicked region is removed and a same-coloured region elsewhere stays;
  toggle "Shape internal edges" and confirm the internal-hole edge shapes.

## Out of scope (YAGNI)

- Per-subtraction edge shaping (one global edge-shaping section is kept).
- Multi-seed accumulation within a single area op (use "Subtract another").
- Persisting / reordering subtraction rows beyond add/remove.
