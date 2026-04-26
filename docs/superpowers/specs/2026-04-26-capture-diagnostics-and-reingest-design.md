# Capture diagnostics + per-result reingest

**Date:** 2026-04-26
**Status:** design — pending implementation plan
**Surface area:**
- Backend: `src/xcs_gen_web/capture_pipeline.py`, `src/xcs_gen_web/services/capture.py`, `src/xcs_gen_web/repositories/results.py`, `src/xcs_gen_web/models.py`, `src/xcs_gen_web/schemas.py`, `src/xcs_gen_web/app.py`, `alembic/versions/0011_*.py`, `.github/workflows/ci.yml`.
- Frontend: result-row component on the test detail page, swatch-panel banner, API client, type for `ResultResponse.missing_markers`.

## Goal

Today the capture pipeline silently produces wrong colours when one of the
three ArUco fiducials fails to detect. Confirmed against `samples/Unknown.jpg`
(test #23 on prod): ArUco ID 1 missing → homography under-constrained in the
TR direction → sample grid drifts off the burn pattern → ~half the cells read
the substrate gap as their colour, producing the gray-cluster pattern the user
flagged in the swatch panel.

This spec ships three coupled changes on one feature branch:

1. **(B) Stronger fiducial detection.** Add CLAHE + adaptive-threshold
   preprocessing variants so the ArUco/QR detectors recover photos with uneven
   lighting, glare on one quadrant, or low local contrast.
2. **(A) Surface missing-marker info.** When detection still misses a marker,
   plumb that signal through to a persisted `missing_markers` field on the
   result row, then surface it visibly in the UI (row pill + swatch-panel
   banner) so the user knows the colours near that corner are unreliable.
3. **Per-result reingest.** A new `POST /api/results/{rid}/reingest` endpoint
   reads the saved photo bytes and re-runs capture with the current
   detection logic and the test's current spec, then replaces
   `swatches_json` + `missing_markers_json` on the row. UI: a small `↻
   Reingest` button on each result row.

These three are scoped to ship together because they're complementary: (B)
reduces how often (A) fires, (A) makes silent failures visible, and reingest
lets users re-run their existing photos through the better detection without
losing the upload.

## Non-goals

- Per-test bulk reingest. Per-result is the primary surface; bulk can be a
  follow-up if it ever feels useful.
- Storing the warped image alongside the result. Still recomputed in
  memory per capture; reingest doesn't change this.
- Visual overlay (sample-grid markers) on the saved result image. That
  belongs in a future "diagnostic view" feature.
- Auto-reingest on detection-code releases. There's no good signal to
  trigger this on; user-driven only.
- Backfilling `missing_markers` on existing rows during the migration.
  Existing rows get the default `[]` and update on next reingest. Running
  detection across every historical photo is expensive and unnecessary
  — users can re-run the photos they care about.

## Design

### 1. Stronger fiducial preprocessing — `capture_pipeline.py`

`_preprocessing_variants(gray: np.ndarray) -> list[np.ndarray]` currently
returns `[gray, otsu(blurred(gray))]`. Extend to four variants, in this
order (cheapest first; the detector loops short-circuit when enough
markers are found, per `_qr_polygon_raw` and `_aruco_centres_px`):

1. `gray` (raw) — current behaviour, unchanged. Fast, works for crisp
   well-lit shots.
2. `otsu(blurred(gray))` — current second variant, unchanged. Rescues
   shots with mid-tone burns on stainless.
3. **CLAHE** — `cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))`
   applied to `gray`. Local-contrast equalisation; normalises uneven
   lighting across the photo, which is the most common cause of ArUco
   detection failure in this codebase (one corner of the disc gets less
   flash than the other).
4. **Adaptive threshold (mean-C)** —
   `cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
   cv2.THRESH_BINARY, blockSize=51, C=10)`. Different mechanism from
   Otsu — adapts threshold per-region rather than picking one global
   threshold. Catches photos where Otsu picks a bad split because of a
   bright background highlight.

Both new variants are O(image-pixels) and run once per detection. On
the 4032×3024 phone photos this codebase handles, CLAHE adds ~50ms and
adaptive-threshold ~100ms — negligible against the multi-second
homography + sample pipeline.

The `_aruco_centres_px` and `_qr_polygon_raw` loops already handle
"any marker found across any variant" via the merge-into-out
dictionary; nothing in those callers needs to change. A unit test on
`_preprocessing_variants` will pin the expected count (4) so a future
edit doesn't accidentally drop a variant.

### 2. Missing-marker plumbing

#### 2a. `services/capture.py` — `CaptureResult`

Add a new field:

```python
@dataclass
class CaptureResult:
    swatches: list[dict[str, Any]]
    warped_image_bgr: np.ndarray
    retest_index: int = 0
    missing_markers: list[int] = field(default_factory=list)  # NEW
```

Compute inside `run_capture` after `detect_fiducials`:

```python
expected_arucos = {1, 2, 3}
detected = set(corners_px.keys()) & expected_arucos
missing_markers = sorted(expected_arucos - detected)
```

Pass through to the return value. Don't raise — the homography is still
solved if at least 4 anchors are present, which the existing
`warp_to_burn_space` enforces.

#### 2b. Database — new column

Migration `alembic/versions/0011_add_results_missing_markers.py`:

```python
def upgrade():
    op.add_column(
        "results",
        sa.Column("missing_markers_json", sa.Text, nullable=False, server_default="[]"),
    )

def downgrade():
    op.drop_column("results", "missing_markers_json")
```

`models.py` `results` table gains the matching column declaration.

CI assertion at `.github/workflows/ci.yml::mysql-migration-test` line
144 must update to `test "$VER" = "0011"` in the same commit. (CLAUDE.md
gotcha: this is hardcoded.)

#### 2c. `repositories/results.py`

- `create()` accepts `missing_markers: list[int] = ()`, serialises to
  JSON for the new column.
- `get()`, `list_for_test()`, `list_recent_for_user()` deserialise on
  read into `result["missing_markers"]: list[int]`.
- New `replace_capture(rid: int, swatches: list[dict], missing_markers: list[int]) -> dict | None`
  — UPDATE on `swatches_json` + `missing_markers_json`, returns the
  refreshed row. Used by the reingest endpoint.

#### 2d. `schemas.py` — `ResultResponse`

Add `missing_markers: list[int] = []`. Backward-compatible default for
old API consumers; new column reads cleanly into the new field.

#### 2e. `app.py` — `_persist_upload`

Pass `missing_markers=cap_result.missing_markers` to `r_repo.create`.
Plumb through to `_result_to_response` so the API returns the field.

### 3. Per-result reingest endpoint

#### 3a. `app.py`

```python
@app.post("/api/results/{rid}/reingest", response_model=ResultResponse)
def results_reingest(
    rid: int, user_id: int = Depends(get_current_user),
) -> ResultResponse:
    """Re-run the capture pipeline against the result's saved photo.

    Replaces ``swatches_json`` and ``missing_markers_json`` on the row
    using the current detection code and the test's current spec.
    Useful after detection improvements, after retest spec edits, or
    when the user wants to verify a previously-flagged result is now
    accurate.
    """
    r = r_repo.get(rid, owner_id=user_id)
    if r is None:
        raise HTTPException(status_code=404, detail="result not found")
    t = t_repo.get(r["test_id"], owner_id=user_id)
    if t is None:  # shouldn't happen if the row exists, but defend.
        raise HTTPException(status_code=404, detail="test not found")
    try:
        data = images.read(r["image_path"])
    except FileNotFoundError:
        raise HTTPException(
            status_code=410,
            detail="source image no longer available — cannot reingest",
        )
    try:
        cap = capture_service.run_capture(
            image_bytes=data, test_id=r["test_id"], spec=t["spec"],
        )
    except capture_service.CaptureError as e:
        raise HTTPException(status_code=400, detail=str(e))
    refreshed = r_repo.replace_capture(
        rid, swatches=cap.swatches, missing_markers=cap.missing_markers,
    )
    return _result_to_response(refreshed)
```

The auth check via `r_repo.get(rid, owner_id=user_id)` already
enforces wrong-owner returns 404. No additional permission gate
needed.

#### 3b. `images.read(path)` — small helper

`src/xcs_gen_web/images.py` already has `save()` and the storage
dispatcher. It needs a corresponding `read(path: str) -> bytes` that
calls the same dispatcher (filesystem or S3). Verify whether this
already exists; add if not. Raises `FileNotFoundError` if the storage
backend reports missing — the endpoint maps that to 410.

### 4. UI surface

#### 4a. Type updates

`web/src/api/results.ts` (or wherever `ResultResponse` is typed): add
`missing_markers: number[]` to the type. Add `reingestResult(rid:
number): Promise<ResultResponse>` API client.

#### 4b. Result row — pill + reingest button

In the result row component on the test detail page:

- When `missing_markers.length > 0`, render a small ⚠ pill next to the
  retest index / upload time. Tooltip:
  `"1 marker missing — colours near {corner} may be inaccurate"`.
  The pill uses the existing warning-tint design (`color-warn` /
  `color-warn-tint` if defined, otherwise the muted-foreground +
  warning-icon pattern used elsewhere).
- An icon-only `↻` button next to the existing per-result controls
  (delete, exclude). Tooltip: `"Reingest — re-run capture on the saved
  photo"`. On click: call `reingestResult(rid)`, show inline spinner,
  on success refetch the test's results so the swatch panel + pill
  refresh. On error: toast the API error message verbatim.

Map ArUco IDs to corner names for the tooltip:

```ts
const CORNER_NAMES: Record<number, string> = {
  1: "top-right",
  2: "bottom-left",
  3: "bottom-right",
};
```

#### 4c. Swatch panel banner

When the currently-displayed result has `missing_markers.length > 0`,
render a single-line banner above the swatch grid:

> ⚠ 1 of 3 ArUco markers missing on this photo (top-right). Colours
> near that corner may be inaccurate. Reingest after retaking.

Multiple-marker case: list the corners (`"top-right and bottom-left"`).
The banner uses the same warning palette as the row pill.

When the active result has no missing markers, the banner is absent
(no "all good" state — the absence of the warning is the all-good
state).

### 5. Error handling

| Failure mode | Endpoint behaviour |
|---|---|
| Result row not found / wrong owner | 404 (existing repo pattern). |
| Test row not found | 404 (defensive). |
| Source image gone (FS or S3) | 410 Gone with `"source image no longer available — cannot reingest"`. UI toasts verbatim. |
| `run_capture` raises `CaptureError` (no QR, homography fails, etc.) | 400 with the exception message. UI toasts verbatim. Row is not modified. |
| DB write fails | 500 from the framework default. Row is not modified (single UPDATE, atomic). |

### 6. Testing

**Unit (Python, `tests/`)**

- `test_capture_pipeline.py::test_preprocessing_variants_count`: assert
  `len(_preprocessing_variants(np.zeros((100, 100), dtype=np.uint8))) == 4`.
- `test_capture_pipeline.py::test_preprocessing_variants_shapes`: each
  returned array is the same shape as the input.
- `test_capture_service.py::test_run_capture_populates_missing_markers`:
  monkeypatch `_aruco_centres_px` to return only `{2: ..., 3: ...}`,
  assert the resulting `CaptureResult.missing_markers == [1]`.

**Integration (Python, `tests/`)**

- `test_results_endpoint.py::test_reingest_happy_path`: upload a photo
  via the existing fixture path, then `POST /api/results/{rid}/reingest`,
  assert 200 + `swatches` shape unchanged + `missing_markers` field
  present on the response.
- `test_results_endpoint.py::test_reingest_missing_image_returns_410`:
  delete the saved file directly on disk between create and reingest;
  assert 410.
- `test_results_endpoint.py::test_reingest_wrong_owner_returns_404`:
  user A creates a result; user B's reingest call returns 404.

**Migration (Python, smoke)**

- `test_migrations.py` (or equivalent if it exists): `alembic upgrade
  head` succeeds; the new column exists on `results` and is nullable=False
  with the `[]` default.

**Vitest (frontend, `web/src/**/*.test.ts`)**

- Result row renders the ⚠ pill iff `missing_markers.length > 0`;
  tooltip names the right corners.
- Swatch panel renders the banner iff the active result has missing
  markers.
- Reingest button click calls the API stub and triggers a refetch.

**Manual**

- Re-run `/tmp/diag_capture.py` (the diagnostic from the brainstorm)
  with the new `_preprocessing_variants`. Either ArUco 1 is now found
  (warp aligns, swatches look correct), OR it's still missed and the
  resulting `missing_markers` lists `[1]`.
- On a local server: upload `samples/Unknown.jpg` against test #23,
  see the row pill + banner, click `↻ Reingest`, watch the swatches
  refresh.

### 7. Files touched

| Path | Action |
|---|---|
| `src/xcs_gen_web/capture_pipeline.py` | Modify `_preprocessing_variants`. |
| `src/xcs_gen_web/services/capture.py` | `CaptureResult.missing_markers`; `run_capture` populates it. |
| `src/xcs_gen_web/models.py` | New column. |
| `src/xcs_gen_web/repositories/results.py` | `create()` arg + serialisation; `replace_capture()` new function; deserialise on reads. |
| `src/xcs_gen_web/schemas.py` | `ResultResponse.missing_markers`. |
| `src/xcs_gen_web/app.py` | `_persist_upload` plumbing; new `results_reingest` endpoint; `_result_to_response` includes new field. |
| `src/xcs_gen_web/images.py` | Add `read(path)` helper if absent. |
| `alembic/versions/0011_add_results_missing_markers.py` | New migration. |
| `.github/workflows/ci.yml` | Bump alembic version assertion to `0011`. |
| `web/src/api/results.ts` (or wherever) | Type field + `reingestResult`. |
| `web/src/components/...` (test detail / result row / swatch panel) | UI changes. |
| `tests/...` | Unit + integration tests per Section 6. |
| `web/src/.../*.test.ts` | Vitest per Section 6. |

## Branching / commit shape

Single branch `feat/capture-diagnostics-reingest`, two commits:

1. `feat(capture): stronger preprocessing + persisted missing-marker diagnostics`
   — covers (1) and (2). Stops the silent-failure mode and adds the
   warning surfaces.
2. `feat(capture): per-result reingest endpoint + UI button` — covers (3).
   Depends on (1)/(2) being in place because the reingest path writes
   `missing_markers`.

One PR. Two reviewable atomic commits inside.

## Risks / open questions

- **Adaptive-threshold parameters.** `blockSize=51, C=10` are starting
  values — they may need tuning if the new variants regress on
  photos that were previously detected fine. The TDD plan should run
  the existing capture-pipeline integration tests against any sample
  fixtures before declaring done. If we see regressions, we tune
  rather than ship and let users find them.
- **`images.read` may not exist yet.** If absent, adding it is a
  trivial wrap of the existing storage dispatcher; if present and
  works as expected, no change needed. Plan should include a verification
  step early.
- **Storage path migration.** Older rows may have `image_path` values
  that don't resolve cleanly under the current storage configuration
  (e.g. local-FS rows after an S3 cutover). Reingest of those returns
  410 cleanly per Section 5; user response is "retake the photo".
  Acceptable.

## Out of scope follow-ups (parking lot)

- Per-test bulk reingest button (when needed).
- Visual sample-grid overlay on the saved result image — would help
  users see whether the warp is shifted, complementing the
  missing-marker warning.
- Auto-reingest scheduled job triggered by detection-code releases.
- Surfacing detection diagnostics in the upload-time error path
  (pre-persisted): currently if detection fails entirely the upload
  returns 400 with the bare error; we could include partial corner
  info there too.
