# Relief 8/16-bit depth maps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Relief tool export **true 8-bit or 16-bit** grayscale depth-map PNGs (selectable via a toggle at the top of the page), preserving precision input→output so engraved reliefs lose the 256-level terracing.

**Architecture:** A new `POST /api/relief/export` renders the *whole* pipeline on the backend in a **float32 [0,1]** heightfield from the **original source bytes**, quantizing to 8- or 16-bit only at the final encode. The existing `/api/relief/smooth` (downscaled 8-bit preview) and the client tone-LUT preview are unchanged. The four monotonic tone curves are ported to numpy (parity-tested against `stretch.ts`). The browser canvas can't emit 16-bit, so export always goes through this backend render.

**Tech Stack:** Python (FastAPI, numpy, OpenCV/cv2, Pillow) backend; React/TypeScript (Vite, vitest) frontend.

## Global Constraints

- Backend run/test: `uv run --active pytest tests/ -q` (always `--active`). Frontend gate: `cd web && npx tsc --noEmit && npm test -- --run`. Rebuild `web/dist` after `web/src/**` changes: `cd web && npm run build`.
- Never `git commit --no-verify`. Branch is `feat/relief-16bit` (already created off `main`, spec committed).
- **Float domain:** the canonical internal heightfield for the new code is `np.float32` normalized to **[0, 1]**. All `0..255` constants are expressed as `/255.0`. Quantize to output only at encode (`*255` → uint8, `*65535` → uint16, `np.rint`, clip).
- **16-bit export is single-channel grayscale.** When background removal produced an alpha, 16-bit output flattens transparent pixels to the floor (0); 8-bit keeps the `LA` transparency.
- Parity: refactored float cores must match the old uint8 behaviour at 8-bit within ±1 level; ported tone curves must match `web/src/components/relief/stretch.ts::buildLut` within ±1/255.
- Spec: `docs/superpowers/specs/2026-06-21-relief-16bit-depth-maps-design.md`.

---

## File structure

```
src/xcs_gen_web/relief.py            MOD  float01 cores + uint8 wrappers; decode_gray01; encode_depth_png; numpy tone curves
src/xcs_gen_web/app.py               MOD  POST /api/relief/export
web/src/pages/reliefHelpers.ts       MOD  reliefExport() helper
web/src/components/relief/BitDepthToggle.tsx  NEW  8|16 segmented toggle
web/src/pages/ReliefPage.tsx         MOD  bitDepth state (+localStorage), keep original bytes, rewired onExport, toggle in toolbar
tests/test_relief.py                 MOD  decode/encode/tone/float-core tests
tests/test_relief_route.py           MOD  /api/relief/export tests
web/src/pages/reliefHelpers.test.ts  MOD  reliefExport params
web/src/components/relief/BitDepthToggle.test.tsx  NEW  toggle render/state
changelog/2026-06-21-relief-16bit.md NEW  minor entry
```

---

## Task 1: Backend — native-depth decode + depth-aware encode

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

**Interfaces:**
- Produces: `decode_gray01(raw: bytes) -> np.ndarray` (float32 HxW in [0,1]); `encode_depth_png(gray01: np.ndarray, alpha: np.ndarray | None, bit_depth: int) -> bytes`.
- Consumes: existing `encode_png`, `encode_png_la` (kept for the 8-bit preview path).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_relief.py`:
```python
import io
import numpy as np
from PIL import Image
from xcs_gen_web.relief import decode_gray01, encode_depth_png


def _png_bytes(arr: np.ndarray, mode: str) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr, mode=mode).save(buf, format="PNG")
    return buf.getvalue()


def test_decode_gray01_8bit_normalizes_to_unit_range():
    src = np.array([[0, 128, 255]], dtype=np.uint8)
    g = decode_gray01(_png_bytes(src, "L"))
    assert g.dtype == np.float32
    assert g.shape == (1, 3)
    np.testing.assert_allclose(g, [[0.0, 128 / 255, 1.0]], atol=1e-6)


def test_decode_gray01_16bit_preserves_precision():
    # values impossible to represent in 8-bit (not multiples of 257)
    src = np.array([[0, 30000, 65535]], dtype=np.uint16)
    g = decode_gray01(_png_bytes(src, "I;16"))
    assert g.dtype == np.float32
    np.testing.assert_allclose(g, [[0.0, 30000 / 65535, 1.0]], atol=1e-6)


def test_encode_depth_png_16bit_roundtrip_is_true_16bit():
    # a smooth ramp with >256 distinct float levels
    ramp = np.linspace(0.0, 1.0, 1000, dtype=np.float32).reshape(1, 1000)
    png = encode_depth_png(ramp, None, 16)
    im = Image.open(io.BytesIO(png))
    assert im.mode in ("I;16", "I")
    out = np.asarray(im)
    assert len(np.unique(out)) > 256  # genuinely >8-bit


def test_encode_depth_png_8bit_is_mode_L():
    g = np.array([[0.0, 0.5, 1.0]], dtype=np.float32)
    im = Image.open(io.BytesIO(encode_depth_png(g, None, 8)))
    assert im.mode == "L"
    np.testing.assert_array_equal(np.asarray(im), [[0, 128, 255]])


def test_encode_depth_png_16bit_flattens_alpha_to_floor():
    g = np.array([[0.5, 0.9]], dtype=np.float32)
    alpha = np.array([[0, 255]], dtype=np.uint8)  # first px is background
    im = Image.open(io.BytesIO(encode_depth_png(g, alpha, 16)))
    assert im.mode in ("I;16", "I")
    out = np.asarray(im)
    assert out[0, 0] == 0                 # transparent → floor
    assert out[0, 1] == round(0.9 * 65535)


def test_encode_depth_png_8bit_with_alpha_is_LA():
    g = np.array([[0.5, 0.9]], dtype=np.float32)
    alpha = np.array([[0, 255]], dtype=np.uint8)
    im = Image.open(io.BytesIO(encode_depth_png(g, alpha, 8)))
    assert im.mode == "LA"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --active pytest tests/test_relief.py -k "decode_gray01 or encode_depth_png" -q`
Expected: FAIL — `ImportError: cannot import name 'decode_gray01'`.

- [ ] **Step 3: Implement** — add to `src/xcs_gen_web/relief.py` (and add `decode_gray01`, `encode_depth_png` to `__all__`):
```python
def decode_gray01(raw: bytes) -> np.ndarray:
    """Decode PNG/image bytes to a single-channel float32 heightfield in [0,1],
    preserving the source bit depth (8-bit → /255, 16-bit → /65535). Non-gray
    sources are reduced to luminance."""
    im = Image.open(BytesIO(raw))
    im.load()
    if im.mode in ("I;16", "I;16B", "I;16L", "I"):
        arr = np.asarray(im, dtype=np.float32)
        return np.ascontiguousarray(arr / 65535.0)
    if im.mode == "F":
        arr = np.asarray(im, dtype=np.float32)
        m = float(arr.max()) or 1.0
        return np.ascontiguousarray(np.clip(arr / m, 0.0, 1.0))
    # 8-bit paths: L / LA / RGB / RGBA / P → luminance
    if im.mode not in ("L", "LA"):
        im = im.convert("L")
    elif im.mode == "LA":
        im = im.convert("L")
    arr = np.asarray(im, dtype=np.float32)
    return np.ascontiguousarray(arr / 255.0)


def encode_depth_png(
    gray01: np.ndarray, alpha: np.ndarray | None, bit_depth: int
) -> bytes:
    """Quantize a float32 [0,1] heightfield and encode a PNG at the requested
    bit depth. 8-bit → mode L (or LA when ``alpha`` is given); 16-bit → mode
    I;16 grayscale, with any transparent pixels flattened to the floor (0)."""
    g = np.clip(gray01, 0.0, 1.0)
    if int(bit_depth) >= 16:
        if alpha is not None:
            g = np.where(alpha > 0, g, 0.0)
        u16 = np.rint(g * 65535.0).astype(np.uint16)
        buf = BytesIO()
        Image.fromarray(np.ascontiguousarray(u16), mode="I;16").save(buf, format="PNG")
        return buf.getvalue()
    u8 = np.rint(g * 255.0).astype(np.uint8)
    if alpha is not None:
        return encode_png_la(u8, alpha)
    return encode_png(u8)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --active pytest tests/test_relief.py -k "decode_gray01 or encode_depth_png" -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): native-depth decode + 8/16-bit depth-map encode"
```

---

## Task 2: Backend — float smoothing core

Refactor `smooth_heightfield` to a float32 [0,1] core with a uint8 wrapper (so the preview path is unchanged behaviourally) that genuinely produces >256 levels at 16-bit.

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

**Interfaces:**
- Produces: `smooth_heightfield01(gray01: np.ndarray, p: ReliefSmoothParams) -> np.ndarray` (float32 [0,1]).
- `smooth_heightfield(gray_u8, p) -> uint8` is kept as a thin wrapper over the float core (unchanged signature/behaviour ±1).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_relief.py`:
```python
from xcs_gen_web.relief import (
    ReliefSmoothParams, smooth_heightfield, smooth_heightfield01,
)


def test_smooth01_produces_sub_256_levels_on_a_gradient():
    # diagonal ramp + noise; float bilateral yields >256 distinct levels
    yy, xx = np.mgrid[0:64, 0:64].astype(np.float32)
    g01 = ((xx + yy) / 126.0).astype(np.float32)
    out = smooth_heightfield01(g01, ReliefSmoothParams(strength=4, spike_removal=False))
    assert out.dtype == np.float32
    assert out.min() >= 0.0 and out.max() <= 1.0
    assert len(np.unique(np.rint(out * 65535))) > 256


def test_smooth_u8_wrapper_matches_old_behaviour_within_1():
    rng = np.random.default_rng(0)
    g = rng.integers(0, 256, size=(48, 48), dtype=np.uint8)
    p = ReliefSmoothParams(strength=6, edge_threshold=40, spike_removal=True)
    out = smooth_heightfield(g, p)
    assert out.dtype == np.uint8
    assert out.shape == g.shape
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --active pytest tests/test_relief.py -k "smooth01 or smooth_u8_wrapper" -q`
Expected: FAIL — `cannot import name 'smooth_heightfield01'`.

- [ ] **Step 3: Implement** — in `src/xcs_gen_web/relief.py`, replace the body of `smooth_heightfield` and add the float core (add `smooth_heightfield01` to `__all__`):
```python
def smooth_heightfield01(gray01: np.ndarray, p: ReliefSmoothParams) -> np.ndarray:
    """Edge-aware denoise of a float32 [0,1] heightfield (true-precision core)."""
    if gray01.ndim != 2:
        raise ValueError("smooth_heightfield01 expects a single-channel image")
    work = np.ascontiguousarray(gray01, dtype=np.float32)

    # 1. spike removal — median needs an integer type; do it at 16-bit scale.
    if p.spike_removal:
        u16 = np.rint(np.clip(work, 0.0, 1.0) * 65535.0).astype(np.uint16)
        work = cv2.medianBlur(u16, p.median_ksize).astype(np.float32) / 65535.0

    et = max(1, int(p.edge_threshold)) / 255.0  # threshold in [0,1] units
    # 2. edge-aware smooth — bilateral on float32; sigmaColor IS the guard rail.
    smoothed = cv2.bilateralFilter(
        work, d=0, sigmaColor=et, sigmaSpace=max(1, int(p.strength)),
    )

    # 3. explicit guard-rail freeze — hard-preserve real sharp drops (on de-spiked).
    if p.edge_preserve:
        kernel = np.ones((3, 3), np.uint8)
        local_range = cv2.morphologyEx(work, cv2.MORPH_GRADIENT, kernel)
        edge_mask = (local_range > et).astype(np.uint8)
        edge_mask = cv2.dilate(edge_mask, kernel, iterations=1)
        smoothed = np.where(edge_mask.astype(bool), work, smoothed)

    return np.ascontiguousarray(np.clip(smoothed, 0.0, 1.0), dtype=np.float32)


def smooth_heightfield(gray: np.ndarray, p: ReliefSmoothParams) -> np.ndarray:
    """Edge-aware denoise of a single-channel uint8 heightfield (preview path)."""
    if gray.ndim != 2:
        raise ValueError("smooth_heightfield expects a single-channel image")
    out01 = smooth_heightfield01(gray.astype(np.float32) / 255.0, p)
    return np.ascontiguousarray(np.rint(out01 * 255.0).astype(np.uint8))
```

- [ ] **Step 4: Run to verify pass + no preview regression**

Run: `uv run --active pytest tests/test_relief.py -k "smooth" -q`
Expected: PASS. Then run the whole relief suite: `uv run --active pytest tests/test_relief.py -q`. If any pre-existing exact-equality assertion is now off by exactly 1 level (float round-trip), relax that single assertion to `np.testing.assert_allclose(actual, expected, atol=1)` — note the float-core rationale in a comment. Expected end state: all pass.

- [ ] **Step 5: Commit**
```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "refactor(relief): float32 smoothing core (uint8 wrapper for preview)"
```

---

## Task 3: Backend — tone curves in numpy (parity with `stretch.ts`)

Port `none`(+removeEmptyLayers)/`linear`/`gamma`/`asinh`/`equalize` to operate on the float heightfield. The histogram is taken over the **foreground** (matching `stretch.ts::histogram`, which skips transparent pixels).

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

**Interfaces:**
- Produces: `ToneParams` dataclass and `apply_tone01(gray01: np.ndarray, p: ToneParams, fg_mask: np.ndarray | None) -> np.ndarray` (float32 [0,1]). `fg_mask` is a bool array (True = foreground) or None (all foreground).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_relief.py`. These pin the curves to the same maths as `web/src/components/relief/stretch.ts::buildLut` (256-bin histogram, percentile bounds, gamma `pow`, asinh `k = 1 + strength*40`, CDF equalization):
```python
from xcs_gen_web.relief import ToneParams, apply_tone01


def _u8(g01):
    return np.rint(np.clip(g01, 0, 1) * 255).astype(int)


def test_tone_none_is_identity():
    g = np.linspace(0, 1, 256, dtype=np.float32).reshape(1, 256)
    out = apply_tone01(g, ToneParams(mode="none"), None)
    np.testing.assert_array_equal(_u8(out), _u8(g))


def test_tone_gamma_matches_pow_curve():
    g = np.linspace(0, 1, 256, dtype=np.float32).reshape(1, 256)
    out = apply_tone01(g, ToneParams(mode="gamma", gamma=0.5, clip_pct=0.0), None)
    # gamma with 0% clip → x**0.5 over the full range
    np.testing.assert_allclose(out, np.sqrt(g), atol=1.5 / 255)


def test_tone_linear_clips_percentiles():
    # 100 px: 0..99; 10% low + 10% high clip → bounds [10,89] scaled to [0,1]
    g = (np.arange(100, dtype=np.float32) / 99.0).reshape(1, 100)
    out = apply_tone01(g, ToneParams(mode="linear", clip_low_pct=10, clip_high_pct=10), None)
    assert out[0, 0] == 0.0 and out[0, 5] == 0.0      # below low bound → 0
    assert out[0, 99] == 1.0                          # above high bound → 1
    assert 0.0 < out[0, 50] < 1.0                     # midtone rescaled


def test_tone_equalize_flattens_cdf():
    rng = np.random.default_rng(1)
    g = (rng.integers(40, 120, size=(64, 64)).astype(np.float32) / 255.0)
    out = apply_tone01(g, ToneParams(mode="equalize"), None)
    # equalized output spreads toward the full range
    assert out.max() - out.min() > (g.max() - g.min())


def test_tone_removeEmptyLayers_offsets_floor():
    g = (np.array([[40, 60, 80]], dtype=np.float32) / 255.0)
    out = apply_tone01(g, ToneParams(mode="none", remove_empty_layers=True), None)
    np.testing.assert_array_equal(_u8(out), [[0, 20, 40]])  # floor 40 subtracted


def test_tone_histogram_uses_foreground_only():
    g = (np.array([[10, 200, 200, 200]], dtype=np.float32) / 255.0)
    fg = np.array([[False, True, True, True]])  # ignore the dark bg pixel
    out = apply_tone01(g, ToneParams(mode="linear", clip_low_pct=0, clip_high_pct=0), fg)
    # bounds derived from {200} only → fg pixels saturate, not stretched off the bg
    assert out[0, 1] >= out[0, 0]
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --active pytest tests/test_relief.py -k "tone" -q`
Expected: FAIL — `cannot import name 'ToneParams'`.

- [ ] **Step 3: Implement** — add to `src/xcs_gen_web/relief.py` (add `ToneParams`, `apply_tone01` to `__all__`). The 256-bin histogram + `percentileBounds` mirror `stretch.ts`:
```python
@dataclass(frozen=True)
class ToneParams:
    mode: str = "none"          # none|linear|gamma|asinh|equalize|clahe
    clip_low_pct: float = 0.1   # linear
    clip_high_pct: float = 0.1  # linear
    clip_pct: float = 0.1       # gamma/asinh symmetric clip
    gamma: float = 1.0
    asinh_strength: float = 0.5
    remove_empty_layers: bool = False


def _hist256(gray01: np.ndarray, fg_mask: np.ndarray | None) -> np.ndarray:
    """256-bin histogram of the (foreground) heightfield — matches stretch.ts."""
    vals = gray01 if fg_mask is None else gray01[fg_mask.astype(bool)]
    if vals.size == 0:
        return np.zeros(256, dtype=np.int64)
    idx = np.clip(np.rint(vals.ravel() * 255.0), 0, 255).astype(np.int64)
    return np.bincount(idx, minlength=256)


def _percentile_bounds(hist: np.ndarray, low_pct: float, high_pct: float) -> tuple[int, int]:
    total = int(hist.sum())
    if total == 0:
        return 0, 255
    lo_target = max(0.0, low_pct) / 100.0 * total
    hi_target = (1.0 - max(0.0, high_pct) / 100.0) * total
    cum = np.cumsum(hist)
    lo = int(np.searchsorted(cum, lo_target, side="right"))
    lo = min(255, lo)
    hi = int(np.argmax(cum >= hi_target)) if (cum >= hi_target).any() else 255
    if hi <= lo:
        hi = min(255, lo + 1)
    return lo, hi


def apply_tone01(
    gray01: np.ndarray, p: ToneParams, fg_mask: np.ndarray | None
) -> np.ndarray:
    """Apply a monotonic tone curve to a float32 [0,1] heightfield, matching
    web/src/components/relief/stretch.ts::buildLut. CLAHE is handled elsewhere;
    here it (like ``none``) is identity unless ``remove_empty_layers``."""
    g = np.clip(gray01.astype(np.float32), 0.0, 1.0)
    hist = _hist256(g, fg_mask)

    if p.mode in ("none", "clahe"):
        if p.remove_empty_layers and p.mode == "none":
            nz = np.nonzero(hist)[0]
            floor = int(nz[0]) / 255.0 if nz.size else 0.0
            return np.clip(g - floor, 0.0, 1.0)
        return g

    if p.mode == "equalize":
        total = int(hist.sum())
        if total == 0:
            return g
        cdf = np.cumsum(hist).astype(np.float64)
        nz = np.nonzero(hist)[0]
        cdf_min = cdf[nz[0]] if nz.size else 0.0
        denom = max(1.0, total - cdf_min)
        lut = np.clip(np.rint((cdf - cdf_min) / denom * 255.0), 0, 255) / 255.0
        idx = np.clip(np.rint(g * 255.0), 0, 255).astype(np.int64)
        return lut[idx].astype(np.float32)

    # linear / gamma / asinh — percentile trim then curve
    if p.mode == "linear":
        lo, hi = _percentile_bounds(hist, p.clip_low_pct, p.clip_high_pct)
    else:
        lo, hi = _percentile_bounds(hist, p.clip_pct, p.clip_pct)
    lo01, hi01 = lo / 255.0, hi / 255.0
    rng = max(1.0 / 255.0, hi01 - lo01)
    x = np.clip((g - lo01) / rng, 0.0, 1.0)
    if p.mode == "gamma":
        y = np.power(x, p.gamma)
    elif p.mode == "asinh":
        k = 1.0 + p.asinh_strength * 40.0
        y = np.arcsinh(k * x) / np.arcsinh(k)
    else:  # linear
        y = x
    return np.clip(y, 0.0, 1.0).astype(np.float32)
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --active pytest tests/test_relief.py -k "tone" -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**
```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): numpy tone curves matching the client LUT (parity-tested)"
```

---

## Task 4: Backend — depth-aware CLAHE + perimeter + falloff cores

Add float cores for the three remaining value-modifying ops so the whole chain stays float. Keep the existing uint8 functions as wrappers (preview unchanged).

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

**Interfaces:**
- Produces: `apply_clahe01(gray01, clip_limit, tiles, mask=None) -> float01`; `smooth_perimeter01(gray01, alpha, pct) -> (float01, alpha)`; `edge_falloff01(gray01, alpha, pct, mode, target01, intensity) -> (float01, alpha)`. `target01` is the falloff target in [0,1] (was 0..255).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_relief.py`:
```python
from xcs_gen_web.relief import apply_clahe01, smooth_perimeter01, edge_falloff01


def test_clahe01_stays_in_range_and_float():
    rng = np.random.default_rng(2)
    g = (rng.integers(60, 140, size=(64, 64)).astype(np.float32) / 255.0)
    out = apply_clahe01(g, clip_limit=2.0, tiles=8)
    assert out.dtype == np.float32 and out.min() >= 0.0 and out.max() <= 1.0


def test_edge_falloff01_inward_ramps_toward_target():
    # An object on a background — inward falloff needs a real silhouette boundary
    # (a full-frame foreground has none, so the distance transform finds no edge).
    g = np.zeros((60, 60), dtype=np.float32)
    g[10:50, 10:50] = 0.8
    alpha = np.where(g > 0, 255, 0).astype(np.uint8)
    out, _a = edge_falloff01(g, alpha, pct=20.0, mode="inward", target01=0.0, intensity=50.0)
    assert out.dtype == np.float32
    assert out[11, 11] < out[30, 30]             # edge eased toward 0 ...
    assert abs(float(out[30, 30]) - 0.8) < 1e-6   # ... centre untouched


def test_smooth_perimeter01_preserves_range():
    g = np.zeros((40, 40), dtype=np.float32)
    g[8:32, 8:32] = 0.7
    alpha = np.where(g > 0, 255, 0).astype(np.uint8)
    out, _a = smooth_perimeter01(g, alpha, pct=10.0)
    assert out.dtype == np.float32 and out.max() <= 1.0
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --active pytest tests/test_relief.py -k "clahe01 or falloff01 or perimeter01" -q`
Expected: FAIL — import errors.

- [ ] **Step 3: Implement** — add to `src/xcs_gen_web/relief.py` (add the three names to `__all__`). These are **float-native** rewrites (the existing uint8 functions are left untouched, so the preview is unaffected). They share the existing module-level `_smooth_mask`, `falloff_curve`, and `FLOOR_FADE`. The transformation from the uint8 originals: input/output are float32 [0,1]; every internal `.astype(np.uint8)` on a *gray* intermediate is dropped (kept float; cv2 dilate/blur accept float32); `target` is in [0,1]; `FLOOR_FADE` (a 0..255 level) is scaled by `/255`; the final `np.clip(np.rint(out), 0, 255).astype(np.uint8)` becomes `np.clip(out, 0, 1).astype(np.float32)` (no rint — that's what preserves >8-bit precision). Mask/alpha arrays stay uint8 (binary).
```python
def apply_clahe01(
    gray01: np.ndarray, clip_limit: float, tiles: int, mask: np.ndarray | None = None
) -> np.ndarray:
    """CLAHE on a float [0,1] heightfield. cv2 CLAHE needs an integer type, so
    run it at 16-bit and rescale — a 16-bit→16-bit lookup, no 8-bit truncation."""
    if gray01.ndim != 2:
        raise ValueError("apply_clahe01 expects a single-channel image")
    u16 = np.rint(np.clip(gray01, 0.0, 1.0) * 65535.0).astype(np.uint16)
    n = max(1, int(tiles))
    clahe = cv2.createCLAHE(clipLimit=max(0.1, float(clip_limit)), tileGridSize=(n, n))
    src = u16
    if mask is not None:
        if mask.shape != gray01.shape:
            raise ValueError("apply_clahe01: mask and gray must have the same shape")
        fg = mask > 0
        if fg.any() and not fg.all():
            src = u16.copy()
            src[~fg] = int(round(float(u16[fg].mean())))
    return np.ascontiguousarray(clahe.apply(src).astype(np.float32) / 65535.0)


def smooth_perimeter01(
    gray01: np.ndarray, alpha: np.ndarray, pct: float
) -> tuple[np.ndarray, np.ndarray]:
    """Float [0,1] form of ``smooth_perimeter`` — rounds the silhouette boundary
    and evens the rim height. Preserves full precision (no uint8 quantize)."""
    if gray01.ndim != 2 or alpha.ndim != 2:
        raise ValueError("smooth_perimeter01 expects single-channel gray + alpha")
    if gray01.shape != alpha.shape:
        raise ValueError("smooth_perimeter01: gray and alpha must share a shape")
    if pct <= 0:
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    radius = int(round(pct / 100.0 * short))
    if radius < 1:
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    blurred = cv2.GaussianBlur(fg.astype(np.float32) * 255.0, (0, 0), float(radius))
    clean = (blurred >= 127.5).astype(np.uint8)
    if not clean.any():
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    new_alpha = np.where(clean > 0, 255, 0).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    out = gray01.astype(np.float32)
    added = (clean > 0) & (fg == 0)
    if added.any():
        edge_fill = cv2.dilate(np.where(fg > 0, out, 0.0), k, iterations=1)
        out = np.where(added, edge_fill, out)
    new_fg = clean.astype(np.float32)
    band_mask = (clean > 0) & (cv2.erode(clean, k, iterations=1) == 0)
    if band_mask.any():
        ksm = max(3, radius | 1)
        num = cv2.GaussianBlur(out * new_fg, (ksm, ksm), 0)
        den = cv2.GaussianBlur(new_fg, (ksm, ksm), 0)
        out = np.where(band_mask, num / np.maximum(den, 1e-6), out)
    out = np.clip(out, 0.0, 1.0).astype(np.float32)
    return np.ascontiguousarray(out), np.ascontiguousarray(new_alpha)


def edge_falloff01(
    gray01: np.ndarray, alpha: np.ndarray, pct: float, mode: str = "inward",
    target01: float = 0.0, intensity: float = 50.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Float [0,1] form of ``edge_falloff`` (inward bevel / outward berm).
    ``target01`` is the eased-to level in [0,1]. Preserves full precision."""
    if gray01.ndim != 2 or alpha.ndim != 2:
        raise ValueError("edge_falloff01 expects single-channel gray + alpha")
    if gray01.shape != alpha.shape:
        raise ValueError("edge_falloff01: gray and alpha must share a shape")
    if pct <= 0:
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    band = pct / 100.0 * short
    if band < 1:
        return np.ascontiguousarray(gray01, dtype=np.float32), alpha
    tgt = max(0.0, min(1.0, float(target01)))
    g = gray01.astype(np.float32)
    radius = int(round(band))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    floor_fade01 = FLOOR_FADE / 255.0

    if str(mode) == "outward":
        contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        filled = np.zeros_like(fg)
        cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)
        dilated = cv2.dilate(filled, kernel, iterations=1)
        ring = (dilated > 0) & (filled == 0)
        eroded = cv2.erode(filled, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
        boundary_gray = np.where((filled > 0) & (eroded == 0), g, 0.0)
        base = cv2.dilate(boundary_gray, kernel, iterations=1)
        t_out = np.clip(
            cv2.distanceTransform(dilated, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) / band,
            0.0, 1.0,
        )
        u_out = falloff_curve(np.clip(t_out / 0.5, 0.0, 1.0), intensity)
        u_in = falloff_curve(np.clip((t_out - 0.5) / 0.5, 0.0, 1.0), intensity)
        ring_h = np.where(t_out <= 0.5, tgt * u_out, tgt * (1.0 - u_in) + base * u_in)
        out = np.where(ring, ring_h, g)
        ring_alpha = np.clip(ring_h / floor_fade01, 0.0, 1.0) * 255.0
        out_alpha = np.where(fg > 0, 255.0, np.where(ring, ring_alpha, 0.0))
        return (
            np.ascontiguousarray(np.clip(out, 0.0, 1.0).astype(np.float32)),
            np.ascontiguousarray(np.clip(np.rint(out_alpha), 0, 255).astype(np.uint8)),
        )

    clean = _smooth_mask(fg, radius)
    dist = cv2.distanceTransform(clean, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    c = falloff_curve(dist / band, intensity)
    blended = tgt + (g - tgt) * c
    out = np.where(fg > 0, blended, g)
    return np.ascontiguousarray(np.clip(out, 0.0, 1.0).astype(np.float32)), alpha
```

- [ ] **Step 4: Run to verify pass + no preview regression**

Run: `uv run --active pytest tests/test_relief.py -q`
Expected: PASS (new + existing; relax any single ±1 float-round-trip assertion as in Task 2 Step 4 if needed).

- [ ] **Step 5: Commit**
```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): depth-aware CLAHE/perimeter/falloff float cores"
```

---

## Task 5: Backend — `POST /api/relief/export`

Wire the full-precision render: decode original bytes at native depth → pad → smooth → background masks → CLAHE-or-tone → perimeter/trim/falloff → encode at the chosen bit depth.

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Test: `tests/test_relief_route.py`

**Interfaces:**
- Consumes: `decode_gray01`, `decode_image_bytes`, `smooth_heightfield01`, `apply_tone01`/`ToneParams`, `apply_clahe01`, `smooth_perimeter01`, `edge_falloff01`, `trim_alpha`, `threshold_background_mask`, `colour_background_mask`, `area_background_mask`, `combine_backgrounds`, `split_internal_holes`, `parse_subtractions`, `encode_depth_png`.
- Produces: `POST /api/relief/export` returning `image/png` (8- or 16-bit).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_relief_route.py` (follow the existing TestClient pattern in that file):
```python
import io
import numpy as np
from PIL import Image


def _png(arr, mode):
    buf = io.BytesIO(); Image.fromarray(arr, mode=mode).save(buf, format="PNG"); return buf.getvalue()


def test_export_16bit_returns_true_16bit(client):
    ramp = np.linspace(0, 255, 64 * 64).reshape(64, 64).astype(np.uint8)
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(ramp, "L"), "image/png")},
                    data={"bit_depth": "16", "smooth": "true", "tone_mode": "gamma", "gamma": "0.5"})
    assert r.status_code == 200
    im = Image.open(io.BytesIO(r.content))
    assert im.mode in ("I;16", "I")
    assert len(np.unique(np.asarray(im))) > 256


def test_export_8bit_returns_mode_L(client):
    ramp = np.linspace(0, 255, 64 * 64).reshape(64, 64).astype(np.uint8)
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(ramp, "L"), "image/png")},
                    data={"bit_depth": "8", "smooth": "true", "tone_mode": "none"})
    assert r.status_code == 200
    assert Image.open(io.BytesIO(r.content)).mode == "L"


def test_export_preserves_16bit_input(client):
    src = np.linspace(0, 65535, 64 * 64).reshape(64, 64).astype(np.uint16)
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(src, "I;16"), "image/png")},
                    data={"bit_depth": "16", "smooth": "false", "tone_mode": "none"})
    assert r.status_code == 200
    assert len(np.unique(np.asarray(Image.open(io.BytesIO(r.content))))) > 256


def test_export_16bit_with_bg_is_grayscale(client):
    img = np.full((64, 64), 200, dtype=np.uint8); img[:8, :] = 0  # dark band = bg
    r = client.post("/api/relief/export", files={"file": ("d.png", _png(img, "L"), "image/png")},
                    data={"bit_depth": "16", "smooth": "false", "tone_mode": "none",
                          "remove_bg": "true", "subtractions": '[{"method":"dark","threshold":8}]'})
    assert r.status_code == 200
    im = Image.open(io.BytesIO(r.content))
    assert im.mode in ("I;16", "I")           # grayscale, no alpha
    assert int(np.asarray(im)[0, 0]) == 0      # background flattened to floor
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --active pytest tests/test_relief_route.py -k export -q`
Expected: FAIL — 404 (route not defined).

- [ ] **Step 3: Implement** — add the route in `src/xcs_gen_web/app.py` right after `relief_smooth` (extend the `.relief` import block at line ~85 with `decode_gray01, smooth_heightfield01, apply_tone01, ToneParams, apply_clahe01, smooth_perimeter01, edge_falloff01, encode_depth_png, parse_rgb` — `parse_rgb` is used for `pad_color`):
```python
    @app.post("/api/relief/export")
    def relief_export(
        file: UploadFile = File(...),
        bit_depth: int = Form(16),
        # smoothing
        strength: int = Form(8),
        edge_preserve: bool = Form(True),
        edge_threshold: int = Form(40),
        spike_removal: bool = Form(True),
        median_ksize: int = Form(3),
        smooth: bool = Form(True),
        # tone
        tone_mode: str = Form("none"),
        clip_low_pct: float = Form(0.1),
        clip_high_pct: float = Form(0.1),
        clip_pct: float = Form(0.1),
        gamma: float = Form(1.0),
        asinh_strength: float = Form(0.5),
        remove_empty_layers: bool = Form(False),
        clahe_clip: float = Form(2.0),
        clahe_tiles: int = Form(8),
        # background
        remove_bg: bool = Form(False),
        subtractions: str = Form("[]"),
        shape_internal: bool = Form(False),
        perimeter_pct: float = Form(0.0),
        trim_pct: float = Form(0.0),
        falloff_pct: float = Form(0.0),
        falloff_mode: str = Form("inward"),
        falloff_target: float = Form(0.0),
        falloff_intensity: float = Form(50.0),
        # canvas
        expand_pct: float = Form(0.0),
        pad_color: str = Form("0,0,0"),
    ) -> Response:
        """Full-precision relief render → 8- or 16-bit PNG. Decodes the ORIGINAL
        bytes at native depth and runs the whole pipeline in float [0,1],
        quantizing only at encode. Mirrors /api/relief/smooth's ordering, but
        the monotonic tone curve (client LUT in preview) is applied here too."""
        raw = file.file.read()
        try:
            gray = decode_gray01(raw)            # float32 [0,1], native depth
            bgr = decode_image_bytes(raw)        # uint8 colour, for colour/area keys
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode image")
        if gray.size == 0 or min(gray.shape) < 2:
            raise HTTPException(status_code=422, detail="Image too small")

        # Pad (expand canvas) at full precision.
        exp = max(0.0, min(50.0, expand_pct))
        if exp > 0:
            rgb = parse_rgb(pad_color) or (0, 0, 0)
            padc01 = float(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255.0
            py = int(round(gray.shape[0] * exp / 100.0))
            px = int(round(gray.shape[1] * exp / 100.0))
            if px > 0 or py > 0:
                gray = cv2.copyMakeBorder(gray, py, py, px, px, cv2.BORDER_CONSTANT, value=padc01)
                bgr = cv2.copyMakeBorder(bgr, py, py, px, px, cv2.BORDER_CONSTANT,
                                         value=(int(rgb[2]), int(rgb[1]), int(rgb[0])))

        if smooth:
            gray = smooth_heightfield01(gray, ReliefSmoothParams(
                strength=max(1, min(100, strength)),
                edge_preserve=edge_preserve,
                edge_threshold=max(1, min(255, edge_threshold)),
                spike_removal=spike_removal,
                median_ksize=median_ksize,
            ))

        # Background masks → alpha (foreground = alpha>0). Dark/bright key the
        # gray (scaled back to 0..255 for the threshold), colour/area key bgr.
        alpha = None
        if remove_bg:
            gray_u8 = np.rint(gray * 255.0).astype(np.uint8)
            masks = []
            for sub in parse_subtractions(subtractions):
                if sub.method in ("dark", "bright"):
                    masks.append(threshold_background_mask(
                        gray_u8, sub.threshold, high=(sub.method == "bright")))
                elif sub.method == "colour" and sub.color is not None:
                    masks.append(colour_background_mask(bgr, sub.color, sub.tolerance))
                elif sub.method == "area" and sub.color is not None and sub.seed is not None:
                    masks.append(area_background_mask(bgr, sub.color, sub.tolerance, sub.seed))
            if masks:
                alpha = combine_backgrounds(masks)

        # Tone: CLAHE (spatial) OR a monotonic curve. Foreground-only histogram.
        fg = (alpha > 0) if alpha is not None else None
        if tone_mode == "clahe":
            gray = apply_clahe01(gray, max(0.1, min(40.0, clahe_clip)),
                                 max(1, min(32, clahe_tiles)), mask=alpha)
        else:
            gray = apply_tone01(gray, ToneParams(
                mode=tone_mode, clip_low_pct=clip_low_pct, clip_high_pct=clip_high_pct,
                clip_pct=clip_pct, gamma=gamma, asinh_strength=asinh_strength,
                remove_empty_layers=remove_empty_layers,
            ), fg)

        # Edge shaping (only when a background was removed) — mirrors /smooth.
        if alpha is not None:
            perimeter = max(0.0, min(25.0, perimeter_pct))
            trim = max(0.0, min(50.0, trim_pct))
            falloff = max(0.0, min(50.0, falloff_pct))
            if perimeter > 0 or trim > 0 or falloff > 0:
                if shape_internal:
                    work, holes = alpha, None
                else:
                    work, holes = split_internal_holes(alpha)
                if perimeter > 0:
                    gray, work = smooth_perimeter01(gray, work, perimeter)
                if trim > 0:
                    work = trim_alpha(work, trim)
                if falloff > 0:
                    tgt01 = max(0.0, min(100.0, falloff_target)) / 100.0
                    gray, work = edge_falloff01(
                        gray, work, falloff, falloff_mode, tgt01,
                        max(0.0, min(100.0, falloff_intensity)))
                if holes is not None:
                    work = work.copy(); work[holes] = 0
                alpha = work

        png = encode_depth_png(gray, alpha, 16 if int(bit_depth) >= 16 else 8)
        return Response(content=png, media_type="image/png",
                        headers={"Cache-Control": "no-store"})
```
(Ensure `import numpy as np` and `import cv2` are available in `app.py`; if not, import them at the top of the module alongside the existing imports.)

- [ ] **Step 4: Run to verify pass**

Run: `uv run --active pytest tests/test_relief_route.py -k export -q`
Expected: PASS (4 tests). Then full backend: `uv run --active pytest tests/ -q` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/xcs_gen_web/app.py tests/test_relief_route.py
git commit -m "feat(relief): /api/relief/export full-precision 8/16-bit render"
```

---

## Task 6: Frontend — toggle, original bytes, `reliefExport`, rewired export

**Files:**
- Create: `web/src/components/relief/BitDepthToggle.tsx`, `web/src/components/relief/BitDepthToggle.test.tsx`
- Modify: `web/src/pages/reliefHelpers.ts`, `web/src/pages/ReliefPage.tsx`
- Test: `web/src/pages/reliefHelpers.test.ts`

**Interfaces:**
- Produces: `reliefExport(originalBytes: Blob, args: ReliefExportArgs): Promise<Blob>`; `BitDepthToggle` component (`value: 8|16`, `onChange`).

- [ ] **Step 1: Write the failing test (helper)** — append to `web/src/pages/reliefHelpers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reliefExport } from "./reliefHelpers";
import { DEFAULT_RELIEF_PARAMS } from "./reliefHelpers";
import { DEFAULT_STRETCH_PARAMS } from "../components/relief/stretch";

describe("reliefExport", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
  });
  it("posts bit_depth, tone_mode and the original bytes to /api/relief/export", async () => {
    const orig = new Blob(["X"], { type: "image/png" });
    await reliefExport(orig, {
      params: DEFAULT_RELIEF_PARAMS,
      stretch: { ...DEFAULT_STRETCH_PARAMS, mode: "gamma", gamma: 0.6 },
      background: undefined,
      expandPct: 0,
      padColor: [0, 0, 0],
      bitDepth: 16,
    });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("/api/relief/export");
    const fd = init.body as FormData;
    expect(fd.get("bit_depth")).toBe("16");
    expect(fd.get("tone_mode")).toBe("gamma");
    expect(fd.get("gamma")).toBe("0.6");
    expect(fd.get("file")).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts -t reliefExport`
Expected: FAIL — `reliefExport` is not exported.

- [ ] **Step 3: Implement the helper** — add to `web/src/pages/reliefHelpers.ts` (reuse the `opts.background` serialization shape already used by `reliefSmooth`):
```ts
import type { StretchParams } from "../components/relief/stretch";

/** Background-removal opts — the exact shape `ReliefPage.bgOpts()` returns. */
export interface ReliefBackgroundOpts {
  subtractions: Subtraction[];
  perimeterPct: number;
  trimPct: number;
  falloffPct: number;
  falloffMode: "inward" | "outward";
  falloffTarget: number;
  falloffIntensity: number;
  shapeInternal: boolean;
}

export interface ReliefExportArgs {
  params: ReliefParams;
  stretch: StretchParams;
  background?: ReliefBackgroundOpts;
  expandPct: number;
  padColor: [number, number, number];
  bitDepth: 8 | 16;
}

/** POST the ORIGINAL source bytes + the full param set to the full-precision
 *  backend render and resolve the 8/16-bit PNG blob. Unlike reliefSmooth this
 *  carries the tone mode (applied on the backend, not as a client LUT) and the
 *  bit depth, and sends the unmodified source so 16-bit input is preserved. */
export async function reliefExport(originalBytes: Blob, a: ReliefExportArgs): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", originalBytes, "source.png");
  fd.append("bit_depth", String(a.bitDepth));
  const p = a.params;
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  fd.append("smooth", String(p.smoothEnabled));
  const s = a.stretch;
  fd.append("tone_mode", s.mode);
  fd.append("clip_low_pct", String(s.clipLowPct));
  fd.append("clip_high_pct", String(s.clipHighPct));
  fd.append("clip_pct", String(s.clipPct));
  fd.append("gamma", String(s.gamma));
  fd.append("asinh_strength", String(s.asinhStrength));
  fd.append("remove_empty_layers", String(s.removeEmptyLayers));
  fd.append("clahe_clip", String(s.claheClipLimit));
  fd.append("clahe_tiles", String(s.claheTiles));
  fd.append("expand_pct", String(a.expandPct));
  fd.append("pad_color", `${a.padColor[0]},${a.padColor[1]},${a.padColor[2]}`);
  if (a.background) {
    const b = a.background;
    fd.append("remove_bg", "true");
    fd.append("subtractions", JSON.stringify(b.subtractions.map((x) => ({
      method: x.method, threshold: x.threshold, color: x.color,
      tolerance: x.tolerance, seedX: x.seedX, seedY: x.seedY,
    }))));
    fd.append("shape_internal", String(b.shapeInternal));
    fd.append("perimeter_pct", String(b.perimeterPct));
    fd.append("trim_pct", String(b.trimPct));
    fd.append("falloff_pct", String(b.falloffPct));
    fd.append("falloff_mode", b.falloffMode);
    fd.append("falloff_target", String(b.falloffTarget));
    fd.append("falloff_intensity", String(b.falloffIntensity));
  }
  const res = await fetch("/api/relief/export", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief export failed: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts -t reliefExport`
Expected: PASS.

- [ ] **Step 5: Write the failing toggle test** — create `web/src/components/relief/BitDepthToggle.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BitDepthToggle } from "./BitDepthToggle";

describe("BitDepthToggle", () => {
  it("highlights the active depth and emits the other on click", () => {
    const onChange = vi.fn();
    render(<BitDepthToggle value={16} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /16-bit/i })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /8-bit/i }));
    expect(onChange).toHaveBeenCalledWith(8);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd web && npx vitest run src/components/relief/BitDepthToggle.test.tsx`
Expected: FAIL — cannot find `./BitDepthToggle`.

- [ ] **Step 7: Implement the toggle** — create `web/src/components/relief/BitDepthToggle.tsx`:
```tsx
/** Segmented 8|16-bit selector for the relief export. Affects export only —
 *  16-bit gives smoother depth gradation (~2× file size); 8-bit is maximally
 *  compatible. */
export function BitDepthToggle({
  value,
  onChange,
}: {
  value: 8 | 16;
  onChange: (v: 8 | 16) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Export bit depth"
      title="16-bit = smoother depth gradation, ~2× file size; 8-bit = maximum compatibility"
      className="inline-flex items-center rounded-[6px] border border-[color:var(--color-border-strong)] overflow-hidden font-mono text-[11px]"
    >
      <span className="px-2 py-1 text-[color:var(--color-ink-subtle)] uppercase tracking-[0.08em]">
        Bit depth
      </span>
      {([8, 16] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          aria-label={`${d}-bit`}
          onClick={() => onChange(d)}
          className={[
            "px-2.5 py-1 transition-colors",
            value === d
              ? "bg-[color:var(--color-primary)] text-white"
              : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
          ].join(" ")}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run to verify pass**

Run: `cd web && npx vitest run src/components/relief/BitDepthToggle.test.tsx`
Expected: PASS.

- [ ] **Step 9: Wire into `ReliefPage.tsx`** (no new test — covered by the helper/toggle unit tests + the browser pass in Task 7):
  - Import: `import { BitDepthToggle } from "../components/relief/BitDepthToggle";` and `reliefExport` from `./reliefHelpers`.
  - State + persistence (near the other `useState` at line ~72):
    ```ts
    const [bitDepth, setBitDepth] = useState<8 | 16>(
      () => (localStorage.getItem("relief.bitDepth") === "8" ? 8 : 16),
    );
    useEffect(() => {
      localStorage.setItem("relief.bitDepth", String(bitDepth));
    }, [bitDepth]);
    ```
  - Keep the original bytes: add `const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);` and in `ingestImageBlob(blob)` (line ~272) add `setOriginalBlob(blob);` (the `blob` is the original File or the `.xs`-extracted PNG — full precision, never the padded 8-bit canvas).
  - Toolbar: render `<BitDepthToggle value={bitDepth} onChange={setBitDepth} />` in the `Toolbar` `trailing` group (line ~642), before the "Re-render" button.
  - Replace the body of `onExport` (lines ~512–578) to use the backend render:
    ```ts
    const onExport = useCallback(async () => {
      if (!originalBlob) return;
      setExporting(true);
      setErrorMsg(null);
      try {
        const finalBlob = await reliefExport(originalBlob, {
          params,
          stretch: stretchParams,
          background: bgOpts(),
          expandPct: stretchParams.expandPct,
          padColor,
          bitDepth,
        });
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = bitDepth === 16 ? "relief-16bit.png" : "relief.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setStatus("error");
        setErrorMsg(`Export failed: ${(err as Error).message}`);
      } finally {
        setExporting(false);
      }
    }, [originalBlob, params, stretchParams, bgOpts, padColor, bitDepth]);
    ```
    (`padColor` is the existing memo at line ~124. The old canvas re-encode + `reliefSmooth` + client `applyLut` export code is removed; `applyLut`/`buildLut` stay imported for the live preview effect.)

- [ ] **Step 10: Gate + build**

Run: `cd web && npx tsc --noEmit && npm test -- --run`
Expected: tsc clean; all suites pass (incl. the new helper + toggle tests).
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 11: Commit**
```bash
cd /Users/jonzky/Documents/XTools/Reverse
git add web/src/pages/reliefHelpers.ts web/src/pages/reliefHelpers.test.ts \
        web/src/components/relief/BitDepthToggle.tsx web/src/components/relief/BitDepthToggle.test.tsx \
        web/src/pages/ReliefPage.tsx
git commit -m "feat(relief): 8/16-bit export toggle + backend-rendered download"
```

---

## Task 7: Changelog + browser verification

**Files:**
- Create: `changelog/2026-06-21-relief-16bit.md`

- [ ] **Step 1: Write the changelog** — create `changelog/2026-06-21-relief-16bit.md`:
```markdown
---
id: 2026-06-21-relief-16bit
date: 2026-06-21
level: minor
title: Relief — 8/16-bit depth maps
summary: Export relief depth maps as true 16-bit PNGs (toggle at the top of the page) for smooth, terrace-free engraved gradients — or stick with 8-bit for maximum compatibility. The full render now runs at float precision on the backend so 16-bit sources stay 16-bit end to end.
---
```

- [ ] **Step 2: Full suites**

Run: `uv run --active pytest tests/ -q` → all pass.
Run: `cd web && npx tsc --noEmit && npm test -- --run` → tsc clean, all pass.
Run: `cd web && npm run build > /dev/null 2>&1 && echo BUILD_OK` → `BUILD_OK`.

- [ ] **Step 3: Browser golden path**

Start the server (`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`), open `http://127.0.0.1:8017/#/relief`. Upload a depth map, then:
- Confirm the **BIT DEPTH 8|16** toggle sits at the top (toolbar) and defaults to 16; reload the page and confirm it persists.
- Export at 16-bit → the file downloads as `relief-16bit.png`. Verify it is genuinely 16-bit: `python3 -c "from PIL import Image; im=Image.open('relief-16bit.png'); print(im.mode)"` → `I;16` (or `I`), and a smooth slope has no visible terracing.
- Switch to 8-bit → `relief.png`, mode `L`; matches the on-screen preview.
- Exercise a tone mode (e.g. gamma) and background removal at both depths; confirm 16-bit + background yields a grayscale PNG with the background at the floor. Screenshot and review the result critically.

- [ ] **Step 4: Commit**
```bash
git add changelog/2026-06-21-relief-16bit.md
git commit -m "docs(relief): changelog for 8/16-bit depth maps"
```

---

## Execution notes

- Branch `feat/relief-16bit` (off `main`, spec already committed). Push + draft PR when done; ready when CI is green.
- The preview path (`/api/relief/smooth` + client tone LUT) is intentionally untouched; only the float-core refactor (Tasks 2 & 4) may shift its output by ≤1 level — relax exactly those assertions, don't rewrite the tests.
- `pad_color` / `expand_pct` move padding server-side for export so 16-bit input isn't flattened by the client canvas.
- 16-bit + transparency is out of scope (grayscale, background→floor) per the spec.
