# Relief Depth-Map Smoothing — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Relief page that smooths an imported grayscale depth map (edge-aware denoise with an on-by-default guard rail) and exports a cleaned PNG, with a live 2D before/after and an orbitable 3D preview.

**Architecture:** Backend OpenCV does the smoothing behind a stateless `POST /api/relief/smooth`; the browser downscales for a debounced live preview and sends full-res on export. A new lazy-loaded React page renders the 2D split + a dynamically-imported three.js surface.

**Tech Stack:** Python (FastAPI, OpenCV `cv2`, NumPy, Pillow); React + TypeScript + Vite; three.js (new dep, code-split to this page); Tailwind v4 + the `web/src/ui/` primitives.

**Design spec:** `docs/superpowers/specs/2026-05-31-relief-depth-smoothing-design.md`

### Frontend division of labour (read first)
Per CLAUDE.md, **visual components go through the `frontend-design` agent**. So:
- **Pure logic** (Python smoothing, `reliefHelpers.ts` math) — this plan gives **complete TDD code**.
- **Registration edits** (router/App/TopBar) — this plan gives the **exact diffs**.
- **Styled components** (`ReliefPage`, controls, canvases, 3D) — this plan gives the **precise contract** (props, behaviour, acceptance criteria, and the three.js core) and the task says *build it via `frontend-design` to this contract*. That is intentional, not a placeholder.

Every UI task ends with a **real-browser check** (Chrome/Playwright MCP) per CLAUDE.md — `cd web && npm run build` first (the server serves `web/dist/`, not Vite dev).

---

## Task 1: Backend smoothing core (`relief.py`)

**Files:**
- Create: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing test (spike removal)**

```python
# tests/test_relief.py
"""Tests for grayscale depth-map smoothing (relief)."""
from __future__ import annotations

import numpy as np
from PIL import Image

from xcs_gen_web.relief import (
    ReliefSmoothParams,
    smooth_heightfield,
    to_grayscale_u8,
    encode_png,
)


def test_smooth_removes_single_pixel_spike():
    gray = np.full((20, 20), 100, dtype=np.uint8)
    gray[10, 10] = 255  # one bright spike
    out = smooth_heightfield(gray, ReliefSmoothParams())
    # the spike is gone — centre is back near the 100 background
    assert abs(int(out[10, 10]) - 100) < 20
    assert out.dtype == np.uint8
    assert out.shape == gray.shape
```

- [ ] **Step 2: Run it, watch it fail**

Run: `uv run --active pytest tests/test_relief.py::test_smooth_removes_single_pixel_spike -q`
Expected: FAIL — `ImportError: cannot import name 'smooth_heightfield'`.

- [ ] **Step 3: Implement `relief.py`**

```python
# src/xcs_gen_web/relief.py
"""Edge-aware smoothing of grayscale depth maps for relief engraving.

The xTool machine maps a grayscale image's 0..255 onto N engraving pass-levels
itself (depth = pass count). Our job is to clean the heightfield so it engraves
without pixel oscillation or over-sharp risers, while preserving legitimate
sharp drops. Pure numpy/cv2 — no HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image


@dataclass(frozen=True)
class ReliefSmoothParams:
    strength: int = 8           # bilateral sigmaSpace (spatial radius, px)
    edge_preserve: bool = True  # the guard rail
    edge_threshold: int = 40    # preserve intensity jumps above this (0..255)
    spike_removal: bool = True
    median_ksize: int = 3       # 3 or 5


def to_grayscale_u8(img: np.ndarray) -> np.ndarray:
    """Coerce a decoded image (BGR, BGRA, or single-channel) to contiguous uint8 gray."""
    if img.ndim == 2:
        gray = img
    elif img.shape[2] == 4:
        gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    else:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return np.ascontiguousarray(gray, dtype=np.uint8)


def smooth_heightfield(gray: np.ndarray, p: ReliefSmoothParams) -> np.ndarray:
    """Edge-aware denoise of a single-channel uint8 heightfield."""
    if gray.ndim != 2:
        raise ValueError("smooth_heightfield expects a single-channel image")

    # 1. spike removal — kill single-pixel oscillation
    work = gray
    if p.spike_removal:
        work = cv2.medianBlur(work, 5 if p.median_ksize >= 5 else 3)

    # 2. edge-aware smooth — bilateral; sigmaColor IS the guard rail
    smoothed = cv2.bilateralFilter(
        work, d=0,
        sigmaColor=max(1, int(p.edge_threshold)),
        sigmaSpace=max(1, int(p.strength)),
    )

    # 3. explicit guard-rail freeze — hard-preserve real sharp drops.
    #    Measured on the DE-SPIKED image so spikes (already gone) aren't refrozen;
    #    morphological gradient = local max-min range, in intensity units, so the
    #    threshold compares apples-to-apples with edge_threshold.
    if p.edge_preserve:
        kernel = np.ones((3, 3), np.uint8)
        local_range = cv2.morphologyEx(work, cv2.MORPH_GRADIENT, kernel)
        edge = local_range > int(p.edge_threshold)
        edge = cv2.dilate(edge.astype(np.uint8), kernel, iterations=1).astype(bool)
        smoothed = np.where(edge, work, smoothed)

    return np.ascontiguousarray(smoothed, dtype=np.uint8)


def encode_png(gray: np.ndarray) -> bytes:
    """Encode a single-channel uint8 array to PNG bytes (mode L)."""
    buf = BytesIO()
    Image.fromarray(gray, mode="L").save(buf, format="PNG")
    return buf.getvalue()
```

- [ ] **Step 4: Run it, watch it pass**

Run: `uv run --active pytest tests/test_relief.py -q`
Expected: PASS.

- [ ] **Step 5: Add the edge-preservation test**

```python
def test_smooth_preserves_a_real_step_edge():
    gray = np.empty((20, 20), dtype=np.uint8)
    gray[:, :10] = 50
    gray[:, 10:] = 200  # a 150-level jump, well above edge_threshold=40
    out = smooth_heightfield(gray, ReliefSmoothParams())
    # the step stays sharp — neither side blurs toward the ~125 midpoint
    assert out[:, 8].mean() < 90
    assert out[:, 11].mean() > 160
```

- [ ] **Step 6: Run it, watch it pass** — `uv run --active pytest tests/test_relief.py -q` → PASS.

- [ ] **Step 7: Add the no-new-reversals + encode tests**

```python
def test_smooth_keeps_a_monotonic_ramp_monotonic():
    row = np.linspace(0, 255, 256).astype(np.uint8)
    gray = np.tile(row, (32, 1))  # 32×256 horizontal ramp
    out = smooth_heightfield(gray, ReliefSmoothParams())
    diffs = np.diff(out[16].astype(np.int16))
    assert diffs.min() >= -2  # no new local reversals introduced


def test_encode_png_round_trips_grayscale():
    gray = np.full((8, 12), 128, dtype=np.uint8)
    img = Image.open(BytesIO(encode_png(gray)))
    assert img.mode == "L"
    assert img.size == (12, 8)  # PIL size is (w, h)
```

- [ ] **Step 8: Run it, watch it pass** — `uv run --active pytest tests/test_relief.py -q` → 4 passed.

- [ ] **Step 9: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): edge-aware heightfield smoothing core"
```

---

## Task 2: Smoothing endpoint (`POST /api/relief/smooth`)

**Files:**
- Modify: `src/xcs_gen_web/app.py` (add route + imports)
- Test: `tests/test_relief_route.py`

Heavy cv2 work runs in a FastAPI `def` handler, which FastAPI dispatches on the bounded anyio threadpool (`XCS_GEN_THREADPOOL_SIZE`, default 4) — that satisfies the spec's "bounded" intent for v1; a dedicated semaphore can be added later if profiling shows memory pressure. The 20 MiB upload middleware already caps input size.

- [ ] **Step 1: Write the failing route test**

```python
# tests/test_relief_route.py
"""Tests for the /api/relief/smooth route."""
from __future__ import annotations

from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from xcs_gen_web.app import create_app


def _png_bytes(w=32, h=32, color=100) -> bytes:
    buf = BytesIO()
    Image.new("L", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_returns_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_bytes(), "image/png")},
        data={"strength": "8", "edge_threshold": "40"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    out = Image.open(BytesIO(resp.content))
    assert out.size == (32, 32)


def test_relief_smooth_rejects_non_image():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("x.bin", b"not an image", "application/octet-stream")},
    )
    assert resp.status_code == 400
```

- [ ] **Step 2: Run it, watch it fail**

Run: `uv run --active pytest tests/test_relief_route.py -q`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the route to `app.py`**

Add imports near the other route imports at the top of `src/xcs_gen_web/app.py`:

```python
from fastapi import File, Form, UploadFile  # extend the existing fastapi import
from .relief import ReliefSmoothParams, encode_png, smooth_heightfield, to_grayscale_u8
from .capture_pipeline import decode_image_bytes
```

Add the route inside `create_app()` alongside the other `@app.post(...)` definitions (e.g. just after the pixel-art route):

```python
    @app.post("/api/relief/smooth")
    def relief_smooth(
        file: UploadFile = File(...),
        strength: int = Form(8),
        edge_preserve: bool = Form(True),
        edge_threshold: int = Form(40),
        spike_removal: bool = Form(True),
        median_ksize: int = Form(3),
    ) -> Response:
        """Smooth a grayscale depth map and return the cleaned PNG. Stateless."""
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
            median_ksize=5 if median_ksize >= 5 else 3,
        )
        png = encode_png(smooth_heightfield(gray, params))
        return Response(content=png, media_type="image/png",
                        headers={"Cache-Control": "no-store"})
```

(`Response` and `HTTPException` are already imported in `app.py`; verify and add only what's missing.)

- [ ] **Step 4: Run it, watch it pass** — `uv run --active pytest tests/test_relief_route.py -q` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_relief_route.py
git commit -m "feat(relief): POST /api/relief/smooth endpoint"
```

---

## Task 3: Frontend helpers (`reliefHelpers.ts`)

**Files:**
- Create: `web/src/pages/reliefHelpers.ts`
- Test: `web/src/pages/reliefHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/pages/reliefHelpers.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_RELIEF_PARAMS, previewRatio, scaleParamsForPreview } from "./reliefHelpers";

describe("previewRatio", () => {
  it("is 1 when already within maxEdge", () => {
    expect(previewRatio(400, 300, 800)).toBe(1);
  });
  it("is maxEdge/longest when larger", () => {
    expect(previewRatio(1600, 400, 800)).toBeCloseTo(0.5, 5);
  });
});

describe("scaleParamsForPreview", () => {
  it("scales strength by the ratio (>=1), leaves thresholds alone", () => {
    const p = { ...DEFAULT_RELIEF_PARAMS, strength: 8, edgeThreshold: 40 };
    const out = scaleParamsForPreview(p, 0.5);
    expect(out.strength).toBe(4);
    expect(out.edgeThreshold).toBe(40);
  });
  it("never drops strength below 1", () => {
    expect(scaleParamsForPreview({ ...DEFAULT_RELIEF_PARAMS, strength: 1 }, 0.1).strength).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts`
Expected: FAIL — cannot resolve `./reliefHelpers`.

- [ ] **Step 3: Implement `reliefHelpers.ts`**

```ts
// web/src/pages/reliefHelpers.ts
export interface ReliefParams {
  strength: number;       // bilateral spatial radius (px, full-res)
  edgePreserve: boolean;
  edgeThreshold: number;  // 1..255
  spikeRemoval: boolean;
  medianKsize: number;    // 3 | 5
}

export const DEFAULT_RELIEF_PARAMS: ReliefParams = {
  strength: 8,
  edgePreserve: true,
  edgeThreshold: 40,
  spikeRemoval: true,
  medianKsize: 3,
};

/** Longest-edge downscale ratio for a max edge (<=1; 1 if already small). */
export function previewRatio(width: number, height: number, maxEdge: number): number {
  const longest = Math.max(width, height);
  return longest <= maxEdge ? 1 : maxEdge / longest;
}

/** Scale spatial params for a downscaled preview so preview ≈ full-res export.
 *  Thresholds are intensity-domain and stay fixed; only the pixel radius scales. */
export function scaleParamsForPreview(p: ReliefParams, ratio: number): ReliefParams {
  const r = Math.min(1, Math.max(0.01, ratio));
  return { ...p, strength: Math.max(1, Math.round(p.strength * r)) };
}

/** POST a depth-map blob + params (multipart) and resolve the cleaned PNG blob. */
export async function reliefSmooth(blob: Blob, p: ReliefParams): Promise<Blob> {
  const fd = new FormData();
  fd.append("file", blob, "depth.png");
  fd.append("strength", String(p.strength));
  fd.append("edge_preserve", String(p.edgePreserve));
  fd.append("edge_threshold", String(p.edgeThreshold));
  fd.append("spike_removal", String(p.spikeRemoval));
  fd.append("median_ksize", String(p.medianKsize));
  const res = await fetch("/api/relief/smooth", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`relief smooth failed: ${res.status}`);
  return res.blob();
}

/** Downscale an ImageBitmap to <=maxEdge longest edge, return { blob, ratio }.
 *  ratio is what scaleParamsForPreview() expects. Browser-only (canvas). */
export async function downscaleForPreview(
  bitmap: ImageBitmap,
  maxEdge: number,
): Promise<{ blob: Blob; ratio: number }> {
  const ratio = previewRatio(bitmap.width, bitmap.height, maxEdge);
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return { blob, ratio };
}
```

- [ ] **Step 4: Run it, watch it pass** — `cd web && npx vitest run src/pages/reliefHelpers.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/reliefHelpers.ts web/src/pages/reliefHelpers.test.ts
git commit -m "feat(relief): client smoothing helpers + preview scaling"
```

---

## Task 4: Register the Relief route

**Files:**
- Create: `web/src/pages/ReliefPage.tsx` (stub; the real page replaces it in Task 5)
- Modify: `web/src/router.ts`, `web/src/App.tsx`, `web/src/components/TopBar.tsx`

- [ ] **Step 1: `router.ts` — add the route to the union + parser + formatter**

Add to the `Route` union (next to `| { name: "gcode" }`):
```ts
  | { name: "relief" }
```
Add to `parseRoute` (next to the gcode case):
```ts
  if (h === "relief") return { name: "relief" };
```
Add to `formatRoute` (next to the gcode case):
```ts
    case "relief":      return "#/relief";
```

- [ ] **Step 2: Create the page stub, then wire `App.tsx`**

First create a stub so the lazy import resolves and this commit builds (Task 5 replaces it):
```tsx
// web/src/pages/ReliefPage.tsx
export function ReliefPage() {
  return <div className="p-6 font-mono text-sm">Relief — coming soon.</div>;
}
```
Then add the lazy import next to `GcodeViewerPage`:
```ts
const ReliefPage = lazy(() =>
  import("./pages/ReliefPage").then((m) => ({ default: m.ReliefPage })),
);
```
Add to the page-title ternary chain (next to the `gcode` case):
```ts
    : route.name === "relief"     ? "Relief"
```
Add to the gated render block (next to the `gcode` render):
```ts
          {gate === "ready" && route.name === "relief"      && <ReliefPage />}
```

- [ ] **Step 3: `TopBar.tsx` — nav entry in the Engraving group**

Add `"relief"` to the `NavRouteName` union, and add to the Engraving group's children:
```ts
              { label: "Relief", route: "relief" },
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (the Step 2 stub satisfies the lazy import).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ReliefPage.tsx web/src/router.ts web/src/App.tsx web/src/components/TopBar.tsx
git commit -m "feat(relief): register #/relief route + Engraving nav entry + page stub"
```

---

## Task 5: Relief page MVP — upload → smooth → 2D before/after → export PNG  *(frontend-design)*

**Files:**
- Create: `web/src/pages/ReliefPage.tsx`
- Create: `web/src/components/relief/ReliefCompare2D.tsx`

**Build via the `frontend-design` agent** to this contract. Pattern source: `web/src/pages/PixelArtPage.tsx` (layout, debounced effect + `renderTick`, `decodeFile` from `pixelArtHelpers.ts`); canvas auto-fit + devicePixelRatio from `web/src/components/gcode/GcodeCanvas.tsx`.

**`ReliefPage` behaviour contract:**
- Hidden file input → on file, `decodeFile()` → store `{ bitmap, imageData }`.
- State: `params: ReliefParams` (`DEFAULT_RELIEF_PARAMS`), `cleanedUrl: string | null`, `originalUrl`, `status: "idle" | "smoothing" | "ready" | "error"`, `renderTick`.
- **Debounced effect** (≈250ms) on `[bitmap, params, renderTick]`: `downscaleForPreview(bitmap, 800)` → `reliefSmooth(blob, scaleParamsForPreview(params, ratio))` → `URL.createObjectURL` → set `cleanedUrl`; on throw → `status="error"`. Revoke the previous object URL.
- A **"Re-render"** button bumps `renderTick` (immediate).
- **Export**: `reliefSmooth(fullResBlob, params)` (full-res, unscaled) → download via an `<a download="relief.png">`.
- Layout mirrors PixelArtPage: left = settings placeholder (real controls in Task 6), centre = `<ReliefCompare2D>`, right = actions (Upload, Export cleaned PNG).

**`ReliefCompare2D` props contract:**
```ts
interface ReliefCompare2DProps {
  originalUrl: string | null;   // object URL of the source depth map
  cleanedUrl: string | null;    // object URL of the cleaned PNG
  width: number; height: number; // CSS px (from a ResizeObserver host)
}
```
- Renders the two images stacked with a **draggable vertical split handle** (left = original, right = cleaned), auto-fit centred, drawn at `devicePixelRatio`.
- Empty state ("upload a depth map") when both URLs are null.

- [ ] **Step 1:** Replace the Task-4 stub — build the full `ReliefPage` + `ReliefCompare2D` to the contract via `frontend-design`. Keep `ReliefPage` a named export.
- [ ] **Step 2:** `cd web && npx tsc --noEmit` → PASS.
- [ ] **Step 3:** `cd web && npm test -- src/pages/reliefHelpers.test.ts` → still PASS (no regressions).
- [ ] **Step 4: Real-browser check.** `cd web && npm run build`; start the server (`uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`); via Playwright MCP: load `#/relief`, upload `samples/pika.png` (or any grayscale PNG), confirm the cleaned preview appears, drag the split handle, click **Export cleaned PNG** and confirm a PNG downloads. Screenshot and read it critically. Check the console for errors.
- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ReliefPage.tsx web/src/components/relief/ReliefCompare2D.tsx
git commit -m "feat(relief): Relief page MVP — smooth + 2D before/after + PNG export"
```

---

## Task 6: Smoothing controls + inspect strip  *(frontend-design)*

**Files:**
- Create: `web/src/components/relief/ReliefControls.tsx`
- Create: `web/src/components/relief/ReliefInspect.tsx`
- Modify: `web/src/pages/ReliefPage.tsx` (wire them in)

**`ReliefControls` props contract:**
```ts
interface ReliefControlsProps {
  params: ReliefParams;
  onChange: (p: ReliefParams) => void;
}
```
Controls (using `Card`/`Section`/`Field`/`NumberField` + a Radix slider):
- **Smoothing strength** — slider 1..30 → `params.strength`.
- **Preserve edges** — toggle → `params.edgePreserve`; when on, an **Edge threshold** slider 1..255 → `params.edgeThreshold` (help: "preserve drops steeper than this").
- **Remove speckle** — toggle → `params.spikeRemoval`; median window 3/5 → `params.medianKsize`.
- **Target layers (preview)** + **Z descent / layers** — captured in `ReliefParams` as informational/pass-through fields (add `targetLayers`, `zDescentPerLayers` to `ReliefParams` + `DEFAULT_RELIEF_PARAMS`; they don't affect Phase 1 smoothing, only the future export and the banding overlay).

**`ReliefInspect` props contract:**
```ts
interface ReliefInspectProps {
  originalData: ImageData | null;
  cleanedData: ImageData | null;  // from a hidden canvas of the cleaned preview
}
```
- Renders a **luminance histogram**, a **gradient-magnitude thumbnail**, and **"% pixels changed"** (fraction where `|cleaned-original| > 1`). All pure-canvas/SVG; no new deps.

- [ ] **Step 1:** Extend `ReliefParams`/`DEFAULT_RELIEF_PARAMS` in `reliefHelpers.ts` with `targetLayers: number` (default 256) and `zDescentPerLayers: number` (default 0). Run `npx vitest run src/pages/reliefHelpers.test.ts` → still PASS.
- [ ] **Step 2:** Build `ReliefControls` + `ReliefInspect` via `frontend-design` to the contracts; wire into `ReliefPage` (left = controls, right = inspect).
- [ ] **Step 3:** `cd web && npx tsc --noEmit` → PASS.
- [ ] **Step 4: Real-browser check** — rebuild, reload `#/relief`, verify each control changes the preview (strength blurs more; turning **Preserve edges** off lets a hard edge blur; threshold tunes it), and the inspect strip updates. Screenshot + read critically.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/relief/ReliefControls.tsx web/src/components/relief/ReliefInspect.tsx web/src/pages/ReliefPage.tsx web/src/pages/reliefHelpers.ts
git commit -m "feat(relief): smoothing controls + inspect strip"
```

---

## Task 7: 3D surface preview  *(frontend-design + three.js)*

**Files:**
- Modify: `web/package.json` (add `three` + `@types/three`)
- Create: `web/src/components/relief/ReliefSurface3D.tsx`
- Modify: `web/src/pages/ReliefPage.tsx` (add a 2D/3D tab toggle in the preview area)

- [ ] **Step 1: Add the dependency**

Run: `cd web && npm install three && npm install -D @types/three`
Confirm `three` lands in `dependencies` in `web/package.json`.

**`ReliefSurface3D` props + behaviour contract:**
```ts
interface ReliefSurface3DProps {
  heightData: ImageData | null;  // the surface to display
  show: "original" | "cleaned";  // which heightfield is bound (parent toggles)
  width: number; height: number; // CSS px
}
```
- **`three` is dynamically imported inside the component** (`const THREE = await import("three")`, and `OrbitControls` from `three/examples/jsm/controls/OrbitControls.js`) so Rollup code-splits it to this chunk — never import `three` at module top-level of any always-loaded file.
- Build a `PlaneGeometry(1, h/w, segX, segY)` with `segX,segY ≤ 256`; sample `heightData` (downsample to the mesh grid) into the geometry's `position.z` (normalize 0..1 × a fixed relief scale). Directional + ambient light; `OrbitControls`; `renderer.setPixelRatio(devicePixelRatio)`; resize on prop change; dispose geometry/renderer on unmount.
- Re-displace (not rebuild) when `heightData`/`show` change.

- [ ] **Step 2:** Build `ReliefSurface3D` via `frontend-design` to the contract. In `ReliefPage`, add a preview tab toggle (`2D split` | `3D surface`) and, in 3D mode, an **Original | Cleaned** toggle feeding `show`.
- [ ] **Step 3:** `cd web && npx tsc --noEmit` → PASS.
- [ ] **Step 4: Build + confirm code-split.** `cd web && npm run build`; confirm in the build output that `three` lands in a **separate chunk** (e.g. a `three-*.js` or the Relief page chunk), not in `index-*.js`. If it bloats `index`, note it for a later `manualChunks` tweak.
- [ ] **Step 5: Real-browser check** — reload `#/relief`, switch to **3D surface**, confirm the surface renders, orbits, and the **Original/Cleaned** toggle visibly flattens the noise ridges while keeping real edges crisp. Screenshot + read critically; check console.
- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/components/relief/ReliefSurface3D.tsx web/src/pages/ReliefPage.tsx
git commit -m "feat(relief): three.js 3D before/after surface (code-split)"
```

---

## Task 8: Changelog + final verification

**Files:**
- Create: `changelog/2026-05-31-relief.md` + a screenshot in `changelog/images/`

- [ ] **Step 1: Write the changelog entry (major — new page)**

```markdown
---
id: 2026-05-31-relief
date: 2026-05-31
level: major
title: Relief — depth-map smoothing
summary: Import a grayscale depth map, smooth out pixel noise and over-sharp steps while keeping real edges, and export a clean heightfield — with a live before/after and an orbitable 3D preview.
images:
  - src: relief-preview.png
    caption: A depth map before/after edge-aware smoothing, shown as a 3D surface.
---

Engraving a grayscale depth map turns each pixel's brightness into a number of
laser passes. Sensor/AI noise and dithering make that surface rough — single
pixels oscillate, gentle slopes alias into jagged terraces. **Relief** cleans
the heightfield before the machine ever sees it.

[…body: the three artifacts, the guard rail (preserve edges sharper than X, on
by default), the 2D split + 3D orbit, exporting the cleaned PNG…]
```

Drop the screenshot at `changelog/images/relief-preview.png` (capture it during Task 7's browser check).

- [ ] **Step 2: Full verification**

```bash
uv run --active pytest tests/ -q          # backend incl. relief
cd web && npx tsc --noEmit && npm test && npm run build
```
Expected: all green.

- [ ] **Step 3: Final browser walkthrough** — golden path on `#/relief` (upload → tune → 3D → export) plus a quick regression glance at `#/pixel-art` and `#/forge` (shared `router`/`App`/`TopBar` were edited). Screenshot the Relief page for the changelog.

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-05-31-relief.md changelog/images/relief-preview.png
git commit -m "docs(relief): changelog entry for the Relief page"
```

- [ ] **Step 5: PR**

```bash
git push -u origin feat/relief-depth-smoothing
gh pr create --draft --title "Relief — depth-map smoothing (Phase 1)" --body "…summary + screenshot…"
# flip to ready when CI is green:  gh pr ready
```

---

## Out of scope (separate future plans)
- **Phase 2** — `.xcs` `RELIEF` BITMAP export (feasibility confirmed in the spec §10).
- Layer-aware label-space cleanup; TV/L0 "stylized" mode; browser-worker instant preview.
