# Capture Diagnostics + Per-Result Reingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the silent miscapture mode where one missing ArUco still produces a homography but with badly-shifted sampling. Strengthen detection, persist diagnostics, and add a per-result reingest button so users can re-run their existing photos through the better pipeline.

**Architecture:** Three coupled backend changes — (1) more preprocessing variants in `capture_pipeline.py`, (2) a `missing_markers` list returned from `run_capture` and persisted on a new `results.missing_markers_json` column, (3) a `POST /api/results/{rid}/reingest` endpoint that re-runs capture against the saved photo. Frontend gains a typed field, an API client, a per-row ⚠ pill + ↻ Reingest button, and a banner above the swatch grid in the result-detail dialog.

**Tech Stack:** Python + FastAPI + SQLAlchemy + alembic (backend), OpenCV + PIL (capture pipeline), React + TypeScript + Tailwind v4 + lucide-react (frontend), pytest (backend tests), vitest (frontend tests).

**Spec:** `docs/superpowers/specs/2026-04-26-capture-diagnostics-and-reingest-design.md`

**Branch:** `feat/capture-diagnostics-reingest` (already created from `main`; spec is committed at SHA `cdf5682`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/xcs_gen_web/capture_pipeline.py` | **Modify** `_preprocessing_variants` | Extend from 2 → 4 variants: raw gray, Otsu(blurred), CLAHE, adaptive-threshold mean-C. |
| `src/xcs_gen_web/services/capture.py` | **Modify** `CaptureResult`, `run_capture` | Add `missing_markers: list[int]` field and computation. |
| `alembic/versions/0011_add_results_missing_markers.py` | **Create** | DB migration: add `results.missing_markers_json TEXT NOT NULL DEFAULT '[]'`. |
| `src/xcs_gen_web/models.py` | **Modify** `results` table | Add the new column declaration. |
| `src/xcs_gen_web/repositories/results.py` | **Modify** `_row`, `create`; **add** `replace_capture` | Serialise/deserialise the new column; add reingest write path. |
| `src/xcs_gen_web/schemas.py` | **Modify** `ResultResponse` | Add `missing_markers: list[int] = []`. |
| `src/xcs_gen_web/app.py` | **Modify** `_persist_upload`, `_result_to_response`; **add** `results_reingest` endpoint | Plumb the field; add reingest route. |
| `.github/workflows/ci.yml` | **Modify** line 144 | Bump alembic version assertion to `0011`. |
| `tests/test_capture_pipeline.py` | **Modify** | Unit tests for preprocessing variant count. |
| `tests/test_service_capture.py` | **Modify** | Unit test for `missing_markers` population. |
| `tests/test_results_api.py` | **Modify** | Integration tests for reingest happy path / 410 / 404. |
| `web/src/types.ts` | **Modify** `ResultRecord` | Add `missing_markers?: number[]`. |
| `web/src/api/results.ts` | **Modify** | Add `reingestResult(rid)`. |
| `web/src/components/ResultsPanel.tsx` | **Modify** | ⚠ pill on result row, ↻ Reingest button, click handler. |
| `web/src/components/ResultDetailDialog.tsx` | **Modify** | Banner above the swatch grid when `missing_markers.length > 0`. |
| `web/src/components/ResultsPanel.test.tsx` (or similar) | **Create or modify** | Vitest assertions on pill + button. |

`src/xcs_gen_web/images.py` already has `read(path: str) -> bytes` (verified — line 93). No change needed there.

---

## Task 1: Stronger preprocessing variants

**Files:**
- Modify: `src/xcs_gen_web/capture_pipeline.py:90-101`
- Test: `tests/test_capture_pipeline.py`

- [ ] **Step 1.1: Write the failing test**

Append to `tests/test_capture_pipeline.py`:

```python
def test_preprocessing_variants_returns_four_variants():
    """We need four detection variants — raw gray, Otsu(blurred), CLAHE,
    adaptive-threshold mean-C — so the QR/ArUco loops have multiple
    chances to recover photos with uneven lighting or glare. A
    regression to fewer variants degrades detection on phone photos
    of round discs."""
    import numpy as np
    from xcs_gen_web.capture_pipeline import _preprocessing_variants

    gray = np.full((200, 200), 128, dtype=np.uint8)
    variants = _preprocessing_variants(gray)
    assert len(variants) == 4, f"expected 4 variants, got {len(variants)}"
    for v in variants:
        assert v.shape == gray.shape
        assert v.dtype == np.uint8
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_capture_pipeline.py::test_preprocessing_variants_returns_four_variants -v
```

Expected: FAIL with `expected 4 variants, got 2`.

- [ ] **Step 1.3: Implement the new variants**

In `src/xcs_gen_web/capture_pipeline.py`, replace `_preprocessing_variants` (currently lines 90–101) with:

```python
def _preprocessing_variants(gray: np.ndarray) -> list[np.ndarray]:
    """Return candidate images for fiducial detection.

    Phone photos of laser burns on stainless usually aren't pure B&W —
    burns are mid-tone gray on a bright substrate. Raw gray confuses
    zbar/ArUco's built-in thresholding. Variants 2–4 are increasingly
    aggressive recovery techniques: Otsu rescues most mid-tone shots;
    CLAHE normalises uneven lighting (the most common failure mode on
    round-disc photos where one edge gets less flash); adaptive
    threshold catches photos where Otsu picks a bad global split
    because of a bright background highlight.
    """
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY,
        blockSize=51, C=10,
    )
    return [gray, otsu, clahe, adaptive]
```

- [ ] **Step 1.4: Run the new test plus the existing capture-pipeline suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_capture_pipeline.py -v
```

Expected: all tests pass, including the new one. The suite includes existing fixture-based detection tests; if any regress (e.g. detection threshold became sensitive to ordering), stop and report — the variant *order* (cheapest first) matters because the loops in `_qr_polygon_raw` and `_aruco_centres_px` short-circuit on success.

- [ ] **Step 1.5: Smoke-check on the real disc photo**

Run the diagnostic script written during the brainstorm:

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active python3 /tmp/diag_capture.py 2>&1 | head -25
```

Expected: ArUco ID 1 may now be detected (line `key=1: ... detected_in_image_px=(...)` instead of `None`). If it still isn't detected, that's fine for this task — the missing-marker plumbing in Task 2 makes this visible. Either way, all 6 already-detected anchors should still be found. Note the result for the implementation summary.

- [ ] **Step 1.6: Stage**

Don't commit yet — Tasks 1–5 land as a single backend commit at the end of Task 6.

```bash
git add src/xcs_gen_web/capture_pipeline.py tests/test_capture_pipeline.py
git status
```

Expected: both files staged, no other diffs.

---

## Task 2: `CaptureResult.missing_markers`

**Files:**
- Modify: `src/xcs_gen_web/services/capture.py:64-69, 79-82`
- Test: `tests/test_service_capture.py`

- [ ] **Step 2.1: Write the failing test**

Append to `tests/test_service_capture.py`:

```python
def test_run_capture_populates_missing_markers(monkeypatch):
    """When detect_fiducials returns ArUcos {2, 3} but not 1, the
    CaptureResult.missing_markers should list [1]. This is the signal
    the UI uses to warn that colours near the TR corner may be
    inaccurate."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    fake_img = np.zeros((50, 50, 3), dtype=np.uint8)
    warped = np.zeros((100, 100, 3), dtype=np.uint8)

    # corners_px keyed only by QR (0,4,5,6) + ArUcos {2, 3} — ID 1 is missing.
    corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(cap, "detect_fiducials", lambda _: (42, 0, corners))
    monkeypatch.setattr(cap, "warp_to_burn_space", lambda *a, **kw: warped)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 200.0, "x_steps": 9,
        "y_param": "pulse_width", "y_min": 2.0, "y_max": 60.0, "y_steps": 9,
        "rows": 1, "width_mm": 23.0, "height_mm": 23.0,
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }

    result = cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)
    assert result.missing_markers == [1]


def test_run_capture_missing_markers_empty_when_all_detected(monkeypatch):
    import numpy as np
    from xcs_gen_web.services import capture as cap

    fake_img = np.zeros((50, 50, 3), dtype=np.uint8)
    warped = np.zeros((100, 100, 3), dtype=np.uint8)
    corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(cap, "detect_fiducials", lambda _: (42, 0, corners))
    monkeypatch.setattr(cap, "warp_to_burn_space", lambda *a, **kw: warped)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 200.0, "x_steps": 9,
        "y_param": "pulse_width", "y_min": 2.0, "y_max": 60.0, "y_steps": 9,
        "rows": 1, "width_mm": 23.0, "height_mm": 23.0,
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }

    result = cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)
    assert result.missing_markers == []
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_service_capture.py::test_run_capture_populates_missing_markers tests/test_service_capture.py::test_run_capture_missing_markers_empty_when_all_detected -v
```

Expected: FAIL with `AttributeError: 'CaptureResult' object has no attribute 'missing_markers'`.

- [ ] **Step 2.3: Implement the field + computation**

In `src/xcs_gen_web/services/capture.py`, edit the `CaptureResult` dataclass (currently lines 64–69):

```python
from dataclasses import dataclass, field

@dataclass
class CaptureResult:
    swatches: list[dict[str, Any]]
    warped_image_bgr: np.ndarray
    # Retest index decoded from the QR. Pre-retest-era burns → 0.
    retest_index: int = 0
    # ArUco IDs (subset of {1, 2, 3}) that detect_fiducials did not find
    # in the photo. The homography is still solvable with ≥4 anchors,
    # but a missing ArUco means that quadrant of the burn-space is
    # extrapolated rather than constrained — sample colours near the
    # corresponding corner are unreliable.
    missing_markers: list[int] = field(default_factory=list)
```

Then in `run_capture` (currently around lines 79–82), replace the existing block:

```python
    try:
        qr_id, retest_index, corners_px = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e
```

with:

```python
    try:
        qr_id, retest_index, corners_px = detect_fiducials(img)
    except DetectionError as e:
        raise CaptureError(str(e)) from e

    expected_arucos = {1, 2, 3}
    detected_arucos = set(corners_px.keys()) & expected_arucos
    missing_markers = sorted(expected_arucos - detected_arucos)
```

And update the final `return CaptureResult(...)` (currently lines 178–182) to include the field:

```python
    return CaptureResult(
        swatches=swatches,
        warped_image_bgr=warped,
        retest_index=retest_index,
        missing_markers=missing_markers,
    )
```

- [ ] **Step 2.4: Run the tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_service_capture.py -v
```

Expected: all tests pass, including the two new ones and the existing service_capture tests.

- [ ] **Step 2.5: Stage**

```bash
git add src/xcs_gen_web/services/capture.py tests/test_service_capture.py
git status
```

---

## Task 3: DB migration + model column + repository plumbing

**Files:**
- Create: `alembic/versions/0011_add_results_missing_markers.py`
- Modify: `src/xcs_gen_web/models.py:142-165` (add column on the `results` table)
- Modify: `src/xcs_gen_web/repositories/results.py:26-65` (`_row`, `create`); also append `replace_capture`
- Modify: `.github/workflows/ci.yml:144` (bump assertion from `0010` to `0011`)
- Test: extend `tests/test_repo_results.py`

- [ ] **Step 3.1: Confirm current alembic head**

```bash
ls /Users/jonzky/Documents/XTools/Reverse/alembic/versions/ | tail -3
```

Expected: `0010_frequency_to_khz.py` is the latest. The new migration is `0011_*`.

- [ ] **Step 3.2: Write the migration**

Create `/Users/jonzky/Documents/XTools/Reverse/alembic/versions/0011_add_results_missing_markers.py`:

```python
"""Add results.missing_markers_json column.

Tracks which ArUco fiducials (subset of IDs 1/2/3) were not detected at
ingest time. Empty list means all three were detected — the homography
is well-constrained on every corner. A non-empty list means some
quadrant of the burn was extrapolated rather than measured; the UI
surfaces this so users know the affected colours may be inaccurate.

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "results",
        sa.Column(
            "missing_markers_json",
            sa.Text,
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("results", "missing_markers_json")
```

- [ ] **Step 3.3: Bump the CI alembic-version assertion**

Edit `.github/workflows/ci.yml` line 144. Change:

```yaml
          test "$VER" = "0010"
```

to:

```yaml
          test "$VER" = "0011"
```

This is the CLAUDE.md gotcha — failing to bump it produces a green migration that fails CI on the next push.

- [ ] **Step 3.4: Run alembic upgrade head locally**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active alembic upgrade head
uv run --active alembic current
```

Expected: `alembic current` reports `0011 (head)`. If the local DB is already at 0010, the upgrade adds the column and bumps the version.

- [ ] **Step 3.5: Add the column to the SQLAlchemy table**

In `src/xcs_gen_web/models.py`, find the `results` table definition (lines 142–165). After the `retest_index` column (currently line 132 in the `tests` table — for the `results` table the equivalent is around lines 154–160), add the new column. The exact insert point: after `Column("retest_index", Integer, nullable=False, server_default="0"),` in the `results` table block, before the `CheckConstraint(...)` lines.

```python
    Column(
        "missing_markers_json",
        Text,
        nullable=False,
        server_default="[]",
    ),
```

- [ ] **Step 3.6: Update `_row` + `create` in the results repo**

In `src/xcs_gen_web/repositories/results.py`, modify `_row` (currently lines 26–41) to deserialise the new column. Add this line just before the closing `}` of the dict (after `"retest_index": ...`):

```python
        "missing_markers": json.loads(getattr(r, "missing_markers_json", None) or "[]"),
```

(`getattr(...) or "[]"` lets pre-migration test DBs load gracefully — the existing `retest_index` line uses the same pattern at line 40.)

Then modify `create` (currently lines 44–65) to accept and persist the new field. Update the signature:

```python
def create(
    *, test_id: int, image_path: str, image_sha256: str,
    swatches: list[dict[str, Any]], owner_id: int = STANDALONE_USER_ID,
    notes: str = "",
    visibility: str = DEFAULT_VISIBILITY,
    via: str = "desktop",
    retest_index: int = 0,
    missing_markers: list[int] | None = None,
) -> dict[str, Any]:
```

In the `results.insert().values(...)` call, add the new column value alongside the existing fields:

```python
            missing_markers_json=json.dumps(
                list(missing_markers or []), separators=(",", ":"),
            ),
```

- [ ] **Step 3.7: Add `replace_capture` to the results repo**

Append to `src/xcs_gen_web/repositories/results.py`:

```python
def replace_capture(
    rid: int,
    *,
    swatches: list[dict[str, Any]],
    missing_markers: list[int],
    owner_id: int = STANDALONE_USER_ID,
) -> dict[str, Any] | None:
    """Replace ``swatches_json`` and ``missing_markers_json`` on an
    existing result row. Used by the reingest endpoint to write fresh
    capture output without touching the source photo or upload metadata.
    """
    with session_scope() as s:
        s.execute(
            results.update()
            .where(and_(results.c.id == rid, results.c.owner_id == owner_id))
            .values(
                swatches_json=json.dumps(swatches, separators=(",", ":")),
                missing_markers_json=json.dumps(
                    list(missing_markers), separators=(",", ":"),
                ),
            )
        )
    return get(rid, owner_id=owner_id)
```

- [ ] **Step 3.8: Add a repo unit test**

Append to `tests/test_repo_results.py`:

```python
def test_create_persists_missing_markers(fresh_db, monkeypatch, tmp_path):
    """create() should serialise missing_markers into missing_markers_json
    and round-trip through get()."""
    from xcs_gen_web.repositories import results as r_repo
    from xcs_gen_web.repositories import tests as t_repo

    tid = t_repo.create(
        name="t", spec={"x_param": "frequency", "x_min": 50.0, "x_max": 200.0,
                        "x_steps": 9, "y_param": None, "rows": 1,
                        "width_mm": 10.0, "height_mm": 10.0,
                        "base_params": {}, "registration": {"mode": "on"}},
        material_id=1,
    )["id"]

    row = r_repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[], missing_markers=[1, 3],
    )
    assert row["missing_markers"] == [1, 3]
    fetched = r_repo.get(row["id"])
    assert fetched["missing_markers"] == [1, 3]


def test_replace_capture_overwrites_swatches_and_missing_markers(fresh_db, monkeypatch, tmp_path):
    from xcs_gen_web.repositories import results as r_repo
    from xcs_gen_web.repositories import tests as t_repo

    tid = t_repo.create(
        name="t", spec={"x_param": "frequency", "x_min": 50.0, "x_max": 200.0,
                        "x_steps": 9, "y_param": None, "rows": 1,
                        "width_mm": 10.0, "height_mm": 10.0,
                        "base_params": {}, "registration": {"mode": "on"}},
        material_id=1,
    )["id"]
    row = r_repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[{"row": 0, "col": 0, "x_value": 1.0, "y_value": None,
                   "hex": "#000000", "lab": [0, 0, 0], "sigma": 0.0}],
        missing_markers=[1],
    )

    new_swatches = [{"row": 0, "col": 0, "x_value": 2.0, "y_value": None,
                     "hex": "#ffffff", "lab": [100, 0, 0], "sigma": 0.5}]
    refreshed = r_repo.replace_capture(
        row["id"], swatches=new_swatches, missing_markers=[],
    )
    assert refreshed is not None
    assert refreshed["swatches"] == new_swatches
    assert refreshed["missing_markers"] == []
```

(Reuse whatever `fresh_db` fixture pattern this codebase has — `tests/test_repo_results.py` already imports it.)

- [ ] **Step 3.9: Run the repo tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_repo_results.py -v
```

Expected: all tests pass, including the two new ones and any existing ones in this file.

- [ ] **Step 3.10: Stage**

```bash
git add alembic/versions/0011_add_results_missing_markers.py \
        src/xcs_gen_web/models.py \
        src/xcs_gen_web/repositories/results.py \
        tests/test_repo_results.py \
        .github/workflows/ci.yml
git status
```

---

## Task 4: Plumb `missing_markers` through upload + ResultResponse

**Files:**
- Modify: `src/xcs_gen_web/schemas.py:540-553`
- Modify: `src/xcs_gen_web/app.py:1023-1034, 1052-1062`
- Test: `tests/test_results_api.py`

- [ ] **Step 4.1: Write the failing test**

Append to `tests/test_results_api.py`:

```python
def test_upload_response_includes_missing_markers(fresh_db, monkeypatch, tmp_path):
    """The upload route should expose missing_markers on the
    ResultResponse — the UI relies on it to render the warning pill."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    # Force run_capture to behave deterministically.
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials",
                        lambda _: (1, 0, {0: (0.0, 0.0), 4: (0.0, 10.0),
                                          5: (10.0, 10.0), 6: (10.0, 0.0),
                                          2: (0.0, 30.0), 3: (30.0, 30.0)}))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: np.zeros((100, 100, 3), dtype=np.uint8))

    # Use whatever test fixtures the file already uses to create a test row.
    # Adapt the signature below to match the existing helper if there is one.
    from tests.test_results_api import _make_test  # adjust if name differs
    tid = _make_test(...)  # 1×1 grid for simplicity

    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    c = TestClient(create_app())
    r = c.post(f"/api/tests/{tid}/results",
               files={"image": ("x.png", b"fake", "image/png")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert "missing_markers" in body
    assert body["missing_markers"] == [1]
```

NOTE: the `_make_test` import is illustrative. Look at the **first existing test in `tests/test_results_api.py`** (`test_upload_happy_path` around line 35 — confirmed via `grep`) to copy its setup pattern, including how it creates a parent test row and how it monkeypatches the capture pipeline. Mirror that pattern exactly. The test above is shown as code-shape-illustration; the engineer must inspect the existing tests in this file and adapt the fixture wiring to match.

- [ ] **Step 4.2: Run the test to verify it fails**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py::test_upload_response_includes_missing_markers -v
```

Expected: FAIL with `KeyError: 'missing_markers'` or assertion failure on the body.

- [ ] **Step 4.3: Add `missing_markers` to `ResultResponse`**

In `src/xcs_gen_web/schemas.py`, modify `ResultResponse` (currently lines 540–553). Add the field right after `retest_index`:

```python
class ResultResponse(BaseModel):
    id: int
    test_id: int
    uploaded_at: str
    image_url: str
    image_sha256: str
    excluded: bool
    notes: str
    swatches: list[ResultSwatch]
    owner_id: int
    visibility: str
    # Copied from the QR at ingest. 0 for burns from pre-retest-era
    # XCS files (the implicit "first burn").
    retest_index: int = 0
    # ArUco IDs (subset of {1, 2, 3}) that detection did not find.
    # Empty when the homography was fully constrained.
    missing_markers: list[int] = []
```

- [ ] **Step 4.4: Plumb through `_result_to_response` and `_persist_upload`**

In `src/xcs_gen_web/app.py`, modify `_result_to_response` (currently lines 1023–1034). Add the new field in the return:

```python
    def _result_to_response(r: dict) -> ResultResponse:
        return ResultResponse(
            id=r["id"], test_id=r["test_id"],
            uploaded_at=r["uploaded_at"],
            image_url=f"/api/results/{r['id']}/image",
            image_sha256=r["image_sha256"],
            excluded=r["excluded"], notes=r["notes"],
            swatches=[ResultSwatch(**s) for s in r["swatches"]],
            owner_id=r["owner_id"],
            visibility=r["visibility"],
            retest_index=r.get("retest_index", 0),
            missing_markers=r.get("missing_markers", []),
        )
```

In `_persist_upload` (currently lines 1036–1072), update the `r_repo.create(...)` call (currently lines 1053–1061) to pass the field:

```python
        placeholder = r_repo.create(
            test_id=tid,
            image_path="pending",
            image_sha256=images.sha256_hex(data),
            swatches=cap_result.swatches,
            owner_id=user_id,
            via=via,
            retest_index=cap_result.retest_index,
            missing_markers=cap_result.missing_markers,
        )
```

- [ ] **Step 4.5: Run the new test plus the existing results-API suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py -v
```

Expected: all tests pass.

- [ ] **Step 4.6: Stage**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/app.py tests/test_results_api.py
git status
```

---

## Task 5: Reingest endpoint

**Files:**
- Modify: `src/xcs_gen_web/app.py` (add new endpoint near the existing results routes; insertion point: after `me_mobile_uploads_recent` and before the next-section endpoints — around line 545 — or just append within the `register_routes`-equivalent block alongside the other result endpoints).
- Test: `tests/test_results_api.py`

- [ ] **Step 5.1: Write the failing tests**

Append to `tests/test_results_api.py`. Match the pre-existing file's monkeypatch + fixture style by reading the first tests in the file and copying their setup precisely:

```python
def test_reingest_happy_path(fresh_db, monkeypatch, tmp_path):
    """POST /api/results/{rid}/reingest re-runs capture against the
    saved photo and returns a ResultResponse with fresh swatches +
    missing_markers."""
    import numpy as np
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials",
                        lambda _: (1, 0, {0: (0.0, 0.0), 4: (0.0, 10.0),
                                          5: (10.0, 10.0), 6: (10.0, 0.0),
                                          1: (30.0, 0.0), 2: (0.0, 30.0),
                                          3: (30.0, 30.0)}))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: np.zeros((100, 100, 3), dtype=np.uint8))

    # Use the existing fixture pattern to create a test + upload a result.
    # Then call the reingest endpoint and assert the response shape.
    c = TestClient(create_app())
    tid = ...  # (adapt from the existing _make_test or test_upload_happy_path setup)
    rid = c.post(f"/api/tests/{tid}/results",
                 files={"image": ("x.png", b"fake", "image/png")}).json()["id"]

    r = c.post(f"/api/results/{rid}/reingest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == rid
    assert "missing_markers" in body
    assert body["missing_markers"] == []  # all 3 ArUcos detected in mock


def test_reingest_returns_410_when_image_missing(fresh_db, monkeypatch, tmp_path):
    """If the saved photo is gone (FS deleted, S3 404), reingest
    should 410, not 500."""
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web import images

    monkeypatch.setattr(images, "read",
                        lambda _: (_ for _ in ()).throw(FileNotFoundError()))

    c = TestClient(create_app())
    # Adapt to use the existing fixture for creating a result row.
    rid = ...
    r = c.post(f"/api/results/{rid}/reingest")
    assert r.status_code == 410, r.text
    assert "no longer available" in r.json()["detail"].lower()


def test_reingest_returns_404_for_unknown_rid(fresh_db, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app

    c = TestClient(create_app())
    r = c.post("/api/results/9999/reingest")
    assert r.status_code == 404
```

(The `...` placeholders mark where the engineer copies the existing fixture-setup pattern — the file already contains working examples of "create test, upload, get rid". Use those verbatim.)

- [ ] **Step 5.2: Run the tests to verify they fail**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py::test_reingest_happy_path tests/test_results_api.py::test_reingest_returns_410_when_image_missing tests/test_results_api.py::test_reingest_returns_404_for_unknown_rid -v
```

Expected: FAIL with `404 Not Found` (the route doesn't exist yet) on all three.

- [ ] **Step 5.3: Implement the endpoint**

In `src/xcs_gen_web/app.py`, find a good insertion point near the existing result endpoints. The cleanest spot is right after `_persist_upload` and before the `@app.post("/api/tests/{tid}/results", ...)` route — i.e. before line 1074. Insert:

```python
    @app.post(
        "/api/results/{rid}/reingest",
        response_model=ResultResponse,
    )
    def results_reingest(
        rid: int, user_id: int = Depends(get_current_user),
    ) -> ResultResponse:
        """Re-run the capture pipeline against the result's saved photo.

        Replaces ``swatches_json`` and ``missing_markers_json`` on the
        row using current detection code and the test's current spec.
        Useful after detection improvements, after retest spec edits,
        or when the user wants to verify a previously-flagged result
        is now accurate.
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
                detail="source image no longer available — cannot reingest",
            )
        try:
            cap = capture_service.run_capture(
                image_bytes=data, test_id=r["test_id"], spec=t["spec"],
            )
        except capture_service.CaptureError as e:
            raise HTTPException(status_code=400, detail=str(e))
        refreshed = r_repo.replace_capture(
            rid,
            swatches=cap.swatches,
            missing_markers=cap.missing_markers,
            owner_id=user_id,
        )
        if refreshed is None:
            # Owner check passed in r_repo.get; row should still exist.
            raise HTTPException(status_code=500, detail="reingest write failed")
        return _result_to_response(refreshed)
```

- [ ] **Step 5.4: Run the tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/test_results_api.py -v
```

Expected: all three reingest tests pass + existing results-API tests still pass.

- [ ] **Step 5.5: Stage**

```bash
git add src/xcs_gen_web/app.py tests/test_results_api.py
git status
```

---

## Task 6: Backend commit

- [ ] **Step 6.1: Run the full backend test suite**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active pytest tests/ -q
```

Expected: all green. If anything regressed (most likely: a test that asserts an exact shape on `ResultResponse` and now sees the new `missing_markers` field), update the assertion accordingly — additive fields are not a breaking change for any consumer that uses `**unpack` or specific-key access.

- [ ] **Step 6.2: Re-run the diagnostic on the real disc photo**

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active python3 /tmp/diag_capture.py 2>&1 | head -25
```

Capture two things in the implementation summary for the PR description:

1. Whether ArUco ID 1 is now detected (look at the `key=1: ...` line — `None` means it's still missed; coordinates means it's now found).
2. Whether the swatch hexes for the previously-gray cells (e.g. row 0 columns 5–8) now show real burn colours.

Either outcome is acceptable for this PR — Tasks 1 and 2 cover both cases (better detection + missing-marker warning when detection still fails).

- [ ] **Step 6.3: Commit**

```bash
git status   # Confirm only files from Tasks 1–5 are staged
git commit -m "$(cat <<'EOF'
feat(capture): preprocessing variants + persisted missing-marker diagnostics + reingest endpoint

Three coupled changes:

- _preprocessing_variants extends from 2 → 4 variants (raw, Otsu+blur,
  CLAHE, adaptive-threshold mean-C). CLAHE rescues photos with uneven
  flash; adaptive-threshold catches photos where Otsu picks a bad
  global split. Both add ~50–100ms vs the multi-second pipeline —
  negligible.
- CaptureResult gains a missing_markers list (subset of ArUco IDs
  {1,2,3} not found). A new results.missing_markers_json column
  persists this. The upload path plumbs it through to ResultResponse
  so the UI can warn that colours near a given corner may be
  inaccurate.
- New POST /api/results/{rid}/reingest re-runs the capture pipeline
  against the saved photo and replaces swatches_json +
  missing_markers_json on the row. 410 if the source photo is gone,
  404 if the result/test isn't owned by the caller, 400 if capture
  fails.

Migration 0011 + matching CI alembic-version bump.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: pre-commit hooks pass. If any hook fails (e.g. ruff on the new code), fix in place and create a NEW commit (per CLAUDE.md "always create new commits, not amend on hook failure").

---

## Task 7: Frontend types + API client

**Files:**
- Modify: `web/src/types.ts:181-192`
- Modify: `web/src/api/results.ts`

- [ ] **Step 7.1: Add `missing_markers` to `ResultRecord`**

Edit `web/src/types.ts`. Modify `ResultRecord` (currently lines 181–192):

```ts
export interface ResultRecord {
  id: number;
  test_id: number;
  uploaded_at: string;
  image_url: string;
  image_sha256: string;
  excluded: boolean;
  notes: string;
  swatches: ResultSwatch[];
  /** Copied from the QR on ingest; 0 for pre-retest-era burns. */
  retest_index?: number;
  /** ArUco IDs (subset of {1,2,3}) the pipeline failed to detect on
   *  this photo. Empty/absent when the homography was fully
   *  constrained. UI surfaces this as a warning so users know which
   *  corner's colours may be unreliable. */
  missing_markers?: number[];
}
```

- [ ] **Step 7.2: Add `reingestResult` to the API client**

Append to `web/src/api/results.ts`, after `deleteResult`:

```ts
export async function reingestResult(rid: number): Promise<ResultRecord> {
  return j(await fetch(`/api/results/${rid}/reingest`, { method: "POST" }));
}
```

- [ ] **Step 7.3: Typecheck**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit
```

Expected: PASS, no errors.

- [ ] **Step 7.4: Stage**

```bash
git add web/src/types.ts web/src/api/results.ts
git status
```

---

## Task 8: ResultsPanel — pill on row + reingest button

**Files:**
- Modify: `web/src/components/ResultsPanel.tsx`
- Test: `web/src/components/ResultsPanel.test.tsx` (create if absent)

- [ ] **Step 8.1: Inspect existing imports + helper components**

Read the top imports of `ResultsPanel.tsx` to know what's already available:

```bash
sed -n '1,30p' /Users/jonzky/Documents/XTools/Reverse/web/src/components/ResultsPanel.tsx
```

Note the existing icon imports from `lucide-react` and the existing component patterns; the new code reuses them.

- [ ] **Step 8.2: Add the pill + reingest button to each result row**

In `ResultsPanel.tsx`, locate the `results.map((r) => (...))` block (currently around lines 185–260). The relevant insertion points:

1. **Add to the existing `lucide-react` import** (currently `import { Trash2, Camera, ... } from "lucide-react"`): add `RotateCcw` and `AlertTriangle`.

2. **Add a `reingest` helper** near the existing `toggleExclude` function (around line 102):

```tsx
  const [reingestingId, setReingestingId] = useState<number | null>(null);

  async function reingest(rid: number) {
    setReingestingId(rid);
    try {
      const { reingestResult } = await import("../api/results");
      await reingestResult(rid);
      await refresh(); // or whatever the existing results-refresh hook is called
    } catch (err) {
      // Toast the error verbatim. Use the existing toast helper if there is one;
      // otherwise fall back to the existing error-handling pattern in this file.
      console.error(err);
    } finally {
      setReingestingId(null);
    }
  }
```

(Identify the existing data-refresh function in this file by reading from the top — it's the function called after `toggleExclude` or `onDeleteResult` to repaint the row. Pass that name into the snippet above. If it's unclear, stop and report so the controller can confirm.)

3. **Add a corner-name map** near the top of the file (after imports, before the component):

```tsx
const ARUCO_CORNER_NAMES: Record<number, string> = {
  1: "top-right",
  2: "bottom-left",
  3: "bottom-right",
};

function formatMissingCorners(ids: number[]): string {
  const names = ids.map((id) => ARUCO_CORNER_NAMES[id] ?? `marker ${id}`);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
```

4. **Inject the pill** inside the result-row's left-side meta div (currently lines 209–225, the `flex items-center gap-1.5 font-mono text-[12px]` div). After the existing retest-index pill block (lines 211–224), add:

```tsx
                    {(r.missing_markers?.length ?? 0) > 0 && (
                      <span
                        title={`${r.missing_markers!.length} of 3 ArUco markers missing — colours near ${formatMissingCorners(r.missing_markers!)} may be inaccurate`}
                        className={cn(
                          "inline-flex items-center gap-0.5 h-4 px-1.5 rounded-[3px]",
                          "font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase",
                          "border border-[color:var(--color-warn,orange)]/40",
                          "bg-[color:var(--color-warn-tint,rgba(255,165,0,0.1))]",
                          "text-[color:var(--color-warn,orange)]",
                        )}
                        aria-label="Capture warning"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
                        {r.missing_markers!.length}/3
                      </span>
                    )}
```

(If `--color-warn` / `--color-warn-tint` aren't defined in the codebase, the fallback inline values keep the visual result correct. The plan author prefers existing tokens — sweep `web/src/index.css` for the actual variable names. If the codebase uses different naming like `--color-warning`, swap in.)

5. **Add the reingest button** right before the existing delete button (currently lines 247–258). Insert:

```tsx
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    reingest(r.id);
                  }}
                  disabled={isDemo || reingestingId === r.id}
                  className="p-1 rounded text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-tint)] disabled:opacity-50"
                  title={isDemo
                    ? "Reingesting is disabled in the demo."
                    : "Reingest — re-run capture on the saved photo"}
                  aria-label="Reingest result"
                >
                  <RotateCcw className={cn(
                    "h-3.5 w-3.5",
                    reingestingId === r.id && "animate-spin",
                  )} />
                </button>
```

- [ ] **Step 8.3: Write the vitest**

Look for an existing `*.test.ts(x)` next to `ResultsPanel.tsx`. If absent, create `web/src/components/ResultsPanel.test.tsx`. The framework already used in this codebase is Vitest + React Testing Library — match whatever import style is used in other component tests (e.g. `palette/Palette.test.tsx` if it exists).

Minimum content:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultsPanel } from "./ResultsPanel";

// Adapt props/mocks to whatever ResultsPanel actually expects — read its
// declaration first.

describe("ResultsPanel", () => {
  it("renders the missing-marker pill when missing_markers is non-empty", () => {
    const result = {
      id: 1, test_id: 1, uploaded_at: "2026-04-26T10:00:00Z",
      image_url: "/api/results/1/image", image_sha256: "x",
      excluded: false, notes: "",
      swatches: [], missing_markers: [1],
    };
    render(<ResultsPanel results={[result] as any} {...minimalProps()} />);
    expect(screen.getByLabelText("Capture warning")).toBeInTheDocument();
  });

  it("does not render the pill when missing_markers is empty", () => {
    const result = {
      id: 1, test_id: 1, uploaded_at: "2026-04-26T10:00:00Z",
      image_url: "/api/results/1/image", image_sha256: "x",
      excluded: false, notes: "",
      swatches: [], missing_markers: [],
    };
    render(<ResultsPanel results={[result] as any} {...minimalProps()} />);
    expect(screen.queryByLabelText("Capture warning")).not.toBeInTheDocument();
  });
});

function minimalProps() {
  // Read ResultsPanel's prop signature and return whatever is required.
  // If the component exports a context provider for test wiring, use it.
  return { /* ... */ };
}
```

(If wiring a meaningful render is too involved for this scope — e.g. ResultsPanel pulls from many hooks/contexts — write a smaller unit-style test on `formatMissingCorners` only, which is pure, and skip the render tests. Note the choice in the implementation summary.)

- [ ] **Step 8.4: Run vitest**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npm test
```

Expected: tests pass, including the new ones.

- [ ] **Step 8.5: Typecheck**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit
```

Expected: PASS, no errors.

- [ ] **Step 8.6: Stage**

```bash
git add web/src/components/ResultsPanel.tsx
[ -f web/src/components/ResultsPanel.test.tsx ] && git add web/src/components/ResultsPanel.test.tsx
git status
```

---

## Task 9: ResultDetailDialog — banner above the swatch grid

**Files:**
- Modify: `web/src/components/ResultDetailDialog.tsx`

- [ ] **Step 9.1: Locate the swatch-grid section**

The dialog renders charts on top, then a swatch grid. The swatch grid is preceded by a `<ChartLabel title={`Swatches (${result.swatches.length})`} />` (around line 183). The banner should sit between the readout strip / charts and that label — i.e. just before the `<ChartLabel ... Swatches`.

- [ ] **Step 9.2: Add the corner-name map (or import from a shared module)**

If you already created `formatMissingCorners` and `ARUCO_CORNER_NAMES` in `ResultsPanel.tsx`, **extract them to a shared module** to avoid duplication. Create `web/src/components/captureWarnings.ts`:

```ts
export const ARUCO_CORNER_NAMES: Record<number, string> = {
  1: "top-right",
  2: "bottom-left",
  3: "bottom-right",
};

export function formatMissingCorners(ids: number[]): string {
  const names = ids.map((id) => ARUCO_CORNER_NAMES[id] ?? `marker ${id}`);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
```

Then update `ResultsPanel.tsx` from Task 8 to import these instead of defining them locally:

```ts
import { ARUCO_CORNER_NAMES, formatMissingCorners } from "./captureWarnings";
```

(Remove the local copies.) This is a tiny refactor done while we're touching both files, not a separate cleanup pass.

- [ ] **Step 9.3: Add the banner**

In `ResultDetailDialog.tsx`, **add to the `lucide-react` import** if not present: `AlertTriangle`.

Add the banner just before the `<ChartLabel ... Swatches ...` line (currently around line 183). The exact insertion: inside the wrapper div that contains the charts and grid, just before the swatches `<ChartLabel>`:

```tsx
        {(result.missing_markers?.length ?? 0) > 0 && (
          <div
            role="status"
            className={cn(
              "mx-5 my-3 flex items-start gap-2 px-3 py-2 rounded-[6px]",
              "border border-[color:var(--color-warn,orange)]/40",
              "bg-[color:var(--color-warn-tint,rgba(255,165,0,0.1))]",
              "text-[color:var(--color-warn,orange)]",
              "text-[12px] leading-snug",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5 mt-[1px] shrink-0" strokeWidth={2} />
            <div>
              {result.missing_markers!.length} of 3 ArUco markers missing on this
              photo ({formatMissingCorners(result.missing_markers!)}). Colours
              near {result.missing_markers!.length > 1 ? "those corners" : "that corner"} may
              be inaccurate. Reingest after retaking.
            </div>
          </div>
        )}
```

Add the import at the top of the file:

```tsx
import { ARUCO_CORNER_NAMES, formatMissingCorners } from "./captureWarnings";
```

(Drop `ARUCO_CORNER_NAMES` if you don't end up needing it directly here.)

- [ ] **Step 9.4: Typecheck + run tests**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npx tsc --noEmit && npm test
```

Expected: all pass. If `AlertTriangle` isn't already imported and your environment has tree-shaking warnings, the typecheck still succeeds.

- [ ] **Step 9.5: Build the bundle**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/web && npm run build > /dev/null 2>&1
```

Expected: exit 0. (CLAUDE.md gotcha: backend serves `web/dist/`, not Vite dev — without this, browser checks would test stale code.)

- [ ] **Step 9.6: Browser smoke check**

Start the server on a free port and verify the bundle is loaded:

```bash
cd /Users/jonzky/Documents/XTools/Reverse
uv run --active xcs-gen serve --host 127.0.0.1 --port 8019 > /tmp/xcs.log 2>&1 &
SERVER_PID=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8019/
curl -s http://127.0.0.1:8019/ | grep -c "/assets/"
kill $SERVER_PID
```

Expected: `200` and at least 1 `/assets/` reference. Manual full-browser walk-through happens in Task 10 before flipping the PR to ready.

- [ ] **Step 9.7: Stage**

```bash
git add web/src/components/ResultDetailDialog.tsx web/src/components/captureWarnings.ts web/src/components/ResultsPanel.tsx
git status
```

---

## Task 10: Frontend commit + PR

- [ ] **Step 10.1: Confirm staged set is frontend-only**

```bash
git status
```

Expected: only `web/src/**` files staged. No backend files (those landed in Task 6's commit).

- [ ] **Step 10.2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): missing-marker UI + per-result reingest button

ResultsPanel: a small ⚠ pill on each result row when ArUco markers
were missing on capture, naming how many are missing. A new ↻
Reingest button next to the existing per-row controls calls the new
backend endpoint and refreshes the list. ResultDetailDialog shows a
matching banner above the swatch grid when the active result has
missing markers, naming the affected corner(s).

A small captureWarnings.ts module shares the corner-name formatting
between the two surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: pre-commit hooks pass.

- [ ] **Step 10.3: Push the branch**

```bash
git push -u origin feat/capture-diagnostics-reingest
```

- [ ] **Step 10.4: Open a draft PR**

```bash
gh pr create --draft --title "feat: capture diagnostics + per-result reingest" --body "$(cat <<'EOF'
## Summary

- Stronger fiducial detection: \`_preprocessing_variants\` extends from 2 → 4 variants (raw, Otsu+blur, CLAHE, adaptive-threshold mean-C). Recovers photos with uneven lighting / glare on one quadrant.
- Persisted missing-marker diagnostics: \`CaptureResult.missing_markers\` is plumbed through to a new \`results.missing_markers_json\` column (alembic 0011). \`ResultResponse\` exposes it; the UI surfaces a ⚠ pill on each result row and a banner above the swatch grid when any ArUco was missed.
- Per-result reingest: new \`POST /api/results/{rid}/reingest\` re-runs capture against the saved photo using current detection + the test's current spec. UI: a ↻ button on each result row.

Spec: \`docs/superpowers/specs/2026-04-26-capture-diagnostics-and-reingest-design.md\`. Plan: \`docs/superpowers/plans/2026-04-26-capture-diagnostics-and-reingest.md\`.

## Test plan

- [x] \`uv run --active pytest tests/ -q\` is green.
- [x] \`cd web && npx tsc --noEmit\` is green.
- [x] \`cd web && npm test\` is green.
- [x] \`cd web && npm run build\` succeeds.
- [x] Diagnostic on \`samples/Unknown.jpg\` (test #23 spec): inspect \`/tmp/diag_capture.py\` output and note whether ArUco 1 is now detected. Document outcome in PR comment.
- [ ] **Manual browser check:** Upload \`samples/Unknown.jpg\` against test #23 in a fresh local DB. The result row shows a ⚠ pill. Open the result detail dialog — banner appears above the swatch grid naming the affected corner. Click ↻ Reingest — request returns 200, swatches refresh.
- [ ] **Manual browser check:** Reingest on a result whose source photo was deleted on disk returns 410 with a clean error toast (no 500).
- [ ] **CI alembic-version assertion** is bumped to 0011 (catches migration-vs-CI drift).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.5: Watch CI**

```bash
gh pr checks --watch
```

- [ ] **Step 10.6: Mark ready when CI is green**

```bash
gh pr ready
```

If CI fails, do not flip to ready. Most likely failure path: the alembic-version assertion (already updated in Task 3.3) or a Python type-check on the new endpoint. Investigate and push a fix commit on the same branch.

---

## Self-review notes

**Spec coverage:**

| Spec section | Task(s) | ✓ |
|---|---|---|
| (B) Stronger preprocessing variants | T1 | ✓ |
| `CaptureResult.missing_markers` field | T2 | ✓ |
| DB migration + model + CI version bump | T3 | ✓ |
| Repository: `_row` deserialise, `create` arg, `replace_capture` | T3 | ✓ |
| `ResultResponse.missing_markers` schema field | T4 | ✓ |
| `_persist_upload` plumbing | T4 | ✓ |
| `_result_to_response` plumbing | T4 | ✓ |
| Reingest endpoint with 410/404/400 error mapping | T5 | ✓ |
| `images.read(path)` (already exists; verified) | T5 (uses) | ✓ |
| Frontend `ResultRecord.missing_markers` type | T7 | ✓ |
| Frontend `reingestResult(rid)` API client | T7 | ✓ |
| ResultsPanel: ⚠ pill on row + ↻ button | T8 | ✓ |
| ResultDetailDialog: banner above swatch grid | T9 | ✓ |
| Shared corner-name formatting module | T9 (extracted from T8) | ✓ |
| Vitest coverage on the UI | T8 | ✓ |
| Single PR, two atomic commits (backend, frontend) | T6 + T10 | ✓ |

**Type / name consistency:**

- Python field name: `missing_markers` (snake_case). DB column: `missing_markers_json` (the storage form). All references match.
- TS field name on `ResultRecord`: `missing_markers?: number[]`. Marked optional so older API responses (in case any cached page predates the rollout) don't trip a runtime read.
- TS helpers: `ARUCO_CORNER_NAMES`, `formatMissingCorners`. Defined once in `web/src/components/captureWarnings.ts`; both `ResultsPanel.tsx` and `ResultDetailDialog.tsx` import from there.

**Placeholder scan:**

- Two intentional `...` markers exist in Task 4 (`_make_test(...)`) and Task 5 (`tid = ...`). Both are accompanied by an explicit instruction to **read the existing tests in the same file** and copy their fixture-setup style. This is not a hidden TBD — it's "follow the existing pattern" with a precise reference. Acceptable.
- All other code blocks are complete and committable.

**Out of scope follow-ups:**

- Per-test bulk reingest button.
- Visual sample-grid overlay on the saved result image (would help users see whether the warp is shifted).
- Auto-reingest scheduled job triggered by detection-code releases.
