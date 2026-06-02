# Relief Trim + Background + Smoothing-Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three Relief-page preprocessing additions — make smoothing optional, a "remove initial empty layers" range trim, and a "background → transparency" cut-out.

**Architecture:** Smoothing-toggle and background-removal are backend (they gate/shape the `/api/relief/smooth` result; background bakes an `LA` alpha PNG). "Remove empty layers" is a pure client-side LUT offset. Downstream of the alpha mask, the client histogram excludes transparent pixels and `applyLut`/export carry alpha through automatically.

**Tech Stack:** Python + FastAPI + numpy + OpenCV + Pillow + pytest (backend); TypeScript + React + Vite + vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-02-relief-trim-background-design.md`

---

## File Structure

**Modified — backend**
- `src/xcs_gen_web/relief.py` — add `background_alpha()`, `encode_png_la()`.
- `src/xcs_gen_web/app.py` — `smooth` / `remove_bg` / `bg_threshold` / `bg_high` form params.
- `tests/test_relief.py`, `tests/test_relief_route.py`.

**Modified — frontend**
- `web/src/components/relief/stretch.ts` — `removeEmptyLayers` + bg fields on `StretchParams`; `buildLut` floor offset; `histogram` alpha exclusion.
- `web/src/pages/reliefHelpers.ts` — `smoothEnabled` on `ReliefParams`; `reliefSmooth` opts object.
- `web/src/components/relief/ReliefControls.tsx` — smoothing enable toggle.
- `web/src/components/relief/StretchControls.tsx` — "Trim" section.
- `web/src/pages/ReliefPage.tsx` — wiring + checkerboard preview backdrop.
- `web/src/components/relief/ReliefCompare2D.tsx` — clear transparent (so alpha shows).
- changelog.

---

## Task 1: Backend — `background_alpha` + `encode_png_la`

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_relief.py`:

```python
def test_background_alpha_masks_dark():
    from xcs_gen_web.relief import background_alpha

    gray = np.full((10, 10), 100, dtype=np.uint8)
    gray[0, 0] = 0
    gray[1, 1] = 5
    alpha = background_alpha(gray, threshold=8, high=False)
    assert alpha.dtype == np.uint8 and alpha.shape == gray.shape
    assert alpha[0, 0] == 0 and alpha[1, 1] == 0  # dark → transparent
    assert alpha[5, 5] == 255                     # relief → opaque


def test_background_alpha_high_masks_bright():
    from xcs_gen_web.relief import background_alpha

    gray = np.full((10, 10), 100, dtype=np.uint8)
    gray[0, 0] = 255
    alpha = background_alpha(gray, threshold=250, high=True)
    assert alpha[0, 0] == 0 and alpha[5, 5] == 255


def test_encode_png_la_round_trips_alpha():
    from io import BytesIO as _B

    from PIL import Image as _I

    from xcs_gen_web.relief import encode_png_la

    gray = np.full((4, 4), 120, dtype=np.uint8)
    alpha = np.full((4, 4), 255, dtype=np.uint8)
    alpha[0, 0] = 0
    img = _I.open(_B(encode_png_la(gray, alpha)))
    assert img.mode == "LA"
    px = np.array(img)
    assert px[0, 0, 1] == 0 and px[1, 1, 1] == 255
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --active pytest tests/test_relief.py::test_background_alpha_masks_dark -q`
Expected: FAIL — `ImportError: cannot import name 'background_alpha'`.

- [ ] **Step 3: Implement**

In `src/xcs_gen_web/relief.py`, extend `__all__` with `"background_alpha"` and `"encode_png_la"`, and add these functions after `apply_clahe`:

```python
def background_alpha(gray: np.ndarray, threshold: int, high: bool = False) -> np.ndarray:
    """Alpha mask (uint8 0/255) marking background pixels transparent.

    ``high=False``: background is the dark end (``gray <= threshold``) — the
    common case (surrounding black background). ``high=True``: the bright end
    (``gray >= threshold``) for inverted maps."""
    if gray.ndim != 2:
        raise ValueError("background_alpha expects a single-channel image")
    t = max(0, min(255, int(threshold)))
    mask = gray >= t if high else gray <= t
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(alpha)


def encode_png_la(gray: np.ndarray, alpha: np.ndarray) -> bytes:
    """Encode grayscale + alpha as an ``LA`` PNG (transparent background)."""
    l = Image.fromarray(np.ascontiguousarray(gray, dtype=np.uint8), mode="L")
    a = Image.fromarray(np.ascontiguousarray(alpha, dtype=np.uint8), mode="L")
    buf = BytesIO()
    Image.merge("LA", [l, a]).save(buf, format="PNG")
    return buf.getvalue()
```

`__all__` becomes:

```python
__all__ = [
    "ReliefSmoothParams",
    "smooth_heightfield",
    "apply_clahe",
    "background_alpha",
    "encode_png_la",
    "to_grayscale_u8",
    "encode_png",
]
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --active pytest tests/test_relief.py -q`
Expected: PASS (all relief unit tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): background_alpha + encode_png_la (LA transparency)"
```

---

## Task 2: Backend — endpoint `smooth` / `remove_bg` params

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Test: `tests/test_relief_route.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_relief_route.py`:

```python
def test_relief_smooth_can_disable_smoothing():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(32, 32, 120), "image/png")},
        data={"smooth": "false"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.size == (32, 32)


def test_relief_smooth_remove_bg_returns_alpha():
    client = TestClient(create_app())
    # Image with a black (0) border and a gray (120) interior.
    img = Image.new("L", (32, 32), 0)
    for y in range(8, 24):
        for x in range(8, 24):
            img.putpixel((x, y), 120)
    buf = BytesIO()
    img.save(buf, format="PNG")
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", buf.getvalue(), "image/png")},
        data={"smooth": "false", "remove_bg": "true", "bg_threshold": "8"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode in ("LA", "RGBA")  # has an alpha channel
    px = out.convert("LA")
    assert px.getpixel((0, 0))[1] == 0      # black border → transparent
    assert px.getpixel((16, 16))[1] == 255  # interior → opaque


def test_relief_smooth_clamps_bg_threshold():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(32, 32, 120), "image/png")},
        data={"remove_bg": "true", "bg_threshold": "9999"},
    )
    assert resp.status_code == 200
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --active pytest tests/test_relief_route.py::test_relief_smooth_remove_bg_returns_alpha -q`
Expected: FAIL — response is mode `L` (no alpha), `assert out.mode in ("LA","RGBA")` fails.

- [ ] **Step 3: Implement**

In `src/xcs_gen_web/app.py`, add the imports `background_alpha` and `encode_png_la` to the `from .relief import (...)` block (alphabetical: after `apply_clahe`):

```python
from .relief import (
    ReliefSmoothParams,
    apply_clahe,
    background_alpha,
    encode_png,
    encode_png_la,
    smooth_heightfield,
    to_grayscale_u8,
)
```

Replace the `relief_smooth` handler signature + body (the `clahe`-aware version from the tone-stretch work) with:

```python
    @app.post("/api/relief/smooth")
    def relief_smooth(
        file: UploadFile = File(...),
        strength: int = Form(8),
        edge_preserve: bool = Form(True),
        edge_threshold: int = Form(40),
        spike_removal: bool = Form(True),
        median_ksize: int = Form(3),
        smooth: bool = Form(True),
        clahe: bool = Form(False),
        clahe_clip: float = Form(2.0),
        clahe_tiles: int = Form(8),
        remove_bg: bool = Form(False),
        bg_threshold: int = Form(8),
        bg_high: bool = Form(False),
    ) -> Response:
        """Smooth a grayscale depth map and return the cleaned PNG. Stateless.

        ``smooth=false`` skips the smoothing pass (raw heightfield). Optional
        CLAHE runs after the smooth; optional background removal masks near-black
        (or near-white) pixels to transparency and returns an ``LA`` PNG. The
        monotonic tone modes are applied client-side as a LUT."""
        raw = file.file.read()
        try:
            bgr = decode_image_bytes(raw)
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode image")
        gray = to_grayscale_u8(bgr)
        if gray.size == 0 or min(gray.shape) < 2:
            raise HTTPException(status_code=422, detail="Image too small to smooth")
        out = gray
        if smooth:
            params = ReliefSmoothParams(
                strength=max(1, min(100, strength)),
                edge_preserve=edge_preserve,
                edge_threshold=max(1, min(255, edge_threshold)),
                spike_removal=spike_removal,
                median_ksize=median_ksize,
            )
            out = smooth_heightfield(gray, params)
        if clahe:
            out = apply_clahe(
                out,
                clip_limit=max(0.1, min(40.0, clahe_clip)),
                tiles=max(1, min(32, clahe_tiles)),
            )
        if remove_bg:
            alpha = background_alpha(
                out, threshold=max(0, min(255, bg_threshold)), high=bg_high
            )
            png = encode_png_la(out, alpha)
        else:
            png = encode_png(out)
        return Response(content=png, media_type="image/png",
                        headers={"Cache-Control": "no-store"})
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --active pytest tests/test_relief_route.py -q`
Expected: PASS (existing + the three new tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_relief_route.py
git commit -m "feat(relief): endpoint smooth toggle + background removal (LA)"
```

---

## Task 3: `stretch.ts` — remove-empty-layers + alpha-aware histogram

**Files:**
- Modify: `web/src/components/relief/stretch.ts`
- Test: `web/src/components/relief/stretch.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/components/relief/stretch.test.ts` (inside the existing file; `makeGray`, `bunchedHist`, `params`, the ImageData shim already exist):

```ts
describe("removeEmptyLayers", () => {
  it("offsets the floor to 0 in None mode", () => {
    const lut = buildLut(
      params({ mode: "none", removeEmptyLayers: true }),
      bunchedHist(60, 180),
    );
    expect(lut[60]).toBe(0);
    expect(lut[100]).toBe(40);
    expect(lut[180]).toBe(120);
  });

  it("is identity in None mode when off", () => {
    const lut = buildLut(
      params({ mode: "none", removeEmptyLayers: false }),
      bunchedHist(60, 180),
    );
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it("is a no-op under Linear (mode already zeros the floor)", () => {
    const hist = bunchedHist(60, 180);
    const off = buildLut(params({ mode: "linear", removeEmptyLayers: false }), hist);
    const on = buildLut(params({ mode: "linear", removeEmptyLayers: true }), hist);
    for (let v = 0; v < 256; v++) expect(on[v]).toBe(off[v]);
  });
});

describe("histogram alpha exclusion", () => {
  it("skips transparent pixels", () => {
    // 4 pixels: two opaque value 100, two transparent value 0.
    const data = new Uint8ClampedArray(4 * 4);
    data.set([100, 100, 100, 255], 0);
    data.set([100, 100, 100, 255], 4);
    data.set([0, 0, 0, 0], 8);
    data.set([0, 0, 0, 0], 12);
    const img = new ImageData(data, 4, 1);
    const h = histogram(img);
    expect(h[100]).toBe(2);
    expect(h[0]).toBe(0); // transparent pixels not counted
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/components/relief/stretch.test.ts`
Expected: FAIL — `removeEmptyLayers` not on params / histogram counts transparent pixels.

- [ ] **Step 3: Implement**

In `web/src/components/relief/stretch.ts`:

(a) Extend `StretchParams` (add the four fields) and `DEFAULT_STRETCH_PARAMS`:

```ts
export interface StretchParams {
  mode: StretchMode;
  clipLowPct: number;
  clipHighPct: number;
  clipPct: number;
  gamma: number;
  asinhStrength: number;
  claheClipLimit: number;
  claheTiles: number;
  /** Offset the lowest populated value to 0 (drop unused bottom of the range). */
  removeEmptyLayers: boolean;
  /** Mask near-black (or near-white) pixels to transparency — backend. */
  removeBackground: boolean;
  bgThreshold: number;
  bgHigh: boolean;
}

export const DEFAULT_STRETCH_PARAMS: StretchParams = {
  mode: "none",
  clipLowPct: 0.1,
  clipHighPct: 0.1,
  clipPct: 0.1,
  gamma: 1.0,
  asinhStrength: 0.5,
  claheClipLimit: 2,
  claheTiles: 8,
  removeEmptyLayers: false,
  removeBackground: false,
  bgThreshold: 8,
  bgHigh: false,
};
```

(b) `histogram()` — skip transparent pixels:

```ts
export function histogram(src: ImageData): Uint32Array {
  const bins = new Uint32Array(256);
  const px = src.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue; // skip transparent (background) pixels
    const l = luma(px[i], px[i + 1], px[i + 2]);
    bins[Math.min(255, Math.max(0, Math.round(l)))]++;
  }
  return bins;
}
```

(c) `buildLut()` — the `none`/`clahe` branch gains the floor offset for None:

```ts
  // None and CLAHE (backend) are identity here — except None gains an optional
  // floor offset ("remove initial empty layers").
  if (p.mode === "none" || p.mode === "clahe") {
    if (p.removeEmptyLayers && p.mode === "none") {
      let floor = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > 0) {
          floor = i;
          break;
        }
      }
      for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, v - floor));
    } else {
      for (let v = 0; v < 256; v++) lut[v] = v;
    }
    return lut;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/components/relief/stretch.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

> Note: adding required fields to `DEFAULT_STRETCH_PARAMS` keeps all existing
> spreads valid; `tsc` will flag any object literal that builds a `StretchParams`
> without the new fields — there are none outside the default.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/relief/stretch.ts web/src/components/relief/stretch.test.ts
git commit -m "feat(relief): removeEmptyLayers offset + alpha-aware histogram"
```

---

## Task 4: `reliefHelpers.ts` — `smoothEnabled` + `reliefSmooth` opts

**Files:**
- Modify: `web/src/pages/reliefHelpers.ts`
- Test: `web/src/pages/reliefHelpers.test.ts`

- [ ] **Step 1: Update the existing clahe test + add new tests**

In `web/src/pages/reliefHelpers.test.ts`, the existing "appends clahe fields" test calls `reliefSmooth(blob, params, { clipLimit, tiles })`. Change that call to the new opts shape and add `smooth` + background assertions. Replace the whole `describe("reliefSmooth clahe form fields", ...)` block with:

```ts
describe("reliefSmooth form fields", () => {
  function stub() {
    const sent: FormData[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: { body: FormData }) => {
        sent.push(init.body);
        return Promise.resolve({ ok: true, blob: async () => new Blob() });
      });
    vi.stubGlobal("fetch", fetchMock);
    return sent;
  }

  it("always sends the smooth flag from params", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS, smoothEnabled: false });
    expect(sent[0].get("smooth")).toBe("false");
    vi.unstubAllGlobals();
  });

  it("omits clahe / bg fields when no opts given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS });
    expect(sent[0].get("clahe")).toBeNull();
    expect(sent[0].get("remove_bg")).toBeNull();
    expect(sent[0].get("smooth")).toBe("true");
    vi.unstubAllGlobals();
  });

  it("appends clahe fields when opts.clahe given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS }, {
      clahe: { clipLimit: 3, tiles: 8 },
    });
    expect(sent[0].get("clahe")).toBe("true");
    expect(sent[0].get("clahe_clip")).toBe("3");
    expect(sent[0].get("clahe_tiles")).toBe("8");
    vi.unstubAllGlobals();
  });

  it("appends background fields when opts.background given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS }, {
      background: { threshold: 8, high: false },
    });
    expect(sent[0].get("remove_bg")).toBe("true");
    expect(sent[0].get("bg_threshold")).toBe("8");
    expect(sent[0].get("bg_high")).toBe("false");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts`
Expected: FAIL — `smoothEnabled` not on `DEFAULT_RELIEF_PARAMS`; `reliefSmooth` doesn't accept the opts object / send `smooth`.

- [ ] **Step 3: Implement**

In `web/src/pages/reliefHelpers.ts`:

(a) Add `smoothEnabled` to the interface + default:

```ts
export interface ReliefParams {
  strength: number;
  edgePreserve: boolean;
  edgeThreshold: number;
  spikeRemoval: boolean;
  medianKsize: number;
  /** Master switch for the smoothing pass — off = use the raw heightfield. */
  smoothEnabled: boolean;
  /** Informational / preview-only in Phase 1 — does NOT affect the smooth. */
  targetLayers: number;
  /** Pass-through for a future export — does NOT affect the smooth. */
  zDescentPerLayers: number;
}

export const DEFAULT_RELIEF_PARAMS: ReliefParams = {
  strength: 8,
  edgePreserve: true,
  edgeThreshold: 40,
  spikeRemoval: true,
  medianKsize: 3,
  smoothEnabled: true,
  targetLayers: 256,
  zDescentPerLayers: 0,
};
```

(b) Replace `reliefSmooth` with the opts-object form:

```ts
/** POST a depth-map blob + params (multipart) and resolve the cleaned PNG blob.
 *  ``opts.clahe`` requests backend tile-adaptive local-contrast stretch;
 *  ``opts.background`` requests near-black/white → transparency (LA PNG). The
 *  monotonic tone modes are applied client-side as a LUT, not here. */
export async function reliefSmooth(
  blob: Blob,
  p: ReliefParams,
  opts?: {
    clahe?: { clipLimit: number; tiles: number };
    background?: { threshold: number; high: boolean };
  },
): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", blob, "depth.png");
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  fd.append("smooth", String(p.smoothEnabled));
  if (opts?.clahe) {
    fd.append("clahe", "true");
    fd.append("clahe_clip", String(opts.clahe.clipLimit));
    fd.append("clahe_tiles", String(opts.clahe.tiles));
  }
  if (opts?.background) {
    fd.append("remove_bg", "true");
    fd.append("bg_threshold", String(opts.background.threshold));
    fd.append("bg_high", String(opts.background.high));
  }
  const res = await fetch("/api/relief/smooth", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief smooth failed: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts && npx tsc --noEmit`
Expected: PASS. (`tsc` will now flag the two `reliefSmooth(... claheArg)` call sites in `ReliefPage.tsx` — those are fixed in Task 6; if running tsc in isolation here errors only on ReliefPage, that's expected and resolved in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/reliefHelpers.ts web/src/pages/reliefHelpers.test.ts
git commit -m "feat(relief): ReliefParams.smoothEnabled + reliefSmooth opts object"
```

---

## Task 5: Controls — smoothing toggle + Trim section (use frontend-design)

**Files:**
- Modify: `web/src/components/relief/ReliefControls.tsx`
- Modify: `web/src/components/relief/StretchControls.tsx`
- Test: `web/src/components/relief/StretchControls.test.tsx`

New visual controls → **invoke the `frontend-design` skill** for both edits, matching the existing patterns in those files (`Section`/`Field`/local `Slider`/`Toggle`/`SegmentedChoice`).

- [ ] **Step 1: ReliefControls smoothing toggle (frontend-design)**

Brief: In `web/src/components/relief/ReliefControls.tsx`, add an **"Enable smoothing"** `Toggle` (the file already has a local `Toggle`) at the very top of the existing **Smoothing** `Section`, bound to `params.smoothEnabled` via the existing `set("smoothEnabled", v)`. When `smoothEnabled` is false, **hide** the Strength slider and the entire Edges and Speckle `Section`s (conditional render), and show a one-line muted hint in the Smoothing section: "Smoothing off — driving the raw heightfield." Leave the Layers section as-is. Keep the file's comment/JSDoc density and Workshop-Instrument styling.

- [ ] **Step 2: StretchControls Trim section (frontend-design)**

Brief: In `web/src/components/relief/StretchControls.tsx`, add a **second `Section` titled "Trim"** below the existing "Stretch" section (same `Card`). It contains:
- a **"Remove empty layers"** `Toggle` bound to `params.removeEmptyLayers` (hint: "Drop the unused bottom of the range — offsets the lowest value to 0. Most useful with Mode = None.").
- a **"Remove background"** `Toggle` bound to `params.removeBackground` (hint: "Make the surrounding background transparent — it won't be engraved.").
- when `removeBackground` is on: a **`Slider`** "Threshold" bound to `params.bgThreshold` (min 0, max 64, step 1, hint: "Pixels at or below this value become transparent.") and a **`Toggle`** "Background is the bright end" bound to `params.bgHigh` (hint: "On = treat near-white as background instead of near-black.").

Add `Toggle` to `StretchControls` (mirror the one in `ReliefControls`). Patch via the existing `set` helper. Must `tsc --noEmit` clean.

- [ ] **Step 3: Extend the StretchControls render test**

Append to `web/src/components/relief/StretchControls.test.tsx`:

```ts
  it("renders the Trim section toggles", () => {
    render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={() => {}} />,
    );
    expect(screen.getByText("Trim")).toBeInTheDocument();
    expect(screen.getByText(/remove empty layers/i)).toBeInTheDocument();
    expect(screen.getByText(/remove background/i)).toBeInTheDocument();
  });

  it("shows the threshold slider only when remove background is on", () => {
    const { rerender } = render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={() => {}} />,
    );
    expect(screen.queryByLabelText(/threshold/i)).not.toBeInTheDocument();
    rerender(
      <StretchControls
        params={{ ...DEFAULT_STRETCH_PARAMS, removeBackground: true }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/threshold/i)).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `cd web && npx vitest run src/components/relief/StretchControls.test.tsx && npx tsc --noEmit`
Expected: PASS (ReliefPage tsc errors from Task 4 still pending until Task 6 — run the component test specifically here).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/relief/ReliefControls.tsx web/src/components/relief/StretchControls.tsx web/src/components/relief/StretchControls.test.tsx
git commit -m "feat(relief): smoothing enable toggle + Trim controls"
```

---

## Task 6: `ReliefPage` wiring + checkerboard preview

**Files:**
- Modify: `web/src/pages/ReliefPage.tsx`
- Modify: `web/src/components/relief/ReliefCompare2D.tsx`

- [ ] **Step 1: Build the backend opts in the preview smooth effect**

In `ReliefPage.tsx`, in the debounced smooth effect, replace the `claheArg` block + `reliefSmooth(...)` call with an `opts` object that also carries background:

```ts
          const opts = {
            clahe:
              stretchParams.mode === "clahe"
                ? {
                    clipLimit: stretchParams.claheClipLimit,
                    tiles: stretchParams.claheTiles,
                  }
                : undefined,
            background: stretchParams.removeBackground
              ? {
                  threshold: stretchParams.bgThreshold,
                  high: stretchParams.bgHigh,
                }
              : undefined,
          };
          const smoothed = await reliefSmooth(
            blob,
            scaleParamsForPreview(params, ratio),
            opts,
          );
```

- [ ] **Step 2: Extend the smooth-effect deps**

Add `params.smoothEnabled` and the background fields to that effect's dependency array (they all change the backend result). The array becomes:

```ts
  }, [
    bitmap,
    params.strength,
    params.edgePreserve,
    params.edgeThreshold,
    params.spikeRemoval,
    params.medianKsize,
    params.smoothEnabled,
    stretchParams.mode === "clahe",
    stretchParams.claheClipLimit,
    stretchParams.claheTiles,
    stretchParams.removeBackground,
    stretchParams.bgThreshold,
    stretchParams.bgHigh,
    renderTick,
  ]);
```

- [ ] **Step 3: Add `removeEmptyLayers` to the client stretch-effect deps**

In the client tone-stretch effect's dependency array, add `stretchParams.removeEmptyLayers` so toggling it recomputes the LUT:

```ts
  }, [
    smoothedData,
    stretchParams.mode,
    stretchParams.clipLowPct,
    stretchParams.clipHighPct,
    stretchParams.clipPct,
    stretchParams.gamma,
    stretchParams.asinhStrength,
    stretchParams.removeEmptyLayers,
  ]);
```

- [ ] **Step 4: Build the same opts in `onExport`**

In `onExport`, replace the `claheArg` block + `reliefSmooth(fullBlob, params, claheArg)` call with:

```ts
      const opts = {
        clahe:
          stretchParams.mode === "clahe"
            ? {
                clipLimit: stretchParams.claheClipLimit,
                tiles: stretchParams.claheTiles,
              }
            : undefined,
        background: stretchParams.removeBackground
          ? { threshold: stretchParams.bgThreshold, high: stretchParams.bgHigh }
          : undefined,
      };
      const smoothed = await reliefSmooth(fullBlob, params, opts);
```

(The rest of `onExport` — `createImageBitmap` → `applyLut` → `toBlob` — is unchanged; the canvas already preserves the alpha from an `LA`/RGBA source.)

- [ ] **Step 5: Checkerboard backdrop behind the preview host**

In `ReliefPage.tsx`, find the centre preview host `<div ref={hostCallbackRef} className="min-h-0 min-w-0 flex-1">` and give it a subtle checkerboard so transparent regions read as cut out:

```tsx
                  <div
                    ref={hostCallbackRef}
                    className="min-h-0 min-w-0 flex-1 rounded-[6px]"
                    style={{
                      backgroundColor: "var(--color-surface)",
                      backgroundImage:
                        "repeating-conic-gradient(var(--color-border) 0% 25%, transparent 0% 50%)",
                      backgroundSize: "16px 16px",
                    }}
                  >
```

- [ ] **Step 6: Ensure the 2D compare clears to transparent**

In `web/src/components/relief/ReliefCompare2D.tsx`, confirm the canvas is cleared with `clearRect` (not filled with an opaque colour) before drawing the cleaned image, so transparent pixels let the checkerboard through. If it fills an opaque background, change that fill to `ctx.clearRect(0, 0, w, h)`. (Read the file; apply only if needed. If the cleaned side draws an image with alpha onto a cleared canvas, no change is required.)

- [ ] **Step 7: Typecheck + full tests + build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build > /dev/null 2>&1 && echo BUILD_OK`
Expected: no type errors (Task 4's pending ReliefPage errors now resolved), all tests pass, `BUILD_OK`.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/ReliefPage.tsx web/src/components/relief/ReliefCompare2D.tsx
git commit -m "feat(relief): wire smoothing toggle + trims + checkerboard preview"
```

---

## Task 7: Browser verification + changelog

**Files:**
- Create: `changelog/2026-06-02-relief-trim.md`

- [ ] **Step 1: Rebuild + serve**

```bash
cd web && npm run build > /dev/null 2>&1 && cd ..
XCSGEN_LOG=WARNING uv run --active xcs-gen serve --host 127.0.0.1 --port 8017 &
```

- [ ] **Step 2: Golden-path browser walkthrough (Chrome MCP)**

Generate a cramped depth map **with a black border** inside the workspace (the upload tool sandboxes to workspace roots), upload at `#/relief`, and verify:
- **Smoothing off:** toggle Enable smoothing off → strength/edges/speckle hide, status returns Ready, preview still renders (raw heightfield).
- **Remove empty layers** (Mode = None): histogram shifts left toward 0 with **no rescale** (shape preserved, just offset); 3D surface base drops.
- **Remove background:** toggle on → the black border reads as the checkerboard (transparent) in the 2D/3D preview; the luminance histogram no longer shows the big black-background spike; a `/api/relief/smooth` request fires.
- **Export** with background on → the downloaded PNG has an alpha channel (transparent background).
- Screenshot the background-removal result for the changelog; read it critically.

- [ ] **Step 3: Write the changelog**

Create `changelog/2026-06-02-relief-trim.md`:

```markdown
---
id: 2026-06-02-relief-trim
date: 2026-06-02
level: minor
title: Relief — optional smoothing, range trim, background cut-out
summary: Toggle smoothing off to use just the histogram tools; drop unused bottom-of-range layers; and make a black background transparent so it isn't engraved.
images:
  - src: relief-trim.png
    caption: A depth map with its black background cut to transparency.
---

Three Relief refinements that pair with the tone stretch:

- **Smoothing is now optional** — flip it off to drive the histogram/stretch
  tools on the raw heightfield.
- **Remove empty layers** — drop the unused bottom of the value range (offsets
  the lowest value to 0) without changing contrast, so the machine stops
  cutting air before it reaches real geometry.
- **Background → transparency** — depth maps often ship with a black surround.
  Mask it out (by threshold) and it becomes transparent: excluded from the
  stretch histogram and skipped by the engraver. The export carries the alpha.
```

Save the Step 2 screenshot to `changelog/images/relief-trim.png`.

- [ ] **Step 4: Commit, then finish the branch**

```bash
git add changelog/2026-06-02-relief-trim.md changelog/images/relief-trim.png
git commit -m "docs(changelog): relief optional smoothing + trims + background cut-out"
```

Then proceed to `superpowers:finishing-a-development-branch` for the whole `feat/relief-tone-stretch` branch (tone stretch + these trims).

---

## Self-Review Notes (author checklist — completed)

- **Spec coverage:** §3.1 smoothing toggle → Tasks 2 (backend), 4 (`smoothEnabled`), 5 (toggle), 6 (deps). §3.2 remove empty layers → Task 3 (`buildLut` floor) + 5 (toggle) + 6 (deps). §3.3 background → Tasks 1 (`background_alpha`/`encode_png_la`), 2 (endpoint), 3 (histogram exclusion), 4 (`reliefSmooth` bg opt), 5 (Trim controls), 6 (wiring + checkerboard). §4 UI → Task 5. §6 tests → Tasks 1–5. Changelog → Task 7. ✅
- **Placeholder scan:** every code step is complete; frontend-design tasks carry full briefs with exact prop names + bindings. ✅
- **Type consistency:** `StretchParams` new fields (`removeEmptyLayers`, `removeBackground`, `bgThreshold`, `bgHigh`) are identical across `stretch.ts`, the controls brief, and the ReliefPage opts. `reliefSmooth(blob, p, opts?: { clahe?, background? })` matches every call site in Task 6. Backend `background_alpha(gray, threshold, high)` / `encode_png_la(gray, alpha)` match the endpoint calls. `smoothEnabled` consistent in `ReliefParams` + endpoint `smooth`. ✅
```
