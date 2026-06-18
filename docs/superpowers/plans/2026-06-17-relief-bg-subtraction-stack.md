# Relief — connected-area + stacked background subtractions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pick area" (connected-component) background-subtraction method and let users stack multiple subtractions ("Subtract another") in the Relief / Depth Maps tool.

**Architecture:** The single background config becomes a list of subtraction ops. The backend builds one boolean background mask per op and unions them into a single alpha; edge shaping runs once on the combined alpha, defaulting to the outer silhouette only (internal holes re-punched hard-edged) with a "Shape internal edges" opt-in. The `/api/relief/smooth` request swaps the flat `bg_*` fields for a `subtractions` JSON field + `shape_internal`. The frontend `StretchParams` is reshaped to carry `subtractions: Subtraction[]` + `shapeInternal`.

**Tech Stack:** Python / FastAPI / numpy / OpenCV (cv2) backend; React + TypeScript + Vite + Tailwind v4 frontend; pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-relief-bg-subtraction-stack-design.md`

**Conventions for every task:**
- Backend tests: `uv run --active pytest tests/test_relief.py -q` (and `tests/test_relief_route.py`).
- Frontend gate before any FE commit: `cd web && npx tsc --noEmit && npm test -- --run`.
- The FE reshape (Task 7) removes `StretchParams.bgMode/bgColor/bgThreshold/bgTolerance`; that breaks `stretch.ts`, `reliefHelpers.ts`, `CutoutControls.tsx`, and `ReliefPage.tsx` at once, so they are all edited within Task 7 and the project typecheck is only expected to pass at the end of that task.

---

## Task 1: Boolean background-mask helpers (backend)

Introduce boolean-mask primitives and re-express the existing alpha helpers on top of them, so all later ops compose by OR-ing booleans. No behaviour change — existing tests stay green.

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_relief.py`:

```python
def test_threshold_background_mask_dark_and_bright():
    from xcs_gen_web.relief import threshold_background_mask
    gray = np.full((4, 4), 100, np.uint8)
    gray[0, 0] = 5
    gray[1, 1] = 250
    dark = threshold_background_mask(gray, 8, high=False)
    assert dark.dtype == bool and dark[0, 0] and not dark[2, 2]
    bright = threshold_background_mask(gray, 200, high=True)
    assert bright[1, 1] and not bright[2, 2]


def test_colour_background_mask_keys_picked_colour():
    from xcs_gen_web.relief import colour_background_mask
    img = np.zeros((2, 2, 3), np.uint8)
    img[:, 0] = (30, 20, 10)  # BGR → RGB (10, 20, 30)
    m = colour_background_mask(img, (10, 20, 30), 5)
    assert m.dtype == bool
    assert m[:, 0].all() and not m[:, 1].any()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --active pytest tests/test_relief.py -k "threshold_background_mask or colour_background_mask" -q`
Expected: FAIL with `ImportError: cannot import name 'threshold_background_mask'`.

- [ ] **Step 3: Implement the boolean helpers and re-express the alpha wrappers**

In `src/xcs_gen_web/relief.py`, add to `__all__` the names `"threshold_background_mask"`, `"colour_background_mask"`.

Replace the existing `background_alpha` and `colour_background_alpha` functions with these (the two `*_mask` helpers are new; the two `*_alpha` functions become thin wrappers so their existing unit tests still pass):

```python
def threshold_background_mask(gray: np.ndarray, threshold: int, high: bool = False) -> np.ndarray:
    """Boolean background mask (True = background) from a luminance cut.

    ``high=False``: background is the dark end (``gray <= threshold``); the
    common case. ``high=True``: the bright end (``gray >= threshold``)."""
    if gray.ndim != 2:
        raise ValueError("threshold_background_mask expects a single-channel image")
    t = max(0, min(255, int(threshold)))
    return (gray >= t) if high else (gray <= t)


def background_alpha(gray: np.ndarray, threshold: int, high: bool = False) -> np.ndarray:
    """Alpha mask (uint8 0/255) marking background pixels transparent — the
    alpha form of ``threshold_background_mask``."""
    mask = threshold_background_mask(gray, threshold, high)
    return np.ascontiguousarray(np.where(mask, 0, 255).astype(np.uint8))


def _to_rgb(bgr: np.ndarray) -> np.ndarray:
    """Coerce BGR / BGRA / single-channel to an RGB array."""
    if bgr.ndim == 2:
        return cv2.cvtColor(bgr, cv2.COLOR_GRAY2RGB)
    if bgr.ndim == 3 and bgr.shape[2] == 4:
        return cv2.cvtColor(bgr, cv2.COLOR_BGRA2RGB)
    if bgr.ndim == 3 and bgr.shape[2] == 3:
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    raise ValueError(f"unsupported image shape {bgr.shape}")


def colour_background_mask(
    bgr: np.ndarray, color_rgb: tuple[int, int, int], tolerance: float
) -> np.ndarray:
    """Boolean background mask (True = background): pixels within Euclidean RGB
    distance ``tolerance`` of ``color_rgb``. Accepts BGR / BGRA / single-channel."""
    rgb = _to_rgb(bgr)
    target = np.array(color_rgb, dtype=np.float32).reshape(1, 1, 3)
    dist = np.sqrt(((rgb.astype(np.float32) - target) ** 2).sum(axis=2))
    return dist <= float(tolerance)


def colour_background_alpha(
    bgr: np.ndarray, color_rgb: tuple[int, int, int], tolerance: float
) -> np.ndarray:
    """Alpha form of ``colour_background_mask`` (uint8 0/255)."""
    mask = colour_background_mask(bgr, color_rgb, tolerance)
    return np.ascontiguousarray(np.where(mask, 0, 255).astype(np.uint8))
```

Note: this removes the old standalone bodies of `background_alpha` / `colour_background_alpha`; the new wrappers preserve identical output.

- [ ] **Step 4: Run the relief unit tests to verify all pass**

Run: `uv run --active pytest tests/test_relief.py -q`
Expected: PASS (new mask tests + the pre-existing `test_background_alpha_*` and `test_colour_background_alpha_*` still green).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "refactor(relief): boolean background-mask helpers"
```

---

## Task 2: Connected-area mask (`area_background_mask`)

Keep only the contiguous region containing the clicked seed.

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_relief.py`:

```python
def test_area_background_mask_keeps_only_seed_component():
    from xcs_gen_web.relief import area_background_mask
    img = np.zeros((10, 30, 3), np.uint8)        # black background
    img[2:8, 2:8] = (0, 0, 255)                  # BGR red blob A (left)  → RGB (255,0,0)
    img[2:8, 22:28] = (0, 0, 255)                # red blob B (right)
    # seed inside blob A: fractional (x, y)
    m = area_background_mask(img, (255, 0, 0), 10, (5 / 30, 5 / 10))
    assert m.dtype == bool
    assert m[5, 5]            # blob A (seed's component) → background
    assert not m[5, 25]       # blob B same colour but disconnected → kept
    assert not m[0, 0]        # black background → not in colour range


def test_area_background_mask_empty_when_seed_off_colour_or_missing():
    from xcs_gen_web.relief import area_background_mask
    img = np.zeros((10, 10, 3), np.uint8)
    img[2:8, 2:8] = (0, 0, 255)                  # red blob
    # seed on the black background (not within tolerance of red) → empty
    off = area_background_mask(img, (255, 0, 0), 10, (0.0, 0.0))
    assert not off.any()
    # no seed at all → empty
    none = area_background_mask(img, (255, 0, 0), 10, None)
    assert not none.any()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --active pytest tests/test_relief.py -k area_background_mask -q`
Expected: FAIL with `ImportError: cannot import name 'area_background_mask'`.

- [ ] **Step 3: Implement `area_background_mask`**

In `src/xcs_gen_web/relief.py`, add `"area_background_mask"` to `__all__` and add (after `colour_background_mask`):

```python
def area_background_mask(
    bgr: np.ndarray,
    color_rgb: tuple[int, int, int],
    tolerance: float,
    seed_xy: tuple[float, float] | None,
) -> np.ndarray:
    """Boolean background mask: the ``colour_background_mask`` for ``color_rgb``,
    restricted to the single connected component (8-connectivity) containing the
    seed pixel. ``seed_xy`` is a fractional (x, y) in [0, 1) — resolved the same
    way the frontend eyedropper samples colour, so it lands on the picked pixel
    at any resolution. Seed outside the colour range, or ``None`` → empty mask."""
    cand = colour_background_mask(bgr, color_rgb, tolerance)
    if seed_xy is None:
        return np.zeros(cand.shape, dtype=bool)
    h, w = cand.shape
    fx = min(0.999999, max(0.0, float(seed_xy[0])))
    fy = min(0.999999, max(0.0, float(seed_xy[1])))
    x = min(w - 1, int(fx * w))
    y = min(h - 1, int(fy * h))
    _num, labels = cv2.connectedComponents(cand.astype(np.uint8), connectivity=8)
    lbl = int(labels[y, x])
    if lbl == 0:
        return np.zeros(cand.shape, dtype=bool)
    return labels == lbl
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --active pytest tests/test_relief.py -k area_background_mask -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): connected-area background mask"
```

---

## Task 3: Union masks into an alpha (`combine_backgrounds`)

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_relief.py`:

```python
def test_combine_backgrounds_unions_masks():
    from xcs_gen_web.relief import combine_backgrounds
    a = np.zeros((4, 4), bool)
    b = np.zeros((4, 4), bool)
    a[0, 0] = True
    b[3, 3] = True
    alpha = combine_backgrounds([a, b])
    assert alpha.dtype == np.uint8
    assert alpha[0, 0] == 0 and alpha[3, 3] == 0   # either mask → background
    assert alpha[1, 1] == 255                      # neither → foreground


def test_combine_backgrounds_empty_is_all_foreground():
    from xcs_gen_web.relief import combine_backgrounds
    alpha = combine_backgrounds([], shape=(3, 3))
    assert alpha.shape == (3, 3) and (alpha == 255).all()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --active pytest tests/test_relief.py -k combine_backgrounds -q`
Expected: FAIL with `ImportError: cannot import name 'combine_backgrounds'`.

- [ ] **Step 3: Implement `combine_backgrounds`**

In `src/xcs_gen_web/relief.py`, add `"combine_backgrounds"` to `__all__` and add:

```python
def combine_backgrounds(
    masks: list[np.ndarray], shape: tuple[int, int] | None = None
) -> np.ndarray:
    """OR a list of boolean background masks (True = background) into an alpha
    (uint8 0/255: 0 = background/transparent, 255 = foreground). An empty list
    returns all-foreground (255); pass ``shape`` to size that case."""
    if masks:
        bg = np.zeros(masks[0].shape, dtype=bool)
        for m in masks:
            if m.shape != bg.shape:
                raise ValueError("combine_backgrounds: masks must share a shape")
            bg |= m.astype(bool)
    elif shape is not None:
        bg = np.zeros(shape, dtype=bool)
    else:
        raise ValueError("combine_backgrounds: empty masks needs an explicit shape")
    return np.ascontiguousarray(np.where(bg, 0, 255).astype(np.uint8))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --active pytest tests/test_relief.py -k combine_backgrounds -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): union background masks into alpha"
```

---

## Task 4: Split internal holes (`split_internal_holes`)

Detect enclosed (non-border-connected) background so edge shaping can default to the outer silhouette only.

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_relief.py`:

```python
def test_split_internal_holes_marks_enclosed_background():
    from xcs_gen_web.relief import split_internal_holes
    alpha = np.full((20, 20), 255, np.uint8)     # solid object
    alpha[8:12, 8:12] = 0                          # an enclosed internal hole
    alpha[0, :] = 0                                # border-connected background strip
    solid, holes = split_internal_holes(alpha)
    assert holes.dtype == bool
    assert holes[9, 9]               # enclosed hole detected
    assert not holes[0, 5]           # border background is NOT a hole
    assert solid[9, 9] == 255        # hole filled solid
    assert solid[0, 5] == 0          # border background unchanged in solid


def test_split_internal_holes_no_holes_is_identity():
    from xcs_gen_web.relief import split_internal_holes
    alpha = np.full((10, 10), 255, np.uint8)
    alpha[0, :] = 0                                # only border background
    solid, holes = split_internal_holes(alpha)
    assert not holes.any()
    assert np.array_equal(solid, alpha)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --active pytest tests/test_relief.py -k split_internal_holes -q`
Expected: FAIL with `ImportError: cannot import name 'split_internal_holes'`.

- [ ] **Step 3: Implement `split_internal_holes`**

In `src/xcs_gen_web/relief.py`, add `"split_internal_holes"` to `__all__` and add:

```python
def split_internal_holes(alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split a 0/255 alpha into ``(solid_alpha, holes)``.

    A "hole" is a background pixel (alpha == 0) not connected to the image
    border — an enclosed pocket. ``holes`` is a boolean mask of those pixels;
    ``solid_alpha`` is ``alpha`` with the holes filled to 255 (opaque), i.e. the
    outer silhouette only. Border-connected background is left as background."""
    if alpha.ndim != 2:
        raise ValueError("split_internal_holes expects a single-channel alpha")
    bg = (alpha == 0).astype(np.uint8)             # 1 = background
    # Flood the OUTER background inward from a 1px background border so a corner
    # that happens to be foreground can't trap the fill. Foreground (0) walls it.
    bordered = cv2.copyMakeBorder(bg, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
    ffmask = np.zeros((bordered.shape[0] + 2, bordered.shape[1] + 2), np.uint8)
    cv2.floodFill(bordered, ffmask, (0, 0), 2)     # outer background → 2
    outer = bordered[1:-1, 1:-1] == 2
    holes = (alpha == 0) & (~outer)
    solid = alpha.copy()
    solid[holes] = 255
    return np.ascontiguousarray(solid), np.ascontiguousarray(holes)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --active pytest tests/test_relief.py -k split_internal_holes -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): detect enclosed internal holes in an alpha"
```

---

## Task 5: Subtraction model + tolerant parser (`parse_subtractions`)

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Add to the top of `tests/test_relief.py` (with the other imports):

```python
import json
```

Add tests:

```python
def test_parse_subtractions_parses_and_clamps():
    from xcs_gen_web.relief import parse_subtractions, Subtraction
    js = json.dumps([
        {"method": "dark", "threshold": 9999},                  # clamp to 255
        {"method": "colour", "color": [300, -5, 40], "tolerance": 999},
        {"method": "area", "color": [10, 20, 30], "tolerance": 25,
         "seedX": 0.5, "seedY": 0.25},
        {"method": "bogus"},                                     # dropped (bad method)
        {"threshold": 5},                                        # dropped (no method)
        "not a dict",                                            # dropped
    ])
    subs = parse_subtractions(js)
    assert len(subs) == 3
    assert subs[0] == Subtraction("dark", threshold=255)
    assert subs[1].method == "colour"
    assert subs[1].color == (255, 0, 40) and subs[1].tolerance == 441.0
    assert subs[2].method == "area" and subs[2].seed == (0.5, 0.25)


def test_parse_subtractions_tolerates_junk():
    from xcs_gen_web.relief import parse_subtractions
    assert parse_subtractions("") == []
    assert parse_subtractions("not json") == []
    assert parse_subtractions("{}") == []            # not a list
    assert parse_subtractions("[1, 2, 3]") == []     # no dicts
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --active pytest tests/test_relief.py -k parse_subtractions -q`
Expected: FAIL with `ImportError: cannot import name 'parse_subtractions'`.

- [ ] **Step 3: Implement the model + parser**

At the top of `src/xcs_gen_web/relief.py` add `import json` (below `from io import BytesIO`).

Add `"Subtraction"` and `"parse_subtractions"` to `__all__`, then add:

```python
@dataclass(frozen=True)
class Subtraction:
    """One background-subtraction op. ``method`` ∈ dark|bright|colour|area.
    ``threshold`` is the dark/bright luminance cut; ``color``/``tolerance`` the
    colour key (colour/area); ``seed`` the fractional (x, y) click (area only)."""
    method: str
    threshold: int = 8
    color: tuple[int, int, int] | None = None
    tolerance: float = 40.0
    seed: tuple[float, float] | None = None


_SUB_METHODS = {"dark", "bright", "colour", "area"}


def _parse_sub_color(v: object) -> tuple[int, int, int] | None:
    if not isinstance(v, (list, tuple)) or len(v) != 3:
        return None
    try:
        r, g, b = (max(0, min(255, int(round(float(c))))) for c in v)
    except (ValueError, TypeError):
        return None
    return (r, g, b)


def _parse_sub_seed(sx: object, sy: object) -> tuple[float, float] | None:
    if sx is None or sy is None:
        return None
    try:
        return (float(sx), float(sy))
    except (ValueError, TypeError):
        return None


def parse_subtractions(json_str: str) -> list[Subtraction]:
    """Parse a JSON array of subtraction ops, tolerantly: clamp out-of-range
    threshold (0..255) / tolerance (0..441), snap bad numbers to defaults, drop
    entries without a usable method. Malformed / non-list JSON → ``[]``."""
    try:
        raw = json.loads(json_str) if json_str else []
    except (ValueError, TypeError):
        return []
    if not isinstance(raw, list):
        return []
    out: list[Subtraction] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        method = item.get("method")
        if method not in _SUB_METHODS:
            continue
        try:
            threshold = max(0, min(255, int(round(float(item.get("threshold", 8))))))
        except (ValueError, TypeError):
            threshold = 8
        try:
            tolerance = max(0.0, min(441.0, float(item.get("tolerance", 40.0))))
        except (ValueError, TypeError):
            tolerance = 40.0
        out.append(Subtraction(
            method=method,
            threshold=threshold,
            color=_parse_sub_color(item.get("color")),
            tolerance=tolerance,
            seed=_parse_sub_seed(item.get("seedX"), item.get("seedY")),
        ))
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --active pytest tests/test_relief.py -k parse_subtractions -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): Subtraction model + tolerant JSON parser"
```

---

## Task 6: Wire the stacked pipeline into `/api/relief/smooth`

Replace the flat `bg_*` form fields with `subtractions` (JSON) + `shape_internal`; union the per-op masks; apply edge shaping to the outer silhouette by default.

**Files:**
- Modify: `src/xcs_gen_web/app.py:85-99` (imports) and `:900-1000` (route)
- Test: `tests/test_relief_route.py`

- [ ] **Step 1: Migrate the existing route tests + add stacked / area / shape_internal tests**

At the top of `tests/test_relief_route.py` add `import json` (next to the other imports).

Edit the existing tests to use the new fields (replace the `data=` dicts as shown):

`test_relief_smooth_remove_bg_returns_alpha`:
```python
        data={"smooth": "false", "remove_bg": "true",
              "subtractions": json.dumps([{"method": "dark", "threshold": 8}])},
```

`test_relief_smooth_clamps_bg_threshold` (rename to `test_relief_smooth_clamps_subtraction_threshold`):
```python
def test_relief_smooth_clamps_subtraction_threshold():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(32, 32, 120), "image/png")},
        data={"remove_bg": "true",
              "subtractions": json.dumps([{"method": "dark", "threshold": 9999}])},
    )
    assert resp.status_code == 200
```

`test_relief_smooth_colour_trim_falloff_returns_la_png`:
```python
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([{"method": "colour", "color": [0, 0, 0],
                                         "tolerance": 20}]),
            "trim_pct": "5",
            "falloff_pct": "10",
            "falloff_target": "0",
        },
```

`test_relief_smooth_perimeter_returns_la_png`:
```python
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
            "perimeter_pct": "5",
        },
```

`test_relief_smooth_clahe_with_bg_removal_returns_la_png`:
```python
        data={
            "smooth": "false",
            "clahe": "true",
            "clahe_clip": "3",
            "clahe_tiles": "8",
            "remove_bg": "true",
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
        },
```

`test_relief_smooth_colour_mode_without_colour_is_opaque` (rename to `test_relief_smooth_no_usable_subtraction_is_opaque`):
```python
def test_relief_smooth_no_usable_subtraction_is_opaque():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={"smooth": "false", "remove_bg": "true",
              "subtractions": json.dumps([{"method": "colour"}])},  # no colour → skipped
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "L"             # nothing usable → no alpha, plain L PNG
```

Add new tests at the end of `tests/test_relief_route.py`:

```python
def _png_two_red_blobs():
    """40×20 RGB: black background, two disconnected red blobs (left & right)."""
    from PIL import Image as _I
    buf = BytesIO()
    img = _I.new("RGB", (40, 20), (0, 0, 0))
    for y in range(5, 15):
        for x in range(3, 11):
            img.putpixel((x, y), (200, 0, 0))    # blob A (left)
        for x in range(29, 37):
            img.putpixel((x, y), (200, 0, 0))    # blob B (right)
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_stacks_dark_plus_area():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_two_red_blobs(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([
                {"method": "dark", "threshold": 8},                     # outer black bg
                {"method": "area", "color": [200, 0, 0], "tolerance": 40,
                 "seedX": 7 / 40, "seedY": 0.5},                        # blob A only
            ]),
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content)).convert("LA")
    assert out.getpixel((0, 0))[1] == 0       # black background removed (dark)
    assert out.getpixel((7, 10))[1] == 0      # blob A removed (area, seeded)
    assert out.getpixel((33, 10))[1] == 255   # blob B kept (same colour, disconnected)


def test_relief_smooth_empty_subtractions_is_plain_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={"smooth": "false", "remove_bg": "true", "subtractions": "[]"},
    )
    assert resp.status_code == 200
    assert Image.open(BytesIO(resp.content)).mode == "L"


def _png_donut():
    """48×48 RGB: grey square on black with an enclosed black hole at the centre."""
    from PIL import Image as _I
    buf = BytesIO()
    img = _I.new("RGB", (48, 48), (0, 0, 0))
    for y in range(12, 36):
        for x in range(12, 36):
            img.putpixel((x, y), (150, 150, 150))
    for y in range(22, 26):
        for x in range(22, 26):
            img.putpixel((x, y), (0, 0, 0))       # internal hole (dark)
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_shape_internal_default_keeps_hole_hard():
    # Default shape_internal=false: the internal hole is re-punched hard-edged
    # even with edge falloff on.
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_donut(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
            "falloff_pct": "10",
            "falloff_target": "0",
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content)).convert("LA")
    assert out.getpixel((23, 23))[1] == 0     # internal hole stays transparent


def test_relief_smooth_shape_internal_true_returns_la():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_donut(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "subtractions": json.dumps([{"method": "dark", "threshold": 8}]),
            "falloff_pct": "10",
            "falloff_target": "0",
            "shape_internal": "true",
        },
    )
    assert resp.status_code == 200
    assert Image.open(BytesIO(resp.content)).mode == "LA"
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `uv run --active pytest tests/test_relief_route.py -q`
Expected: FAIL — the migrated tests send `subtractions`, which the route ignores (no alpha), and `test_relief_smooth_stacks_dark_plus_area` fails its assertions.

- [ ] **Step 3: Update the route imports**

In `src/xcs_gen_web/app.py`, the relief import block (`from .relief import (...)` around line 85) currently imports `background_alpha`, `colour_background_alpha`, `parse_rgb`. Replace those three names with the new ones so the block reads (keep the other existing names — `ReliefSmoothParams`, `smooth_heightfield`, `apply_clahe`, `edge_falloff`, `encode_png`, `encode_png_la`, `to_grayscale_u8`, `trim_alpha`, `smooth_perimeter`, `falloff_curve`):

```python
from .relief import (
    ReliefSmoothParams,
    apply_clahe,
    area_background_mask,
    colour_background_mask,
    combine_backgrounds,
    edge_falloff,
    encode_png,
    encode_png_la,
    parse_subtractions,
    smooth_heightfield,
    smooth_perimeter,
    split_internal_holes,
    threshold_background_mask,
    to_grayscale_u8,
    trim_alpha,
)
```

(Drop `background_alpha`, `colour_background_alpha`, `parse_rgb` from the import — they are no longer used by the route. `falloff_curve` was not imported by app.py; leave it.)

- [ ] **Step 4: Replace the route signature fields**

In `relief_smooth(...)` (around line 912-916), delete these four parameters:

```python
        bg_threshold: int = Form(8),
        bg_mode: str = Form("dark"),
        bg_color: str = Form(""),
        bg_tolerance: float = Form(40.0),
```

and replace with:

```python
        subtractions: str = Form("[]"),
        shape_internal: bool = Form(False),
```

(Keep `remove_bg: bool = Form(False)` above them.)

- [ ] **Step 5: Replace the masking + edge-shaping body**

Replace the masking block (currently lines ~956-995, from `alpha = None` through the end of the `if alpha is not None:` block, i.e. everything between the CLAHE-comment masking and `png = encode_png_la(...)` / `else: png = encode_png(out)`) with:

```python
        # Background removal FIRST, so every follow-up step (CLAHE, the client
        # monotonic stretches downstream, and edge shaping) operates on the
        # cut-out. Each subtraction op contributes a boolean background mask;
        # the union becomes the alpha. colour/area key the colour image; dark/
        # bright key the (smoothed) gray.
        alpha = None
        if remove_bg:
            masks = []
            for sub in parse_subtractions(subtractions):
                if sub.method in ("dark", "bright"):
                    masks.append(threshold_background_mask(
                        out, sub.threshold, high=(sub.method == "bright")))
                elif sub.method == "colour" and sub.color is not None:
                    masks.append(colour_background_mask(bgr, sub.color, sub.tolerance))
                elif sub.method == "area" and sub.color is not None and sub.seed is not None:
                    masks.append(area_background_mask(bgr, sub.color, sub.tolerance, sub.seed))
            if masks:
                alpha = combine_backgrounds(masks)
        if clahe:
            # ``mask=alpha`` keeps a large background from skewing CLAHE's
            # adaptive tiles near the object edge (no-op when nothing's masked).
            out = apply_clahe(
                out,
                clip_limit=max(0.1, min(40.0, clahe_clip)),
                tiles=max(1, min(32, clahe_tiles)),
                mask=alpha,
            )
        if alpha is not None:
            perimeter = max(0.0, min(25.0, perimeter_pct))
            trim = max(0.0, min(50.0, trim_pct))
            falloff = max(0.0, min(50.0, falloff_pct))
            if perimeter > 0 or trim > 0 or falloff > 0:
                # Default: shape the outer silhouette only — fill internal holes,
                # shape, then re-punch the holes hard-edged. ``shape_internal``
                # opts in to shaping every boundary (holes included).
                if shape_internal:
                    work, holes = alpha, None
                else:
                    work, holes = split_internal_holes(alpha)
                if perimeter > 0:
                    out, work = smooth_perimeter(out, work, perimeter)
                if trim > 0:
                    work = trim_alpha(work, trim)
                if falloff > 0:
                    target_gray = 255.0 * max(0.0, min(100.0, falloff_target)) / 100.0
                    out, work = edge_falloff(
                        out, work, falloff, falloff_mode, target_gray,
                        max(0.0, min(100.0, falloff_intensity)),
                    )
                if holes is not None:
                    work = work.copy()
                    work[holes] = 0
                alpha = work
            png = encode_png_la(out, alpha)
        else:
            png = encode_png(out)
```

Also update the route docstring's background paragraph (lines ~926-934) to describe `subtractions` + `shape_internal` instead of `bg_mode`:

```python
        """Smooth a grayscale depth map and return the cleaned PNG. Stateless.

        ``smooth=false`` skips the smoothing pass (raw heightfield). Background
        removal (``remove_bg``) applies a stack of ``subtractions`` (a JSON array
        of ops — dark/bright luminance cut, ``colour`` key, or connected ``area``
        pick) whose masks union into one alpha (LA PNG). CLAHE then equalizes the
        foreground only; ``perimeter_pct`` rounds the silhouette, ``trim_pct``
        erodes it, and ``falloff_pct`` ramps a soft edge — applied to the outer
        silhouette unless ``shape_internal`` is set (then internal holes too).
        The monotonic tone modes are applied client-side as a LUT."""
```

- [ ] **Step 6: Run the route tests to verify they pass**

Run: `uv run --active pytest tests/test_relief_route.py tests/test_relief.py -q`
Expected: PASS (all relief + route tests).

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_relief_route.py
git commit -m "feat(relief): stacked subtractions + outer-only edge shaping in /api/relief/smooth"
```

---

## Task 7: Frontend — stacked-subtraction model, payload, and UI

Reshape `StretchParams`, update the API payload, rebuild the Cutout panel as a row list, and rewire the eyedropper to pick per-row. These four files + their tests change together because removing the flat `bg*` fields breaks all of them at once; the project typecheck is expected to pass only at the end of this task.

**Files:**
- Modify: `web/src/components/relief/stretch.ts`
- Modify: `web/src/pages/reliefHelpers.ts`
- Modify: `web/src/components/relief/CutoutControls.tsx`
- Modify: `web/src/pages/ReliefPage.tsx`
- Test: `web/src/components/relief/stretch.test.ts`, `web/src/pages/reliefHelpers.test.ts`, `web/src/components/relief/controls.test.tsx`

- [ ] **Step 1: Reshape the data model in `stretch.ts`**

In `web/src/components/relief/stretch.ts`, replace the four background-method fields in `StretchParams`:

```ts
  /** Picked background colour (RGB) for `colour` mode; null until sampled. */
  bgColor: [number, number, number] | null;
  /** Euclidean RGB distance for `colour` mode (0..441). */
  bgTolerance: number;
```
and
```ts
  bgThreshold: number;
  /** Background removal method. */
  bgMode: "dark" | "bright" | "colour";
```

— remove all four (`bgMode`, `bgThreshold`, `bgColor`, `bgTolerance`). Keep `removeBackground`. Add, immediately after `removeBackground: boolean;`:

```ts
  /** Stacked background subtractions; their masks union. At least one row. */
  subtractions: Subtraction[];
  /** Shape internal-hole edges too (default: outer silhouette only). */
  shapeInternal: boolean;
```

Add the new types + helper near the top of the file (after the `StretchMode` type):

```ts
export type SubMethod = "dark" | "bright" | "colour" | "area";

/** One background-subtraction op. `colour`/`area` carry a picked colour; `area`
 *  also carries a fractional (0..1) seed click used to keep only the connected
 *  region under the cursor. */
export interface Subtraction {
  method: SubMethod;
  /** dark/bright luminance cut (0..255). */
  threshold: number;
  /** colour/area: picked RGB; null until sampled. */
  color: [number, number, number] | null;
  /** colour/area: Euclidean RGB distance (0..441). */
  tolerance: number;
  /** area: fractional (0..1) seed, in source-image space; null until picked. */
  seedX: number | null;
  seedY: number | null;
}

/** A fresh subtraction row with sensible defaults. */
export function defaultSubtraction(method: SubMethod = "dark"): Subtraction {
  return { method, threshold: 8, color: null, tolerance: 40, seedX: null, seedY: null };
}
```

In `DEFAULT_STRETCH_PARAMS`, remove the four lines `bgThreshold: 8,`, `bgMode: "dark",`, `bgColor: null,`, `bgTolerance: 40,` and add in their place:

```ts
  subtractions: [defaultSubtraction("dark")],
  shapeInternal: false,
```

- [ ] **Step 2: Update the API payload in `reliefHelpers.ts`**

In `web/src/pages/reliefHelpers.ts`, add the import at the top:

```ts
import type { Subtraction } from "../components/relief/stretch";
```

Replace the `background?: {...}` option type (lines ~42-53) with:

```ts
    background?: {
      subtractions: Subtraction[];
      perimeterPct: number; // 0 = off
      trimPct: number;    // 0 = off
      falloffPct: number; // 0 = off
      falloffMode: "inward" | "outward";
      falloffTarget: number;    // 0 (floor) .. 100 (peak) % of tone range
      falloffIntensity: number; // 0..100
      shapeInternal: boolean;
    };
```

Replace the `if (opts?.background) {...}` block (lines ~69-82) with:

```ts
  if (opts?.background) {
    const b = opts.background;
    fd.append("remove_bg", "true");
    fd.append(
      "subtractions",
      JSON.stringify(
        b.subtractions.map((s) => ({
          method: s.method,
          threshold: s.threshold,
          color: s.color,
          tolerance: s.tolerance,
          seedX: s.seedX,
          seedY: s.seedY,
        })),
      ),
    );
    fd.append("shape_internal", String(b.shapeInternal));
    fd.append("perimeter_pct", String(b.perimeterPct));
    fd.append("trim_pct", String(b.trimPct));
    fd.append("falloff_pct", String(b.falloffPct));
    fd.append("falloff_mode", b.falloffMode);
    fd.append("falloff_target", String(b.falloffTarget));
    fd.append("falloff_intensity", String(b.falloffIntensity));
  }
```

- [ ] **Step 3: Rebuild the Cutout panel as a row list in `CutoutControls.tsx`**

In `web/src/components/relief/CutoutControls.tsx`:

Change the props + imports. Replace the import line and `CutoutControlsProps`:

```tsx
import { Field } from "../../ui";
import type { StretchParams, SubMethod, Subtraction } from "./stretch";
import { defaultSubtraction } from "./stretch";
import { LabelHint, SelectField, Slider, Toggle } from "./fields";

export interface CutoutControlsProps {
  params: StretchParams;
  onChange: (p: StretchParams) => void;
  /** Begin picking a colour/seed for the subtraction row at `index`. */
  onPickColor: (index: number) => void;
}
```

Replace the whole block from the opening `{params.removeBackground && (` down to the matching close before the `{!params.removeBackground && (` fallback — i.e. the `Method` `SelectField`, the threshold/colour conditional, and the "Edge shaping" divider/label sit *after* the rows now. Use this for the removeBackground branch (keeps the existing Edge-shaping controls unchanged below the rows; only the method/threshold/colour part becomes a row list, and a "Shape internal edges" toggle is added at the end of Edge shaping):

```tsx
      {params.removeBackground && (
        <>
          {params.subtractions.map((sub, i) => (
            <SubtractionRow
              key={i}
              index={i}
              sub={sub}
              canRemove={params.subtractions.length > 1}
              onChange={(next) =>
                set(
                  "subtractions",
                  params.subtractions.map((s, j) => (j === i ? next : s)),
                )
              }
              onRemove={() =>
                set(
                  "subtractions",
                  params.subtractions.filter((_, j) => j !== i),
                )
              }
              onPick={() => onPickColor(i)}
            />
          ))}
          <button
            type="button"
            onClick={() => set("subtractions", [...params.subtractions, defaultSubtraction()])}
            className="self-start rounded-[5px] border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[color:var(--color-ink-muted)] hover:border-[var(--color-primary)]/50 hover:text-[color:var(--color-ink)]"
          >
            + Subtract another
          </button>

          {/* ── Edge shaping (depends on the alpha above) ──────────────── */}
          <div
            aria-hidden
            className="mt-1 h-px"
            style={{ background: "var(--metal-bar-soft)" }}
          />
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-ink-subtle)]">
            Edge shaping
          </div>

          <Toggle
            label="Smooth edge"
            checked={params.perimeterEnabled}
            onChange={(v) => set("perimeterEnabled", v)}
            hint="Round the jagged silhouette outline — smooths the engraved wall and any tapered rim."
          />
          {params.perimeterEnabled && (
            <Slider
              label="Smooth %"
              value={params.perimeterPct}
              min={0}
              max={15}
              step={0.5}
              onChange={(v) => set("perimeterPct", v)}
            />
          )}

          <Toggle
            label="Trim outline"
            checked={params.trimEnabled}
            onChange={(v) => set("trimEnabled", v)}
            hint="Erode the object outline by a % of its shorter side — removes a fuzzy border."
          />
          {params.trimEnabled && (
            <Slider
              label="Trim %"
              value={params.trimPct}
              min={0}
              max={25}
              step={0.5}
              onChange={(v) => set("trimPct", v)}
            />
          )}

          <Toggle
            label="Edge falloff"
            checked={params.falloffEnabled}
            onChange={(v) => set("falloffEnabled", v)}
            hint="Soften the cut edge: bevel a band inside the object, or grow an outward raised border (berm)."
          />
          {params.falloffEnabled && (
            <>
              <SelectField
                label="Falloff mode"
                ariaLabel="Edge falloff mode"
                value={params.falloffMode}
                onChange={(v) => set("falloffMode", v as StretchParams["falloffMode"])}
                options={[
                  { value: "inward", label: "Inward — bevel the object edge" },
                  { value: "outward", label: "Outward — raised border (berm)" },
                ]}
              />
              <Slider
                label="Taper to %"
                value={params.falloffTarget}
                min={0}
                max={100}
                step={1}
                onChange={(v) => set("falloffTarget", v)}
                hint="Level the edge ramps to — 0 = floor, 100 = peak (outward: berm crest height)."
              />
              <Slider
                label="Offset %"
                value={params.falloffPct}
                min={0}
                max={50}
                step={0.5}
                onChange={(v) => set("falloffPct", v)}
                hint="Width of the falloff band as a % of the object's shorter side."
              />
              <Slider
                label="Intensity"
                value={params.falloffIntensity}
                min={0}
                max={100}
                step={1}
                onChange={(v) => set("falloffIntensity", v)}
                hint="Falloff curve steepness — 0 gentle (linear), 100 sharp."
              />
            </>
          )}

          <Toggle
            label="Shape internal edges"
            checked={params.shapeInternal}
            onChange={(v) => set("shapeInternal", v)}
            hint="Apply the edge shaping above to internal holes (e.g. an inner pocket) too. Off = only the outer silhouette is shaped; holes stay hard-edged."
          />
        </>
      )}
```

Then add the `SubtractionRow` component at the bottom of the file (before the final close), which renders one op:

```tsx
const METHOD_OPTIONS: { value: SubMethod; label: string }[] = [
  { value: "dark", label: "Dark threshold" },
  { value: "bright", label: "Bright threshold" },
  { value: "colour", label: "Pick colour" },
  { value: "area", label: "Pick area" },
];

function SubtractionRow({
  index,
  sub,
  canRemove,
  onChange,
  onRemove,
  onPick,
}: {
  index: number;
  sub: Subtraction;
  canRemove: boolean;
  onChange: (next: Subtraction) => void;
  onRemove: () => void;
  onPick: () => void;
}) {
  const isColourLike = sub.method === "colour" || sub.method === "area";
  return (
    <div className="flex flex-col gap-2 rounded-[6px] border border-[color:var(--color-border)] p-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <SelectField
            label={`Subtraction ${index + 1}`}
            ariaLabel={`Subtraction ${index + 1} method`}
            value={sub.method}
            onChange={(v) => onChange({ ...sub, method: v as SubMethod })}
            options={METHOD_OPTIONS}
            hint="How this layer detects background: a dark/bright luminance cut, a global colour key, or a connected area (only the region you click)."
          />
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove subtraction ${index + 1}`}
            className="mb-0.5 rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-ink-muted)] hover:border-[var(--color-primary)]/50 hover:text-[color:var(--color-ink)]"
          >
            ×
          </button>
        )}
      </div>

      {!isColourLike ? (
        <Slider
          label="Threshold"
          value={sub.threshold}
          min={0}
          max={255}
          step={1}
          onChange={(v) => onChange({ ...sub, threshold: v })}
          hint="Pixels at or below (dark) / above (bright) this value become transparent."
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPick}
              className="rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-primary)]/50"
            >
              {sub.method === "area" ? "Pick area from image" : "Pick from image"}
            </button>
            <span
              className="inline-block h-5 w-5 rounded-[4px] border border-[var(--color-border)]"
              style={{ background: sub.color ? `rgb(${sub.color.join(",")})` : "transparent" }}
              aria-hidden
            />
            <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
              {sub.color ? sub.color.join(", ") : "no colour picked"}
            </span>
          </div>
          <Slider
            label="Tolerance"
            value={sub.tolerance}
            min={0}
            max={200}
            step={1}
            onChange={(v) => onChange({ ...sub, tolerance: v })}
            hint="How far a pixel's colour can be from the picked colour and still count as background."
          />
        </>
      )}
    </div>
  );
}
```

Note: the `set` helper (`const set = <K extends keyof StretchParams>(...)`) is already defined at the top of `CutoutControls`; `SubtractionRow` lives in the same module.

- [ ] **Step 4: Rewire the eyedropper + payload + pad colour in `ReliefPage.tsx`**

In `web/src/pages/ReliefPage.tsx`:

(a) Picker state — replace `const [pickingColor, setPickingColor] = useState(false);` (line ~223) with:

```tsx
  // Eyedropper: the subtraction-row index awaiting a pick, or null.
  const [pickingFor, setPickingFor] = useState<number | null>(null);
```

(b) Replace the two existing callbacks `onSourceClick` (lines ~225-247, including its leading comment) **and** `onPickFraction` (lines ~249-259) — the whole contiguous region — with this single block. `applyPick` is declared **first** so the click handlers can reference it (a `const` is not hoisted, and it must appear in their dep arrays):

```tsx
  // Set the picked colour + seed on the awaiting subtraction row. The colour is
  // sampled at the click; the seed (fraction) is stored for every pick and used
  // by the backend only for the `area` method.
  const applyPick = useCallback(
    (index: number, fx: number, fy: number) => {
      if (!originalData) return;
      const rgb = sampleRgb(originalData, fx, fy);
      setStretchParams((p) => ({
        ...p,
        removeBackground: true,
        subtractions: p.subtractions.map((s, j) =>
          j === index ? { ...s, color: rgb, seedX: fx, seedY: fy } : s,
        ),
      }));
      setPickingFor(null);
    },
    [originalData],
  );

  // The source thumbnail is displayed at width:100% with natural aspect, so
  // (clientX - r.left) / r.width maps directly to a fractional pixel.
  const onSourceClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (pickingFor === null || !originalData) return;
      const r = e.currentTarget.getBoundingClientRect();
      applyPick(pickingFor, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    },
    [pickingFor, originalData, applyPick],
  );

  // Eyedropper pick from the main 2D preview: the canvas hands back the clicked
  // position as image fractions (letterbox already accounted for).
  const onPickFraction = useCallback(
    (fx: number, fy: number) => {
      if (pickingFor !== null) applyPick(pickingFor, fx, fy);
    },
    [pickingFor, applyPick],
  );
```

(d) `bgOpts` (lines ~80-116) — replace the returned object's bg fields and deps:

```tsx
  const bgOpts = useCallback(
    () =>
      stretchParams.removeBackground
        ? {
            subtractions: stretchParams.subtractions,
            perimeterPct: stretchParams.perimeterEnabled
              ? stretchParams.perimeterPct
              : 0,
            trimPct: stretchParams.trimEnabled ? stretchParams.trimPct : 0,
            falloffPct: stretchParams.falloffEnabled
              ? stretchParams.falloffPct
              : 0,
            falloffMode: stretchParams.falloffMode,
            falloffTarget: stretchParams.falloffTarget,
            falloffIntensity: stretchParams.falloffIntensity,
            shapeInternal: stretchParams.shapeInternal,
          }
        : undefined,
    [
      stretchParams.removeBackground,
      stretchParams.subtractions,
      stretchParams.perimeterEnabled,
      stretchParams.perimeterPct,
      stretchParams.trimEnabled,
      stretchParams.trimPct,
      stretchParams.falloffEnabled,
      stretchParams.falloffPct,
      stretchParams.falloffMode,
      stretchParams.falloffTarget,
      stretchParams.falloffIntensity,
      stretchParams.shapeInternal,
    ],
  );
```

(e) `workingSource` deps (lines ~127-133) — replace `stretchParams.bgMode,` and `stretchParams.bgColor,` in the dep array with `stretchParams.subtractions,`:

```tsx
  }, [
    bitmap,
    stretchParams.expandPct,
    stretchParams.subtractions,
    stretchParams.removeBackground,
  ]);
```

(f) `CutoutControls` invocation (line ~679-683) — change `onPickColor`:

```tsx
              <CutoutControls
                params={stretchParams}
                onChange={setStretchParams}
                onPickColor={(index) => setPickingFor(index)}
              />
```

(g) `ReliefCompare2D` / `ReliefSplit2D` `picking` props (lines ~754, ~763) — change `picking={pickingColor}` to `picking={pickingFor !== null}` in both places.

(h) Any other reference to `pickingColor` (e.g. the source-thumbnail cursor/title around lines ~856-863, and the `onSourceClick` wiring) — replace `pickingColor` with `pickingFor !== null`. Search the file for `pickingColor` and ensure none remain.

(i) `padColorFor` (lines ~897-901) — replace with the first-subtraction version:

```tsx
function padColorFor(p: StretchParams): [number, number, number] {
  const first = p.subtractions[0];
  if (p.removeBackground && first) {
    if (first.method === "bright") return [255, 255, 255];
    if ((first.method === "colour" || first.method === "area") && first.color)
      return first.color;
  }
  return [0, 0, 0];
}
```

- [ ] **Step 5: Update the three test files**

`web/src/components/relief/stretch.test.ts` — append:

```ts
import { defaultSubtraction } from "./stretch";

describe("subtraction defaults", () => {
  it("DEFAULT_STRETCH_PARAMS starts with one dark subtraction and shapeInternal off", () => {
    expect(DEFAULT_STRETCH_PARAMS.subtractions).toHaveLength(1);
    expect(DEFAULT_STRETCH_PARAMS.subtractions[0].method).toBe("dark");
    expect(DEFAULT_STRETCH_PARAMS.shapeInternal).toBe(false);
  });
  it("defaultSubtraction builds a row with the given method and null colour/seed", () => {
    const s = defaultSubtraction("area");
    expect(s).toEqual({
      method: "area", threshold: 8, color: null, tolerance: 40, seedX: null, seedY: null,
    });
  });
});
```

(If `DEFAULT_STRETCH_PARAMS` is already imported at the top of the file, keep that import; only add the `defaultSubtraction` import.)

`web/src/pages/reliefHelpers.test.ts` — replace the two background tests (`it("appends background fields when opts.background given", ...)` inside `describe("reliefSmooth form fields", ...)` and the whole `describe("reliefSmooth background fields", ...)` block) with:

```ts
  it("appends subtraction + shape_internal fields when opts.background given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS }, {
      background: {
        subtractions: [
          { method: "dark", threshold: 8, color: null, tolerance: 40, seedX: null, seedY: null },
          { method: "area", threshold: 8, color: [10, 20, 30], tolerance: 25, seedX: 0.5, seedY: 0.25 },
        ],
        perimeterPct: 0, trimPct: 0, falloffPct: 0, falloffMode: "inward",
        falloffTarget: 0, falloffIntensity: 50, shapeInternal: true,
      },
    });
    expect(sent[0].get("remove_bg")).toBe("true");
    expect(sent[0].get("shape_internal")).toBe("true");
    const subs = JSON.parse(sent[0].get("subtractions") as string);
    expect(subs).toHaveLength(2);
    expect(subs[0].method).toBe("dark");
    expect(subs[1]).toMatchObject({ method: "area", color: [10, 20, 30], seedX: 0.5, seedY: 0.25 });
    vi.unstubAllGlobals();
  });
```

(Delete the old `describe("reliefSmooth background fields", ...)` block at the bottom of the file that referenced `bg_mode`/`bg_color`.)

`web/src/components/relief/controls.test.tsx` — replace the third test (`it("fires onPickColor from the eyedropper button in colour mode", ...)`) and add row tests. Replace it with:

```tsx
  it("fires onPickColor(index) from a colour row's eyedropper", () => {
    const onPickColor = vi.fn();
    render(
      <CutoutControls
        params={{
          ...DEFAULT_STRETCH_PARAMS,
          removeBackground: true,
          subtractions: [{ method: "colour", threshold: 8, color: null, tolerance: 40, seedX: null, seedY: null }],
        }}
        onChange={() => {}}
        onPickColor={onPickColor}
      />,
    );
    fireEvent.click(screen.getByText(/pick from image/i));
    expect(onPickColor).toHaveBeenCalledWith(0);
  });

  it("appends a row via 'Subtract another'", () => {
    const onChange = vi.fn();
    render(
      <CutoutControls
        params={{ ...DEFAULT_STRETCH_PARAMS, removeBackground: true }}
        onChange={onChange}
        onPickColor={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/subtract another/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ subtractions: expect.arrayContaining([
        expect.objectContaining({ method: "dark" }),
      ]) }),
    );
    const arg = onChange.mock.calls[0][0];
    expect(arg.subtractions).toHaveLength(2);
  });

  it("removes a row via × when more than one row exists", () => {
    const onChange = vi.fn();
    render(
      <CutoutControls
        params={{
          ...DEFAULT_STRETCH_PARAMS,
          removeBackground: true,
          subtractions: [defaultSubtraction("dark"), defaultSubtraction("bright")],
        }}
        onChange={onChange}
        onPickColor={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove subtraction 1/i));
    expect(onChange.mock.calls[0][0].subtractions).toHaveLength(1);
  });
```

Add `defaultSubtraction` to the stretch import at the top of `controls.test.tsx`:
```tsx
import { DEFAULT_STRETCH_PARAMS, defaultSubtraction } from "./stretch";
```

The existing test `it("reveals the threshold slider only when background removal is on", ...)` still holds: with one default `dark` row, the "Threshold" slider appears and the `Subtraction 1 method` select (aria-label) is present — update its second assertion from `/background removal method/i` to `/subtraction 1 method/i`.

- [ ] **Step 6: Typecheck + run the frontend suite**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all vitest suites pass (incl. the updated `stretch`, `reliefHelpers`, `controls` tests). Grep to confirm no stragglers: `grep -rn "bgMode\|bgColor\|bgThreshold\|bgTolerance\|pickingColor" web/src` returns nothing.

- [ ] **Step 7: Rebuild `web/dist` (the server serves it, not Vite dev)**

Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK`
Expected: `BUILD_OK`.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/relief/stretch.ts web/src/components/relief/stretch.test.ts \
        web/src/pages/reliefHelpers.ts web/src/pages/reliefHelpers.test.ts \
        web/src/components/relief/CutoutControls.tsx web/src/components/relief/controls.test.tsx \
        web/src/pages/ReliefPage.tsx
git commit -m "feat(relief): stacked subtraction rows + Pick area UI + shape-internal toggle"
```

---

## Task 8: Changelog + full verification

**Files:**
- Create: `changelog/2026-06-17-relief-bg-subtraction-stack.md`

- [ ] **Step 1: Write the changelog entry**

Create `changelog/2026-06-17-relief-bg-subtraction-stack.md`:

```markdown
---
id: 2026-06-17-relief-bg-subtraction-stack
date: 2026-06-17
level: minor
title: Relief — pick-area + stacked background subtractions
summary: Background removal now stacks. "Subtract another" adds independent subtraction layers whose masks combine, so you can drop the outer background and one or more internal features in a single pass. A new "Pick area" method works like the colour picker but only removes the contiguous region you click — same-coloured patches elsewhere stay put. Edge shaping defaults to the outer silhouette, with a "Shape internal edges" toggle for internal holes.
---
```

- [ ] **Step 2: Run the full backend + frontend suites**

Run: `uv run --active pytest tests/test_relief.py tests/test_relief_route.py -q`
Expected: PASS.

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass.

- [ ] **Step 3: Browser smoke-test (golden path)**

Start the server (`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`), open `http://127.0.0.1:8017/#/depthmaps`, and verify:
- Upload a depth map; turn on "Remove background"; the first row defaults to "Dark threshold".
- Add a second row via "Subtract another", set it to "Pick area", click "Pick area from image", and click an internal feature → only that region is removed; a same-coloured region elsewhere stays.
- Toggle "Shape internal edges" with Edge falloff on → the internal hole edge ramps; toggle off → it is hard-edged.
- Remove the second row with × → back to one subtraction.
Screenshot and review the result critically before reporting complete.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-06-17-relief-bg-subtraction-stack.md
git commit -m "docs(relief): changelog for pick-area + stacked subtractions"
```

---

## Execution notes

- After all tasks: push `feat/relief-bg-subtract-stack`, open a draft PR, flip to ready when CI is green (per CLAUDE.md). This branch is independent of the still-open `.xs` import PR (#157).
- No alembic migration is involved (stateless endpoint; no model change), so the CI revision-assertion gotcha does not apply.
