# Photo-based palette ingest for param tests

**Date:** 2026-04-17
**Status:** Design approved, pending pre-implementation validation

## Problem

Param test grids produce physical burn artifacts whose colors are currently only interpretable by eye. A user who wants "the teal I got at speed=800, power=45" has no way to query that — they must remember, re-burn, or search by hand. This prevents scaling the library of known-good param sets.

The user wants to:
1. Photograph a burned test with a phone
2. Upload the photo
3. Have the tool extract per-cell colors and store them in a queryable palette
4. Later, request a color (by hex) and get the nearest-matching param set(s) back

This also must work for gradient tests (one long stripe spanning a full color spectrum), where a single photo can produce dozens of palette entries at once.

## Non-goals

- Color calibration. The user is the final judge: if they like how the color looks in their phone photo, that's what gets stored. No reference patches, no white balance correction.
- Automatic SVG color-mapping (assign params to an arbitrary input SVG's colors). Possible future extension — explicitly out of v1.
- Spectral / material-aware analysis. A swatch is a swatch.
- Multi-test detection per photo. v1 = one param test per photo.

## High-level architecture

Processing lives **server-side** in the existing `xcs-gen serve` Python backend. The browser handles upload, preview, review, and query UX; the server handles CV (OpenCV, pyzbar-style QR decode, numpy sampling), persistence, and querying.

Rationale: OpenCV/numpy in Python are far more mature than their browser-WASM equivalents; the Python side already expresses ParamTest geometry and param semantics; upload latency is trivial for a user-triggered single shot.

## Section 1: Marker layout on the burn

Each `ParamTest` can be generated with a **registration block** on the blue-diode annotation layer (same layer that already renders test-name/param labels).

**Compact mode (default for substrates ≤ 80mm any dimension):**
- Single QR code in one corner, ~10–14mm square
- The QR does triple duty: test ID, spec payload, registration anchor (OpenCV returns all four QR corners precisely)
- No separate corner fiducials
- Trade-off: registration accuracy assumes a near-orthogonal phone shot. At steep angles, affine approximation to homography loses precision. For 25×50mm blanks shot from ~directly above, this is fine.

**Full mode (opt-in; auto-selected when both test dims > 80mm):**
- QR in one corner + 3 small ArUco markers (~4–5mm each) at the other three corners
- True 4-point homography; robust to significant perspective distortion
- Extra overhead ~5mm per edge

**Editor control:** new "Registration markers" section on the test editor with:
- Mode: `auto` | `compact` | `full` | `off`
- QR payload mode: `inline` | `id-only`

**Fallback (deferred):** If ArUco or QR burn quality on blue-diode proves marginal on certain substrates, add a "thick-cross" fiducial style as a second option. Not in v1 unless pre-validation reveals a problem.

## Section 2: QR payload format

Compact JSON with shortened keys to fit in low QR versions:

```json
{
  "v": 1,
  "id": "a1b2c3d4",
  "t": "grid",
  "x": {"p": "speed", "min": 100, "max": 5000, "n": 50},
  "y": {"p": "power", "min": 10, "max": 100, "n": 10},
  "grid": {"w": 22, "h": 44, "rows": 1, "gap": 0},
  "b": {"p": 80, "s": 230, "f": 60000, "d": 200, "r": 1, "pw": 200, "l": "red"}
}
```

**Fields:**
- `v`: schema version (lets us evolve without breaking old sheets)
- `id`: 8-char random, primary key for local spec lookup + palette attribution
- `t`: `"grid"` or `"gradient"` — drives sampler shape
- `x`, `y`: axis param name (`p`), range (`min`, `max`), step count (`n`). `y` omitted for 1D tests.
- `grid`: burn area in mm (cell region, not substrate size), plus `rows`/`gap`
- `b`: base_params (non-swept values); keys shortened (`p`=power, `s`=speed, `f`=frequency, `d`=density, `r`=repeat/passes, `pw`=pulse_width, `l`=laser)

**Size / QR version:**
- Full payload: ~250 chars → QR v6 @ ECC-M → burnable at ~12–14mm
- Drop `b` (fall back to local lookup): ~130 chars → v4 → ~10–11mm
- `id`-only (`{"v":1,"id":"..."}`): ~15 chars → v1 → ~8mm

**ID-only mode trade-off:** sheet becomes un-decodable if local spec storage is cleared. Documented; user's choice when substrate is too small for inline.

**Generation:** `segno` Python library — outputs SVG vectors, integrates directly with the existing annotation-layer SVG pipeline (no raster step).

## Section 3: Detection + sampling pipeline

Endpoint: `POST /api/capture/ingest` (multipart upload of an image).

1. **QR decode + localization.** `cv2.QRCodeDetector.detectAndDecode` returns the decoded string + 4 image-space corner points. If decode fails → return the upload as a preview image with an error suggesting a brighter/less-angled shot.

2. **Parse payload** → test spec + burn-area dimensions in mm.

3. **Perspective correction.**
   - Compact mode: 4-point homography from QR image corners → canonical burn-space pixels (10 px/mm resolution).
   - Full mode: detect 3 ArUco markers + QR corner → 4 corner references → homography.

4. **Cell sampling (grid tests).**
   - For each cell, compute its mm bounding box from the spec → pixel rect in the warped image.
   - Sample the **central 60%** of each cell to avoid edge halo and inter-cell gaps.
   - Color statistic: **median per channel** in sRGB (more robust than mean to speckle).
   - Quality signal: standard deviation in Lab space per cell. High σ = noisy/unclean burn.
   - Per-cell record: `{row, col, x_value, y_value, hex, sigma}` where `x_value`/`y_value` are the interpolated param values from the axis spec.

5. **Gradient sampling.**
   - `t: "gradient"` treats the test as one stripe sampled at N positions along the gradient axis.
   - Each sample interpolates its x_value linearly from `x.min` to `x.max`.
   - Same central-region + median + sigma treatment.

6. **Response:** `{test_id, swatches: [...], preview_url}`. `preview_url` points to a server-cached annotated overlay (warped image with sampled regions outlined and detected hex shown alongside) so the browser can show a confirmation view.

**Libraries:** `opencv-python`, `numpy`, `pillow`, `segno` (generator side).

**Testing:** `tests/fixtures/capture/` holds sample photos + expected swatch JSON. CV regressions caught headlessly via vitest-equivalent Python tests (pytest).

## Section 4: Palette storage + query

**Location:** `~/.xcs-gen/palette.json` by default. Overridable via flag/env for project-local palettes.

**Schema:**
```json
{
  "version": 1,
  "entries": [
    {
      "id": "uuid",
      "test_id": "a1b2c3d4",
      "source": "upload",
      "timestamp": "2026-04-17T10:00:00Z",
      "hex": "#c4a87b",
      "lab": [71.2, 5.1, 28.4],
      "params": {
        "power": 45, "speed": 800, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"
      },
      "sigma": 2.3,
      "notes": ""
    }
  ]
}
```

- `lab` is precomputed at ingest so queries don't recompute N times
- `sigma` retained for later filtering
- `test_id` retained so bulk delete/re-ingest by test is supported

**APIs:**
- `POST /api/palette/ingest` — append confirmed swatches from a capture run
- `GET /api/palette/query?hex=#c4a87b&limit=5` — top-N nearest by ΔE2000
- `DELETE /api/palette/{id}` — single entry
- `DELETE /api/palette/by-test/{test_id}` — clear all entries from one test
- `PATCH /api/palette/{id}` — edit notes
- `GET /api/palette` — list all (for browse UI)

**Query distance:** ΔE2000 (perceptually uniform). ~30 lines of numpy or one `colormath` dependency. Worth it over naive RGB distance. At thousands of entries a linear scan is sub-ms; no spatial index in v1.

## Section 5: Web UI flow

New **"Palette"** tab alongside existing tabs.

**Upload flow:**
1. "Upload test photo" button — `<input type="file" accept="image/*" capture="environment">` so mobile opens the camera directly.
2. POST to `/api/capture/ingest` → response renders annotated preview + swatch list.
3. Each swatch has a checkbox (all on by default); high-σ swatches pre-unchecked with a ⚠ indicator.
4. "Save N swatches" → POST to `/api/palette/ingest`.

**Error states:**
- QR decode failure → show original photo + "Couldn't read QR. Try brighter lighting or a less-angled shot."
- Partial detection → show what was detected, let user retry.

**Query flow:**
1. Hex input + color-picker preview.
2. Results list: top 5 by ΔE, each showing swatch, ΔE score, param set, source test, σ.
3. Per-match action: "Copy to new test base_params" → opens test editor with those params pre-filled.

**Palette browse:**
- Grid of all swatches, hue → lightness sorted.
- Click swatch → detail panel (params, source test, notes editable).
- Filter chips: by laser, by test_id.
- Bulk delete by test_id.

**Generator integration:**
- Test editor gains a "Registration markers" section (mode + QR mode toggles).
- On XCS export, markers + QR are laid out automatically around/inside the test on the annotation layer.

## Section 6: Scope

**In v1:**
- QR-as-anchor compact mode; full mode with 3 ArUco markers opt-in.
- `segno` QR generation → annotation-layer SVG.
- Grid + gradient sampling.
- JSON palette file with ΔE2000 query.
- Web UI: upload → review → save, query by hex, browse grid, bulk-delete by test.
- Test editor: "Registration markers" controls.

**Deferred:**
- Thick-cross fiducial fallback (unless pre-validation shows ArUco burn is marginal).
- SVG color-mapper (auto-assign params per SVG layer).
- Non-linear gradient curve fitting.
- Material/substrate tagging.
- Multi-test-per-photo detection.
- Mobile-tuned UI polish.

## Pre-implementation validation

Before committing to the full build, burn + shoot tests to validate three risks:

1. **QR legibility on blue-diode burn.** Burn a v1, v4, and v6 QR at 8mm, 11mm, and 14mm respectively on the user's standard 25×50mm metal blank. Confirm each decodes reliably from a normal phone photo.
2. **Homography accuracy in compact mode.** Photograph a burned test at 0°, 15°, 30° tilt from a phone held ~20cm above. Measure cell-center sampling error in warped coordinates. Accept if <10% of cell size at 15° (typical hand-held).
3. **ArUco detection at 4–5mm marker size.** Burn a test in full mode and confirm all 3 markers detect at the same tilt angles.

These three validations (~1 hour of lasering + a small notebook) de-risk the whole spec before writing the production pipeline.

## Build sequence (for the subsequent implementation plan)

1. QR generation on the Python side, emitted into the annotation-layer SVG pipeline.
2. "Registration markers" editor controls + wiring through to generation.
3. Pre-implementation validation burns + notebook measurements.
4. Detection pipeline: QR decode → homography → sampling.
5. `/api/capture/ingest` endpoint + server-side preview render.
6. Palette JSON store + CRUD endpoints + ΔE2000 query.
7. Web UI: Palette tab with upload, review, save, query, browse.
