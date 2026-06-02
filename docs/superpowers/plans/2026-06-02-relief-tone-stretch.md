# Relief Tone-Stretch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental tone-stretch stage to the Relief page — a `Mode` dropdown (None / Linear / Gamma / Asinh / Equalize / CLAHE) applied *after* smoothing, so cramped depth maps fill the engraver's 256-level palette.

**Architecture:** Monotonic modes are a pure 256-entry LUT computed and applied **client-side** (instant on slider drag, resolution-independent so preview ≡ export). CLAHE is spatially adaptive, so it runs on the **backend** (cv2) via the existing `/api/relief/smooth` round-trip; in CLAHE mode the client LUT is identity. The stretch sits *after* `smooth_heightfield` (denoise-then-stretch), so it never re-triggers the backend smooth.

**Tech Stack:** TypeScript + React + Vite + vitest (frontend), Python + FastAPI + numpy + OpenCV (`cv2`) + pytest (backend). Design language: Tailwind v4 + the Workshop-Instrument primitives in `web/src/ui/`.

**Spec:** `docs/superpowers/specs/2026-06-02-relief-tone-stretch-design.md`

---

## File Structure

**New files**
- `web/src/components/relief/stretch.ts` — pure tone-map core: `StretchMode`, `StretchParams`, `DEFAULT_STRETCH_PARAMS`, `histogram`, `buildLut`, `applyLut`. No React, no DOM canvas. *Depends on:* nothing.
- `web/src/components/relief/stretch.test.ts` — vitest for the pure core.
- `web/src/components/relief/StretchControls.tsx` — the `Mode` dropdown + per-mode sliders. *Depends on:* `stretch.ts`, `web/src/ui/`.
- `web/src/components/relief/StretchControls.test.tsx` — light render test.
- `changelog/2026-06-02-relief-tone-stretch.md` — minor changelog entry.

**Modified files**
- `src/xcs_gen_web/relief.py` — add `apply_clahe()`.
- `src/xcs_gen_web/app.py` — add `clahe*` form fields to `/api/relief/smooth` (~line 85 import, ~line 887 handler).
- `tests/test_relief.py` — `apply_clahe` unit tests.
- `tests/test_relief_route.py` — CLAHE route test.
- `web/src/pages/reliefHelpers.ts` — `reliefSmooth` gains an optional `clahe` arg.
- `web/src/pages/reliefHelpers.test.ts` — assert clahe form fields.
- `web/src/pages/ReliefPage.tsx` — split backend `smoothed*` from final `cleaned*`; add `stretchParams`; client stretch effect; CLAHE deps; export applies the LUT; render `<StretchControls>`.
- `web/src/components/relief/ReliefInspect.tsx` — overlay the active LUT as a transfer-curve line; import `histogram` from `stretch.ts` (DRY).

---

## Task 1: Pure tone-map core (`stretch.ts`)

**Files:**
- Create: `web/src/components/relief/stretch.ts`
- Test: `web/src/components/relief/stretch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/relief/stretch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STRETCH_PARAMS,
  histogram,
  buildLut,
  applyLut,
  type StretchParams,
} from "./stretch";

// jsdom doesn't ship the ImageData constructor. Shim a structural
// equivalent with the data-first signature the repo uses elsewhere
// (see pixelArtImage.test.ts).
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof ImageData }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

/** Solid-gray image of a given value. */
function makeGray(width: number, height: number, value: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

/** Histogram bunched in [lo, hi] — one pixel per value in that band. */
function bunchedHist(lo: number, hi: number): Uint32Array {
  const h = new Uint32Array(256);
  for (let v = lo; v <= hi; v++) h[v] = 100;
  return h;
}

const params = (over: Partial<StretchParams>): StretchParams => ({
  ...DEFAULT_STRETCH_PARAMS,
  ...over,
});

describe("buildLut", () => {
  it("none → identity", () => {
    const lut = buildLut(params({ mode: "none" }), bunchedHist(60, 180));
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it("clahe → identity (handled on the backend)", () => {
    const lut = buildLut(params({ mode: "clahe" }), bunchedHist(60, 180));
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it("linear maps the populated band to the full range", () => {
    const lut = buildLut(
      params({ mode: "linear", clipLowPct: 0, clipHighPct: 0 }),
      bunchedHist(60, 180),
    );
    expect(lut[60]).toBeLessThanOrEqual(1);
    expect(lut[180]).toBeGreaterThanOrEqual(254);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it("gamma < 1 lifts midtones; > 1 lowers them", () => {
    const hist = bunchedHist(0, 255);
    const lo = buildLut(params({ mode: "gamma", clipPct: 0, gamma: 0.5 }), hist);
    const hi = buildLut(params({ mode: "gamma", clipPct: 0, gamma: 2.0 }), hist);
    expect(lo[128]).toBeGreaterThan(128);
    expect(hi[128]).toBeLessThan(128);
  });

  it("asinh is monotonic and lifts low values", () => {
    const lut = buildLut(
      params({ mode: "asinh", clipPct: 0, asinhStrength: 0.7 }),
      bunchedHist(0, 255),
    );
    expect(lut[64]).toBeGreaterThan(64);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it("equalize flattens a peaked histogram toward uniform", () => {
    const lut = buildLut(params({ mode: "equalize" }), bunchedHist(100, 140));
    expect(lut[100]).toBeLessThan(60);
    expect(lut[140]).toBeGreaterThan(195);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });
});

describe("applyLut", () => {
  it("preserves dimensions and alpha, maps RGB through the LUT", () => {
    const src = makeGray(3, 2, 100);
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.min(255, v + 10);
    const out = applyLut(src, lut);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(out.data[0]).toBe(110); // R
    expect(out.data[1]).toBe(110); // G
    expect(out.data[2]).toBe(110); // B
    expect(out.data[3]).toBe(255); // A preserved
  });
});

describe("histogram", () => {
  it("counts luminance into 256 bins", () => {
    const h = histogram(makeGray(10, 10, 100));
    expect(h[100]).toBe(100);
    expect(h.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/relief/stretch.test.ts`
Expected: FAIL — `Failed to resolve import "./stretch"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/relief/stretch.ts`:

```ts
/**
 * Relief — tone stretch (experimental).
 *
 * Pure, DOM-free tone-mapping for a smoothed depth map. Every monotonic mode
 * is a 256-entry lookup table (input gray → output gray): instant to apply in
 * the browser and resolution-independent, so the preview LUT is the exact same
 * one used for the full-res export. CLAHE is spatially adaptive (not a single
 * LUT) and is handled on the backend — here it resolves to identity.
 *
 * The stretch runs AFTER smoothing (denoise-then-stretch): stretching first
 * would amplify the very noise the smoother removes.
 */

export type StretchMode =
  | "none"
  | "linear"
  | "gamma"
  | "asinh"
  | "equalize"
  | "clahe";

export interface StretchParams {
  mode: StretchMode;
  /** Linear: low/high percentile clip (0..10 %). */
  clipLowPct: number;
  clipHighPct: number;
  /** Gamma / Asinh: symmetric percentile clip applied to both ends (0..10 %). */
  clipPct: number;
  /** Gamma exponent (0.2..2.5). <1 lifts midtones, >1 lowers them. */
  gamma: number;
  /** Asinh lift strength (0..1). */
  asinhStrength: number;
  /** CLAHE (backend) clip limit (1..8). */
  claheClipLimit: number;
  /** CLAHE (backend) tile grid (one axis): 4 | 8 | 16. */
  claheTiles: number;
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
};

/** Rec. 601 luma — for a grayscale depth map R=G=B so this is just the value. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 256-bin luminance histogram for an ImageData. */
export function histogram(src: ImageData): Uint32Array {
  const bins = new Uint32Array(256);
  const px = src.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = luma(px[i], px[i + 1], px[i + 2]);
    bins[Math.min(255, Math.max(0, Math.round(l)))]++;
  }
  return bins;
}

/** Value bounds [lo, hi] after trimming lowPct/highPct of the population. */
function percentileBounds(
  hist: Uint32Array,
  lowPct: number,
  highPct: number,
): [number, number] {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (total === 0) return [0, 255];
  const loTarget = (Math.max(0, lowPct) / 100) * total;
  const hiTarget = (1 - Math.max(0, highPct) / 100) * total;

  let cum = 0;
  let lo = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum > loTarget) {
      lo = i;
      break;
    }
  }
  cum = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= hiTarget) {
      hi = i;
      break;
    }
  }
  if (hi <= lo) hi = Math.min(255, lo + 1);
  return [lo, hi];
}

/** Build the 256-entry tone LUT for the given params + source histogram. */
export function buildLut(p: StretchParams, hist: Uint32Array): Uint8Array {
  const lut = new Uint8Array(256);

  // None and CLAHE (backend) are identity here.
  if (p.mode === "none" || p.mode === "clahe") {
    for (let v = 0; v < 256; v++) lut[v] = v;
    return lut;
  }

  if (p.mode === "equalize") {
    let total = 0;
    for (let i = 0; i < 256; i++) total += hist[i];
    if (total === 0) {
      for (let v = 0; v < 256; v++) lut[v] = v;
      return lut;
    }
    const cdf = new Float64Array(256);
    let cum = 0;
    let cdfMin = 0;
    let foundMin = false;
    for (let i = 0; i < 256; i++) {
      cum += hist[i];
      cdf[i] = cum;
      if (!foundMin && hist[i] > 0) {
        cdfMin = cum;
        foundMin = true;
      }
    }
    const denom = Math.max(1, total - cdfMin);
    for (let v = 0; v < 256; v++) {
      const y = Math.round(((cdf[v] - cdfMin) / denom) * 255);
      lut[v] = Math.max(0, Math.min(255, y));
    }
    return lut;
  }

  // linear / gamma / asinh share a linear percentile trim first.
  const [lo, hi] =
    p.mode === "linear"
      ? percentileBounds(hist, p.clipLowPct, p.clipHighPct)
      : percentileBounds(hist, p.clipPct, p.clipPct);
  const range = Math.max(1, hi - lo);
  const k = 1 + p.asinhStrength * 40; // asinh curvature

  for (let v = 0; v < 256; v++) {
    let x = (v - lo) / range;
    if (x < 0) x = 0;
    if (x > 1) x = 1;

    let y: number;
    if (p.mode === "gamma") {
      y = Math.pow(x, p.gamma);
    } else if (p.mode === "asinh") {
      y = Math.asinh(k * x) / Math.asinh(k);
    } else {
      y = x; // linear
    }
    lut[v] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

/** Apply a 256-LUT to every R/G/B channel; alpha and dimensions preserved. */
export function applyLut(src: ImageData, lut: Uint8Array): ImageData {
  const out = new Uint8ClampedArray(src.data.length);
  const s = src.data;
  for (let i = 0; i < s.length; i += 4) {
    out[i] = lut[s[i]];
    out[i + 1] = lut[s[i + 1]];
    out[i + 2] = lut[s[i + 2]];
    out[i + 3] = s[i + 3];
  }
  return new ImageData(out, src.width, src.height);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/relief/stretch.test.ts`
Expected: PASS (all `buildLut` / `applyLut` / `histogram` cases green).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/relief/stretch.ts web/src/components/relief/stretch.test.ts
git commit -m "feat(relief): pure tone-stretch LUT core (linear/gamma/asinh/equalize)"
```

---

## Task 2: Backend CLAHE (`apply_clahe`)

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_relief.py` (and add `apply_clahe` to the existing import from `xcs_gen_web.relief`):

```python
def test_apply_clahe_increases_local_contrast():
    from xcs_gen_web.relief import apply_clahe

    # A low-contrast gradient bunched in a narrow band.
    row = np.linspace(90, 150, 256).astype(np.uint8)
    gray = np.tile(row, (64, 1))
    out = apply_clahe(gray, clip_limit=2.0, tiles=8)
    assert out.dtype == np.uint8
    assert out.shape == gray.shape
    # CLAHE should widen the value range vs the cramped input.
    assert int(out.max()) - int(out.min()) >= int(gray.max()) - int(gray.min())


def test_apply_clahe_handles_flat_field_without_error():
    from xcs_gen_web.relief import apply_clahe

    gray = np.full((32, 32), 128, dtype=np.uint8)
    out = apply_clahe(gray, clip_limit=2.0, tiles=8)
    assert out.shape == (32, 32)
    assert out.dtype == np.uint8
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --active pytest tests/test_relief.py::test_apply_clahe_increases_local_contrast -q`
Expected: FAIL — `ImportError: cannot import name 'apply_clahe'`.

- [ ] **Step 3: Implement `apply_clahe`**

In `src/xcs_gen_web/relief.py`, add `"apply_clahe"` to `__all__` and append this function (after `smooth_heightfield`):

```python
def apply_clahe(gray: np.ndarray, clip_limit: float, tiles: int) -> np.ndarray:
    """Contrast-limited adaptive histogram equalization of a uint8 heightfield.

    Tile-adaptive local-contrast equalization — not expressible as a single
    256-LUT, hence done here on the backend rather than client-side. Runs on
    the already-smoothed field (denoise-then-stretch)."""
    if gray.ndim != 2:
        raise ValueError("apply_clahe expects a single-channel image")
    n = max(1, int(tiles))
    clahe = cv2.createCLAHE(
        clipLimit=max(0.1, float(clip_limit)),
        tileGridSize=(n, n),
    )
    return np.ascontiguousarray(clahe.apply(gray), dtype=np.uint8)
```

Update the `__all__` line to:

```python
__all__ = [
    "ReliefSmoothParams",
    "smooth_heightfield",
    "apply_clahe",
    "to_grayscale_u8",
    "encode_png",
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --active pytest tests/test_relief.py -q`
Expected: PASS (all relief unit tests, including the two new CLAHE tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): apply_clahe — backend tile-adaptive local-contrast stretch"
```

---

## Task 3: Wire CLAHE into the `/api/relief/smooth` endpoint

**Files:**
- Modify: `src/xcs_gen_web/app.py` (~line 85 import, ~line 887 handler)
- Test: `tests/test_relief_route.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_relief_route.py`:

```python
def test_relief_smooth_with_clahe_returns_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(64, 64, 120), "image/png")},
        data={"clahe": "true", "clahe_clip": "3.0", "clahe_tiles": "8"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    out = Image.open(BytesIO(resp.content))
    assert out.size == (64, 64)


def test_relief_smooth_clamps_out_of_range_clahe_params():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(64, 64, 120), "image/png")},
        # absurd values must be clamped, not 422'd (snap-don't-reject convention)
        data={"clahe": "true", "clahe_clip": "9999", "clahe_tiles": "9999"},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.size == (64, 64)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --active pytest tests/test_relief_route.py::test_relief_smooth_with_clahe_returns_png -q`
Expected: FAIL — CLAHE not applied yet; this may still pass-as-200 but the clamp test exercises the new params. (If both unexpectedly pass, that's because the new `Form` fields don't exist yet and FastAPI ignores unknown form data — proceed to Step 3 anyway; the implementation makes the behaviour real.)

- [ ] **Step 3: Add the import + form fields + apply CLAHE**

In `src/xcs_gen_web/app.py` line 85, extend the relief import:

```python
from .relief import (
    ReliefSmoothParams,
    apply_clahe,
    encode_png,
    smooth_heightfield,
    to_grayscale_u8,
)
```

Replace the `relief_smooth` handler signature + body (currently ~lines 887–914) with:

```python
    @app.post("/api/relief/smooth")
    def relief_smooth(
        file: UploadFile = File(...),
        strength: int = Form(8),
        edge_preserve: bool = Form(True),
        edge_threshold: int = Form(40),
        spike_removal: bool = Form(True),
        median_ksize: int = Form(3),
        clahe: bool = Form(False),
        clahe_clip: float = Form(2.0),
        clahe_tiles: int = Form(8),
    ) -> Response:
        """Smooth a grayscale depth map and return the cleaned PNG. Stateless.

        Optional CLAHE (tile-adaptive local-contrast stretch) runs AFTER the
        smooth — the monotonic tone modes are applied client-side as a LUT."""
        raw = file.file.read()
        try:
            bgr = decode_image_bytes(raw)
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode image")
        gray = to_grayscale_u8(bgr)
        if gray.size == 0 or min(gray.shape) < 2:
            raise HTTPException(status_code=422, detail="Image too small to smooth")
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
        png = encode_png(out)
        return Response(content=png, media_type="image/png",
                        headers={"Cache-Control": "no-store"})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --active pytest tests/test_relief_route.py -q`
Expected: PASS (existing + the two CLAHE route tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_relief_route.py
git commit -m "feat(relief): /api/relief/smooth applies optional CLAHE after smoothing"
```

---

## Task 4: `reliefSmooth` helper gains a `clahe` arg

**Files:**
- Modify: `web/src/pages/reliefHelpers.ts`
- Test: `web/src/pages/reliefHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `web/src/pages/reliefHelpers.test.ts` (add `vi` to the vitest import line — change `import { describe, it, expect } from "vitest";` to `import { describe, it, expect, vi } from "vitest";`):

```ts
import { reliefSmooth } from "./reliefHelpers";

describe("reliefSmooth clahe form fields", () => {
  it("omits clahe fields when no clahe arg is given", async () => {
    const sent: FormData[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: { body: FormData }) => {
        sent.push(init.body);
        return Promise.resolve({ ok: true, blob: async () => new Blob() });
      });
    vi.stubGlobal("fetch", fetchMock);

    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS });
    expect(sent[0].get("clahe")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("appends clahe fields when a clahe arg is given", async () => {
    const sent: FormData[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: { body: FormData }) => {
        sent.push(init.body);
        return Promise.resolve({ ok: true, blob: async () => new Blob() });
      });
    vi.stubGlobal("fetch", fetchMock);

    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS }, {
      clipLimit: 3,
      tiles: 8,
    });
    expect(sent[0].get("clahe")).toBe("true");
    expect(sent[0].get("clahe_clip")).toBe("3");
    expect(sent[0].get("clahe_tiles")).toBe("8");

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts`
Expected: FAIL — `reliefSmooth` doesn't accept a third arg / appends nothing.

- [ ] **Step 3: Extend `reliefSmooth`**

In `web/src/pages/reliefHelpers.ts`, replace the `reliefSmooth` function with:

```ts
/** POST a depth-map blob + params (multipart) and resolve the cleaned PNG blob.
 *  Pass `clahe` to request backend tile-adaptive local-contrast stretch (the
 *  monotonic tone modes are applied client-side as a LUT, not here). */
export async function reliefSmooth(
  blob: Blob,
  p: ReliefParams,
  clahe?: { clipLimit: number; tiles: number },
): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", blob, "depth.png");
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  if (clahe) {
    fd.append("clahe", "true");
    fd.append("clahe_clip", String(clahe.clipLimit));
    fd.append("clahe_tiles", String(clahe.tiles));
  }
  const res = await fetch("/api/relief/smooth", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief smooth failed: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/reliefHelpers.ts web/src/pages/reliefHelpers.test.ts
git commit -m "feat(relief): reliefSmooth accepts an optional clahe arg"
```

---

## Task 5: `StretchControls` component (use frontend-design)

**Files:**
- Create: `web/src/components/relief/StretchControls.tsx`
- Test: `web/src/components/relief/StretchControls.test.tsx`

This is a new visual panel → **invoke the `frontend-design` skill** (CLAUDE.md mandate). The component is pure presentation over `StretchParams`; no business logic.

- [ ] **Step 1: Design + build the component via frontend-design**

Invoke the `frontend-design` skill with this brief:

> Build `web/src/components/relief/StretchControls.tsx` — a settings panel section for the Relief page's experimental tone-stretch, matching the existing `ReliefControls.tsx` (same `Card`/`Section`/`Field` primitives from `web/src/ui/`, JetBrains-mono numerics, `--color-primary` accent, the `Slider` and segmented-control patterns already in `ReliefControls.tsx`).
>
> Props (import the types from `./stretch`):
> ```ts
> export interface StretchControlsProps {
>   params: StretchParams;
>   onChange: (p: StretchParams) => void;
> }
> ```
> Layout — a `Section` titled **"Stretch"** with `titleHint="Experimental — remap tones after smoothing to fill the palette."`:
> - A **Mode** control: a `<select>` (or the existing segmented pattern if it fits) over `none | linear | gamma | asinh | equalize | clahe`, labelled None / Linear / Gamma / Asinh / Equalize / CLAHE.
> - Conditional sliders by mode (mirror `ReliefControls`'s `Slider`):
>   - `linear`: "Clip low %" (`clipLowPct`, 0–10, step 0.1) and "Clip high %" (`clipHighPct`, 0–10, step 0.1).
>   - `gamma`: "Clip %" (`clipPct`, 0–10, step 0.1) and "Gamma" (`gamma`, 0.2–2.5, step 0.05).
>   - `asinh`: "Clip %" (`clipPct`, 0–10, step 0.1) and "Strength" (`asinhStrength`, 0–1, step 0.05).
>   - `equalize`: no sliders — a one-line hint "Global histogram equalization."
>   - `clahe`: "Clip limit" (`claheClipLimit`, 1–8, step 0.5) and "Tiles" (`claheTiles`, segmented 4 / 8 / 16). Add a hint: "Runs on the server."
> - For `none`: a one-line hint "No change — pick a mode to stretch the tones."
> - When mode is `linear`/`gamma`/`asinh`, surface the depth-map caveat as a small hint under the clip slider: "Clipping discards extreme pixels — keep it low to preserve peak depth."
> - Patch immutably via `onChange({ ...params, [key]: value })`, exactly like `ReliefControls`'s `set` helper. Steps that are fractional must use a non-integer-aware slider (the existing `Slider` parses `parseInt`; add a `step`/`float` variant or a small local `FloatSlider` for the 0.1/0.05-step controls).

Constraint for the worker: the produced file must `npx tsc --noEmit` clean and follow the file's existing comment/JSDoc density.

- [ ] **Step 2: Write a light render test**

Create `web/src/components/relief/StretchControls.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StretchControls } from "./StretchControls";
import { DEFAULT_STRETCH_PARAMS } from "./stretch";

describe("StretchControls", () => {
  it("renders the Stretch section and a mode control", () => {
    render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={() => {}} />,
    );
    expect(screen.getByText(/stretch/i)).toBeInTheDocument();
  });

  it("emits a mode change", () => {
    const onChange = vi.fn();
    render(
      <StretchControls params={DEFAULT_STRETCH_PARAMS} onChange={onChange} />,
    );
    // The mode control is a <select> labelled for accessibility.
    const select = screen.getByLabelText(/mode/i);
    fireEvent.change(select, { target: { value: "linear" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "linear" }),
    );
  });
});
```

> If frontend-design implements the mode control as a segmented button group rather than a `<select>`, adjust the second test to click the "Linear" button (`fireEvent.click(screen.getByRole("radio", { name: /linear/i }))`) instead — keep the assertion identical.

- [ ] **Step 3: Run the test + typecheck**

Run: `cd web && npx vitest run src/components/relief/StretchControls.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/relief/StretchControls.tsx web/src/components/relief/StretchControls.test.tsx
git commit -m "feat(relief): StretchControls panel (mode dropdown + per-mode sliders)"
```

---

## Task 6: Wire the stretch into `ReliefPage`

**Files:**
- Modify: `web/src/pages/ReliefPage.tsx`

The plan: the backend result becomes the intermediate `smoothed*`; a client stretch effect derives the final `cleaned*` that all consumers already read. CLAHE-active state joins the backend-smooth deps; monotonic params drive only the client stretch effect.

- [ ] **Step 1: Add imports + stretch state**

At the top of `ReliefPage.tsx`, after the existing `reliefHelpers` import, add:

```ts
import { StretchControls } from "../components/relief/StretchControls";
import {
  DEFAULT_STRETCH_PARAMS,
  buildLut,
  applyLut,
  histogram,
  type StretchParams,
} from "../components/relief/stretch";
```

In the component body, next to `const [params, setParams] = useState<ReliefParams>(DEFAULT_RELIEF_PARAMS);`, add:

```ts
  const [stretchParams, setStretchParams] = useState<StretchParams>(
    DEFAULT_STRETCH_PARAMS,
  );
  // Active LUT (monotonic modes) — passed to the inspect curve overlay; null
  // for none/clahe so the overlay draws nothing.
  const [lut, setLut] = useState<Uint8Array | null>(null);
```

- [ ] **Step 2: Rename the backend buffers to `smoothed*` and add final `cleaned*`**

Rename the existing backend-result state. Change:

```ts
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
```
to:
```ts
  const [smoothedUrl, setSmoothedUrl] = useState<string | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null); // final (post-stretch)
```

Change the URL bookkeeping refs block:

```ts
  const cleanedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    cleanedUrlRef.current = cleanedUrl;
  }, [cleanedUrl]);
```
to:
```ts
  const smoothedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    smoothedUrlRef.current = smoothedUrl;
  }, [smoothedUrl]);
  const cleanedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    cleanedUrlRef.current = cleanedUrl;
  }, [cleanedUrl]);
```

Change the inspect-buffer state:

```ts
  const [originalData, setOriginalData] = useState<ImageData | null>(null);
  const [cleanedData, setCleanedData] = useState<ImageData | null>(null);
```
to:
```ts
  const [originalData, setOriginalData] = useState<ImageData | null>(null);
  const [smoothedData, setSmoothedData] = useState<ImageData | null>(null);
  const [cleanedData, setCleanedData] = useState<ImageData | null>(null); // final (post-stretch)
```

- [ ] **Step 3: Backend smooth effect → set `smoothedUrl`, pass CLAHE, add deps**

In the debounced preview effect, the smooth call + result handling changes. Replace the `reliefSmooth(...)` call and `setCleanedUrl` block inside that effect:

```ts
          const cleaned = await reliefSmooth(
            blob,
            scaleParamsForPreview(params, ratio),
          );
          // Stale guard: a newer request started while we awaited.
          if (cancelled || myReq !== reqIdRef.current) return;
          const url = URL.createObjectURL(cleaned);
          if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
          setCleanedUrl(url);
          setStatus("ready");
```
with:
```ts
          const claheArg =
            stretchParams.mode === "clahe"
              ? {
                  clipLimit: stretchParams.claheClipLimit,
                  tiles: stretchParams.claheTiles,
                }
              : undefined;
          const smoothed = await reliefSmooth(
            blob,
            scaleParamsForPreview(params, ratio),
            claheArg,
          );
          // Stale guard: a newer request started while we awaited.
          if (cancelled || myReq !== reqIdRef.current) return;
          const url = URL.createObjectURL(smoothed);
          if (smoothedUrlRef.current) URL.revokeObjectURL(smoothedUrlRef.current);
          setSmoothedUrl(url);
          setStatus("ready");
```

Extend that effect's dependency array. The backend must re-run only when CLAHE is active or its params change (NOT on monotonic-mode switches). Change the deps array end from:

```ts
  }, [
    bitmap,
    params.strength,
    params.edgePreserve,
    params.edgeThreshold,
    params.spikeRemoval,
    params.medianKsize,
    renderTick,
  ]);
```
to:
```ts
  }, [
    bitmap,
    params.strength,
    params.edgePreserve,
    params.edgeThreshold,
    params.spikeRemoval,
    params.medianKsize,
    // CLAHE is the only stretch mode that touches the backend. A boolean so
    // switching between monotonic modes doesn't cost a round-trip.
    stretchParams.mode === "clahe",
    stretchParams.claheClipLimit,
    stretchParams.claheTiles,
    renderTick,
  ]);
```

- [ ] **Step 4: Decode effect → produce `smoothedData` from `smoothedUrl`**

In the "Inspect buffers" effect, change its guard, its setters, the decoded variable name, and its dependency from `cleanedUrl` to `smoothedUrl`. Specifically:

- `if (!bitmap || !cleanedUrl) {` → `if (!bitmap || !smoothedUrl) {`
- inside that guard: `setCleanedData(null);` → `setSmoothedData(null);`
- the line `const cleaned = cctx.getImageData(0, 0, w, h);` → `const smoothed = cctx.getImageData(0, 0, w, h);`
- `setCleanedData(cleaned);` → `setSmoothedData(smoothed);`
- the two `setCleanedData(null);` in the catch/onerror branches → `setSmoothedData(null);`
- `img.src = cleanedUrl;` → `img.src = smoothedUrl;`
- dependency array `}, [bitmap, cleanedUrl]);` → `}, [bitmap, smoothedUrl]);`

(Leave `setOriginalData(...)` exactly as-is — `originalData` is still the source drawn to the same box.)

- [ ] **Step 5: Add the client stretch effect (smoothed → final cleaned)**

Immediately after the decode effect, add:

```ts
  // ── Client tone-stretch: smoothedData → final cleanedData (+ URL) ─────
  // Monotonic modes (linear/gamma/asinh/equalize) are a 256-LUT applied here
  // in the browser — instant, no backend round-trip. CLAHE resolved on the
  // backend already, so its LUT is identity and this just forwards the result.
  useEffect(() => {
    if (!smoothedData) {
      setCleanedData(null);
      setLut(null);
      if (cleanedUrlRef.current) {
        URL.revokeObjectURL(cleanedUrlRef.current);
        setCleanedUrl(null);
      }
      return;
    }
    const built = buildLut(stretchParams, histogram(smoothedData));
    const out = applyLut(smoothedData, built);
    setCleanedData(out);
    setLut(
      stretchParams.mode === "none" || stretchParams.mode === "clahe"
        ? null
        : built,
    );

    // Re-encode for the 2D wipe (cleanedUrl). Cheap at the ≤800px preview size.
    let cancelled = false;
    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.putImageData(out, 0, 0);
      canvas.toBlob((b) => {
        if (cancelled || !b) return;
        const url = URL.createObjectURL(b);
        if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
        setCleanedUrl(url);
      }, "image/png");
    }
    return () => {
      cancelled = true;
    };
  }, [
    smoothedData,
    stretchParams.mode,
    stretchParams.clipLowPct,
    stretchParams.clipHighPct,
    stretchParams.clipPct,
    stretchParams.gamma,
    stretchParams.asinhStrength,
  ]);
```

- [ ] **Step 6: Update unmount cleanup to revoke both URLs**

In the unmount cleanup effect, change:

```ts
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
      bitmapRef.current?.close();
```
to:
```ts
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (smoothedUrlRef.current) URL.revokeObjectURL(smoothedUrlRef.current);
      if (cleanedUrlRef.current) URL.revokeObjectURL(cleanedUrlRef.current);
      bitmapRef.current?.close();
```

- [ ] **Step 7: Export applies the same LUT (identity for CLAHE)**

Replace the body of `onExport`'s `try` (from the `reliefSmooth` call onward) so the full-res backend result is run through the same LUT before download:

```ts
      const claheArg =
        stretchParams.mode === "clahe"
          ? {
              clipLimit: stretchParams.claheClipLimit,
              tiles: stretchParams.claheTiles,
            }
          : undefined;
      const smoothed = await reliefSmooth(fullBlob, params, claheArg);

      // Apply the SAME client LUT to the full-res result (identity for CLAHE).
      const smoothedBitmap = await createImageBitmap(smoothed);
      const oc = document.createElement("canvas");
      oc.width = smoothedBitmap.width;
      oc.height = smoothedBitmap.height;
      const octx = oc.getContext("2d", { willReadFrequently: true });
      if (!octx) throw new Error("Failed to get 2D context");
      octx.drawImage(smoothedBitmap, 0, 0);
      smoothedBitmap.close();
      const srcData = octx.getImageData(0, 0, oc.width, oc.height);
      const finalData = applyLut(srcData, buildLut(stretchParams, histogram(srcData)));
      octx.putImageData(finalData, 0, 0);
      const finalBlob = await new Promise<Blob>((resolve, reject) =>
        oc.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        ),
      );
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "relief.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
```

Add `stretchParams` to `onExport`'s dependency array: `}, [bitmap, params, stretchParams]);`.

- [ ] **Step 8: Render `<StretchControls>` in the left column**

In the left settings column, under `<ReliefControls params={params} onChange={setParams} />`, add:

```tsx
            <StretchControls params={stretchParams} onChange={setStretchParams} />
```

- [ ] **Step 9: Typecheck + existing tests + build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build > /dev/null 2>&1 && echo BUILD_OK`
Expected: no type errors, all tests pass, `BUILD_OK` printed.

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/ReliefPage.tsx
git commit -m "feat(relief): wire client tone-stretch into ReliefPage (preview + export)"
```

---

## Task 7: Transfer-curve overlay on the inspect histogram (use frontend-design)

**Files:**
- Modify: `web/src/components/relief/ReliefInspect.tsx`
- Modify: `web/src/pages/ReliefPage.tsx` (pass the `lut` prop)

Drawing the active tone curve over the existing histogram is a visual feature → **invoke the `frontend-design` skill** for the overlay rendering, keeping the histogram exactly as it is today.

- [ ] **Step 1: DRY the histogram helper**

In `ReliefInspect.tsx`, remove its local `function histogram(...)` and import the shared one:

```ts
import { histogram } from "./stretch";
```

(Confirm the local `luma` helper is still used by the gradient/percentChanged code — leave it. Only the `histogram` function moves to the import.)

- [ ] **Step 2: Add the `lut` prop + overlay via frontend-design**

Invoke the `frontend-design` skill with this brief:

> In `web/src/components/relief/ReliefInspect.tsx`, add an optional prop `lut?: Uint8Array | null` to `ReliefInspectProps`. When `lut` is present, draw it as a thin transfer-curve polyline over the existing luminance histogram canvas (the `histRef` canvas): map input `x = i/255` across the canvas width and output `y` so `lut[i]/255 = 0` sits on the baseline and `=1` at the top. Use `--color-secondary` (or a muted ink) at ~1.5px, drawn on top of the bars after they're painted, inside the same `useEffect` that paints the histogram (add `lut` to that effect's dependency array). Draw nothing when `lut` is null/absent. Keep all existing histogram/gradient/% -changed behaviour and the Workshop-Instrument styling unchanged. Add a small legend entry "curve" next to the existing "cleaned"/"original" legend when a curve is shown.

- [ ] **Step 3: Pass the prop from ReliefPage**

In `ReliefPage.tsx`, update the `<ReliefInspect>` usage:

```tsx
                <ReliefInspect
                  originalData={originalData}
                  cleanedData={cleanedData}
                  lut={lut}
                />
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build > /dev/null 2>&1 && echo BUILD_OK`
Expected: no type errors, tests pass, `BUILD_OK`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/relief/ReliefInspect.tsx web/src/pages/ReliefPage.tsx
git commit -m "feat(relief): transfer-curve overlay on the inspect histogram"
```

---

## Task 8: Browser verification + changelog

**Files:**
- Create: `changelog/2026-06-02-relief-tone-stretch.md`

- [ ] **Step 1: Rebuild and run the dev server**

```bash
cd web && npm run build > /dev/null 2>&1 && cd ..
uv run --active xcs-gen serve --host 127.0.0.1 --port 8017
```

- [ ] **Step 2: Golden-path browser walkthrough (Chrome MCP / Playwright)**

Per CLAUDE.md, UI work is not done until verified in a real browser. Navigate to `http://127.0.0.1:8017/#/relief` and:
- Upload a **cramped** grayscale depth map (values bunched in a narrow mid band). A quick fixture: any photo converted to grayscale, or generate one.
- Confirm **None** = no change vs the smoothed image.
- Switch to **Linear** (clip 0.1%) → histogram visibly spreads to fill 0–255; 3D surface deepens; transfer curve shows as a steeper-than-diagonal line.
- **Gamma** 0.6 → midtones lift; curve bows upward; preview updates **instantly** (no network round-trip — confirm in the Network panel that no `/api/relief/smooth` fires on the gamma slider).
- **Asinh**, **Equalize** → live, curve overlay tracks.
- **CLAHE** → confirm a `/api/relief/smooth` request DOES fire (it's the backend mode), local contrast increases.
- **Export cleaned PNG** in Gamma mode → open the downloaded PNG and confirm its histogram matches the preview (LUT parity).
- Screenshot the page in Linear mode (cramped → filled) for the changelog. Read the screenshot critically before declaring done.

- [ ] **Step 3: Write the changelog entry**

Create `changelog/2026-06-02-relief-tone-stretch.md`:

```markdown
---
id: 2026-06-02-relief-tone-stretch
date: 2026-06-02
level: minor
title: Relief — tone stretch
summary: Spread a cramped depth map across the full engraving palette — linear, gamma, asinh, equalize, or CLAHE — applied after smoothing, previewed live.
images:
  - src: relief-tone-stretch.png
    caption: A depth map bunched in the midtones, stretched to fill 0–255.
---

Depth maps often arrive with their values squeezed into a narrow band — the
relief then carves shallow and flat, and where the band starts above zero the
machine wastes passes cutting air before it reaches real geometry.

The Relief page now has an experimental **Stretch** section. Pick a mode and
the tones remap to fill the engraver's 256-level palette, live in the preview:

- **Linear** — pull the black/white points to 0–255, preserving relative depth
  (your wasted-descent fix).
- **Gamma / Asinh** — bend the midtones to reveal compressed detail.
- **Equalize / CLAHE** — even out the histogram globally, or per-tile.

Monotonic modes run instantly in the browser; CLAHE runs on the server. The
inspect histogram draws the active tone curve so you can see the mapping, and
the export applies the exact same curve — preview is what you carve.
```

Save the screenshot from Step 2 to `changelog/images/relief-tone-stretch.png`.

- [ ] **Step 4: Commit + push + draft PR**

```bash
git add changelog/2026-06-02-relief-tone-stretch.md changelog/images/relief-tone-stretch.png
git commit -m "docs(changelog): relief tone stretch"
git push -u origin feat/relief-tone-stretch
gh pr create --draft --title "feat(relief): experimental tone stretch" \
  --body "Adds a Mode dropdown (None / Linear / Gamma / Asinh / Equalize / CLAHE) to the Relief page, applied after smoothing. Monotonic modes are an instant client-side 256-LUT (preview == export); CLAHE runs on the backend via cv2. Spec: docs/superpowers/specs/2026-06-02-relief-tone-stretch-design.md"
```

- [ ] **Step 5: Flip to ready when CI is green**

```bash
gh pr ready
```

---

## Self-Review Notes (author checklist — completed)

- **Spec coverage:** §3 pipeline order → Task 6 (stretch effect after decode). §4 client/backend split → Tasks 1+6 (LUT) and 2+3 (CLAHE). §5 modes/params → Task 1 (`buildLut`) + Task 5 (controls). §6 components → Tasks 1/5/6/7. §6 backend → Tasks 2/3. §7 UI → Task 5. §6 inspect overlay → Task 7. §8 tests → Tasks 1–6. §11 changelog → Task 8. ✅ All covered.
- **Placeholder scan:** every code step shows complete code; no TBD/TODO. Frontend-design tasks (5, 7) carry full briefs + concrete props/types. ✅
- **Type consistency:** `StretchParams` field names (`clipLowPct`, `clipHighPct`, `clipPct`, `gamma`, `asinhStrength`, `claheClipLimit`, `claheTiles`) are identical across `stretch.ts`, the controls brief, `reliefSmooth`'s `{ clipLimit, tiles }` arg, and the ReliefPage wiring. `buildLut(params, hist)` / `applyLut(src, lut)` / `histogram(src)` signatures match every call site. Backend `apply_clahe(gray, clip_limit, tiles)` matches the endpoint call. ✅
```
