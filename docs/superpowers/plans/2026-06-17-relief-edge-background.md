# Relief Edge & Background Refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give relief depth-maps a clean edge — pick the background colour (eyedropper), trim a % of the object outline, and add a non-linear edge falloff (bevel down / rim up).

**Architecture:** Three pure numpy/cv2 helpers in `relief.py`, wired into `POST /api/relief/smooth` after the existing background mask; the relief page gains an "Edge & background" control section and an eyedropper that samples an RGB from the source image. Offsets are % of the object's shorter bbox side (no mm).

**Tech Stack:** Python (numpy + cv2 + Pillow) backend; React + TS relief page; pytest + vitest.

---

## Spec

`docs/superpowers/specs/2026-06-17-relief-edge-background-design.md`

## File structure

- **Modify `src/xcs_gen_web/relief.py`** — add `parse_rgb`, `colour_background_alpha`, `trim_alpha`, `edge_falloff` (+ `__all__`). Owns: pure image ops.
- **Modify `tests/test_relief.py`** — unit tests for the four new helpers.
- **Modify `src/xcs_gen_web/app.py`** — `/api/relief/smooth` new form fields + pipeline wiring.
- **Modify `tests/test_relief_route.py`** — endpoint test for the new fields.
- **Modify `web/src/components/relief/stretch.ts`** — `StretchParams`: `bgMode`, `bgColor`, `bgTolerance`, trim, falloff fields + defaults.
- **Modify `web/src/pages/reliefHelpers.ts`** — extend `reliefSmooth` opts + new form fields; add pure `sampleRgb`.
- **Modify `web/src/pages/reliefHelpers.test.ts`** — `sampleRgb` test + `reliefSmooth` form-field test.
- **Modify `web/src/components/relief/StretchControls.tsx`** — the "Edge & background" controls.
- **Modify `web/src/pages/ReliefPage.tsx`** — build the `background` opts from params (preview + export); eyedropper sampling.
- **Create `changelog/2026-06-17-relief-edge-background.md`**.

---

### Task 1: `colour_background_alpha` + `parse_rgb` (backend)

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_relief.py`:

```python
def test_parse_rgb_parses_and_clamps():
    from xcs_gen_web.relief import parse_rgb
    assert parse_rgb("10,20,30") == (10, 20, 30)
    assert parse_rgb("300,-5,40") == (255, 0, 40)  # clamped 0..255
    assert parse_rgb("") is None
    assert parse_rgb("1,2") is None
    assert parse_rgb("a,b,c") is None


def test_colour_background_alpha_keys_picked_colour():
    from xcs_gen_web.relief import colour_background_alpha
    # BGR image: left column a known colour, right column black.
    img = np.zeros((2, 2, 3), np.uint8)
    img[:, 0] = (30, 20, 10)  # BGR → RGB (10, 20, 30)
    alpha = colour_background_alpha(img, (10, 20, 30), 5)
    assert (alpha[:, 0] == 0).all()    # picked colour → background (transparent)
    assert (alpha[:, 1] == 255).all()  # black → foreground


def test_colour_background_alpha_respects_tolerance():
    from xcs_gen_web.relief import colour_background_alpha
    img = np.zeros((1, 2, 3), np.uint8)
    img[0, 0] = (0, 0, 0)    # RGB (0,0,0)
    img[0, 1] = (0, 0, 20)   # BGR → RGB (20,0,0), distance 20 from black
    tight = colour_background_alpha(img, (0, 0, 0), 10)   # 20 > 10 → fg
    assert tight[0, 0] == 0 and tight[0, 1] == 255
    loose = colour_background_alpha(img, (0, 0, 0), 30)   # 20 <= 30 → bg
    assert loose[0, 0] == 0 and loose[0, 1] == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_relief.py -k "parse_rgb or colour_background_alpha" -q`
Expected: FAIL — `cannot import name 'parse_rgb'` / `colour_background_alpha`.

- [ ] **Step 3: Implement**

In `src/xcs_gen_web/relief.py`, add to the `__all__` list the four new names: `"parse_rgb"`, `"colour_background_alpha"`, `"trim_alpha"`, `"edge_falloff"`. Then add, after `background_alpha` (≈ line 114):

```python
def parse_rgb(s: str) -> tuple[int, int, int] | None:
    """Parse ``'r,g,b'`` (each 0..255, clamped) → tuple, or None if malformed/empty."""
    parts = str(s).split(",")
    if len(parts) != 3:
        return None
    try:
        vals = [max(0, min(255, int(round(float(p))))) for p in parts]
    except ValueError:
        return None
    return (vals[0], vals[1], vals[2])


def colour_background_alpha(
    bgr: np.ndarray, color_rgb: tuple[int, int, int], tolerance: float
) -> np.ndarray:
    """Alpha mask (uint8 0/255): background = pixels within Euclidean RGB distance
    ``tolerance`` of ``color_rgb`` (the picked background colour); foreground = 255.
    Accepts BGR / BGRA / single-channel (gray treated as R=G=B)."""
    if bgr.ndim == 2:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_GRAY2RGB)
    elif bgr.ndim == 3 and bgr.shape[2] == 4:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGRA2RGB)
    elif bgr.ndim == 3 and bgr.shape[2] == 3:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    else:
        raise ValueError(f"unsupported image shape {bgr.shape}")
    target = np.array(color_rgb, dtype=np.float32).reshape(1, 1, 3)
    dist = np.sqrt(((rgb.astype(np.float32) - target) ** 2).sum(axis=2))
    mask = dist <= float(tolerance)  # background
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(alpha)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_relief.py -k "parse_rgb or colour_background_alpha" -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): colour-key background alpha + parse_rgb"
```

---

### Task 2: `trim_alpha` (backend)

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_relief.py`:

```python
def test_trim_alpha_erodes_object_inward():
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((40, 40), np.uint8)
    alpha[10:30, 10:30] = 255            # 20×20 square (short side 20)
    out = trim_alpha(alpha, 10)          # 10% of 20 → radius 2 → shave a 2px ring
    assert out[10, 10] == 0              # corner shaved off
    assert out[20, 20] == 255            # centre kept
    assert int((out > 0).sum()) < int((alpha > 0).sum())


def test_trim_alpha_noop_and_clamp():
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((40, 40), np.uint8)
    alpha[18:22, 18:22] = 255            # 4×4 square
    assert (trim_alpha(alpha, 0) == alpha).all()    # pct 0 → identity
    assert (trim_alpha(alpha, 90) == alpha).all()   # would empty → clamp to input
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_relief.py -k trim_alpha -q`
Expected: FAIL — `cannot import name 'trim_alpha'`.

- [ ] **Step 3: Implement**

In `src/xcs_gen_web/relief.py`, add after `colour_background_alpha`:

```python
def trim_alpha(alpha: np.ndarray, pct: float) -> np.ndarray:
    """Erode the foreground (``alpha > 0``) inward by ``pct``% of the object's
    shorter bbox side, shaving a fuzzy border. No-op for ``pct <= 0`` or a
    sub-pixel radius; clamps (returns the input) if the erosion would empty the
    object — never erase it."""
    if alpha.ndim != 2:
        raise ValueError("trim_alpha expects a single-channel alpha")
    if pct <= 0:
        return alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    radius = int(round(pct / 100.0 * short))
    if radius < 1:
        return alpha
    k = 2 * radius + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    eroded = cv2.erode(fg, kernel, iterations=1)
    if not eroded.any():
        return alpha  # clamp: never erase the whole object
    return np.ascontiguousarray(np.where(eroded > 0, 255, 0).astype(np.uint8))
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_relief.py -k trim_alpha -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): trim_alpha — erode the object outline by a %"
```

---

### Task 3: `edge_falloff` (backend)

**Files:**
- Modify: `src/xcs_gen_web/relief.py`
- Test: `tests/test_relief.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_relief.py`:

```python
def test_edge_falloff_down_bevels_to_floor():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((40, 40), 200, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[5:35, 5:35] = 255                       # 30×30 object (short side 30)
    out = edge_falloff(gray, alpha, 20, "down")   # band = 6 px
    assert out[5, 20] < 80                          # edge ramped toward the floor
    assert out[20, 20] == 200                       # centre (beyond band) unchanged
    row = out[20, 5:21].astype(int)                 # edge → centre along a row
    assert (np.diff(row) >= 0).all()                # monotonic non-decreasing


def test_edge_falloff_up_and_noop():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((40, 40), 100, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[5:35, 5:35] = 255
    up = edge_falloff(gray, alpha, 20, "up")
    assert up[5, 20] > 180                           # edge ramped toward the peak
    assert (edge_falloff(gray, alpha, 0, "down") == gray).all()  # pct 0 → identity
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_relief.py -k edge_falloff -q`
Expected: FAIL — `cannot import name 'edge_falloff'`.

- [ ] **Step 3: Implement**

In `src/xcs_gen_web/relief.py`, add after `trim_alpha`:

```python
def edge_falloff(
    gray: np.ndarray, alpha: np.ndarray, pct: float, direction: str = "down"
) -> np.ndarray:
    """Ramp the height within a band of ``pct``% of the object's shorter bbox side
    just inside the foreground boundary, via smoothstep, toward a target:
    ``"down"`` → 0 (bevel to floor), ``"up"`` → 255 (rim to peak). Background
    (``alpha == 0``) is untouched. No-op for ``pct <= 0`` or a sub-pixel band."""
    if gray.ndim != 2 or alpha.ndim != 2:
        raise ValueError("edge_falloff expects single-channel gray + alpha")
    if pct <= 0:
        return gray
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return gray
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    band = pct / 100.0 * short
    if band < 1:
        return gray
    dist = cv2.distanceTransform(fg, cv2.DIST_L2, 3)
    t = np.clip(dist / band, 0.0, 1.0)
    c = t * t * (3.0 - 2.0 * t)  # smoothstep — zero-slope at both ends
    target = 255.0 if str(direction) == "up" else 0.0
    g = gray.astype(np.float32)
    blended = target + (g - target) * c
    out = np.where(fg > 0, np.rint(blended), g)
    return np.ascontiguousarray(np.clip(out, 0, 255).astype(np.uint8))
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_relief.py -k edge_falloff -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/relief.py tests/test_relief.py
git commit -m "feat(relief): edge_falloff — smoothstep bevel/rim at the object edge"
```

---

### Task 4: Wire the helpers into `/api/relief/smooth`

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Test: `tests/test_relief_route.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_relief_route.py`:

```python
def _png_rgb(w=48, h=48):
    from PIL import Image as _I
    buf = BytesIO()
    img = _I.new("RGB", (w, h), (0, 0, 0))      # black background
    for y in range(12, 36):                       # a mid-grey square object
        for x in range(12, 36):
            img.putpixel((x, y), (150, 150, 150))
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_relief_smooth_colour_trim_falloff_returns_la_png():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={
            "smooth": "false",
            "remove_bg": "true",
            "bg_mode": "colour",
            "bg_color": "0,0,0",      # key out the black background
            "bg_tolerance": "20",
            "trim_pct": "5",
            "falloff_pct": "10",
            "falloff_dir": "down",
        },
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "LA"            # grayscale + alpha
    assert out.size == (48, 48)
    # the keyed background is transparent
    assert out.getpixel((2, 2))[1] == 0


def test_relief_smooth_colour_mode_without_colour_is_opaque():
    client = TestClient(create_app())
    resp = client.post(
        "/api/relief/smooth",
        files={"file": ("depth.png", _png_rgb(), "image/png")},
        data={"smooth": "false", "remove_bg": "true", "bg_mode": "colour", "bg_color": ""},
    )
    assert resp.status_code == 200
    out = Image.open(BytesIO(resp.content))
    assert out.mode == "L"             # nothing picked → no alpha, plain L PNG
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --active pytest tests/test_relief_route.py -k "colour" -q`
Expected: FAIL — `bg_mode`/`bg_color` not handled (colour test gets an `L` PNG with no transparency, or LA-mode assertion fails).

- [ ] **Step 3: Implement**

In `src/xcs_gen_web/app.py`, extend the `from .relief import (...)` block (≈ line 85) to also import `colour_background_alpha`, `trim_alpha`, `edge_falloff`, `parse_rgb`.

Replace the `relief_smooth` signature's background params — delete `bg_high: bool = Form(False)` and add:

```python
        bg_mode: str = Form("dark"),
        bg_color: str = Form(""),
        bg_tolerance: float = Form(40.0),
        trim_pct: float = Form(0.0),
        falloff_pct: float = Form(0.0),
        falloff_dir: str = Form("down"),
```

Replace the background block (currently the `if remove_bg:` / `else:` at ≈ lines 941–947) with:

```python
        alpha = None
        if remove_bg:
            if bg_mode == "colour":
                color = parse_rgb(bg_color)
                if color is not None:
                    alpha = colour_background_alpha(
                        bgr, color, max(0.0, min(441.0, bg_tolerance))
                    )
                # color is None → nothing picked yet: leave alpha None (no removal)
            else:
                alpha = background_alpha(
                    out, threshold=max(0, min(255, bg_threshold)),
                    high=(bg_mode == "bright"),
                )
        if alpha is not None:
            if trim_pct > 0:
                alpha = trim_alpha(alpha, trim_pct)
            if falloff_pct > 0:
                out = edge_falloff(out, alpha, falloff_pct, falloff_dir)
            png = encode_png_la(out, alpha)
        else:
            png = encode_png(out)
```

(`bgr` is already decoded above via `decode_image_bytes`; trim runs before falloff so the falloff band is measured from the trimmed edge.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --active pytest tests/test_relief_route.py -q`
Expected: PASS (all relief-route tests, incl. the two new ones and the existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/app.py tests/test_relief_route.py
git commit -m "feat(relief): /api/relief/smooth — bg mode/colour, trim, falloff"
```

---

### Task 5: FE params + `reliefSmooth` wrapper + `sampleRgb`

**Files:**
- Modify: `web/src/components/relief/stretch.ts`
- Modify: `web/src/pages/reliefHelpers.ts`
- Test: `web/src/pages/reliefHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/pages/reliefHelpers.test.ts`:

```ts
import { sampleRgb, reliefSmooth } from "./reliefHelpers";

describe("sampleRgb", () => {
  it("reads the RGB at a fractional position", () => {
    // 2×1 image: left red, right blue.
    const data = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1);
    expect(sampleRgb(data, 0.0, 0.0)).toEqual([255, 0, 0]);
    expect(sampleRgb(data, 0.99, 0.0)).toEqual([0, 0, 255]);
  });
  it("clamps out-of-range fractions", () => {
    const data = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
    expect(sampleRgb(data, -5, 9)).toEqual([1, 2, 3]);
  });
});

describe("reliefSmooth background fields", () => {
  it("posts bg mode/colour/trim/falloff form fields", async () => {
    let sent: FormData | null = null;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return { ok: true, blob: async () => new Blob() } as Response;
    }) as typeof fetch;
    try {
      await reliefSmooth(new Blob(), {
        strength: 8, edgePreserve: true, edgeThreshold: 40, spikeRemoval: true,
        medianKsize: 3, smoothEnabled: true,
      }, {
        background: {
          mode: "colour", threshold: 8, color: [10, 20, 30], tolerance: 25,
          trimPct: 3, falloffPct: 7, falloffDir: "up",
        },
      });
    } finally {
      globalThis.fetch = orig;
    }
    expect(sent!.get("remove_bg")).toBe("true");
    expect(sent!.get("bg_mode")).toBe("colour");
    expect(sent!.get("bg_color")).toBe("10,20,30");
    expect(sent!.get("bg_tolerance")).toBe("25");
    expect(sent!.get("trim_pct")).toBe("3");
    expect(sent!.get("falloff_pct")).toBe("7");
    expect(sent!.get("falloff_dir")).toBe("up");
  });
});
```

(The `ReliefParams` shape passed above matches the existing interface in `reliefHelpers.ts`; check the field names there and match them exactly.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts`
Expected: FAIL — `sampleRgb` not exported; `reliefSmooth` doesn't post the new fields.

- [ ] **Step 3: Implement — `stretch.ts`**

In `web/src/components/relief/stretch.ts`, in `interface StretchParams` replace the line `bgHigh: boolean;` with:

```ts
  /** Background removal method. */
  bgMode: "dark" | "bright" | "colour";
  /** Picked background colour (RGB) for `colour` mode; null until sampled. */
  bgColor: [number, number, number] | null;
  /** Euclidean RGB distance for `colour` mode (0..441). */
  bgTolerance: number;
  /** Trim (erode) the object outline by trimPct% of its shorter side. */
  trimEnabled: boolean;
  trimPct: number;
  /** Non-linear edge falloff over falloffPct% of the shorter side. */
  falloffEnabled: boolean;
  falloffPct: number;
  falloffDir: "down" | "up";
```

In `DEFAULT_STRETCH_PARAMS` replace `bgHigh: false,` with:

```ts
  bgMode: "dark",
  bgColor: null,
  bgTolerance: 40,
  trimEnabled: false,
  trimPct: 2,
  falloffEnabled: false,
  falloffPct: 5,
  falloffDir: "down",
```

- [ ] **Step 4: Implement — `reliefHelpers.ts`**

In `web/src/pages/reliefHelpers.ts`, change the `reliefSmooth` `opts.background` type and the field appends. Replace the `background?: { threshold: number; high: boolean };` opt type with:

```ts
    background?: {
      mode: "dark" | "bright" | "colour";
      threshold: number;
      color: [number, number, number] | null;
      tolerance: number;
      trimPct: number;    // 0 = off
      falloffPct: number; // 0 = off
      falloffDir: "down" | "up";
    };
```

Replace the `if (opts?.background) { ... }` block with:

```ts
  if (opts?.background) {
    const b = opts.background;
    fd.append("remove_bg", "true");
    fd.append("bg_mode", b.mode);
    fd.append("bg_threshold", String(b.threshold));
    if (b.color) fd.append("bg_color", b.color.join(","));
    fd.append("bg_tolerance", String(b.tolerance));
    fd.append("trim_pct", String(b.trimPct));
    fd.append("falloff_pct", String(b.falloffPct));
    fd.append("falloff_dir", b.falloffDir);
  }
```

Add the pure helper (export it) at the end of the file:

```ts
/** RGB at a fractional (0..1) position in an ImageData. Fractions are clamped to
 *  [0,1); used by the eyedropper to map a click on the source image to a pixel. */
export function sampleRgb(
  data: ImageData,
  fracX: number,
  fracY: number,
): [number, number, number] {
  const cx = Math.min(0.999999, Math.max(0, fracX));
  const cy = Math.min(0.999999, Math.max(0, fracY));
  const x = Math.min(data.width - 1, Math.floor(cx * data.width));
  const y = Math.min(data.height - 1, Math.floor(cy * data.height));
  const i = (y * data.width + x) * 4;
  return [data.data[i], data.data[i + 1], data.data[i + 2]];
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run src/pages/reliefHelpers.test.ts && npx tsc --noEmit`
Expected: the new tests pass. tsc will report errors in `StretchControls.tsx` / `ReliefPage.tsx` because they still reference `bgHigh` — that is expected and fixed in Tasks 6–7. Confirm the ONLY tsc errors are `bgHigh`-related in those two files; if so, proceed.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/relief/stretch.ts web/src/pages/reliefHelpers.ts web/src/pages/reliefHelpers.test.ts
git commit -m "feat(relief): FE params + reliefSmooth fields + sampleRgb"
```

---

### Task 6: "Edge & background" controls (StretchControls)

**Files:**
- Modify: `web/src/components/relief/StretchControls.tsx`

- [ ] **Step 1: Replace the background controls**

Find the existing background block in `web/src/components/relief/StretchControls.tsx` (the `params.removeBackground` checkbox + the `bgThreshold` slider + the `bgHigh` checkbox, ≈ lines 195–216). Replace from the `removeBackground` checkbox through the end of that background group with the markup below. It adds: a mode `<select>`; for `dark`/`bright` the existing threshold slider; for `colour` an eyedropper button (calls the new `onPickColor` prop), a swatch, and a tolerance slider; then the Trim and Falloff groups. Keep using the file's existing `Slider`, `Field`, `Checkbox`/toggle and `set(...)` helpers (match how the surrounding controls are written).

```tsx
        <Checkbox
          label="Remove background"
          checked={params.removeBackground}
          onChange={(v) => set("removeBackground", v)}
        />
        {params.removeBackground && (
          <>
            <Field label="Method">
              <select
                className="w-full rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                value={params.bgMode}
                onChange={(e) => set("bgMode", e.target.value as "dark" | "bright" | "colour")}
              >
                <option value="dark">Dark threshold</option>
                <option value="bright">Bright threshold</option>
                <option value="colour">Pick colour</option>
              </select>
            </Field>

            {params.bgMode !== "colour" ? (
              <Slider
                label="Threshold"
                value={params.bgThreshold}
                min={0}
                max={255}
                step={1}
                onChange={(v) => set("bgThreshold", v)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onPickColor}
                    className="rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-primary)]/50"
                  >
                    Pick from image
                  </button>
                  <span
                    className="inline-block h-5 w-5 rounded-[4px] border border-[var(--color-border)]"
                    style={{ background: params.bgColor ? `rgb(${params.bgColor.join(",")})` : "transparent" }}
                    aria-hidden
                  />
                  <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                    {params.bgColor ? params.bgColor.join(", ") : "no colour picked"}
                  </span>
                </div>
                <Slider
                  label="Tolerance"
                  value={params.bgTolerance}
                  min={0}
                  max={200}
                  step={1}
                  onChange={(v) => set("bgTolerance", v)}
                />
              </>
            )}

            <Checkbox
              label="Trim outline"
              checked={params.trimEnabled}
              onChange={(v) => set("trimEnabled", v)}
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

            <Checkbox
              label="Edge falloff"
              checked={params.falloffEnabled}
              onChange={(v) => set("falloffEnabled", v)}
            />
            {params.falloffEnabled && (
              <>
                <Field label="Direction">
                  <select
                    className="w-full rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                    value={params.falloffDir}
                    onChange={(e) => set("falloffDir", e.target.value as "down" | "up")}
                  >
                    <option value="down">Down — bevel to floor</option>
                    <option value="up">Up — rim to peak</option>
                  </select>
                </Field>
                <Slider
                  label="Falloff %"
                  value={params.falloffPct}
                  min={0}
                  max={50}
                  step={0.5}
                  onChange={(v) => set("falloffPct", v)}
                />
              </>
            )}
          </>
        )}
```

- [ ] **Step 2: Add the `onPickColor` prop**

In `StretchControlsProps` (≈ line 16) add `onPickColor: () => void;`. Destructure it in the component signature alongside the existing props. (Use the exact `Checkbox` component name the file already uses — if it uses a local `Toggle`/`Checkbox`, match it; if checkboxes are inline, follow that pattern.)

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: errors now only in `ReliefPage.tsx` (it must pass `onPickColor` and still references `bgHigh`/old background opts) — fixed in Task 7. Confirm StretchControls itself is clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/relief/StretchControls.tsx
git commit -m "feat(relief): Edge & background controls (mode, trim, falloff, swatch)"
```

---

### Task 7: ReliefPage wiring + eyedropper

**Files:**
- Modify: `web/src/pages/ReliefPage.tsx`

- [ ] **Step 1: Build the `background` opts from params**

In `web/src/pages/ReliefPage.tsx` there are two `reliefSmooth(...)` calls (the debounced preview, ≈ line 168, and `onExport`, ≈ line 374) that build `background: stretchParams.removeBackground ? { threshold, high } : undefined`. Add a helper near the top of the component and use it at BOTH call sites:

```tsx
  const bgOpts = useCallback(() =>
    stretchParams.removeBackground
      ? {
          mode: stretchParams.bgMode,
          threshold: stretchParams.bgThreshold,
          color: stretchParams.bgColor,
          tolerance: stretchParams.bgTolerance,
          trimPct: stretchParams.trimEnabled ? stretchParams.trimPct : 0,
          falloffPct: stretchParams.falloffEnabled ? stretchParams.falloffPct : 0,
          falloffDir: stretchParams.falloffDir,
        }
      : undefined,
  [
    stretchParams.removeBackground, stretchParams.bgMode, stretchParams.bgThreshold,
    stretchParams.bgColor, stretchParams.bgTolerance, stretchParams.trimEnabled,
    stretchParams.trimPct, stretchParams.falloffEnabled, stretchParams.falloffPct,
    stretchParams.falloffDir,
  ]);
```

Replace both inline `background: stretchParams.removeBackground ? {...} : undefined` expressions with `background: bgOpts()`.

- [ ] **Step 2: Add the new params to the debounced preview deps**

The preview effect (≈ line 205–219) lists `stretchParams.*` in its dependency array. Add the new fields so a change re-runs the smooth: `stretchParams.bgMode`, `stretchParams.bgColor`, `stretchParams.bgTolerance`, `stretchParams.trimEnabled`, `stretchParams.trimPct`, `stretchParams.falloffEnabled`, `stretchParams.falloffPct`, `stretchParams.falloffDir`. Remove the now-deleted `stretchParams.bgHigh` from the deps.

- [ ] **Step 3: Eyedropper sampling state + handler**

Add state and a handler. `originalData` (the source `ImageData`, colour-preserving) already exists on the page.

```tsx
  const [pickingColor, setPickingColor] = useState(false);
```

Handler for a click on the source preview image (attach to the element that shows the source — the same element/canvas `ReliefInspect` or the source `<img>` uses; if it's an `<img>`/`<canvas>`, wrap it so the click maps to its box):

```tsx
  const onSourceClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!pickingColor || !originalData) return;
    const r = e.currentTarget.getBoundingClientRect();
    const rgb = sampleRgb(originalData, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    setStretchParams((p) => ({ ...p, bgColor: rgb, bgMode: "colour", removeBackground: true }));
    setPickingColor(false);
  }, [pickingColor, originalData]);
```

Pass `onPickColor={() => setPickingColor(true)}` to `<StretchControls>`. Attach `onClick={onSourceClick}` (and, when `pickingColor`, `style={{ cursor: "crosshair" }}`) to the source-preview element. Import `sampleRgb` from `./reliefHelpers`.

- [ ] **Step 4: Typecheck + full FE tests + build**

Run: `cd web && npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all tests pass, build succeeds.

- [ ] **Step 5: Browser-verify (CLAUDE.md requires a real-browser check)**

Start/confirm the server, load `http://127.0.0.1:8017/#/relief`, upload a depth map with a fuzzy border and (separately) one with a coloured background. Verify: Method select (dark/bright/colour); in *colour* mode the eyedropper picks a colour (swatch updates) and the background drops out; *Trim outline* shaves the fuzzy ring; *Edge falloff* down bevels the edge / up raises a rim in the 3D surface; turning each off restores prior output. Screenshot and read it critically.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ReliefPage.tsx
git commit -m "feat(relief): wire edge/background params + eyedropper into the page"
```

---

### Task 8: Changelog + final verification

**Files:**
- Create: `changelog/2026-06-17-relief-edge-background.md`

- [ ] **Step 1: Write the changelog**

Create `changelog/2026-06-17-relief-edge-background.md`:

```markdown
---
id: 2026-06-17-relief-edge-background
date: 2026-06-17
level: minor
title: Relief — colour-pick background, outline trim, and a soft edge
summary: Background removal can now key on a colour you pick from the image with an eyedropper (not just a dark/bright threshold). A new "Trim outline" shaves a % off the object edge to remove the fussy border background removal leaves behind, and "Edge falloff" gives the object a smooth, non-linear bevel down to the floor (or a raised rim) instead of a vertical cliff.
---
```

- [ ] **Step 2: Final verification**

Run: `uv run --active pytest tests/test_relief.py tests/test_relief_route.py -q && cd web && npx tsc --noEmit && npm test && npm run build`
Expected: backend relief tests pass, tsc clean, FE tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add changelog/2026-06-17-relief-edge-background.md
git commit -m "docs(changelog): relief edge & background refinement"
```

---

## Self-review notes (author)

- **Spec coverage:** colour pick (Task 1 + endpoint Task 4 + UI Tasks 6/7), trim (Task 2 + 4 + 6/7), falloff (Task 3 + 4 + 6/7), % of shorter side (in each helper), pipeline order mask→trim→falloff (Task 4 block), eyedropper (Task 7), `removeBackground` master enable + trim/falloff only with a mask (Task 4: `alpha is not None` gate), defaults preserve current output when off (Tasks 5 defaults + 4 `pct>0` gates). Testing per layer present.
- **Type/name consistency:** `bg_mode`/`bg_color`/`bg_tolerance`/`trim_pct`/`falloff_pct`/`falloff_dir` identical across `reliefHelpers.ts` (append), `app.py` (Form), and tests; `StretchParams` field names (`bgMode`, `bgColor`, `bgTolerance`, `trimEnabled`/`trimPct`, `falloffEnabled`/`falloffPct`/`falloffDir`) used identically in stretch.ts, StretchControls, ReliefPage; `sampleRgb`, `colour_background_alpha`, `trim_alpha`, `edge_falloff`, `parse_rgb` signatures match between definition, tests, and call sites.
- **No placeholders:** every code step is complete. The two FE-UI tasks (6/7) instruct matching the file's existing `Slider`/`Checkbox`/`set` helpers because those are local conventions — the implementer must read the file; the markup provided is concrete.
- **`bgHigh` removal:** dropped from `StretchParams`, the endpoint, and the FE opts; `bg_mode === "bright"` replaces it. Internal FE↔BE only, no external callers.
