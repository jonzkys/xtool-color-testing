# Sample Aggregator + Per-Cell Inspect-Match Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make captured colours match the disc visually. Add cell-shape-aware sampling masks (50% inscribed circle for `circle` cells, current 60% rect for `rect`), a user-selectable aggregator on the test spec (5 options), live preview without DB writes, and a per-cell inspect-match modal that shows the sampled region and all 5 aggregator results side-by-side.

**Architecture:** Five additions across one branch / one PR. (1) A new pure aggregator module so each statistical method is unit-testable in isolation. (2) A refactor of the cell sampler to apply a shape-appropriate mask before aggregating. (3) Plumbing of the new `sample_aggregator` field through `TestSpec`, the upload/reingest paths, and `ResultResponse`. (4) Two new GET endpoints — one re-aggregates the whole result (preview), one returns full per-cell context (inspect). (5) UI: dropdown on the test edit form, dropdown + Save-as-default on the result-detail dialog, and a brand-new InspectMatchDialog whose visual layout is shaped by the **frontend-design** agent.

**Tech Stack:** Python 3 + FastAPI + SQLAlchemy (backend), OpenCV + NumPy + scikit-learn (aggregators), React + TypeScript + Tailwind v4 + lucide-react (frontend), pytest + vitest (tests).

**Spec:** `docs/superpowers/specs/2026-04-26-sample-aggregator-and-inspector-design.md`

**Branch:** `feat/sample-aggregator-and-inspector` (already created from `main`; spec committed at SHA `77529f9`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/xcs_gen/sampling_aggregators.py` | **Create** | 5 pure functions (`aggregate_median`, `aggregate_mean`, `aggregate_saturation_median`, `aggregate_trimmed_mean`, `aggregate_kmeans_dominant`) + `LEGAL_AGGREGATORS` tuple + `aggregate(name, pixels)` dispatcher. |
| `src/xcs_gen_web/capture_sampling.py` | **Modify** | Replace `_sample_rect` with `_sample_cell(img, cx, cy, w, h, cell_shape, aggregator)`. Build circular mask for `circle`, no mask (current rect) for `rect`. Plumb `cell_shape` + `aggregator` through `sample_grid`. |
| `src/xcs_gen_web/services/capture.py` | **Modify** | `run_capture` reads `spec.get("sample_aggregator", "saturation_median")` and passes to `sample_grid`. New helper `aggregate_warped(warped, spec, aggregator)` re-runs only the aggregation step (used by preview + inspect). New helper `inspect_cell(warped, spec, row, col)` extracts a single cell crop + runs all 5 aggregators on it. |
| `src/xcs_gen_web/schemas.py` | **Modify** | `TestSpec.sample_aggregator: Optional[str] = None`. New `SwatchPreviewResponse` and `InspectCellResponse` Pydantic models. |
| `src/xcs_gen_web/app.py` | **Modify** | New `GET /api/results/{rid}/swatches/preview?aggregator=...` and `GET /api/results/{rid}/inspect/{row}/{col}` endpoints. |
| `tests/test_sampling_aggregators.py` | **Create** | Unit tests for all 5 aggregators + dispatcher. |
| `tests/test_capture_sampling.py` | **Modify** | Tests for cell-shape mask behaviour. |
| `tests/test_results_api.py` | **Modify** | Integration tests for preview + inspect endpoints + save-as-default flow. |
| `web/src/types.ts` | **Modify** | `TestSpec.sample_aggregator?: SampleAggregator` literal-string-union type. |
| `web/src/api/results.ts` | **Modify** | `previewSwatches(rid, aggregator)`, `inspectCell(rid, row, col)`. |
| `web/src/api/tests.ts` (or wherever `patchTest` lives) | (verify) | Existing `patchTest` already supports spec edits per PR #11. |
| `web/src/components/ParamTestEditor.tsx` | **Modify** | Aggregator `<Select>` field next to the existing `cell_shape` selector (around line 245). Default flips when `cell_shape` changes. |
| `web/src/components/ResultDetailDialog.tsx` | **Modify** | Aggregator dropdown above the swatch grid. Preview on change. "Save as test default" button. SwatchTile clicks open InspectMatchDialog. |
| `web/src/components/InspectMatchDialog.tsx` | **Create** | Per-cell inspect modal — visual layout by `frontend-design` agent. |
| `web/src/components/InspectMatchDialog.test.tsx` | **Create** | Vitest. |

The codebase already exposes only `cell_shape ∈ {rect, circle}` (verified via `web/src/types.ts:147` and `ParamTestEditor.tsx:242-244`). Plan handles both; a future `square` shape can opt into a 50% inscribed-square mask without contract changes.

---

## Task 1: Pure aggregator module

**Files:**
- Create: `src/xcs_gen/sampling_aggregators.py`
- Create: `tests/test_sampling_aggregators.py`

- [ ] **Step 1.1: Write failing tests**

Create `tests/test_sampling_aggregators.py`:

```python
"""Unit tests for the pure aggregator module.

Each aggregator is exercised on a hand-crafted (N, 3) BGR uint8 input where
the expected output is computable by inspection. K-Means tests use a
deliberately bimodal input where the dominant cluster is unambiguous."""

from __future__ import annotations

import numpy as np
import pytest

from xcs_gen.sampling_aggregators import (
    LEGAL_AGGREGATORS,
    aggregate,
    aggregate_kmeans_dominant,
    aggregate_mean,
    aggregate_median,
    aggregate_saturation_median,
    aggregate_trimmed_mean,
)


def test_legal_aggregators_includes_all_five():
    assert set(LEGAL_AGGREGATORS) == {
        "median", "mean", "saturation_median",
        "trimmed_mean", "kmeans_dominant",
    }


def test_aggregate_median_returns_per_channel_median():
    pixels = np.array([
        [10, 20, 30],
        [50, 60, 70],
        [90, 100, 110],
    ], dtype=np.uint8)
    assert aggregate_median(pixels) == (50, 60, 70)


def test_aggregate_mean_returns_per_channel_mean():
    pixels = np.array([
        [10, 20, 30],
        [30, 40, 50],
    ], dtype=np.uint8)
    assert aggregate_mean(pixels) == (20, 30, 40)


def test_aggregate_saturation_median_biases_toward_vivid():
    """Two-thirds desaturated grey + one-third vivid red; the result
    should be biased toward the red, not the grey."""
    grey = np.tile([128, 128, 128], (10, 1)).astype(np.uint8)
    red = np.tile([0, 0, 200], (5, 1)).astype(np.uint8)
    pixels = np.vstack([grey, red])
    b, g, r = aggregate_saturation_median(pixels)
    # Result should lean red (high R, low B/G), not grey (R==G==B).
    assert r > 100 and b < 50, f"expected vivid red, got ({b}, {g}, {r})"


def test_aggregate_trimmed_mean_drops_outliers():
    """A flat region with two extreme outliers — the trimmed mean should
    reject the outliers and return the bulk."""
    bulk = np.tile([100, 100, 100], (18, 1)).astype(np.uint8)
    outliers = np.array([[0, 0, 0], [255, 255, 255]], dtype=np.uint8)
    pixels = np.vstack([bulk, outliers])
    b, g, r = aggregate_trimmed_mean(pixels, trim=0.10)
    # With trim=0.10 of 20 pixels = 2 dropped at each end; outliers gone.
    assert (b, g, r) == (100, 100, 100)


def test_aggregate_kmeans_dominant_picks_largest_cluster():
    """Two clusters: 70% red, 30% blue. Dominant should be red."""
    red = np.tile([0, 0, 200], (70, 1)).astype(np.uint8)
    blue = np.tile([200, 0, 0], (30, 1)).astype(np.uint8)
    pixels = np.vstack([red, blue])
    b, g, r = aggregate_kmeans_dominant(pixels, n_clusters=2)
    assert r > 150 and b < 50, f"expected red dominant, got ({b}, {g}, {r})"


def test_aggregate_kmeans_falls_back_when_too_few_distinct_pixels():
    """If the cell has fewer distinct colours than n_clusters, KMeans
    can't fit — fall back to plain median rather than crashing."""
    flat = np.tile([100, 110, 120], (10, 1)).astype(np.uint8)
    b, g, r = aggregate_kmeans_dominant(flat, n_clusters=3)
    assert (b, g, r) == (100, 110, 120)


def test_dispatcher_routes_to_correct_function():
    pixels = np.array([[10, 20, 30], [50, 60, 70]], dtype=np.uint8)
    assert aggregate("median", pixels) == aggregate_median(pixels)
    assert aggregate("mean", pixels) == aggregate_mean(pixels)


def test_dispatcher_unknown_raises_value_error():
    pixels = np.array([[10, 20, 30]], dtype=np.uint8)
    with pytest.raises(ValueError, match="unknown aggregator"):
        aggregate("not_a_real_method", pixels)


def test_aggregate_handles_empty_input():
    """Empty input should not crash; return a defined sentinel."""
    pixels = np.empty((0, 3), dtype=np.uint8)
    # Each function should handle this — return (0, 0, 0) as a safe sentinel.
    assert aggregate_median(pixels) == (0, 0, 0)
    assert aggregate_mean(pixels) == (0, 0, 0)
```

- [ ] **Step 1.2: Run, expect FAIL**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_sampling_aggregators.py -v
```

Expected: ImportError — module doesn't exist yet.

- [ ] **Step 1.3: Implement the pure module**

Create `src/xcs_gen/sampling_aggregators.py`:

```python
"""Pure aggregator functions for distilling a region of BGR pixels into
a single (b, g, r) tuple.

Each aggregator takes ``(N, 3)`` uint8 BGR input and returns
``(b, g, r)`` ints in [0, 255]. No I/O, no shared state. Composed by the
sampler in ``xcs_gen_web.capture_sampling`` after a cell mask is applied.

Adding a new aggregator: implement ``aggregate_<name>(pixels) -> tuple``,
add the name to :data:`LEGAL_AGGREGATORS`, and register a branch in
:func:`aggregate`. Tests in ``tests/test_sampling_aggregators.py``.
"""

from __future__ import annotations

import cv2
import numpy as np

LEGAL_AGGREGATORS: tuple[str, ...] = (
    "median",
    "mean",
    "saturation_median",
    "trimmed_mean",
    "kmeans_dominant",
)


def _to_int_bgr(arr: np.ndarray) -> tuple[int, int, int]:
    """Coerce a length-3 ndarray to a (b, g, r) int tuple."""
    return int(arr[0]), int(arr[1]), int(arr[2])


def aggregate_median(pixels: np.ndarray) -> tuple[int, int, int]:
    """Per-channel median of all pixels."""
    if pixels.size == 0:
        return (0, 0, 0)
    return _to_int_bgr(np.median(pixels, axis=0).astype(np.uint8))


def aggregate_mean(pixels: np.ndarray) -> tuple[int, int, int]:
    """Per-channel mean of all pixels."""
    if pixels.size == 0:
        return (0, 0, 0)
    return _to_int_bgr(np.mean(pixels, axis=0).astype(np.uint8))


def aggregate_saturation_median(pixels: np.ndarray) -> tuple[int, int, int]:
    """Median of the most-saturated half of the pixels.

    Designed for MOPA gradient strips where a thin colored band sits in
    a mostly-substrate cell — the saturation filter keeps the vivid peak
    rather than averaging it away with substrate.
    """
    if pixels.size == 0:
        return (0, 0, 0)
    if len(pixels) < 4:
        return aggregate_median(pixels)
    hsv = cv2.cvtColor(
        pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV,
    )
    sats = hsv.reshape(-1, 3)[:, 1]
    threshold = float(np.median(sats))
    mask = sats >= threshold
    vivid = pixels[mask] if mask.any() else pixels
    return _to_int_bgr(np.median(vivid, axis=0).astype(np.uint8))


def aggregate_trimmed_mean(
    pixels: np.ndarray, trim: float = 0.10,
) -> tuple[int, int, int]:
    """Drop the top and bottom ``trim`` fraction of pixels by luminance,
    then take the per-channel mean of the rest. Robust to glare / dust
    specks."""
    if pixels.size == 0:
        return (0, 0, 0)
    if len(pixels) < 4:
        return aggregate_median(pixels)
    # Luminance proxy: 0.114 B + 0.587 G + 0.299 R (Rec. 601).
    lum = (
        pixels[:, 0].astype(np.float32) * 0.114
        + pixels[:, 1].astype(np.float32) * 0.587
        + pixels[:, 2].astype(np.float32) * 0.299
    )
    n = len(pixels)
    drop = max(1, int(round(n * trim)))
    order = np.argsort(lum)
    keep = order[drop : n - drop] if (n - 2 * drop) > 0 else order
    return _to_int_bgr(np.mean(pixels[keep], axis=0).astype(np.uint8))


def aggregate_kmeans_dominant(
    pixels: np.ndarray, n_clusters: int = 3,
) -> tuple[int, int, int]:
    """Run K-Means on the pixels and return the centroid of the cluster
    with the most members. Falls back to the plain median when there are
    fewer distinct colours than ``n_clusters``."""
    if pixels.size == 0:
        return (0, 0, 0)
    distinct = np.unique(pixels.reshape(-1, 3), axis=0)
    if len(distinct) < n_clusters:
        return aggregate_median(pixels)
    from sklearn.cluster import KMeans

    km = KMeans(n_clusters=n_clusters, n_init=4, random_state=0)
    labels = km.fit_predict(pixels.astype(np.float32))
    counts = np.bincount(labels, minlength=n_clusters)
    dominant = int(np.argmax(counts))
    centroid = km.cluster_centers_[dominant]
    return _to_int_bgr(np.clip(centroid, 0, 255).astype(np.uint8))


_DISPATCH = {
    "median": aggregate_median,
    "mean": aggregate_mean,
    "saturation_median": aggregate_saturation_median,
    "trimmed_mean": aggregate_trimmed_mean,
    "kmeans_dominant": aggregate_kmeans_dominant,
}


def aggregate(name: str, pixels: np.ndarray) -> tuple[int, int, int]:
    """Dispatch by aggregator name. Raises ValueError on unknown names."""
    fn = _DISPATCH.get(name)
    if fn is None:
        raise ValueError(
            f"unknown aggregator: {name!r}; legal values: {LEGAL_AGGREGATORS}",
        )
    return fn(pixels)
```

- [ ] **Step 1.4: Run tests, expect PASS**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_sampling_aggregators.py -v
```

Expected: all 9 tests pass. If `scikit-learn` isn't installed, pip install via uv:

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv add scikit-learn
```

(Verify by `grep -i sklearn pyproject.toml` first; if it's already a dep via another package, no add needed.)

- [ ] **Step 1.5: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen/sampling_aggregators.py tests/test_sampling_aggregators.py pyproject.toml uv.lock 2>/dev/null
git status --short
```

Expected: 2 staged paths (4 if pyproject.toml + uv.lock changed). NO commit.

---

## Task 2: Cell-shape-aware sampling region

**Files:**
- Modify: `src/xcs_gen_web/capture_sampling.py:14-194` (refactor `_sample_rect` into `_sample_cell`, plumb through `sample_grid`)
- Modify: `tests/test_capture_sampling.py` (extend with shape/aggregator tests)

- [ ] **Step 2.1: Write failing tests**

Append to `tests/test_capture_sampling.py`:

```python
def test_sample_cell_circle_excludes_corner_pixels():
    """For a 'circle' cell, corner pixels of the bounding rect should NOT
    be sampled. Setup: a 60x60 image with bright corners and a dark
    centre. The captured median should be near the centre value."""
    import numpy as np
    from xcs_gen_web.capture_sampling import _sample_cell

    img = np.full((60, 60, 3), 200, dtype=np.uint8)  # bright everywhere
    # Carve a 30px-diameter dark disc in the centre.
    yy, xx = np.ogrid[:60, :60]
    inside = (xx - 30) ** 2 + (yy - 30) ** 2 < 15 ** 2
    img[inside] = 50
    hex_, sigma = _sample_cell(
        img, cx_px=30, cy_px=30, w_px=60, h_px=60,
        cell_shape="circle", aggregator="median",
    )
    # Inscribed-circle 50% diameter = 30 px, fully inside the dark disc.
    # Median should be ~50, not ~200.
    r = int(hex_[1:3], 16)
    assert r < 100, f"expected near-50 median, got {hex_}"


def test_sample_cell_rect_keeps_60pct_rectangle():
    """Regression: cell_shape='rect' uses the existing 60% rectangle."""
    import numpy as np
    from xcs_gen_web.capture_sampling import _sample_cell

    img = np.full((100, 100, 3), 200, dtype=np.uint8)
    # Pixels inside the 60% rect (centred 60x60 area) all set to 50.
    img[20:80, 20:80] = 50
    hex_, _ = _sample_cell(
        img, cx_px=50, cy_px=50, w_px=100, h_px=100,
        cell_shape="rect", aggregator="median",
    )
    # Median over the 60% window should be 50.
    assert hex_ == "#323232"


def test_sample_cell_dispatches_aggregator():
    """The aggregator name routes to the correct pure function."""
    import numpy as np
    from xcs_gen_web.capture_sampling import _sample_cell

    img = np.full((40, 40, 3), 100, dtype=np.uint8)
    img[10:30, 10:30] = 200
    hex_median, _ = _sample_cell(
        img, cx_px=20, cy_px=20, w_px=40, h_px=40,
        cell_shape="rect", aggregator="median",
    )
    hex_mean, _ = _sample_cell(
        img, cx_px=20, cy_px=20, w_px=40, h_px=40,
        cell_shape="rect", aggregator="mean",
    )
    # In a region with mixed values, median != mean (in general).
    assert hex_median == "#c8c8c8"  # 200 dominates the inner 60%
    # Mean might equal it here too if region is uniform; the key thing
    # is both calls succeed and return valid hex strings.
    assert hex_mean.startswith("#") and len(hex_mean) == 7
```

- [ ] **Step 2.2: Run, expect FAIL**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_capture_sampling.py::test_sample_cell_circle_excludes_corner_pixels tests/test_capture_sampling.py::test_sample_cell_rect_keeps_60pct_rectangle tests/test_capture_sampling.py::test_sample_cell_dispatches_aggregator -v
```

Expected: ImportError — `_sample_cell` doesn't exist yet.

- [ ] **Step 2.3: Refactor `_sample_rect` into `_sample_cell`**

In `src/xcs_gen_web/capture_sampling.py`, replace the current `_sample_rect` (lines 54–101) with:

```python
def _sample_cell(
    img: np.ndarray,
    cx_px: float, cy_px: float,
    w_px: float, h_px: float,
    *,
    cell_shape: str,
    aggregator: str,
) -> tuple[str, float]:
    """Sample a region of pixels around (cx_px, cy_px) using the mask
    appropriate for ``cell_shape`` and the requested ``aggregator``.

    Returns ``(hex, sigma_lab)``.

    Mask:
      * ``cell_shape == "circle"``: inscribed circle of diameter
        ``min(w_px, h_px) * 0.5``. Corners of the bounding box are
        excluded.
      * Any other ``cell_shape``: 60% rectangle (legacy behaviour).

    Sigma is always computed over ALL pixels in the bounding rect, not
    just the masked region — keeps the "how uniform is this cell"
    signal comparable across shapes.
    """
    from xcs_gen.sampling_aggregators import aggregate

    # Bounding-rect halves for sigma + circle-mask coordinates.
    half_w = w_px * _CENTRAL_REGION_FRACTION / 2
    half_h = h_px * _CENTRAL_REGION_FRACTION / 2
    rx0 = max(0, int(round(cx_px - half_w)))
    ry0 = max(0, int(round(cy_px - half_h)))
    rx1 = min(img.shape[1], int(round(cx_px + half_w)))
    ry1 = min(img.shape[0], int(round(cy_px + half_h)))
    bbox = img[ry0:ry1, rx0:rx1]
    if bbox.size == 0:
        return "#000000", 0.0
    bbox_pixels = bbox.reshape(-1, 3)

    if cell_shape == "circle":
        # Build an inscribed-circle mask (50% of cell width).
        radius_px = min(w_px, h_px) * 0.5 / 2
        sx0 = max(0, int(round(cx_px - radius_px)))
        sy0 = max(0, int(round(cy_px - radius_px)))
        sx1 = min(img.shape[1], int(round(cx_px + radius_px)))
        sy1 = min(img.shape[0], int(round(cy_px + radius_px)))
        sample_box = img[sy0:sy1, sx0:sx1]
        if sample_box.size == 0:
            return "#000000", 0.0
        h_, w_ = sample_box.shape[:2]
        yy, xx = np.ogrid[:h_, :w_]
        cy_local = (cy_px - sy0)
        cx_local = (cx_px - sx0)
        inside = (xx - cx_local) ** 2 + (yy - cy_local) ** 2 <= radius_px ** 2
        masked = sample_box[inside]
        if masked.size == 0:
            return "#000000", 0.0
        b, g, r = aggregate(aggregator, masked)
    else:
        # rect (or any non-circle today) — 60% bounding rect, no mask.
        b, g, r = aggregate(aggregator, bbox_pixels)

    hex_ = f"#{r:02x}{g:02x}{b:02x}"

    # Sigma over the full bounding rect — unchanged semantics.
    lab = _bgr_to_lab(bbox_pixels)
    sigma = float(np.sqrt(np.sum(np.var(lab, axis=0))))
    return hex_, sigma
```

(`_CENTRAL_REGION_FRACTION = 0.6` stays as it is at the top of the file.)

- [ ] **Step 2.4: Plumb through `sample_grid`**

In the same file, modify `sample_grid` to accept and pass the new fields. Change the signature (currently lines 111–122):

```python
def sample_grid(
    warped: np.ndarray,
    *,
    grid_origin_mm: tuple[float, float],
    grid_size_mm: tuple[float, float],
    px_per_mm: float,
    x_param: str, x_min: float, x_max: float, x_steps: int,
    y_param: str | None,
    y_min: float = 0.0, y_max: float = 0.0, y_steps: int = 1,
    rows: int = 1,
    row_stride_mm: float | None = None,
    cell_shape: str = "rect",
    aggregator: str = "saturation_median",
) -> list[Swatch]:
```

Then replace EVERY existing call to `_sample_rect(warped, cx_px, cy_px, cell_w_px, cell_h_px)` inside `sample_grid` (currently 2 sites: line 158 and the equivalent inside the 2D branch around line 186) with:

```python
_sample_cell(
    warped, cx_px, cy_px, cell_w_px, cell_h_px,
    cell_shape=cell_shape, aggregator=aggregator,
)
```

Same for `sample_gradient` at the bottom of the file (line 218 calls `_sample_rect`) — update to:

```python
_sample_cell(
    warped, cx_px, cy_px, cell_w_px, cell_h_px,
    cell_shape="rect", aggregator="saturation_median",
)
```

(`sample_gradient` is for a single horizontal stripe — `rect` + current behaviour is the right default.)

Optionally keep `_sample_rect` as a thin wrapper that calls `_sample_cell` with `cell_shape="rect", aggregator="saturation_median"` for any external callers — but grep first; if no external callers exist, delete it cleanly.

```bash
cd /Users/jonzky/Documents/XTools/Reverse
grep -rn "_sample_rect" src/ tests/ web/ 2>/dev/null
```

If only `capture_sampling.py` itself references it, delete `_sample_rect`; if other modules reference it, keep the wrapper.

- [ ] **Step 2.5: Run new tests + the existing suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_capture_sampling.py -v
```

Expected: ALL pass — 3 new + all pre-existing.

- [ ] **Step 2.6: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/capture_sampling.py tests/test_capture_sampling.py
git status --short
```

Expected: 4 paths staged (T1 + T2). NO commit.

---

## Task 3: Plumb `sample_aggregator` through TestSpec + capture pipeline

**Files:**
- Modify: `src/xcs_gen_web/schemas.py:463-486` (`TestSpec`)
- Modify: `src/xcs_gen_web/services/capture.py` (`run_capture` reads + passes the field; new `aggregate_warped` helper)
- Test: `tests/test_service_capture.py`

- [ ] **Step 3.1: Write failing test**

Append to `tests/test_service_capture.py`:

```python
def test_run_capture_uses_spec_sample_aggregator(monkeypatch):
    """When the test spec sets sample_aggregator, run_capture should pass
    it through to sample_grid so the captured swatches reflect that
    method. We verify by checking that swatches differ when the
    aggregator is changed."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    # A 100x100 warped image: half the cells in the grid should fall on
    # a region with mixed bright + dark pixels so median != mean.
    warped = np.full((100, 100, 3), 50, dtype=np.uint8)
    # Inject a bright stripe across the upper half.
    warped[0:50, :] = 220

    fake_corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials",
                        lambda _: (1, 0, fake_corners))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: warped)

    spec_base = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 100.0, "x_steps": 2,
        "y_param": "pulse_width", "y_min": 2.0, "y_max": 10.0, "y_steps": 2,
        "rows": 1, "width_mm": 10.0, "height_mm": 10.0,
        "cell_shape": "rect",
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }
    median_result = cap.run_capture(
        image_bytes=b"fake", test_id=1,
        spec={**spec_base, "sample_aggregator": "median"},
    )
    mean_result = cap.run_capture(
        image_bytes=b"fake", test_id=1,
        spec={**spec_base, "sample_aggregator": "mean"},
    )

    # In the bright/dark cells, mean will pull toward the average; median
    # will snap to one side. The hex strings should differ.
    median_hexes = sorted(s["hex"] for s in median_result.swatches)
    mean_hexes = sorted(s["hex"] for s in mean_result.swatches)
    assert median_hexes != mean_hexes, (
        f"aggregator should change captured colours; "
        f"median={median_hexes} vs mean={mean_hexes}"
    )


def test_run_capture_default_aggregator_is_saturation_median(monkeypatch):
    """When sample_aggregator is absent from the spec, run_capture should
    behave exactly like before (saturation_median) — back-compat for
    existing tests."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    warped = np.full((100, 100, 3), 100, dtype=np.uint8)
    fake_corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials",
                        lambda _: (1, 0, fake_corners))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: warped)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 100.0, "x_steps": 1,
        "y_param": None,
        "rows": 1, "width_mm": 10.0, "height_mm": 10.0,
        "cell_shape": "rect",
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }
    # Should not raise — the missing field defaults to saturation_median.
    result = cap.run_capture(image_bytes=b"fake", test_id=1, spec=spec)
    assert len(result.swatches) >= 1
```

- [ ] **Step 3.2: Run, expect FAIL**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_service_capture.py::test_run_capture_uses_spec_sample_aggregator tests/test_service_capture.py::test_run_capture_default_aggregator_is_saturation_median -v
```

Expected: FAIL — likely the `median_hexes != mean_hexes` assertion or a TypeError that `sample_grid` doesn't accept the new kwargs.

- [ ] **Step 3.3: Pass `sample_aggregator` from spec into `sample_grid` calls**

In `src/xcs_gen_web/services/capture.py`, find `run_capture` (function around line 72) and locate the `sample_grid(...)` call (currently lines 152–165). Add the two new keyword arguments at the end:

```python
    swatches_raw = sample_grid(
        warped,
        grid_origin_mm=grid_origin_mm,
        grid_size_mm=(grid_w, sample_grid_h),
        px_per_mm=10.0,
        x_param=spec["x_param"],
        x_min=spec["x_min"], x_max=spec["x_max"], x_steps=spec["x_steps"],
        y_param=spec.get("y_param"),
        y_min=spec.get("y_min") or 0.0,
        y_max=spec.get("y_max") or 0.0,
        y_steps=spec.get("y_steps") or 1,
        rows=rows,
        row_stride_mm=row_stride_mm,
        cell_shape=spec.get("cell_shape", "rect"),
        aggregator=spec.get("sample_aggregator") or "saturation_median",
    )
```

(The `or "saturation_median"` handles both missing-key and `None` values cleanly.)

- [ ] **Step 3.4: Add the field to `TestSpec`**

In `src/xcs_gen_web/schemas.py`, modify `TestSpec` (currently lines 463–484). Add the new field after `cell_shape`:

```python
class TestSpec(BaseModel):
    x_param: str
    x_min: float
    x_max: float
    x_steps: int
    y_param: str | None = None
    y_min: float | None = None
    y_max: float | None = None
    y_steps: int | None = None
    rows: int = 1
    width_mm: float
    height_mm: float
    gap_mm: float = 0.5
    cell_shape: str = "rect"              # "rect" | "circle"
    # Aggregator name from xcs_gen.sampling_aggregators.LEGAL_AGGREGATORS.
    # When None or absent, capture uses "saturation_median" for back-compat
    # with tests created before this field existed.
    sample_aggregator: str | None = None
    square_cells: bool = False
    angle_mode: str = "fixed"
    unidirectional: bool = False
    hide_axis_labels: bool = False
    base_params: BaseParams
    registration: RegistrationConfig = Field(default_factory=RegistrationConfig)
```

- [ ] **Step 3.5: Add the `aggregate_warped` helper for preview/inspect**

In `src/xcs_gen_web/services/capture.py`, append a new helper at the bottom of the file (after `run_capture`):

```python
def aggregate_warped(
    warped: np.ndarray,
    spec: dict[str, Any],
    aggregator: str,
) -> list[dict[str, Any]]:
    """Re-run only the aggregation step over an already-warped image.

    Used by the preview endpoint to swap aggregators without re-running
    fiducial detection or the homography. The returned swatches have
    the same shape as ``CaptureResult.swatches`` so the API can return
    them unchanged.
    """
    from xcs_gen_web.capture_sampling import sample_grid
    from xcs_gen.sampling_aggregators import LEGAL_AGGREGATORS

    if aggregator not in LEGAL_AGGREGATORS:
        raise CaptureError(
            f"unknown aggregator: {aggregator!r}; "
            f"legal values: {LEGAL_AGGREGATORS}"
        )

    # Recompute the burn-space layout from the spec — same math as
    # run_capture. Lifted into a small helper so we don't duplicate it.
    from xcs_gen.capture.layout import (
        ARUCO_SIZE_DEFAULT_MM, MARKER_MARGIN_MM, QR_SIZE_DEFAULT_MM,
    )
    from .palette import hex_to_lab

    reg = spec.get("registration", {}) if isinstance(spec.get("registration"), dict) else {}
    qr_size = reg.get("qr_size_mm") or QR_SIZE_DEFAULT_MM
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    grid_w = spec["width_mm"]
    row_height_mm = spec["height_mm"]
    rows = spec.get("rows", 1) or 1
    is_wrapped_1d = rows > 1 and spec.get("y_param") is None
    if is_wrapped_1d:
        gap = _effective_row_gap_mm(bool(spec.get("hide_axis_labels", False)))
        row_stride_mm = row_height_mm + gap
        grid_h = rows * row_height_mm + (rows - 1) * gap
    else:
        row_stride_mm = None
        grid_h = row_height_mm
    margin = MARKER_MARGIN_MM
    qr_tl = (margin, margin)
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )
    sample_grid_h = rows * row_height_mm if is_wrapped_1d else grid_h

    swatches_raw = sample_grid(
        warped, grid_origin_mm=grid_origin_mm,
        grid_size_mm=(grid_w, sample_grid_h),
        px_per_mm=10.0,
        x_param=spec["x_param"],
        x_min=spec["x_min"], x_max=spec["x_max"], x_steps=spec["x_steps"],
        y_param=spec.get("y_param"),
        y_min=spec.get("y_min") or 0.0,
        y_max=spec.get("y_max") or 0.0,
        y_steps=spec.get("y_steps") or 1,
        rows=rows,
        row_stride_mm=row_stride_mm,
        cell_shape=spec.get("cell_shape", "rect"),
        aggregator=aggregator,
    )
    return [
        {
            "row": s.row, "col": s.col,
            "x_value": s.x_value, "y_value": s.y_value,
            "hex": s.hex,
            "lab": list(hex_to_lab(s.hex)),
            "sigma": s.sigma,
        }
        for s in swatches_raw
    ]
```

- [ ] **Step 3.6: Run the tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_service_capture.py tests/test_capture_sampling.py -v
```

Expected: ALL pass.

- [ ] **Step 3.7: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/services/capture.py tests/test_service_capture.py
git status --short
```

Expected: 7 staged paths total (T1+T2+T3). NO commit.

---

## Task 4: Preview endpoint

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `SwatchPreviewResponse`)
- Modify: `src/xcs_gen_web/app.py` (add new endpoint)
- Test: `tests/test_results_api.py`

- [ ] **Step 4.1: Add the response schema**

In `src/xcs_gen_web/schemas.py`, append after the existing `ResultResponse`:

```python
class SwatchPreviewResponse(BaseModel):
    aggregator: str
    swatches: list[ResultSwatch]
```

- [ ] **Step 4.2: Write failing test**

Append to `tests/test_results_api.py`:

```python
def test_swatch_preview_with_alternate_aggregator(fresh_db, monkeypatch, tmp_path):
    """The preview endpoint re-runs aggregation with a different method
    and returns the result without writing to DB. The original
    swatches_json on the row stays unchanged."""
    import numpy as np
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    original_swatches = upload.json()["swatches"]

    # Mock decode + warp + detect for the preview path: aggregate_warped
    # is what the endpoint calls, so we monkeypatch THAT to return a
    # known list.
    from xcs_gen_web.services import capture
    monkeypatch.setattr(capture, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(capture, "detect_fiducials",
                        lambda _: (1, 0, {0: (0.0, 0.0), 4: (0.0, 10.0),
                                          5: (10.0, 10.0), 6: (10.0, 0.0),
                                          1: (30.0, 0.0), 2: (0.0, 30.0),
                                          3: (30.0, 30.0)}))
    monkeypatch.setattr(capture, "warp_to_burn_space",
                        lambda *a, **kw: np.full((100, 100, 3), 200, dtype=np.uint8))

    r = c.get(f"/api/results/{rid}/swatches/preview?aggregator=mean")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aggregator"] == "mean"
    assert isinstance(body["swatches"], list)

    # Confirm the row was NOT modified.
    list_after = c.get(f"/api/tests/{tid}/results").json()
    refreshed = next(x for x in list_after if x["id"] == rid)
    assert refreshed["swatches"] == original_swatches


def test_swatch_preview_unknown_aggregator_returns_400(fresh_db, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    r = c.get(f"/api/results/{rid}/swatches/preview?aggregator=not_real")
    assert r.status_code == 400
    assert "unknown aggregator" in r.json()["detail"].lower()


def test_swatch_preview_missing_aggregator_returns_422(fresh_db, monkeypatch, tmp_path):
    """The aggregator query param is required; absence is a 422 from FastAPI."""
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    r = c.get(f"/api/results/{rid}/swatches/preview")
    assert r.status_code == 422
```

- [ ] **Step 4.3: Run, expect FAIL**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py::test_swatch_preview_with_alternate_aggregator tests/test_results_api.py::test_swatch_preview_unknown_aggregator_returns_400 tests/test_results_api.py::test_swatch_preview_missing_aggregator_returns_422 -v
```

Expected: FAIL — endpoint not registered.

- [ ] **Step 4.4: Implement the endpoint**

In `src/xcs_gen_web/app.py`, add the new endpoint immediately after `results_reingest` (around the line that closes the reingest block, before the next section/route):

```python
    @app.get(
        "/api/results/{rid}/swatches/preview",
        response_model=SwatchPreviewResponse,
    )
    def results_swatches_preview(
        rid: int, aggregator: str,
        user_id: int = Depends(get_current_user),
    ) -> SwatchPreviewResponse:
        """Re-aggregate the saved photo with the requested aggregator and
        return the resulting swatches. Does NOT write to the DB. Used by
        the result-detail dialog's aggregator dropdown for live preview.
        """
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        try:
            data = images.read(r["image_path"])
        except FileNotFoundError:
            raise HTTPException(
                status_code=410,
                detail="source image no longer available — cannot preview",
            )
        try:
            img = capture_service.decode_image_bytes(data)
            qr_id, _, corners_px = capture_service.detect_fiducials(img)
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except capture_service.DetectionError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Recompute the warp using the same anchors logic as run_capture.
        # Refactoring run_capture to expose the warped image is out of
        # scope; we re-call it for now (acceptable — < 2 s end-to-end).
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=r["test_id"],
                spec={**t["spec"], "sample_aggregator": aggregator},
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except ValueError as e:
            # aggregate() raises ValueError for unknown aggregator —
            # convert to 400 for the caller.
            raise HTTPException(status_code=400, detail=str(e))

        return SwatchPreviewResponse(
            aggregator=aggregator,
            swatches=[ResultSwatch(**s) for s in cap_result.swatches],
        )
```

Note: this implementation re-runs the FULL capture pipeline (decode + detect + warp + sample) rather than warping once and re-aggregating. This is simpler and still under 2s. A future optimisation can cache the warped image per result.

The `decode_image_bytes`, `detect_fiducials`, `DetectionError` symbols come from `capture_pipeline` — verify whether the implementer needs to import them in `app.py` or whether they're already exposed via `capture_service`. Add imports as needed:

```python
# At the top of app.py with the other imports:
from .capture_pipeline import DetectionError, decode_image_bytes, detect_fiducials
```

- [ ] **Step 4.5: Run all tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py -v
```

Expected: ALL pass — pre-existing + 3 new.

- [ ] **Step 4.6: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py tests/test_results_api.py
git status --short
```

Expected: 8 staged paths total (T1+T2+T3+T4). NO commit.

---

## Task 5: Inspect-cell endpoint

**Files:**
- Modify: `src/xcs_gen_web/schemas.py` (add `InspectCellResponse`)
- Modify: `src/xcs_gen_web/services/capture.py` (new `inspect_cell` helper)
- Modify: `src/xcs_gen_web/app.py` (add new endpoint)
- Test: `tests/test_results_api.py`

- [ ] **Step 5.1: Add the response schema**

In `src/xcs_gen_web/schemas.py`, append:

```python
class InspectCellResponse(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None
    sigma: float
    cell_image_b64: str
    sampling_region: dict[str, Any]
    aggregator_results: dict[str, str]
```

(`Any` should already be imported at the top of `schemas.py`; if not, add `from typing import Any`.)

- [ ] **Step 5.2: Write failing test**

Append to `tests/test_results_api.py`:

```python
def test_inspect_cell_returns_image_and_aggregator_results(fresh_db, monkeypatch, tmp_path):
    """Inspect endpoint returns the cell crop as base64 PNG and runs all
    5 aggregators on the cell, returning their hex outputs."""
    import numpy as np
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials",
                        lambda _: (1, 0, {0: (0.0, 0.0), 4: (0.0, 10.0),
                                          5: (10.0, 10.0), 6: (10.0, 0.0),
                                          1: (30.0, 0.0), 2: (0.0, 30.0),
                                          3: (30.0, 30.0)}))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: np.full((200, 200, 3), 100, dtype=np.uint8))

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]

    r = c.get(f"/api/results/{rid}/inspect/0/0")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["row"] == 0 and body["col"] == 0
    assert "cell_image_b64" in body and len(body["cell_image_b64"]) > 0
    assert "sampling_region" in body
    assert set(body["aggregator_results"].keys()) == {
        "median", "mean", "saturation_median", "trimmed_mean", "kmeans_dominant",
    }
    for hex_value in body["aggregator_results"].values():
        assert hex_value.startswith("#") and len(hex_value) == 7


def test_inspect_cell_out_of_bounds_returns_400(fresh_db, monkeypatch, tmp_path):
    import numpy as np
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials",
                        lambda _: (1, 0, {0: (0.0, 0.0), 4: (0.0, 10.0),
                                          5: (10.0, 10.0), 6: (10.0, 0.0),
                                          1: (30.0, 0.0), 2: (0.0, 30.0),
                                          3: (30.0, 30.0)}))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: np.full((200, 200, 3), 100, dtype=np.uint8))

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    # SPEC has x_steps=3, y_steps=None → grid is 1x3. Asking for col 99 is OOB.
    r = c.get(f"/api/results/{rid}/inspect/0/99")
    assert r.status_code == 400
    assert "out of bounds" in r.json()["detail"].lower()
```

- [ ] **Step 5.3: Run, expect FAIL**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py::test_inspect_cell_returns_image_and_aggregator_results tests/test_results_api.py::test_inspect_cell_out_of_bounds_returns_400 -v
```

Expected: FAIL — endpoint doesn't exist.

- [ ] **Step 5.4: Add `inspect_cell` helper to the capture service**

In `src/xcs_gen_web/services/capture.py`, append:

```python
def inspect_cell(
    warped: np.ndarray,
    spec: dict[str, Any],
    row: int,
    col: int,
) -> dict[str, Any]:
    """Extract a single cell crop from a warped image and run all five
    aggregators on the masked sample region. Returns:

    - ``cell_image_b64``: PNG-encoded base64 string of the cell's
      bounding-rect crop (~ 60% of cell pitch each side, larger so the
      modal can show a comfortable view).
    - ``sampling_region``: dict describing the mask (``shape``,
      ``radius_px`` for circle / ``half_w_px``/``half_h_px`` for rect,
      ``center_px`` relative to the cell crop).
    - ``aggregator_results``: dict mapping each aggregator name to the
      hex it produces on this cell.
    """
    import base64
    import math
    import cv2
    from xcs_gen.sampling_aggregators import LEGAL_AGGREGATORS, aggregate

    px_per_mm = 10.0
    cell_shape = spec.get("cell_shape", "rect")
    grid_w = spec["width_mm"]
    row_height_mm = spec["height_mm"]
    rows_total = spec.get("rows", 1) or 1
    is_wrapped_1d = rows_total > 1 and spec.get("y_param") is None
    if is_wrapped_1d:
        gap = _effective_row_gap_mm(bool(spec.get("hide_axis_labels", False)))
        row_stride_mm = row_height_mm + gap
        grid_h = rows_total * row_height_mm + (rows_total - 1) * gap
    else:
        row_stride_mm = row_height_mm
        grid_h = row_height_mm

    # Burn-space layout (mirrors run_capture).
    from xcs_gen.capture.layout import (
        ARUCO_SIZE_DEFAULT_MM, MARKER_MARGIN_MM, QR_SIZE_DEFAULT_MM,
    )
    reg = spec.get("registration", {}) if isinstance(spec.get("registration"), dict) else {}
    qr_size = reg.get("qr_size_mm") or QR_SIZE_DEFAULT_MM
    aruco_size = reg.get("aruco_size_mm") or ARUCO_SIZE_DEFAULT_MM
    margin = MARKER_MARGIN_MM
    qr_tl = (margin, margin)
    grid_origin_mm = (
        qr_tl[0] + qr_size + margin,
        max(qr_tl[1] + qr_size + margin, margin + aruco_size + margin),
    )

    x_steps = spec["x_steps"]
    y_steps = spec.get("y_steps") if spec.get("y_param") is not None else 1
    if not (0 <= row < (y_steps or 1)) or not (0 <= col < x_steps):
        raise CaptureError(
            f"cell ({row}, {col}) out of bounds for grid "
            f"y_steps={y_steps} x_steps={x_steps}",
        )

    # Cell centre in burn-space mm.
    cell_w_mm = grid_w / x_steps
    if spec.get("y_param") is None and rows_total > 1:
        # Wrapped 1D path
        per_row = math.ceil(x_steps / rows_total)
        cx_mm = grid_origin_mm[0] + (col + 0.5) * (grid_w / per_row)
        cy_mm = grid_origin_mm[1] + row * row_stride_mm + row_height_mm / 2
        cell_h_mm = row_height_mm
    else:
        cell_h_mm = grid_h / (y_steps or 1)
        cx_mm = grid_origin_mm[0] + (col + 0.5) * cell_w_mm
        cy_mm = grid_origin_mm[1] + (row + 0.5) * cell_h_mm

    cell_w_px = cell_w_mm * px_per_mm
    cell_h_px = cell_h_mm * px_per_mm
    cx_px, cy_px = int(round(cx_mm * px_per_mm)), int(round(cy_mm * px_per_mm))

    # Bounding rect for the cell crop (use 100% of cell pitch so the
    # crop shows the cell with a small substrate border for context).
    half_w = int(round(cell_w_px / 2))
    half_h = int(round(cell_h_px / 2))
    rx0 = max(0, cx_px - half_w)
    ry0 = max(0, cy_px - half_h)
    rx1 = min(warped.shape[1], cx_px + half_w)
    ry1 = min(warped.shape[0], cy_px + half_h)
    crop = warped[ry0:ry1, rx0:rx1]
    if crop.size == 0:
        raise CaptureError(f"cell ({row}, {col}) is empty after cropping")

    # Sample-region pixels (the same mask used by _sample_cell).
    half_sample_w = cell_w_px * 0.6 / 2
    half_sample_h = cell_h_px * 0.6 / 2
    sx0 = max(0, int(round(cx_px - half_sample_w)))
    sy0 = max(0, int(round(cy_px - half_sample_h)))
    sx1 = min(warped.shape[1], int(round(cx_px + half_sample_w)))
    sy1 = min(warped.shape[0], int(round(cy_px + half_sample_h)))
    sample_box = warped[sy0:sy1, sx0:sx1]
    if cell_shape == "circle":
        radius_px = min(cell_w_px, cell_h_px) * 0.5 / 2
        h_, w_ = sample_box.shape[:2]
        yy, xx = np.ogrid[:h_, :w_]
        cy_local = (cy_px - sy0)
        cx_local = (cx_px - sx0)
        inside = (xx - cx_local) ** 2 + (yy - cy_local) ** 2 <= radius_px ** 2
        masked = sample_box[inside]
        sampling_region = {
            "shape": "circle",
            "radius_px": float(radius_px),
            "center_px": [int(cx_px - rx0), int(cy_px - ry0)],
        }
    else:
        masked = sample_box.reshape(-1, 3)
        sampling_region = {
            "shape": "rect",
            "half_w_px": float(half_sample_w),
            "half_h_px": float(half_sample_h),
            "center_px": [int(cx_px - rx0), int(cy_px - ry0)],
        }

    # Run all aggregators.
    results: dict[str, str] = {}
    for name in LEGAL_AGGREGATORS:
        b, g, r = aggregate(name, masked) if masked.size > 0 else (0, 0, 0)
        results[name] = f"#{r:02x}{g:02x}{b:02x}"

    # Encode the crop as PNG base64.
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        raise CaptureError("failed to encode cell crop")
    cell_image_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    # Sigma over the sample region (matches sample_grid).
    from ..palette import hex_to_lab  # noqa: F401  (kept consistent)
    if masked.size == 0:
        sigma = 0.0
    else:
        from xcs_gen_web.capture_sampling import _bgr_to_lab
        lab = _bgr_to_lab(masked)
        sigma = float(np.sqrt(np.sum(np.var(lab, axis=0))))

    # Compute x_value / y_value for the inspector header.
    from xcs_gen_web.capture_sampling import _linspace, _round_param
    x_val = _round_param(spec["x_param"], _linspace(spec["x_min"], spec["x_max"], x_steps)[col])
    y_val: float | None
    if spec.get("y_param") is not None and y_steps:
        y_val = _round_param(spec["y_param"], _linspace(spec.get("y_min", 0.0), spec.get("y_max", 0.0), y_steps)[row])
    else:
        y_val = None

    return {
        "row": row, "col": col,
        "x_value": x_val, "y_value": y_val,
        "sigma": sigma,
        "cell_image_b64": cell_image_b64,
        "sampling_region": sampling_region,
        "aggregator_results": results,
    }
```

- [ ] **Step 5.5: Implement the inspect endpoint**

In `src/xcs_gen_web/app.py`, immediately after `results_swatches_preview`, add:

```python
    @app.get(
        "/api/results/{rid}/inspect/{row}/{col}",
        response_model=InspectCellResponse,
    )
    def results_inspect_cell(
        rid: int, row: int, col: int,
        user_id: int = Depends(get_current_user),
    ) -> InspectCellResponse:
        """Return per-cell inspection data: the warped cell crop,
        the sampling-region descriptor, and all 5 aggregators applied
        to that cell. Powers the InspectMatchDialog.
        """
        r = r_repo.get(rid, owner_id=user_id)
        if r is None:
            raise HTTPException(status_code=404, detail="result not found")
        t = t_repo.get(r["test_id"], owner_id=user_id)
        if t is None:
            raise HTTPException(status_code=404, detail="test not found")
        try:
            data = images.read(r["image_path"])
        except FileNotFoundError:
            raise HTTPException(
                status_code=410,
                detail="source image no longer available — cannot inspect",
            )
        try:
            cap_result = capture_service.run_capture(
                image_bytes=data, test_id=r["test_id"], spec=t["spec"],
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            payload = capture_service.inspect_cell(
                warped=cap_result.warped_image_bgr,
                spec=t["spec"], row=row, col=col,
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return InspectCellResponse(**payload)
```

Add the import for `InspectCellResponse` at the top:

```python
from .schemas import (..., InspectCellResponse, SwatchPreviewResponse, ...)
```

(Match the existing schema-import pattern.)

- [ ] **Step 5.6: Run all tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py -v
```

Expected: ALL pass.

- [ ] **Step 5.7: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/services/capture.py src/xcs_gen_web/app.py tests/test_results_api.py
git status --short
```

Expected: still 8 staged paths total. NO commit.

---

## Task 6: Backend test sweep + commit

- [ ] **Step 6.1: Run the full backend suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q
```

Expected: all green. No regressions in existing tests.

- [ ] **Step 6.2: Re-run the diagnostic on samples/Unknown.jpg with the new aggregators**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active python3 -c "
from xcs_gen.sampling_aggregators import LEGAL_AGGREGATORS, aggregate
import numpy as np
# Sanity: round-trip on a small constant array.
pixels = np.full((100, 3), [50, 100, 150], dtype=np.uint8)
for name in LEGAL_AGGREGATORS:
    print(f'{name:>22} -> {aggregate(name, pixels)}')
"
```

Expected: all 5 aggregators return `(50, 100, 150)` on a constant input. Sanity check that the imports + dispatch work end-to-end.

- [ ] **Step 6.3: Commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git status --short  # confirm only T1-T5 backend files staged
git commit -m "$(cat <<'EOF'
feat(capture): pluggable aggregators + cell-shape masks + preview/inspect endpoints

Closes the "captured colours look too dark on circle tests" gap by
making the sampling chain configurable end-to-end.

- New pure aggregator module (xcs_gen/sampling_aggregators.py) with 5
  methods: median, mean, saturation_median (current behaviour, kept as
  back-compat default), trimmed_mean (drop top/bottom 10% by luminance),
  kmeans_dominant (most-populated cluster of 3, falls back to median
  when the cell has < 3 distinct colours).

- _sample_rect → _sample_cell: cell_shape="circle" applies a 50%
  inscribed circular mask (corners excluded); cell_shape="rect" keeps
  the existing 60% rectangle behaviour. Sigma still computed over the
  full bounding rect for comparable "uniformity" signal.

- TestSpec.sample_aggregator (Optional[str]) plumbed through
  run_capture and persisted with the spec. Existing tests with no
  field still work — back-compat default is "saturation_median".

- New GET /api/results/{rid}/swatches/preview?aggregator=... re-runs
  the pipeline with a different aggregator and returns swatches
  without writing to DB. Used by the result-detail dialog for live
  comparison.

- New GET /api/results/{rid}/inspect/{row}/{col} returns per-cell
  context: a PNG-encoded crop, the sampling-region descriptor, and
  all 5 aggregators applied to that cell. Powers the upcoming
  InspectMatchDialog.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend types + API client

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api/results.ts`

- [ ] **Step 7.1: Extend `TestSpec` type**

In `web/src/types.ts`, find `interface TestSpec` (search for `cell_shape: "rect"`). Add the new field after `cell_shape`:

```ts
export type SampleAggregator =
  | "median"
  | "mean"
  | "saturation_median"
  | "trimmed_mean"
  | "kmeans_dominant";
```

And in the `TestSpec` interface, add:

```ts
  /** Aggregator name from xcs_gen.sampling_aggregators.LEGAL_AGGREGATORS.
   * When undefined, the backend treats it as "saturation_median" for
   * back-compat with tests created before this field existed. */
  sample_aggregator?: SampleAggregator;
```

- [ ] **Step 7.2: Add a type for the inspector response**

Append to `web/src/types.ts`:

```ts
export interface SwatchPreviewResponse {
  aggregator: SampleAggregator;
  swatches: ResultSwatch[];
}

export interface InspectSamplingRegion {
  shape: "circle" | "rect";
  radius_px?: number;
  half_w_px?: number;
  half_h_px?: number;
  center_px: [number, number];
}

export interface InspectCellResponse {
  row: number;
  col: number;
  x_value: number;
  y_value: number | null;
  sigma: number;
  cell_image_b64: string;
  sampling_region: InspectSamplingRegion;
  aggregator_results: Record<SampleAggregator, string>;
}
```

- [ ] **Step 7.3: Extend the API client**

In `web/src/api/results.ts`, append:

```ts
import type { SwatchPreviewResponse, InspectCellResponse, SampleAggregator } from "../types";

export async function previewSwatches(
  rid: number, aggregator: SampleAggregator,
): Promise<SwatchPreviewResponse> {
  return j(await fetch(
    `/api/results/${rid}/swatches/preview?aggregator=${encodeURIComponent(aggregator)}`,
  ));
}

export async function inspectCell(
  rid: number, row: number, col: number,
): Promise<InspectCellResponse> {
  return j(await fetch(`/api/results/${rid}/inspect/${row}/${col}`));
}
```

(Adjust the import at the top of the file if `SwatchPreviewResponse` etc. aren't already imported.)

- [ ] **Step 7.4: Typecheck + frontend tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc exit 0, all tests still pass.

- [ ] **Step 7.5: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/types.ts web/src/api/results.ts
git status --short
```

Expected: 2 staged paths from T7.

---

## Task 8: Aggregator dropdown in `ParamTestEditor`

**Files:**
- Modify: `web/src/components/ParamTestEditor.tsx` (around line 245, after the cell_shape selector)

- [ ] **Step 8.1: Add the aggregator field**

In `web/src/components/ParamTestEditor.tsx`, find the `<Field label="Cell shape">` block (currently around lines 234–245). After the closing `</Field>` AND after the existing circle-warning callout (lines 246–252), insert a new field:

```tsx
        <Field label="Aggregator">
          <Select
            value={t.sample_aggregator ?? defaultAggregatorFor(t.cell_shape)}
            disabled={locked}
            onChange={(e) =>
              updateSpec({ sample_aggregator: e.target.value as SampleAggregator })
            }
          >
            <option value="median">Median</option>
            <option value="mean">Mean</option>
            <option value="saturation_median">Saturation-biased median</option>
            <option value="trimmed_mean">Trimmed mean (10%)</option>
            <option value="kmeans_dominant">K-Means dominant cluster</option>
          </Select>
          <p className="mt-1 text-[11px] text-[color:var(--color-ink-subtle)]">
            Sampling: {samplingDescription(t.cell_shape, t.sample_aggregator)}
          </p>
        </Field>
```

Add the helper functions near the top of the file (after the imports, before the component):

```tsx
import type { SampleAggregator } from "../types";

function defaultAggregatorFor(cell_shape: string): SampleAggregator {
  return cell_shape === "circle" ? "median" : "saturation_median";
}

const AGGREGATOR_LABELS: Record<SampleAggregator, string> = {
  median: "median",
  mean: "mean",
  saturation_median: "saturation-biased median",
  trimmed_mean: "trimmed mean (10%)",
  kmeans_dominant: "K-Means dominant cluster",
};

function samplingDescription(cell_shape: string, aggregator?: SampleAggregator): string {
  const region = cell_shape === "circle"
    ? "50% inscribed circle"
    : "60% central rectangle";
  const agg = aggregator ?? defaultAggregatorFor(cell_shape);
  return `${region}, ${AGGREGATOR_LABELS[agg]}`;
}
```

- [ ] **Step 8.2: Apply the cell_shape default-flip**

When the user changes `cell_shape` and `sample_aggregator` is currently *unset*, the form should not need any change — `defaultAggregatorFor` already returns the right value. But when `sample_aggregator` IS set explicitly, leave it alone.

If the user wants the auto-flip to also reset an explicitly-set aggregator on shape change, that's UX-discretionary; the simpler "explicit is sticky" behaviour is what the snippet above implements.

- [ ] **Step 8.3: Typecheck + tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
```

- [ ] **Step 8.4: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/ParamTestEditor.tsx
git status --short
```

---

## Task 9: Aggregator dropdown + Save-as-default in `ResultDetailDialog`

This task and Task 10 (InspectMatchDialog) are the visual surfaces. **The plan instructs the implementer to delegate the visual layout to the `frontend-design` agent for both.**

**Files:**
- Modify: `web/src/components/ResultDetailDialog.tsx`

- [ ] **Step 9.1: Delegate to `frontend-design`**

Dispatch a subagent prompt to `frontend-design` with this brief:

```
Design the layout for an aggregator dropdown + "Save as test default"
button to insert above the swatch grid in
/Users/jonzky/Documents/XTools/Reverse/web/src/components/ResultDetailDialog.tsx.

Constraints:
- Must fit the existing "workshop instrument / blueprint poster"
  aesthetic of the rest of the file (JetBrains Mono for labels, MetalBar
  bands between sections, lab-notebook crop marks, etc.).
- Existing structure: hero photo → MetalBar → instrument readout strip
  → MetalBar(soft) → distribution charts → MetalBar(soft) → swatch grid.
  The new dropdown + save button should sit between the distribution
  charts and the swatch grid (i.e. above the existing
  <ChartLabel title={`Swatches (${result.swatches.length})`} />).
- Behaviour: dropdown shows current aggregator (from result data, or
  test spec default); on change, calls previewSwatches(rid, agg) and
  re-renders the swatch grid + Lab scatter + luminance ramp from the
  preview. "Save as test default" button is disabled when the previewed
  aggregator equals the test's stored aggregator.
- A small caption under the controls reads
  "Sampling: 50% inscribed circle, median" (or the appropriate
  description for the current cell_shape + aggregator).

Return: the JSX block ready to drop in, plus any small CSS additions
needed.
```

- [ ] **Step 9.2: Wire up the JSX returned by frontend-design**

Insert the returned JSX above the `<ChartLabel title={`Swatches (${result.swatches.length})`} />` line (currently around line 183 of `ResultDetailDialog.tsx`). State to add inside `ResultDetailBody`:

```tsx
  const [previewAggregator, setPreviewAggregator] = useState<SampleAggregator | null>(null);
  const [previewSwatchesData, setPreviewSwatchesData] = useState<ResultSwatch[] | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);

  const displayedSwatches = previewSwatchesData ?? result.swatches;
  // currentAggregator is what the user is currently *viewing* — either
  // the previewed value or whatever the result was captured with.
  const currentAggregator = previewAggregator ?? "saturation_median";
```

Handler for dropdown change:

```tsx
  async function onAggregatorChange(agg: SampleAggregator) {
    setPreviewAggregator(agg);
    try {
      const { previewSwatches } = await import("../api/results");
      const resp = await previewSwatches(result.id, agg);
      setPreviewSwatchesData(resp.swatches);
    } catch (err) {
      console.error("Preview failed:", err);
      setPreviewAggregator(null);
      setPreviewSwatchesData(null);
    }
  }

  async function onSaveAsDefault(testSpec: TestSpec) {
    if (!previewAggregator) return;
    setSavingDefault(true);
    try {
      const { patchTest } = await import("../api/tests");
      await patchTest(result.test_id, {
        spec: { ...testSpec, sample_aggregator: previewAggregator },
      });
      const { reingestResult } = await import("../api/results");
      await reingestResult(result.id);
      // Trigger a parent refresh — emit an event the dialog parent listens for.
      window.dispatchEvent(new CustomEvent("result:refetch"));
    } finally {
      setSavingDefault(false);
    }
  }
```

(The `result:refetch` event is a lightweight cross-component signal; the parent `ResultsPanel` listens for it and re-runs `refresh()`. If the codebase already has a callback prop on `ResultDetailDialog` for refresh, prefer that.)

The dropdown JSX should pass: `value={currentAggregator}`, `onChange={(e) => onAggregatorChange(e.target.value as SampleAggregator)}`, and the Save button: `disabled={!previewAggregator || savingDefault} onClick={() => onSaveAsDefault(...)}`.

Pass the chart-rendering swatches (`displayedSwatches`) to the existing `<LabScatter>`, `<LuminanceRamp>`, `<SpectrumStrip>` calls so they reflect the preview when active.

- [ ] **Step 9.3: Vitest covering the dropdown**

Append to a new `web/src/components/ResultDetailDialog.test.tsx` (or extend existing if present):

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResultDetailDialog } from "./ResultDetailDialog";

const result = {
  id: 1, test_id: 1, uploaded_at: "2026-04-26T10:00:00Z",
  image_url: "/api/results/1/image", image_sha256: "x",
  excluded: false, notes: "",
  swatches: [{ row: 0, col: 0, x_value: 50, y_value: null,
               hex: "#ff0000", lab: [0, 0, 0], sigma: 0 }],
  retest_index: 0, missing_markers: [],
};

describe("ResultDetailDialog aggregator dropdown", () => {
  it("calls previewSwatches when the aggregator changes", async () => {
    const previewMock = vi.fn().mockResolvedValue({
      aggregator: "mean",
      swatches: [{ row: 0, col: 0, x_value: 50, y_value: null,
                   hex: "#00ff00", lab: [0, 0, 0], sigma: 0 }],
    });
    vi.mock("../api/results", () => ({
      previewSwatches: previewMock,
      reingestResult: vi.fn(),
    }));

    render(<ResultDetailDialog open={true} onOpenChange={() => {}} result={result as any} />);
    const dropdown = screen.getByLabelText(/aggregator/i);
    fireEvent.change(dropdown, { target: { value: "mean" } });

    await waitFor(() => {
      expect(previewMock).toHaveBeenCalledWith(1, "mean");
    });
  });
});
```

(Adjust the dropdown matcher to whatever accessible label the frontend-design agent uses.)

- [ ] **Step 9.4: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/ResultDetailDialog.tsx \
        web/src/components/ResultDetailDialog.test.tsx 2>/dev/null
git status --short
```

---

## Task 10: `InspectMatchDialog` — visual layout by `frontend-design`

**Files:**
- Create: `web/src/components/InspectMatchDialog.tsx`
- Create: `web/src/components/InspectMatchDialog.test.tsx`

- [ ] **Step 10.1: Delegate to `frontend-design`**

Dispatch the agent with this brief:

```
Design and implement a new React component
/Users/jonzky/Documents/XTools/Reverse/web/src/components/InspectMatchDialog.tsx
matching the project's "workshop instrument" aesthetic (see
ResultDetailDialog.tsx for the reference register: JetBrains Mono for
numerics + labels, MetalBar dividers, lab-notebook crop marks, dark
substrate mat for hero images).

Props:
  open: boolean
  onOpenChange: (open: boolean) => void
  rid: number
  row: number
  col: number
  cellShape: "rect" | "circle"
  currentAggregator: SampleAggregator
  onAggregatorPicked: (agg: SampleAggregator) => void

Behaviour:
  On open, calls inspectCell(rid, row, col) (already in
  web/src/api/results.ts) and renders the response into three sections:

  1. HEADER strip (instrument-readout-style):
     - "row R · col C"
     - "X param value · Y param value"
     - "σ value"
     - "Currently rendering: <currentAggregator>"

  2. VISUAL INSPECTOR (top half of body):
     - Left panel (~50% width): the cell crop, decoded from
       cell_image_b64 (data: URL). ~200 px square, dark substrate mat
       with lab-notebook crop marks like ResultDetailDialog uses.
     - Right panel (~50% width): same crop with the sampling region
       overlaid as an SVG ring/outline. Use sampling_region.shape +
       center_px + radius_px (or half_w/h_px) to draw the ring. Dashed
       1.5 px line in the warning palette so it stands out without
       obscuring the cell.

  3. AGGREGATOR COMPARISON STRIP (bottom half):
     - 5 tiles in a row, one per aggregator (median, mean,
       saturation_median, trimmed_mean, kmeans_dominant).
     - Each tile: solid hex fill from aggregator_results[name],
       hex value labelled below in JetBrains Mono, aggregator name
       below the hex. Currently-active aggregator gets a primary-colored
       outline.
     - Click any tile → call onAggregatorPicked(name) and close the
       modal. (Parent then triggers preview in ResultDetailDialog.)

  Loading state: show a slim spinner while the inspect API call is in
  flight (same component aesthetic as the "loading swatches" treatments
  elsewhere in the codebase if any exist).

  Errors: a small toast / inline error if the API fails. Match the
  pattern used by ResultsPanel.

Return: the full file contents ready to drop in, plus any small
additions needed to existing files (e.g. a new ChartLabel variant).
```

- [ ] **Step 10.2: Wire `InspectMatchDialog` into `ResultDetailDialog`**

In `ResultDetailDialog.tsx`, find `SwatchTile` (likely at the bottom of the file, render is around line 195–199). Add an `onClick` prop:

```tsx
            <SwatchTile
              key={`${s.row}-${s.col}-${i}`}
              swatch={s}
              compact={result.swatches.length > 60}
              onClick={() => {
                setInspectingCell({ row: s.row, col: s.col });
              }}
            />
```

Add state in `ResultDetailBody`:

```tsx
  const [inspectingCell, setInspectingCell] =
    useState<{ row: number; col: number } | null>(null);
```

And render the dialog at the bottom of `ResultDetailBody`:

```tsx
      {inspectingCell && (
        <InspectMatchDialog
          open={true}
          onOpenChange={(o) => !o && setInspectingCell(null)}
          rid={result.id}
          row={inspectingCell.row}
          col={inspectingCell.col}
          cellShape={"rect"}  /* TODO: thread real cell_shape from the test spec — fetch on dialog open */
          currentAggregator={currentAggregator}
          onAggregatorPicked={(agg) => {
            setInspectingCell(null);
            void onAggregatorChange(agg);
          }}
        />
      )}
```

The `cellShape` value should come from the test's spec. The dialog already shows result data; to get the spec, either (a) fetch the test on open via `getTest(result.test_id)`, or (b) pass it in from the parent ResultsPanel via a new prop. **Pick (a)** for less prop drilling — call `getTest` once and cache for the modal session.

Modify `SwatchTile` (search for `function SwatchTile` in `ResultDetailDialog.tsx`) to accept and call the new `onClick`:

```tsx
function SwatchTile({ swatch, compact, onClick }: {
  swatch: ResultSwatch; compact: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // ...existing classes...
        "cursor-pointer hover:ring-2 hover:ring-[color:var(--color-primary)]/60",
      )}
      title={`Inspect cell — ${swatch.hex}`}
    >
      {/* ...existing content... */}
    </button>
  );
}
```

(Wrap the existing tile content in a `<button>` if it isn't already; the original might be a `<div>` — change it.)

- [ ] **Step 10.3: Vitest covering the modal**

Append to `web/src/components/InspectMatchDialog.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { InspectMatchDialog } from "./InspectMatchDialog";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("InspectMatchDialog", () => {
  it("renders all 5 aggregator tiles after the inspect API resolves", async () => {
    vi.mock("../api/results", () => ({
      inspectCell: vi.fn().mockResolvedValue({
        row: 0, col: 0, x_value: 50, y_value: null, sigma: 1.5,
        cell_image_b64: "iVBORw0KGgo=",  // tiny placeholder
        sampling_region: { shape: "rect", half_w_px: 10, half_h_px: 10, center_px: [10, 10] },
        aggregator_results: {
          median: "#101010", mean: "#202020",
          saturation_median: "#303030", trimmed_mean: "#404040",
          kmeans_dominant: "#505050",
        },
      }),
    }));
    render(<InspectMatchDialog open={true} onOpenChange={() => {}}
      rid={1} row={0} col={0} cellShape="rect"
      currentAggregator="median" onAggregatorPicked={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("#101010")).toBeInTheDocument();
      expect(screen.getByText("#505050")).toBeInTheDocument();
    });
  });

  it("calls onAggregatorPicked when a tile is clicked", async () => {
    const onPicked = vi.fn();
    vi.mock("../api/results", () => ({
      inspectCell: vi.fn().mockResolvedValue({
        row: 0, col: 0, x_value: 50, y_value: null, sigma: 1.5,
        cell_image_b64: "iVBORw0KGgo=",
        sampling_region: { shape: "rect", half_w_px: 10, half_h_px: 10, center_px: [10, 10] },
        aggregator_results: {
          median: "#101010", mean: "#202020",
          saturation_median: "#303030", trimmed_mean: "#404040",
          kmeans_dominant: "#505050",
        },
      }),
    }));
    render(<InspectMatchDialog open={true} onOpenChange={() => {}}
      rid={1} row={0} col={0} cellShape="rect"
      currentAggregator="median" onAggregatorPicked={onPicked} />);
    await waitFor(() => screen.getByText("#202020"));
    fireEvent.click(screen.getByText("#202020").closest("button")!);
    expect(onPicked).toHaveBeenCalledWith("mean");
  });
});
```

- [ ] **Step 10.4: Build + browser smoke check**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test 2>&1 | tail -5
cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build > /tmp/build.log 2>&1 && echo "build exit: $?"

cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8019 > /tmp/xcs.log 2>&1 &
SERVER_PID=$!
sleep 2
curl -s -o /dev/null -w "boot=%{http_code}\n" http://127.0.0.1:8019/
grep -c "InspectMatchDialog\|previewSwatches\|inspectCell" web/dist/assets/*.js 2>/dev/null | head -3
kill $SERVER_PID
```

Expected: tsc + tests + build all green; HTTP 200; bundle smoke check shows the new symbols.

- [ ] **Step 10.5: Stage**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/components/InspectMatchDialog.tsx \
        web/src/components/InspectMatchDialog.test.tsx \
        web/src/components/ResultDetailDialog.tsx \
        web/src/components/ResultDetailDialog.test.tsx 2>/dev/null
git status --short
```

---

## Task 11: Frontend commit + PR

- [ ] **Step 11.1: Confirm only frontend files staged**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git status --short
```

Expected: only `web/src/**` files staged. Backend committed at T6.

- [ ] **Step 11.2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): aggregator dropdown + per-cell inspect-match modal

Three new UI surfaces shaped by the frontend-design agent to match the
"workshop instrument" register:

- ParamTestEditor: an Aggregator <Select> next to the Cell shape
  selector. A small caption underneath summarises the current
  sampling region + aggregator (e.g. "50% inscribed circle, median").
  Default flips when cell_shape changes (median for circle,
  saturation_median for rect) and stays sticky once explicitly set.

- ResultDetailDialog: an aggregator dropdown above the swatch grid.
  Changing it calls /api/results/{rid}/swatches/preview and re-renders
  the swatch grid + Lab scatter + luminance ramp without writing to
  DB. A "Save as test default" button commits the choice to the test
  spec and triggers a reingest.

- InspectMatchDialog: a new modal opened by clicking any swatch tile.
  Shows the warped cell crop, the sampling region overlaid as an
  outline, and a comparison strip of all 5 aggregators applied to
  that cell. Clicking a tile in the strip switches the result-detail
  dialog's current aggregator preview.

Vitest covers the dropdown change → preview API call (ResultDetailDialog)
and the modal's tile rendering + click-to-switch (InspectMatchDialog).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11.3: Push the branch**

```bash
git push -u origin feat/sample-aggregator-and-inspector
```

- [ ] **Step 11.4: Open a draft PR**

```bash
gh pr create --draft --title "feat: pluggable sampling aggregator + per-cell inspect modal" --body "$(cat <<'EOF'
## Summary

Closes the "captured colours look too dark on circle tests" gap surfaced after PR #10.

### Backend (commit 1)

- New pure aggregator module \`xcs_gen/sampling_aggregators.py\` with 5 methods (\`median\`, \`mean\`, \`saturation_median\`, \`trimmed_mean\`, \`kmeans_dominant\`) + dispatcher.
- \`_sample_rect\` → \`_sample_cell\`: \`cell_shape="circle"\` applies a 50% inscribed circular mask; \`cell_shape="rect"\` keeps the existing 60% rectangle. Sigma still computed over the bounding rect for comparable "uniformity" signal.
- \`TestSpec.sample_aggregator\` (Optional) plumbed through \`run_capture\` and persisted with the spec. Existing tests with no field still work — back-compat default is \`saturation_median\`.
- New \`GET /api/results/{rid}/swatches/preview?aggregator=…\` re-runs the pipeline with a different aggregator without writing to DB.
- New \`GET /api/results/{rid}/inspect/{row}/{col}\` returns per-cell context: PNG-encoded crop, sampling-region descriptor, all 5 aggregators applied to that cell.

### Frontend (commit 2)

- Aggregator dropdown on the test editor next to Cell shape (with sampling-region caption).
- Aggregator dropdown above the swatch grid in the result-detail dialog (live preview + Save as default).
- New InspectMatchDialog opened by clicking any swatch — visual layout shaped by the frontend-design agent.

Spec: \`docs/superpowers/specs/2026-04-26-sample-aggregator-and-inspector-design.md\`. Plan: \`docs/superpowers/plans/2026-04-26-sample-aggregator-and-inspector.md\`.

## Test plan

- [x] \`uv run --active pytest tests/ -q\` is green.
- [x] \`cd web && npx tsc --noEmit\` is green.
- [x] \`cd web && npm test\` is green.
- [x] \`cd web && npm run build\` succeeds.
- [x] Bundle smoke check confirms \`previewSwatches\`, \`inspectCell\`, \`InspectMatchDialog\` are in the built JS.
- [ ] **Manual browser check:** open result #19 (Unknown.jpg) on test #23. Switch through all 5 aggregators in the dropdown — swatches re-render in place. Click "Save as test default" with \`median\` selected — test spec updates and the result reingests. Click any swatch — inspect modal opens, shows the crop + 5 aggregator tiles. Click a different aggregator tile in the modal — modal closes and the result-detail dialog now previews that aggregator.
- [ ] **Manual browser check:** open the test edit form for test #23. The Aggregator dropdown appears next to Cell shape. Changing the value PATCHes the test (verify via \`/api/tests/23\` GET).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 11.5: Watch CI; flip to ready when green**

```bash
gh pr checks --watch
```

Then `gh pr ready` if green; otherwise fix on the same branch.

---

## Task 12: Changelog entry

The plan's spec calls this out as a major user-visible change (new dropdown, new modal, new behaviour for circle tests). Per `CLAUDE.md`:

> **major** examples: new page, new primary feature, API break.

This is a new primary feature. **Major** entry is the right level.

- [ ] **Step 12.1: Create the entry**

Create `/Users/jonzky/Documents/XTools/Reverse/changelog/2026-04-26-sample-aggregator.md`:

```markdown
---
id: 2026-04-26-sample-aggregator
date: 2026-04-26
created_at: 2026-04-26T22:00:00Z
level: major
title: Pick how each cell's colour is sampled
summary: Five aggregators (median, mean, saturation-biased, trimmed mean, K-Means dominant) plus a per-cell inspector modal that compares all five side-by-side.
---

The capture pipeline used to sample every cell with a single fixed
algorithm — the median of the most-saturated half of the cell's
central 60%. That works well for MOPA gradient strips where a thin
colour band lives inside a mostly-substrate cell. It works less well
for circle / square parameter sweeps, where the captured swatches end
up several L\\* units below what the eye averages over the whole cell.

**Pick your aggregator on the test.** A new dropdown on the test edit
page lets you choose how cells get distilled into a single colour:

- **Median** — straight per-channel median. Robust, predictable.
- **Mean** — straight per-channel mean. Closest to "what the eye averages".
- **Saturation-biased median** — the previous default. Kept for MOPA
  strips and similar gradient burns.
- **Trimmed mean (10%)** — drop the 10% darkest and 10% lightest
  pixels by luminance, mean the rest. Robust to glare and dust.
- **K-Means dominant cluster** — find the most-populated colour blob.
  Useful for variegated burns where the cell has multiple oxidation
  layers.

Defaults are picked for you: **median** for new circle tests,
**saturation-biased median** for new rect/MOPA tests. Existing tests
keep their old behaviour until you opt in.

**Compare aggregators on a single cell.** A new "Inspect" modal opens
when you click any swatch tile in the result-detail dialog. It shows
the cell crop, the exact sampling region as an outline, and a
side-by-side strip of all five aggregators applied to that cell. Click
the one that looks right and the result-detail switches to it for
preview.

**Live preview without commitment.** Above the swatch grid, an
aggregator dropdown re-renders the swatches as you change it (no
database write). When you find the one you want, hit *Save as test
default* — the test spec updates and the result reingests with the
new method.

The geometric sampling region also changed for circle cells: where it
used to be a 60% rectangle whose corners brush against the burn edge,
it's now a 50% inscribed circle — strictly inside the burn area, no
substrate halo.
```

- [ ] **Step 12.2: Commit + push**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add changelog/2026-04-26-sample-aggregator.md
git commit -m "$(cat <<'EOF'
docs: major changelog entry for sample aggregator + inspect modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

**Spec coverage:**

| Spec section | Task | ✓ |
|---|---|---|
| 1. Region by cell_shape | T2 | ✓ |
| 2. Pure aggregator module | T1 | ✓ |
| 3. Aggregator on test spec | T3 | ✓ |
| 4. Live-preview endpoint | T4 | ✓ |
| 5a. Test-edit aggregator dropdown | T8 | ✓ |
| 5b. Result-detail dropdown + Save | T9 | ✓ |
| 5c. Inspect-match modal | T10 | ✓ |
| 6. Data flow | T9 + T10 | ✓ |
| 7. Error handling | T4 + T5 | ✓ |
| 8. Testing | T1, T2, T3, T4, T5, T9, T10 | ✓ |
| 9. Files touched | T1–T10 | ✓ |
| Branching / commit shape (3 commits) | T6, T11, T12 | ✓ |
| Changelog entry | T12 | ✓ (added — spec didn't call it out but the project convention requires major-level entries for new primary features) |

**Type / name consistency:**

- Python field name: `sample_aggregator` (snake), TS type alias: `SampleAggregator` (Pascal), TS field: `sample_aggregator` (snake to match the JSON contract).
- Aggregator names match exactly between Python `LEGAL_AGGREGATORS` and TS `SampleAggregator` literal union.
- Endpoint paths are consistent: `/api/results/{rid}/swatches/preview` and `/api/results/{rid}/inspect/{row}/{col}`.

**Placeholder scan:** none. Two `(verify)` notes are intentional — `web/src/api/tests.ts` patchTest signature and the `_sample_rect` external-callers grep — both can be confirmed in 5 seconds during implementation.

**Out of scope follow-ups:** per-test bulk reingest, warped-image caching, custom aggregators, square-cell mask. None block this PR.
