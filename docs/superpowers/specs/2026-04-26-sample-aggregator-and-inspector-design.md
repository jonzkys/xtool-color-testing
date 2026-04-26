# Sample aggregator + per-cell inspect-match modal

**Date:** 2026-04-26
**Status:** design — pending implementation plan
**Surface area:**
- Backend: `src/xcs_gen_web/capture_sampling.py`, `src/xcs_gen_web/services/capture.py`,
  `src/xcs_gen_web/schemas.py`, `src/xcs_gen_web/app.py`. New small pure module
  `src/xcs_gen/sampling_aggregators.py`.
- Frontend: new `web/src/components/InspectMatchDialog.tsx`. Edits to
  `web/src/components/ResultDetailDialog.tsx`, `web/src/pages/TestDetailPage.tsx`
  (or wherever the test-edit form lives), `web/src/api/results.ts`,
  `web/src/types.ts`.

## Goal

When the captured swatches don't visually match the burns on the disc, two
things go wrong today:

1. **The aggregator over-biases toward dark + saturated.** The
   saturation-biased median in `_sample_rect` was designed for MOPA
   gradient strips where a thin colored band sits inside a mostly-substrate
   cell. For circle/square cells where the burn fills the whole cell with
   roughly uniform color, that bias produces captured hexes 5–18 L*-units
   *below* the cell's perceptual average — visually "too dark".
2. **The user can't tell why the captured colour drifted.** The result-detail
   dialog just shows the captured swatch. There's no way to see which pixels
   were sampled, or how a different aggregator would treat the same cell.

This spec ships three coupled changes on one feature branch:

1. **Cell-shape-aware sampling region.** Square/circle cells get a 50% inscribed
   mask (square or circular respectively); line/rect cells keep the current 60%
   rectangle. Strictly inside the burn area for symmetric shapes.
2. **User-selectable aggregator on the test spec.** Five legal values:
   `median`, `mean`, `saturation_median`, `trimmed_mean`, `kmeans_dominant`.
   The choice is persisted on the test spec; existing tests (no field) are
   treated as `saturation_median` for back-compat.
3. **Live preview + per-cell inspector.** A new endpoint re-aggregates the
   saved photo without writing to DB, so the result-detail dialog can
   preview any aggregator interactively. Click any swatch in the grid to
   open an "Inspect match" modal showing the cell crop, the sampling region
   overlaid, and a side-by-side comparison of all five aggregators applied
   to that cell.

The visual treatment of the new UI surfaces is delegated to the
**frontend-design** agent — the plan instructs implementation subagents to
use that agent for the dropdown placement, the InspectMatchDialog layout,
and the typographic/palette choices.

## Non-goals

- Per-test bulk reingest (still parking-lot from PR #10).
- Per-result aggregator override (one canonical aggregator per test, picked
  by the user; preview is for comparison only).
- Custom / user-defined aggregators or weighted multi-aggregator outputs.
- Aggregator override at upload time.
- Pixel-histogram or Lab-plot views inside the inspector — the visual
  comparison strip is already information-dense.

## Design

### 1. Sampling-region geometry by `cell_shape`

`_sample_rect(img, cx_px, cy_px, w_px, h_px)` in
`src/xcs_gen_web/capture_sampling.py:54` becomes
`_sample_cell(img, cx_px, cy_px, w_px, h_px, cell_shape, aggregator)`.

The "central region fraction" depends on shape:

| `cell_shape` | Sampling region | Mask construction |
|---|---|---|
| `circle` | 50% of cell width as a circular mask | `mask = (X-cx)² + (Y-cy)² ≤ (w_px*0.5/2)²` |
| `square` | 50% of cell width as a square mask | `mask = abs(X-cx) ≤ w_px*0.25 ∧ abs(Y-cy) ≤ h_px*0.25` |
| `rect`, `line` | 60% of cell as a rectangle (current behavior) | All pixels inside the 60% rect |

Implementation: build the bounding box of the largest dimension at the
appropriate fraction, then apply the mask in NumPy. The pixel count drops
roughly 33% for square/circle vs the current rectangular sample (the
inscribed circle is ~21% of the cell area vs ~36% for the 60% rect; the
inscribed square is 25%). All three are ≥ 100 pixels at the typical
2.55mm cell @ 10 px/mm — comfortably enough for any of the aggregators.

The choice of region is **automatic** — there's no user knob. Cell shape
is already part of the test spec; the region simply follows from it.

### 2. Pure aggregator module — `src/xcs_gen/sampling_aggregators.py`

A new standalone module with five functions, each taking `(pixels: np.ndarray)`
shaped `(N, 3)` BGR uint8 and returning `(b, g, r)` uint8. No I/O, no
OpenCV beyond what's needed for HSV/LAB conversion. Fully unit-testable.

```python
LEGAL_AGGREGATORS = ("median", "mean", "saturation_median", "trimmed_mean", "kmeans_dominant")

def aggregate_median(pixels: np.ndarray) -> tuple[int, int, int]: ...
def aggregate_mean(pixels: np.ndarray) -> tuple[int, int, int]: ...
def aggregate_saturation_median(pixels: np.ndarray) -> tuple[int, int, int]: ...  # current behavior
def aggregate_trimmed_mean(pixels: np.ndarray, trim: float = 0.10) -> tuple[int, int, int]: ...
def aggregate_kmeans_dominant(pixels: np.ndarray, n_clusters: int = 3) -> tuple[int, int, int]: ...

def aggregate(name: str, pixels: np.ndarray) -> tuple[int, int, int]:
    """Dispatch by name. Raises ValueError on unknown aggregator."""
```

`saturation_median` exactly preserves the existing behavior (the current
"drop bottom 50% of saturation, take median of the rest" logic). Important
for back-compat — old tests reading from `swatches_json` keep their colors.

`kmeans_dominant` uses scikit-learn's `KMeans(n_clusters=3, n_init=4,
random_state=0)`. Returns the cluster with the highest pixel count. ~2ms
per cell at this scale. Falls back to plain median when there are fewer
than `n_clusters` distinct colors in the cell (e.g., a perfectly flat
substrate region — KMeans would error).

`trimmed_mean(trim=0.10)` drops the top 10% and bottom 10% of pixels by
luminance, then takes the per-channel mean of the rest. Robust to glare
or dust specks.

### 3. Aggregator on the test spec

Add `sample_aggregator: Optional[str]` to the spec dict in `schemas.py`'s
`TestSpec` (or wherever the Test creation/patch schema is defined; likely
just a permissive `dict` with a Pydantic model alongside).

`run_capture` reads `spec.get("sample_aggregator", "saturation_median")` and
passes through to `sample_grid` → `_sample_cell` → `aggregate(name, pixels)`.

Existing tests with no field act as `saturation_median`. **No migration is
required** — the spec is stored as JSON, missing keys are read as default
on the fly.

UI: a new dropdown on the test create/edit page, in the same row as
`cell_shape`. The default for new tests is:

- `cell_shape ∈ {circle, square}` → `median`
- `cell_shape ∈ {line, rect}` → `saturation_median` (current MOPA behavior)

Defaults are picked by the form when the user changes `cell_shape`, but
they can override.

### 4. Live-preview endpoint

`GET /api/results/{rid}/swatches/preview?aggregator=...` runs the full
capture pipeline against the saved photo (decode → detect → warp), then
applies the requested aggregator. Returns:

```python
class SwatchPreviewResponse(BaseModel):
    aggregator: str  # echo
    swatches: list[ResultSwatch]
```

**Does not write to the DB.** The "Save as test default" button in the UI
issues `PATCH /api/tests/{tid}` to set `spec.sample_aggregator` to the
previewed value, then `POST /api/results/{rid}/reingest` to commit the
swatches.

Auth + ownership + 410 (photo gone) + 400 (capture error) handling
mirrors `results_reingest` exactly. Unknown aggregator name → 400 with the
list of legal values.

The endpoint is intentionally not optimized further (no per-cell pixel
caching) — the warp + sample takes ~1–2s on prod, fine for an
interactive "click to compare" loop. If that turns out to be too slow,
caching the warped image per result is a follow-up.

### 5. UI surfaces

#### 5a. Test create / edit form

A new **"Aggregator"** dropdown next to the existing `cell_shape` selector.
Five options listed plainly: Median, Mean, Saturation-biased median,
Trimmed mean (10%), K-Means dominant. When the user changes `cell_shape`,
the aggregator default flips per Section 3 (but only if the user hasn't
explicitly set one yet).

A small inline caption under the dropdown reads, e.g., "Sampling: 50%
inscribed circle, median over BGR." Updates as the user changes either
field.

#### 5b. Result-detail dialog — aggregator dropdown above the swatch grid

When viewing a result, the user sees a small dropdown above the swatch
grid showing the currently-rendered aggregator. The default selection is
whatever's stored in `swatches_json` (i.e. the aggregator the test spec
had at the time of upload/reingest). Changing the dropdown:

1. Calls `GET /api/results/{rid}/swatches/preview?aggregator=…`.
2. Re-renders the swatch grid + LabScatter + LuminanceRamp from the
   preview swatches.
3. Enables a "Save as test default" button next to the dropdown. Click →
   `PATCH /api/tests/{tid}` then `POST /api/results/{rid}/reingest` →
   refetches.

Visual treatment delegated to the frontend-design agent. The expected
register: a small Tailwind dropdown matching the existing right-side
controls, JetBrains Mono caption, the metallic-bar accent if it fits.

#### 5c. Inspect-match modal — `InspectMatchDialog.tsx` (new)

Triggered by clicking any `SwatchTile` in the result-detail's swatch
grid. Modal contents (delegate visual treatment to frontend-design):

- **Header**: cell coordinates ("row 7, col 4 · frequency 125 · pulse_width 53"),
  σ value, currently-displayed aggregator.
- **Top half — visual inspector**: two large image panels side by side.
  - Left: the cell crop from the warped image (~200 px square).
  - Right: same crop with the sampling region overlaid (circular outline
    for `circle`, square outline for `square`, dashed rectangle for `rect`/
    `line`). Lets the user see exactly what pixels got sampled.
- **Bottom half — aggregator comparison strip**: five tiles in a row,
  one per aggregator. Each tile is a solid colored block (the hex result
  of that aggregator on this cell) with the hex value + aggregator name
  labelled below. The currently-active aggregator gets a highlighted
  border. Click any tile → switches the result's currently-displayed
  aggregator to that one (closes the modal, re-renders the grid in the
  underlying dialog via the same preview path as Section 5b).

The five aggregators are computed client-side? No — server-side via the
preview endpoint (one call per aggregator). To avoid five round trips,
the inspect modal does a single `GET /api/results/{rid}/inspect/{row}/{col}`
that returns:

```python
class InspectCellResponse(BaseModel):
    row: int; col: int
    x_value: float; y_value: float | None
    sigma: float
    cell_image_b64: str       # warped cell crop, PNG base64
    sampling_region: dict     # { "shape": "circle", "diameter_px": 13, "center_px": [12, 12] }
    aggregator_results: dict[str, str]  # { "median": "#4e4436", "mean": "...", ... }
```

One round trip per swatch click. Image is small (~200 px square,
sub-30 KB encoded).

### 6. Data flow

**Live-preview flow:**
```
UI dropdown change in result-detail
  → GET /api/results/{rid}/swatches/preview?aggregator=mean
  → server: r_repo.get → t_repo.get → images.read
       → run_capture-without-write (decode + detect + warp + aggregate)
  → returns swatches[]
  → UI re-renders swatch grid + LabScatter + LuminanceRamp
  → Save-as-default enabled
```

**Save-as-default flow:**
```
UI Save button click
  → PATCH /api/tests/{tid} body={ spec: {...spec, sample_aggregator: "mean"} }
  → POST /api/results/{rid}/reingest  (or "for-test" variant — out of scope)
  → UI refetch results → swatches now stored with the new aggregator
```

**Inspect-match flow:**
```
UI swatch click in result-detail grid
  → GET /api/results/{rid}/inspect/{row}/{col}
  → server: r_repo.get → t_repo.get → images.read → decode → detect → warp
       → extract cell crop (PNG b64) + run all 5 aggregators on it
  → returns InspectCellResponse
  → UI opens InspectMatchDialog with the data
```

### 7. Error handling

| Failure mode | Endpoint behavior |
|---|---|
| Unknown `aggregator` query value | 400 with `f"unknown aggregator: {name!r}; legal values: {LEGAL_AGGREGATORS}"`. |
| Result not found / wrong owner | 404 (existing pattern). |
| Source image gone (FS or S3) | 410 with `"source image no longer available"`. Mirrors `results_reingest`. |
| `run_capture` raises `CaptureError` | 400 with the exception message. Row not modified. |
| K-means fails on a flat cell (< n_clusters distinct pixels) | Falls back to plain median for THAT cell, logs a warning. Doesn't fail the whole request. |

### 8. Testing

- **Unit (pure aggregators)** — `tests/test_sampling_aggregators.py`: each of
  the 5 functions tested against hand-crafted `np.array` inputs with known
  expected outputs. K-means tested with a 2-cluster input where the dominant
  cluster is obvious. K-means flat-cell fallback tested.
- **Unit (sample_grid + cell_shape)** — extend `tests/test_capture_sampling.py`:
  - `_sample_cell` with `cell_shape="circle"` excludes corner pixels (test
    a synthetic cell with bright corners + dark center; the median should
    be the center color).
  - `_sample_cell` with `cell_shape="square"` excludes outside the 50% box.
  - `_sample_cell` with `cell_shape="rect"` matches the current 60%
    rectangle behavior (regression).
- **Integration** — `tests/test_results_api.py`:
  - Preview endpoint happy path with each of the 5 aggregators.
  - Preview endpoint with unknown aggregator → 400.
  - Preview endpoint photo-gone → 410.
  - Preview endpoint wrong-owner → 404.
  - Inspect endpoint happy path; returns image b64 + 5 aggregator results.
  - Save-as-default: PATCH + reingest writes the new aggregator to
    `swatches_json` and the test spec.
- **Vitest**:
  - Aggregator dropdown in result-detail re-renders swatches via mocked
    preview API.
  - InspectMatchDialog opens on swatch click and shows 5 tiles.
  - Click on a tile switches the result's aggregator and closes the modal.
- **Manual on prod** with `samples/Unknown.jpg` against test #23: switch
  through all 5 aggregators in the result-detail dropdown. Verify
  `median` and `mean` produce visibly closer matches to the actual cells
  than `saturation_median`. Open the inspect modal on row-7 col-4 and
  confirm the 5 aggregator tiles span the expected lightness range.

### 9. Files touched

| Path | Action |
|---|---|
| `src/xcs_gen/sampling_aggregators.py` | **Create** — 5 pure functions + `aggregate(name, pixels)` dispatcher. |
| `src/xcs_gen_web/capture_sampling.py` | Refactor `_sample_rect` → `_sample_cell` taking `cell_shape` + `aggregator`. Build the appropriate mask. |
| `src/xcs_gen_web/services/capture.py` | `run_capture` reads `spec["sample_aggregator"]` (default `saturation_median`). New `aggregate_warped(warped, spec, aggregator) -> swatches` helper used by the preview + inspect endpoints. |
| `src/xcs_gen_web/schemas.py` | `TestSpec.sample_aggregator: Optional[str]`. New `SwatchPreviewResponse` and `InspectCellResponse`. |
| `src/xcs_gen_web/app.py` | New `GET /api/results/{rid}/swatches/preview` and `GET /api/results/{rid}/inspect/{row}/{col}` endpoints. |
| `tests/test_sampling_aggregators.py` | **Create**. |
| `tests/test_capture_sampling.py` | Extend for cell_shape masks. |
| `tests/test_results_api.py` | Extend for preview + inspect + save-as-default flows. |
| `web/src/types.ts` | `TestSpec.sample_aggregator?` and the literal-string-union type. |
| `web/src/api/results.ts` | `previewSwatches(rid, aggregator)`, `inspectCell(rid, row, col)`. |
| `web/src/pages/TestDetailPage.tsx` (or wherever the test edit form lives) | Aggregator dropdown next to cell_shape. |
| `web/src/components/ResultDetailDialog.tsx` | Aggregator dropdown above the swatch grid; SwatchTile clicks now open InspectMatchDialog. |
| `web/src/components/InspectMatchDialog.tsx` | **Create**. Visual treatment by frontend-design. |
| `web/src/components/InspectMatchDialog.test.tsx` | Vitest. |

## Branching / commit shape

Single branch `feat/sample-aggregator-and-inspector`, three logically-separable
commits inside one PR:

1. `feat(capture): pure aggregator module + cell-shape-aware sampling region`
   — covers the backend math foundations. No new endpoints, no UI. Existing
   `_sample_rect` callers migrate to `_sample_cell` calling
   `aggregate("saturation_median", pixels)`. Behavior unchanged for existing
   tests.

2. `feat(api): aggregator on test spec + preview + inspect endpoints`
   — adds the three new endpoints + plumbs `sample_aggregator` through
   `run_capture` / `_persist_upload`. Existing test specs without the
   field still work (default to `saturation_median`).

3. `feat(web): aggregator dropdown + inspect-match modal`
   — UI work. Frontend-design agent shapes the visual layout for both the
   dropdown placement and the InspectMatchDialog.

## Risks / open questions

- **Test edit page identification.** The plan assumes the test edit form
  lives in `TestDetailPage.tsx` (or similar). Implementation step 1 should
  grep for the existing `cell_shape` selector and place the new dropdown
  next to it; flag if it lives somewhere unexpected.
- **K-means perf at scale.** 81 cells × 2ms = 162ms for one full result.
  Fine. For larger tests (hypothetical 200+ cells) it could matter; not in
  scope to optimize now.
- **PATCH /api/tests/{tid} accepts spec edits.** Confirmed — PR #11 (already
  merged) added material editing on ingested tests. Need to verify the
  existing PATCH allows arbitrary spec field updates (it should, given how
  the spec is stored as a dict).
- **Preview + reingest atomicity.** "Save as test default" is two API calls
  (PATCH then reingest). If the PATCH succeeds and the reingest fails,
  the test spec has the new aggregator but the result still has old
  swatches. UI surfaces the reingest failure as a toast; the user can
  re-click. Acceptable.

## Out of scope follow-ups (parking lot)

- Per-test bulk reingest button (when needed for a test with many results).
- Per-result aggregator override stored alongside the result.
- Caching the warped image per result to make preview/inspect snap-fast.
- Pixel histogram / Lab scatter inside the inspect modal.
- Custom user-defined aggregators.
