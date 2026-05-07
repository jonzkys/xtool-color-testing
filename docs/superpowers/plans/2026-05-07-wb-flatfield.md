# WB Flat-Field via Perimeter Clean Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the previous-branch's 3-coloured-patches calibration approach with a single perimeter clean-pass strip per test plate, sampled at ingest into 4 edge-mean RGBs that drive a bilinear flat-field correction across the colour grid.

**Architecture:** Burn 4 thin clean-pass strips between adjacent registration markers (top, right, bottom, left). At ingest, sample each strip in many points, pool to one RGB per edge, then bilinear-interpolate a per-cell gain anchored on those 4 edges + a hardcoded canonical neutral. Falls back to chromaticity-only on unburned-around-markers when fewer than 3 strips read cleanly; falls back to skip when even fiducials fail. One per-material setting (`clean_pass_params`) gated by an existing-on-spec `wb_supported` flag (default true).

**Tech Stack:** Python 3.12 (FastAPI, Pydantic v2, SQLAlchemy core, Alembic, OpenCV, NumPy, pytest); TypeScript (React 18, Vite, vitest, RTL).

**Spec:** `docs/superpowers/specs/2026-05-07-wb-flatfield-design.md`.

---

## Conventions used by this codebase (skim before starting)

- Always run Python with `unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && .venv/bin/python …` from the worktree root. `uv run --active pytest` falls into a stale pyenv shim on this machine. If pytest can't find `xcs_gen_web`, set `PYTHONPATH=src` for the invocation.
- After ANY `web/src/**` change, rebuild before browser-testing: `cd web && npm run build`. There's no Vite dev server wired up.
- Frontend tests: `cd web && npx tsc --noEmit && npm test -- --run`.
- All FastAPI routes live in `app.py` (60+ of them). Don't create a `routers/` subfolder.
- Migrations: use `alembic revision --autogenerate` and trim noise to columns the spec asks for. Don't bundle pre-existing schema drift.
- Use `git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield …` for git operations to avoid cwd drift between Bash invocations.
- Models in `models.py` are SQLAlchemy core `Table()` definitions. JSON-payload columns use `Text` (not `JSON`).

---

## File Structure

### Backend (Python)

| Path | Responsibility |
|---|---|
| `src/xcs_gen_web/models.py` (modify) | 2 new cols on `materials` + 4 new cols on `results` |
| `alembic/versions/0021_wb_flatfield.py` (new) | Single migration adding the 6 columns |
| `.github/workflows/ci.yml` (modify line 144) | Bump alembic head check `0020` → `0021` |
| `src/xcs_gen_web/calibration_defaults.py` (new) | `default_clean_pass(substrate)` registry — stainless first |
| `src/xcs_gen_web/wb_correction.py` (new) | Pure functions: `chromaticity_correct`, `flatfield_correct`, `sample_strip_line`, `correct_warped_frame` orchestrator |
| `src/xcs_gen_web/capture_pipeline.py` (modify) | Add low-contrast preprocessing variant + `apply_wb_correction_to_warped` wrapper + `correct_with_strip_or_fallback` for live ingest |
| `src/xcs_gen_web/services/capture.py` (modify) | Compute layout with `with_perimeter_strip` when material qualifies, sample edges, persist outcome |
| `src/xcs_gen_web/services/xcs.py` (modify) | Look up material calibration, plumb through converter |
| `src/xcs_gen_web/converter.py` (modify) | Accept `calibration_by_material_id` kwarg, route per-test in the gradient loop |
| `src/xcs_gen_web/schemas.py` (modify) | `MaterialCalibrationConfig`, `MaterialCalibrationPatch`, `ResultWBState` + extend `MaterialResponse`, `ResultResponse` |
| `src/xcs_gen_web/app.py` (modify) | New routes: `GET/PATCH /api/materials/{id}/calibration`, `POST /api/results/{id}/reingest`. Pass `wb` in `_result_to_response`. |
| `src/xcs_gen_web/repositories/materials.py` (modify) | Read/write 2 new cols + `update_material_calibration` helper |
| `src/xcs_gen_web/repositories/results.py` (modify) | Read/write 4 new cols + nested `wb` block + `update_wb_state` helper |
| `src/xcs_gen/capture/layout.py` (modify) | `PerimeterStrip` dataclass + `with_perimeter_strip` kwarg + position math |
| `src/xcs_gen/capture/marker_render.py` (modify) | `render_perimeter_strip` emits 4 `Rect` elements |
| `src/xcs_gen/generators.py` (modify) | `perimeter_strip_params` kwarg, emit strip when set, push `gradient_start_y` to clear summary text |
| `tests/test_wb_correction.py` (new) | All correction algorithm tests |
| `tests/test_capture_perimeter_strip.py` (new) | Layout positions + render |
| `tests/test_capture_pipeline_wb.py` (new) | Pipeline wrapper + flat-field on synthetic frame |
| `tests/test_calibration_defaults.py` (new) | `default_clean_pass(substrate)` |
| `tests/test_materials_calibration_api.py` (new) | GET/PATCH calibration round-trip |
| `tests/test_results_reingest_api.py` (new) | Reingest route 404 + happy path |
| `tests/test_generator_wb.py` (new) | `perimeter_strip_params` plumbing |
| `tests/test_capture_pipeline.py` (modify) | Bump `_preprocessing_variants` count test |

### Frontend (TypeScript / React)

| Path | Responsibility |
|---|---|
| `web/src/types.ts` (modify) | `MaterialCalibrationConfig`, `ResultWBState`, extend `Material` and `Result` |
| `web/src/api/wbCalibration.ts` (new) | `getMaterialCalibration`, `patchMaterialCalibration`, `reingestResult` |
| `web/src/components/BaseParamsEditor.tsx` (new) | Extract shared `BaseParams` 2-column form so the calibration panel + existing places can share it |
| `web/src/components/MaterialEditDialog.tsx` (modify) | Add Calibration section: `wb_supported` toggle + `BaseParamsEditor` for clean-pass params |
| `web/src/components/WBBadge.tsx` (new) | Pill component (FLATFIELD / CHROMA / RAW · NO WB / WB DISABLED) |
| `web/src/components/ResultDebugDialog.tsx` (modify) | Render `WBBadge` near the result header + diagnostic panel below |
| `web/src/components/ResultDetailDialog.tsx` (modify) | "Re-ingest with WB" button alongside existing actions |
| `web/src/pages/StabilityPage.tsx` (modify) | A/B toggle that reverse-applies the flat-field gain when off |

### Changelog

| Path | Responsibility |
|---|---|
| `changelog/2026-05-07-wb-flatfield.md` (new) | Minor-level entry |
| `changelog/images/wb-flatfield-hero.png` (new) | Hero screenshot — material panel + result-detail badge |

---

## Task 0: Verify worktree baseline

- [ ] **Step 1: Backend baseline**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  PYTHONPATH=src XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3
```

Expected: ~680 passing, 0 failed. (`test_demo.py` has a pre-existing in-memory-DB flake unrelated to this work.)

- [ ] **Step 2: Frontend baseline**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/web && \
  npx tsc --noEmit && npm test -- --run 2>&1 | tail -5
```

Expected: TypeScript clean, ~339 vitest passing.

If any baseline step fails, STOP and resolve before adding new code.

---

## Task 1: Schema additions + autogenerate migration

**Files:**
- Modify: `src/xcs_gen_web/models.py` (materials + results table definitions)
- Create: `alembic/versions/0021_wb_flatfield.py` (autogenerated)
- Modify: `.github/workflows/ci.yml` line 144

- [ ] **Step 1: Add columns to `materials` Table**

In `src/xcs_gen_web/models.py`, find the `materials = Table(…)` block. After the existing `is_default` column, BEFORE the `CheckConstraint`, add:

```python
    # WB flat-field calibration — see docs/superpowers/specs/2026-05-07-wb-flatfield-design.md
    Column("wb_supported", Boolean, nullable=False, server_default="1"),
    # Burn parameters for the perimeter clean-pass strip. Stored as a
    # JSON-encoded BaseParams dict. NULL means "use the per-substrate
    # default from calibration_defaults.py".
    Column("clean_pass_params_json", Text, nullable=True),
```

- [ ] **Step 2: Add columns to `results` Table**

Find `results = Table(…)`. After the existing `warped_image_path`, BEFORE the `CheckConstraint(_VISIBILITY_CHECK,…)`, add:

```python
    # WB correction state — populated at ingest. NULL on legacy rows.
    # ``wb_mode`` is one of "flatfield", "chromaticity", "skipped",
    # "disabled" (or NULL for pre-feature legacy rows).
    Column("wb_mode", String(16), nullable=True),
    # flatfield: list of 4 [R, G, B] (top, right, bottom, left).
    # chromaticity: single [R, G, B].
    Column("wb_anchor_rgb_json", Text, nullable=True),
    # flatfield: list of 4 {x_mm, y_mm, R, G, B}.
    # chromaticity: per-channel [sR, sG, sB].
    Column("wb_correction_json", Text, nullable=True),
    # Versioning hook for canonical neutral recalibration; e.g.
    # "v1.steel-default.2026-05-07".
    Column("wb_canonical_id", String(64), nullable=True),
```

- [ ] **Step 3: Verify imports**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  PYTHONPATH=src .venv/bin/python -c "from xcs_gen_web import models; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Autogenerate migration**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.tmp-autogen.db" \
  .venv/bin/alembic upgrade head && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.tmp-autogen.db" \
  .venv/bin/alembic revision --autogenerate -m "WB flat-field: materials + results columns"
```

Rename the autogenerated file to `alembic/versions/0021_wb_flatfield.py`.

```bash
rm /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/.tmp-autogen.db
```

- [ ] **Step 5: Trim the autogenerated migration**

The autogen will likely include unrelated alter_column noise from drift between SQLAlchemy types and SQLite stored types. Compare to the precedent set by `alembic/versions/0019_*.py` and `alembic/versions/0020_*.py`: those are clean column-only files. Trim the autogenerated 0021 to just the 6 `op.add_column` calls + matching `op.drop_column` in `downgrade()`. Confirm:
- `revision = "0021"`, `down_revision = "0020"`
- `upgrade()`: 2 add_column on `materials` + 4 add_column on `results`
- `downgrade()`: 6 drop_column

If autogenerate produced anything other than column adds + drops, STOP and report.

- [ ] **Step 6: Bump CI revision check**

In `.github/workflows/ci.yml` line 144:

```yaml
          test "$VER" = "0021"
```

(Was `"0020"`.)

- [ ] **Step 7: Verify migration applies**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.tmp-migrate.db" \
  .venv/bin/alembic upgrade head && \
  rm /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/.tmp-migrate.db
```

Expected: alembic upgrade through to `0021`, no errors.

- [ ] **Step 8: Backend tests**

```bash
PYTHONPATH=src XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3
```

Expected: 680 passing (no regressions).

- [ ] **Step 9: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/models.py \
  alembic/versions/0021_wb_flatfield.py \
  .github/workflows/ci.yml
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): add materials + results columns for WB state"
```

---

## Task 2: Per-substrate clean-pass defaults

**Files:**
- Create: `src/xcs_gen_web/calibration_defaults.py`
- Create: `tests/test_calibration_defaults.py`

- [ ] **Step 1: Failing test**

Create `tests/test_calibration_defaults.py`:

```python
"""Tests for the per-substrate clean-pass defaults registry."""

from __future__ import annotations

from xcs_gen_web.calibration_defaults import default_clean_pass


def test_stainless_returns_baseparams_dict():
    cp = default_clean_pass("stainless-steel")
    assert isinstance(cp, dict)
    assert {"power", "speed", "frequency", "density", "passes",
            "pulse_width", "laser"}.issubset(cp.keys())


def test_unknown_substrate_returns_none():
    assert default_clean_pass("titanium-magic") is None


def test_returned_dict_is_a_copy():
    a = default_clean_pass("stainless-steel")
    a["power"] = 999
    b = default_clean_pass("stainless-steel")
    assert b["power"] != 999
```

- [ ] **Step 2: Run, expect ImportError**

```bash
PYTHONPATH=src .venv/bin/python -m pytest tests/test_calibration_defaults.py -v
```

- [ ] **Step 3: Implement**

Create `src/xcs_gen_web/calibration_defaults.py`:

```python
"""Per-substrate default clean-pass parameters.

The clean pass produces a known matte finish on the substrate so the
perimeter strip's measured RGB is repeatable across plates. Values
just need to produce a uniform, broadband-neutral surface — exact
target colour doesn't matter.
"""

from __future__ import annotations

from typing import TypedDict


class _BaseParams(TypedDict):
    power: float
    speed: int
    frequency: int
    density: int
    passes: int
    pulse_width: int
    laser: str


_STAINLESS_CLEAN: _BaseParams = {
    "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
    "passes": 2, "pulse_width": 200, "laser": "red",
}


_REGISTRY: dict[str, _BaseParams] = {
    "stainless-steel": _STAINLESS_CLEAN,
}


def default_clean_pass(substrate: str) -> _BaseParams | None:
    """Returns a copy of the default clean-pass params for ``substrate``,
    or ``None`` if the substrate isn't in the registry."""
    cp = _REGISTRY.get(substrate)
    if cp is None:
        return None
    return dict(cp)  # type: ignore[return-value]
```

- [ ] **Step 4: Run, expect 3 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/calibration_defaults.py \
  tests/test_calibration_defaults.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): per-substrate default clean-pass params"
```

---

## Task 3: WB correction module — chromaticity-only fallback (TDD)

**Files:**
- Create: `src/xcs_gen_web/wb_correction.py`
- Create: `tests/test_wb_correction.py`

The chromaticity-only path goes first because it's the simpler primitive and the orchestrator falls back to it. Anchored-flat-field comes in Task 4.

- [ ] **Step 1: Failing test**

Create `tests/test_wb_correction.py`:

```python
"""Tests for the WB correction algorithms."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.wb_correction import (
    chromaticity_correct,
    ChromaticityResult,
)

# Canonical reference for stainless-ish silver: G normalised to 1.0,
# B/G ~ 0.91 (derived from samples/color/* empirical work).
U_CANON = (1.0, 1.0, 0.91)


def _frame(color: tuple[int, int, int], h: int = 100, w: int = 100) -> np.ndarray:
    """A flat solid-colour frame in BGR (OpenCV's native order)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, :] = (color[2], color[1], color[0])
    return img


def test_chromaticity_correct_neutralises_warm_cast_to_canonical():
    img = _frame((150, 140, 110))   # R=150, G=140, B=110
    out = chromaticity_correct(img, (150.0, 140.0, 110.0), U_CANON)
    assert isinstance(out, ChromaticityResult)
    px = out.frame[50, 50]   # BGR
    R, G, B = float(px[2]), float(px[1]), float(px[0])
    assert abs(R / G - U_CANON[0]) < 0.02
    assert abs(B / G - U_CANON[2]) < 0.02


def test_chromaticity_no_op_when_already_canonical():
    Gv = 120
    Rv = int(Gv * U_CANON[0])
    Bv = int(Gv * U_CANON[2])
    img = _frame((Rv, Gv, Bv))
    out = chromaticity_correct(img, (Rv, Gv, Bv), U_CANON)
    assert np.allclose(out.frame, img, atol=1)


def test_chromaticity_records_scale_factors():
    img = _frame((150, 140, 110))
    out = chromaticity_correct(img, (150.0, 140.0, 110.0), U_CANON)
    # G is the anchor; scale stays exactly 1.0
    assert abs(out.scales[1] - 1.0) < 1e-9
    assert out.scales[0] != 1.0
    assert out.scales[2] != 1.0
```

- [ ] **Step 2: Run, expect ImportError**

```bash
PYTHONPATH=src .venv/bin/python -m pytest tests/test_wb_correction.py -v
```

- [ ] **Step 3: Implement**

Create `src/xcs_gen_web/wb_correction.py`:

```python
"""WB correction for ingested test photos.

Spec: docs/superpowers/specs/2026-05-07-wb-flatfield-design.md

Two correction modes:

- **Flat-field** (preferred): bilinear gain across 4 perimeter
  clean-pass strips, neutralises both colour cast AND spatial
  brightness variance.
- **Chromaticity-only** (fallback): single per-channel ratio
  derived from unburned material around the markers; neutralises
  colour cast only.

The orchestrator ``correct_warped_frame`` picks flat-field when
inputs allow, falls back to chromaticity, otherwise marks skipped.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class ChromaticityResult:
    """Output of chromaticity correction."""
    frame: np.ndarray             # BGR uint8, same shape as input
    measured_rgb: tuple[float, float, float]   # the U we measured (R, G, B)
    scales: tuple[float, float, float]         # per-channel multiplicative factors


def chromaticity_correct(
    frame_bgr: np.ndarray,
    unburned_rgb: tuple[float, float, float],
    canonical_rgb: tuple[float, float, float],
) -> ChromaticityResult:
    """Apply chromaticity-only correction.

    Per-channel scale factors normalise the photo's measured unburned-
    material ratios to the canonical ratios; G is the anchor (s_G=1)
    so absolute luminance is preserved.
    """
    Ru, Gu, Bu = unburned_rgb
    Rc, Gc, Bc = canonical_rgb
    if Gu <= 0:
        return ChromaticityResult(
            frame=frame_bgr.copy(),
            measured_rgb=unburned_rgb,
            scales=(1.0, 1.0, 1.0),
        )
    sR = (Rc / Gc) * Gu / Ru if Ru > 0 else 1.0
    sG = 1.0
    sB = (Bc / Gc) * Gu / Bu if Bu > 0 else 1.0

    # OpenCV uses BGR; index 0=B, 1=G, 2=R.
    f = frame_bgr.astype(np.float32)
    f[:, :, 0] *= sB
    f[:, :, 1] *= sG
    f[:, :, 2] *= sR
    out = np.clip(f, 0, 255).astype(np.uint8)

    return ChromaticityResult(
        frame=out,
        measured_rgb=unburned_rgb,
        scales=(sR, sG, sB),
    )
```

- [ ] **Step 4: Run, expect 3 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): chromaticity-only correction primitive"
```

---

## Task 4: Specular rejection helper (TDD)

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing test**

```python
from xcs_gen_web.wb_correction import (
    reject_specular,
    SpecularRejectionResult,
)


def test_reject_specular_drops_top_quartile_by_luminance():
    pixels_rgb = np.array(
        [[100, 100, 100]] * 75 + [[250, 250, 250]] * 25,
        dtype=np.float32,
    )
    out = reject_specular(pixels_rgb, top_pct=0.25)
    assert isinstance(out, SpecularRejectionResult)
    assert out.kept.shape[0] == 75
    assert np.allclose(out.kept.mean(axis=0), [100, 100, 100], atol=1)


def test_reject_specular_handles_empty_input():
    out = reject_specular(np.zeros((0, 3), dtype=np.float32))
    assert out.kept.shape[0] == 0
```

- [ ] **Step 2: Run, expect ImportError**

- [ ] **Step 3: Append to `wb_correction.py`**

```python
@dataclass
class SpecularRejectionResult:
    kept: np.ndarray
    rejected: np.ndarray
    rejected_count: int


def reject_specular(
    pixels_rgb: np.ndarray,
    *,
    top_pct: float = 0.25,
) -> SpecularRejectionResult:
    """Drop the brightest ``top_pct`` of pixels by luminance."""
    if pixels_rgb.size == 0:
        return SpecularRejectionResult(
            kept=pixels_rgb, rejected=pixels_rgb, rejected_count=0
        )
    lum = (
        0.299 * pixels_rgb[:, 0]
        + 0.587 * pixels_rgb[:, 1]
        + 0.114 * pixels_rgb[:, 2]
    )
    cutoff = np.quantile(lum, 1.0 - top_pct)
    keep_mask = lum <= cutoff
    return SpecularRejectionResult(
        kept=pixels_rgb[keep_mask],
        rejected=pixels_rgb[~keep_mask],
        rejected_count=int((~keep_mask).sum()),
    )
```

- [ ] **Step 4: Run, expect 5 passed total**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): specular-rejection helper"
```

---

## Task 5: Strip line sampling (TDD)

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing test**

```python
from xcs_gen_web.wb_correction import sample_strip_line


def test_sample_strip_line_walks_a_horizontal_strip():
    # 200x200 px frame. Plant a known colour along a horizontal
    # band from (10, 95) to (190, 105) — that's the strip's rect.
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[95:106, 10:191, 0] = 80   # B
    img[95:106, 10:191, 1] = 160  # G
    img[95:106, 10:191, 2] = 200  # R
    out = sample_strip_line(
        img,
        x0_mm=10.0, y0_mm=25.0, x1_mm=190.0, y1_mm=25.0,
        px_per_mm=4.0, sample_step_mm=2.0, sample_size_mm=1.5,
    )
    # The strip's centre line at y=25 mm with px_per_mm=4 lands at
    # row 100, exactly within the painted band.
    assert out is not None
    R, G, B = out
    assert abs(R - 200) < 2 and abs(G - 160) < 2 and abs(B - 80) < 2


def test_sample_strip_line_returns_none_when_box_off_frame():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    out = sample_strip_line(
        img,
        x0_mm=-50.0, y0_mm=-50.0, x1_mm=-40.0, y1_mm=-50.0,
        px_per_mm=4.0, sample_step_mm=2.0, sample_size_mm=1.5,
    )
    assert out is None
```

- [ ] **Step 2: Run, expect ImportError**

- [ ] **Step 3: Append to `wb_correction.py`**

```python
def sample_strip_line(
    frame_bgr: np.ndarray,
    *,
    x0_mm: float, y0_mm: float, x1_mm: float, y1_mm: float,
    px_per_mm: float,
    sample_step_mm: float = 2.0,
    sample_size_mm: float = 1.5,
) -> tuple[float, float, float] | None:
    """Walk a strip's centre-line in burn-space mm, sample a small
    box at every ``sample_step_mm``, specular-reject, then pool to
    one (R, G, B). Returns ``None`` when no usable samples survive.
    """
    length_mm = float(np.hypot(x1_mm - x0_mm, y1_mm - y0_mm))
    if length_mm <= 0:
        return None
    n = max(2, int(length_mm / sample_step_mm) + 1)
    half_box_px = (sample_size_mm * px_per_mm) / 2.0
    h, w = frame_bgr.shape[:2]
    pooled: list[np.ndarray] = []
    for i in range(n):
        t = i / (n - 1)
        cx_mm = x0_mm + t * (x1_mm - x0_mm)
        cy_mm = y0_mm + t * (y1_mm - y0_mm)
        cx_px = int(cx_mm * px_per_mm)
        cy_px = int(cy_mm * px_per_mm)
        x0 = max(0, int(cx_px - half_box_px))
        y0 = max(0, int(cy_px - half_box_px))
        x1 = min(w, int(cx_px + half_box_px))
        y1 = min(h, int(cy_px + half_box_px))
        if x1 <= x0 or y1 <= y0:
            continue
        sub = frame_bgr[y0:y1, x0:x1]
        rgb = sub[:, :, ::-1].reshape(-1, 3).astype(np.float32)
        kept = reject_specular(rgb).kept
        if kept.size == 0:
            continue
        pooled.append(kept)
    if not pooled:
        return None
    all_kept = np.concatenate(pooled, axis=0)
    # Reject per-point outliers > 2σ from the strip's pooled mean
    # before averaging — guards against a single sample box that
    # happened to straddle a scratch.
    mean = all_kept.mean(axis=0)
    sigma = all_kept.std(axis=0)
    if float(sigma.max()) > 0:
        keep = np.all(
            np.abs(all_kept - mean) <= 2.0 * np.maximum(sigma, 1.0),
            axis=1,
        )
        if keep.any():
            all_kept = all_kept[keep]
    final = all_kept.mean(axis=0)
    return float(final[0]), float(final[1]), float(final[2])
```

- [ ] **Step 4: Run, expect 7 passed total**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): strip line sampler"
```

---

## Task 6: Flat-field correction (TDD)

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing tests**

```python
from xcs_gen_web.wb_correction import (
    flatfield_correct,
    FlatFieldResult,
)


def test_flatfield_correct_uniform_lighting_recovers_canonical():
    # When all 4 edges measure exactly the canonical neutral, the
    # gain is 1.0 everywhere → frame returns unchanged.
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    canonical = (160.0, 160.0, 145.0)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": (160.0, 160.0, 145.0),
    }
    out = flatfield_correct(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0),
            "right": (100.0, 50.0),
            "bottom": (50.0, 100.0),
            "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=canonical,
        px_per_mm=1.0,
    )
    assert isinstance(out, FlatFieldResult)
    assert np.allclose(out.frame, img, atol=1)


def test_flatfield_correct_gradient_pulls_dim_side_brighter():
    # Plant a measured-vs-canonical mismatch only on the left edge
    # (left is darker than canonical) and confirm the corrected
    # frame is brighter on the left than on the right at row centre.
    img = np.full((100, 100, 3), 100, dtype=np.uint8)
    canonical = (160.0, 160.0, 145.0)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": (80.0, 80.0, 73.0),  # darker → gain > 1 near left
    }
    out = flatfield_correct(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0),
            "right": (100.0, 50.0),
            "bottom": (50.0, 100.0),
            "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=canonical,
        px_per_mm=1.0,
    )
    left_px = out.frame[50, 5]
    right_px = out.frame[50, 95]
    # Left side should now be brighter than the right side.
    assert int(left_px[1]) > int(right_px[1])
```

- [ ] **Step 2: Run, expect ImportError**

- [ ] **Step 3: Append to `wb_correction.py`**

```python
@dataclass
class FlatFieldResult:
    frame: np.ndarray
    edge_means: dict[str, tuple[float, float, float]]
    edge_positions: dict[str, tuple[float, float]]
    canonical_neutral: tuple[float, float, float]


def flatfield_correct(
    frame_bgr: np.ndarray,
    *,
    edge_means: dict[str, tuple[float, float, float]],
    edge_positions: dict[str, tuple[float, float]],
    grid_bbox: tuple[float, float, float, float],   # x_min, y_min, x_max, y_max in mm
    canonical_neutral: tuple[float, float, float],
    px_per_mm: float,
) -> FlatFieldResult:
    """Apply per-pixel bilinear-blend gain across the frame.

    For each pixel at burn-space (mm) position p, the interpolated
    measured RGB is (h_lerp + v_lerp) / 2 where h_lerp blends left and
    right edges, v_lerp blends top and bottom. Per-channel gain at p
    is canonical / interpolated; pixel value scales accordingly.
    """
    h, w = frame_bgr.shape[:2]
    canonical = np.asarray(canonical_neutral, dtype=np.float32)
    top = np.asarray(edge_means["top"], dtype=np.float32)
    right = np.asarray(edge_means["right"], dtype=np.float32)
    bottom = np.asarray(edge_means["bottom"], dtype=np.float32)
    left = np.asarray(edge_means["left"], dtype=np.float32)

    # Build (u, v) grids in [0, 1] across the frame, then convert to
    # burn-space mm and finally to grid_bbox-relative coordinates so
    # the blend sees u=0 at grid_x_min and u=1 at grid_x_max.
    x_min, y_min, x_max, y_max = grid_bbox
    grid_w_mm = max(x_max - x_min, 1e-3)
    grid_h_mm = max(y_max - y_min, 1e-3)
    px_x = np.arange(w, dtype=np.float32) / px_per_mm
    px_y = np.arange(h, dtype=np.float32) / px_per_mm
    u_row = np.clip((px_x - x_min) / grid_w_mm, 0.0, 1.0)
    v_col = np.clip((px_y - y_min) / grid_h_mm, 0.0, 1.0)
    U, V = np.meshgrid(u_row, v_col)              # both (h, w)

    # Per-channel interpolated RGB at every pixel — broadcast over channels.
    # h_lerp = (1-u)*left + u*right, v_lerp = (1-v)*top + v*bottom
    h_lerp = (1 - U)[..., None] * left + U[..., None] * right     # (h, w, 3)
    v_lerp = (1 - V)[..., None] * top + V[..., None] * bottom     # (h, w, 3)
    interpolated = (h_lerp + v_lerp) / 2.0                         # (h, w, 3) RGB

    # Per-pixel per-channel gain. Guard against zero divides.
    gain = canonical / np.maximum(interpolated, 1.0)               # (h, w, 3) RGB

    f = frame_bgr.astype(np.float32)
    # OpenCV BGR ↔ our gain is RGB. Reverse the last axis to align.
    gain_bgr = gain[:, :, ::-1]
    out = np.clip(f * gain_bgr, 0, 255).astype(np.uint8)

    return FlatFieldResult(
        frame=out,
        edge_means=edge_means,
        edge_positions=edge_positions,
        canonical_neutral=canonical_neutral,
    )
```

- [ ] **Step 4: Run, expect 9 passed total**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): bilinear flat-field correction"
```

---

## Task 7: Orchestrator (TDD)

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing tests**

```python
from xcs_gen_web.wb_correction import (
    correct_warped_frame,
    CorrectionOutcome,
)


def test_orchestrator_picks_flatfield_when_4_edges_present():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": (160.0, 160.0, 145.0),
    }
    out = correct_warped_frame(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=None,
    )
    assert isinstance(out, CorrectionOutcome)
    assert out.mode == "flatfield"
    assert out.applied is True


def test_orchestrator_synthesises_missing_edge_when_3_present():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": (160.0, 160.0, 145.0),
        "bottom": (160.0, 160.0, 145.0),
        "left": None,   # missing
    }
    out = correct_warped_frame(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=(150.0, 140.0, 110.0),
    )
    assert out.mode == "flatfield"
    assert out.applied is True


def test_orchestrator_falls_back_to_chromaticity_when_2_edges():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    edges = {
        "top": (160.0, 160.0, 145.0),
        "right": None,
        "bottom": (160.0, 160.0, 145.0),
        "left": None,
    }
    out = correct_warped_frame(
        img,
        edge_means=edges,
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=(150.0, 140.0, 110.0),
    )
    assert out.mode == "chromaticity"
    assert out.applied is True


def test_orchestrator_skips_when_no_inputs():
    img = np.full((100, 100, 3), 128, dtype=np.uint8)
    out = correct_warped_frame(
        img,
        edge_means={"top": None, "right": None, "bottom": None, "left": None},
        edge_positions={
            "top": (50.0, 0.0), "right": (100.0, 50.0),
            "bottom": (50.0, 100.0), "left": (0.0, 50.0),
        },
        grid_bbox=(0.0, 0.0, 100.0, 100.0),
        canonical_neutral=(160.0, 160.0, 145.0),
        px_per_mm=1.0,
        unburned_rgb=None,
    )
    assert out.mode == "skipped"
    assert out.applied is False
    assert np.array_equal(out.frame, img)
```

- [ ] **Step 2: Run, expect ImportError**

- [ ] **Step 3: Append to `wb_correction.py`**

```python
@dataclass
class CorrectionOutcome:
    """High-level result returned to the capture pipeline."""
    frame: np.ndarray
    mode: str             # "flatfield" | "chromaticity" | "skipped"
    applied: bool
    edge_means: dict[str, tuple[float, float, float]] | None
    edge_positions: dict[str, tuple[float, float]] | None
    chromaticity_anchor_rgb: tuple[float, float, float] | None
    chromaticity_scales: tuple[float, float, float] | None
    canonical_id: str | None


def correct_warped_frame(
    frame_bgr: np.ndarray,
    *,
    edge_means: dict[str, tuple[float, float, float] | None],
    edge_positions: dict[str, tuple[float, float]],
    grid_bbox: tuple[float, float, float, float],
    canonical_neutral: tuple[float, float, float] = (160.0, 160.0, 145.0),
    px_per_mm: float = 10.0,
    unburned_rgb: tuple[float, float, float] | None = None,
    canonical_id: str | None = None,
) -> CorrectionOutcome:
    """Top-level correction entry point.

    Counts how many of the 4 edges produced a non-None measurement.
    ≥3 → flat-field path (synthesising any single missing edge as
    the mean of the other three so the bilinear blend has 4 corners
    to read from). 2 or fewer → chromaticity-only fallback when
    ``unburned_rgb`` is set; otherwise skip.
    """
    usable = {k: v for k, v in edge_means.items() if v is not None}
    if len(usable) >= 3:
        if len(usable) == 3:
            mean_rgb = tuple(
                float(np.mean([v[i] for v in usable.values()]))
                for i in range(3)
            )
            for key in ("top", "right", "bottom", "left"):
                if key not in usable:
                    usable[key] = mean_rgb     # type: ignore[assignment]
        ff = flatfield_correct(
            frame_bgr,
            edge_means=usable,
            edge_positions=edge_positions,
            grid_bbox=grid_bbox,
            canonical_neutral=canonical_neutral,
            px_per_mm=px_per_mm,
        )
        return CorrectionOutcome(
            frame=ff.frame,
            mode="flatfield",
            applied=True,
            edge_means=ff.edge_means,
            edge_positions=ff.edge_positions,
            chromaticity_anchor_rgb=None,
            chromaticity_scales=None,
            canonical_id=canonical_id,
        )

    if unburned_rgb is not None:
        canon_normalised = (
            canonical_neutral[0] / max(canonical_neutral[1], 1e-3),
            1.0,
            canonical_neutral[2] / max(canonical_neutral[1], 1e-3),
        )
        chrom = chromaticity_correct(
            frame_bgr,
            unburned_rgb=unburned_rgb,
            canonical_rgb=canon_normalised,
        )
        return CorrectionOutcome(
            frame=chrom.frame,
            mode="chromaticity",
            applied=True,
            edge_means=None,
            edge_positions=None,
            chromaticity_anchor_rgb=chrom.measured_rgb,
            chromaticity_scales=chrom.scales,
            canonical_id=canonical_id,
        )

    return CorrectionOutcome(
        frame=frame_bgr.copy(),
        mode="skipped",
        applied=False,
        edge_means=None,
        edge_positions=None,
        chromaticity_anchor_rgb=None,
        chromaticity_scales=None,
        canonical_id=canonical_id,
    )
```

- [ ] **Step 4: Run, expect 13 passed total**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): correction orchestrator (flat-field → chromaticity → skip)"
```

---

## Task 8: Layout — perimeter strip geometry (TDD)

**Files:**
- Modify: `src/xcs_gen/capture/layout.py`
- Create: `tests/test_capture_perimeter_strip.py`

- [ ] **Step 1: Read the layout module first** so you can map where existing fields like `qr.x`, `qr.size`, `arucos[ar.marker_id == 1]` etc. live. Look at `MarkerPosition`, `RegistrationLayout`, `compute_layout`. Existing constants: `MARKER_MARGIN_MM = 1.5`, `QR_SIZE_DEFAULT_MM = 5.0`, `ARUCO_SIZE_DEFAULT_MM = 2.0`. ArUco IDs: 1 = top-right, 2 = bottom-left, 3 = bottom-right.

- [ ] **Step 2: Failing tests**

Create `tests/test_capture_perimeter_strip.py`:

```python
"""Tests for the perimeter-strip extension to the registration layout."""

from __future__ import annotations

from xcs_gen.capture.layout import (
    PerimeterStrip,
    PerimeterStripSegment,
    compute_layout,
)


def test_strip_disabled_by_default():
    layout = compute_layout(grid_x=10, grid_y=10, grid_w=50, grid_h=50)
    assert layout.perimeter_strip is None


def test_strip_enabled_returns_4_segments():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_perimeter_strip=True,
    )
    strip = layout.perimeter_strip
    assert isinstance(strip, PerimeterStrip)
    sides = {s.side for s in strip.segments}
    assert sides == {"top", "right", "bottom", "left"}
    for seg in strip.segments:
        assert isinstance(seg, PerimeterStripSegment)
        assert seg.width_mm == 3.0
        # Each segment is non-degenerate.
        length = ((seg.x1 - seg.x0) ** 2 + (seg.y1 - seg.y0) ** 2) ** 0.5
        assert length > 5.0


def test_top_strip_runs_between_qr_and_top_right_aruco():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_perimeter_strip=True,
    )
    qr = layout.qr
    tr = next(a for a in layout.arucos if a.marker_id == 1)
    top = next(s for s in layout.perimeter_strip.segments if s.side == "top")
    # Top strip starts to the right of QR's right edge and ends to
    # the left of the top-right ArUco's left edge.
    assert top.x0 >= qr.x + qr.size
    assert top.x1 <= tr.x
    # Both endpoints share the same y on the top edge.
    assert abs(top.y0 - top.y1) < 0.01


def test_strip_falls_back_when_grid_too_narrow():
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=4, grid_h=20,
        with_perimeter_strip=True,
    )
    assert layout.perimeter_strip is None
```

- [ ] **Step 3: Run, expect ImportError**

```bash
PYTHONPATH=src .venv/bin/python -m pytest tests/test_capture_perimeter_strip.py -v
```

- [ ] **Step 4: Implement**

In `src/xcs_gen/capture/layout.py`:

**a)** Add new constant near the existing ones:

```python
PERIMETER_STRIP_WIDTH_MM = 3.0
PERIMETER_STRIP_INSET_MM = 1.0   # gap between strip endpoint and adjacent marker edge
```

**b)** Add new dataclasses after `MarkerPosition`:

```python
@dataclass
class PerimeterStripSegment:
    """One side of the perimeter clean-pass strip.

    ``side`` ∈ {"top", "right", "bottom", "left"}. Coords are
    burn-space mm; the segment is conceptually the centre-line of
    the strip (the renderer expands by ``width_mm / 2`` on each
    side to get the burned rectangle)."""
    side: str
    x0: float
    y0: float
    x1: float
    y1: float
    width_mm: float


@dataclass
class PerimeterStrip:
    segments: list[PerimeterStripSegment]
```

**c)** Modify `RegistrationLayout` to add the strip field:

```python
@dataclass
class RegistrationLayout:
    qr: MarkerPosition | None
    arucos: list[MarkerPosition]
    perimeter_strip: PerimeterStrip | None = None
```

**d)** Extend `compute_layout` — add new kwargs to its signature, and after the four corner markers are computed, add the strip-position block. Update the return statement to pass `perimeter_strip=strip`.

New kwargs:

```python
    with_perimeter_strip: bool = False,
    perimeter_strip_width_mm: float = PERIMETER_STRIP_WIDTH_MM,
    perimeter_strip_inset_mm: float = PERIMETER_STRIP_INSET_MM,
```

Strip-positioning block (insert AFTER the existing marker computations, BEFORE `return RegistrationLayout(...)`):

```python
    strip: PerimeterStrip | None = None
    if mode == "on" and with_perimeter_strip and qr_x >= 0 and qr_y >= 0:
        # Place each strip's centre-line just outside the grid by
        # half the strip width plus a small margin so the burned band
        # doesn't crash into the grid cells.
        offset = perimeter_strip_width_mm / 2.0 + MARKER_MARGIN_MM
        seg_top = PerimeterStripSegment(
            side="top",
            x0=qr_x + qr_size + perimeter_strip_inset_mm,
            y0=grid_y - offset,
            x1=tr.x - perimeter_strip_inset_mm,
            y1=grid_y - offset,
            width_mm=perimeter_strip_width_mm,
        )
        seg_right = PerimeterStripSegment(
            side="right",
            x0=grid_x + grid_w + offset,
            y0=tr.y + tr.size + perimeter_strip_inset_mm,
            x1=grid_x + grid_w + offset,
            y1=br.y - perimeter_strip_inset_mm,
            width_mm=perimeter_strip_width_mm,
        )
        seg_bottom = PerimeterStripSegment(
            side="bottom",
            x0=br.x - perimeter_strip_inset_mm,
            y0=grid_y + grid_h + offset,
            x1=bl.x + bl.size + perimeter_strip_inset_mm,
            y1=grid_y + grid_h + offset,
            width_mm=perimeter_strip_width_mm,
        )
        seg_left = PerimeterStripSegment(
            side="left",
            x0=grid_x - offset,
            y0=bl.y - perimeter_strip_inset_mm,
            x1=grid_x - offset,
            y1=qr_y + qr_size + perimeter_strip_inset_mm,
            width_mm=perimeter_strip_width_mm,
        )
        # Reject if any segment ended up degenerate (grid too small).
        segs = [seg_top, seg_right, seg_bottom, seg_left]
        if all(
            ((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2) ** 0.5 >= 5.0
            for s in segs
        ):
            strip = PerimeterStrip(segments=segs)
```

(Note: variable names `qr_x`, `qr_y`, `qr_size`, `tr`, `bl`, `br` should already exist in `compute_layout` from the existing marker-positioning logic.)

- [ ] **Step 5: Run, expect 4 passed**

- [ ] **Step 6: Run full backend suite**

Expected: same count as baseline + 4 new (no regressions; existing layout tests pass with the optional new kwargs).

- [ ] **Step 7: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen/capture/layout.py tests/test_capture_perimeter_strip.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): perimeter strip geometry in compute_layout"
```

---

## Task 9: Strip emission (TDD)

**Files:**
- Modify: `src/xcs_gen/capture/marker_render.py`
- Modify: `tests/test_capture_perimeter_strip.py`

- [ ] **Step 1: Append failing test**

```python
from xcs_gen.capture.marker_render import render_perimeter_strip


def test_render_emits_4_rect_elements():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_perimeter_strip=True,
    )
    strip = layout.perimeter_strip
    assert strip is not None
    clean_params = {
        "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
        "passes": 2, "pulse_width": 200, "laser": "red",
    }
    elements = render_perimeter_strip(strip, clean_params=clean_params)
    assert len(elements) == 4
    # Each element is a Rect of the right width.
    for el in elements:
        assert el.width >= 5.0   # at least 5 mm long
        assert el.height == 3.0 or el.width == 3.0   # one axis is the strip width
```

- [ ] **Step 2: Run, expect ImportError**

- [ ] **Step 3: Implement**

Append to `src/xcs_gen/capture/marker_render.py`:

```python
from typing import Any   # if not already imported


def render_perimeter_strip(
    strip: "PerimeterStrip",
    *,
    clean_params: dict[str, Any],
) -> list["Rect"]:
    """Emit the perimeter strip as 4 ``Rect`` elements (one per side).

    Each segment's centre-line + ``width_mm`` define a rectangle.
    Horizontal segments (top, bottom) extend in x; vertical segments
    (left, right) extend in y.
    """
    from xcs_gen.model import Rect, ProcessingParams
    from .layout import PerimeterStrip   # noqa: F401  typing only

    def _to_pp(d: dict[str, Any]) -> ProcessingParams:
        return ProcessingParams(
            power=d["power"], speed=d["speed"],
            mopa_frequency=d["frequency"], density=d["density"],
            repeat=d["passes"], pulse_width=d["pulse_width"],
            processing_light_source=d["laser"],
        )

    out: list[Rect] = []
    pp = _to_pp(clean_params)
    half_w = 0.0   # set per segment based on orientation
    for seg in strip.segments:
        if seg.side in ("top", "bottom"):
            x0 = min(seg.x0, seg.x1)
            x1 = max(seg.x0, seg.x1)
            cy = (seg.y0 + seg.y1) / 2.0
            y0 = cy - seg.width_mm / 2.0
            rect_w = x1 - x0
            rect_h = seg.width_mm
        else:   # "left", "right"
            y0 = min(seg.y0, seg.y1)
            y1 = max(seg.y0, seg.y1)
            cx = (seg.x0 + seg.x1) / 2.0
            x0 = cx - seg.width_mm / 2.0
            rect_w = seg.width_mm
            rect_h = y1 - y0
        out.append(Rect(
            x=x0, y=y0,
            width=rect_w, height=rect_h,
            params=pp,
            processing_type="COLOR_FILL_ENGRAVE",
            layer_color=f"#wb_{seg.side}",
        ))
    return out
```

- [ ] **Step 4: Run, expect 5 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen/capture/marker_render.py tests/test_capture_perimeter_strip.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): emit 4 perimeter strip Rects"
```

---

## Task 10: Generator plumbing (TDD)

**Files:**
- Modify: `src/xcs_gen/generators.py`
- Create: `tests/test_generator_wb.py`

- [ ] **Step 1: Failing test**

Create `tests/test_generator_wb.py`:

```python
"""Tests for perimeter-strip plumbing through generate_gradient."""

from __future__ import annotations

from xcs_gen.generators import generate_gradient


def test_no_strip_when_kwarg_omitted():
    project = generate_gradient(
        x_param="power", x_min=10, x_max=100, x_steps=5,
        total_width=80, total_height=20,
        registration_mode="on", test_id=42,
    )
    # Only the gradient cells (5 of them, plus annotation/markers).
    # No strip-named layer colours present.
    layer_colours = {el.layer_color for el in project.elements}
    assert not any(c.startswith("#wb_") for c in layer_colours)


def test_strip_emitted_when_params_provided():
    clean_params = {
        "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
        "passes": 2, "pulse_width": 200, "laser": "red",
    }
    project = generate_gradient(
        x_param="power", x_min=10, x_max=100, x_steps=5,
        total_width=80, total_height=20,
        registration_mode="on", test_id=42,
        perimeter_strip_params=clean_params,
    )
    layer_colours = {el.layer_color for el in project.elements}
    assert any(c == "#wb_top" for c in layer_colours)
    assert any(c == "#wb_right" for c in layer_colours)
    assert any(c == "#wb_bottom" for c in layer_colours)
    assert any(c == "#wb_left" for c in layer_colours)
```

- [ ] **Step 2: Run, expect TypeError on the unknown kwarg**

- [ ] **Step 3: Implement**

In `src/xcs_gen/generators.py`:

**a)** Add the import alongside existing capture imports:

```python
from .capture.marker_render import (
    emit_registration_markers,
    render_perimeter_strip,
)
```

**b)** Add the new kwarg to `generate_gradient`:

```python
    perimeter_strip_params: dict | None = None,
```

**c)** In the existing markers-and-strip block (where `compute_layout` is called and `emit_registration_markers` runs), wire the strip:

```python
        strip_enabled = perimeter_strip_params is not None
        layout = compute_layout(
            grid_x=start_x,
            grid_y=gradient_start_y,
            grid_w=total_width,
            grid_h=grid_h,
            mode=registration_mode,  # type: ignore[arg-type]
            qr_size_mm=registration_qr_size_mm,
            aruco_size_mm=registration_aruco_size_mm,
            with_perimeter_strip=strip_enabled,
        )
        emit_registration_markers(
            project,
            layout=layout,
            test_id=test_id,
            retest_index=retest_index,
            annotation_params=annotation_params,
        )
        if strip_enabled and layout.perimeter_strip is not None:
            project.elements.extend(
                render_perimeter_strip(
                    layout.perimeter_strip,
                    clean_params=perimeter_strip_params,
                )
            )
```

**d)** Where `gradient_start_y` is computed earlier in the function, add a comment-documented push-down so summary text stays above the strip band:

```python
    summary_h = len(summary_lines) * summary_line_h + 0.05
    gradient_start_y = start_y + summary_h
    if perimeter_strip_params is not None:
        # Reserve room above the grid for the top perimeter strip's
        # 3 mm width + the 1.5 mm margin between strip and grid edge.
        gradient_start_y += 3.0 + 1.5
```

- [ ] **Step 4: Run, expect 2 passed**

- [ ] **Step 5: Run full backend suite**

Expected: existing generator tests still pass.

- [ ] **Step 6: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen/generators.py tests/test_generator_wb.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): generate_gradient emits perimeter strip when configured"
```

---

## Task 11: Repository read/write for new columns

**Files:**
- Modify: `src/xcs_gen_web/repositories/materials.py`
- Modify: `src/xcs_gen_web/repositories/results.py`

This task is mechanical. Read both repositories end-to-end first to understand their conventions (`session_scope`, `materials.update()`, `_row` patterns).

- [ ] **Step 1: Materials repo**

In `_row_to_dict` (or equivalent), add:

```python
    wb_supported_raw = getattr(r, "wb_supported", None)
    cp_raw = getattr(r, "clean_pass_params_json", None)
    return {
        ...   # existing keys
        "wb_supported": True if wb_supported_raw is None else bool(wb_supported_raw),
        "clean_pass_params": json.loads(cp_raw) if cp_raw else None,
    }
```

Add at file scope (alongside other update helpers):

```python
def update_material_calibration(
    mid: int,
    *,
    owner_id: int = STANDALONE_USER_ID,
    wb_supported: bool | None = None,
    clean_pass_params: dict | None = None,
) -> None:
    """Patch the WB-flat-field columns on a material. Pass only the
    fields you want to overwrite."""
    fields: dict[str, Any] = {}
    if wb_supported is not None:
        fields["wb_supported"] = wb_supported
    if clean_pass_params is not None:
        fields["clean_pass_params_json"] = json.dumps(clean_pass_params)
    if not fields:
        return
    with session_scope() as s:
        result = s.execute(
            materials.update()
            .where(
                and_(materials.c.id == mid, materials.c.owner_id == owner_id),
            )
            .values(**fields)
        )
        if result.rowcount == 0:
            raise KeyError(mid)
```

(`json` import goes at the top alongside other imports if not already there.)

- [ ] **Step 2: Results repo**

In `_row` (or equivalent), add:

```python
    wb_anchor_raw = getattr(r, "wb_anchor_rgb_json", None)
    wb_correction_raw = getattr(r, "wb_correction_json", None)
    wb_mode = getattr(r, "wb_mode", None)
    return {
        ...   # existing keys
        "wb": (
            {
                "mode": wb_mode,
                "anchor_rgb": (
                    json.loads(wb_anchor_raw) if wb_anchor_raw else None
                ),
                "correction": (
                    json.loads(wb_correction_raw) if wb_correction_raw else None
                ),
                "canonical_id": getattr(r, "wb_canonical_id", None),
            }
            if wb_mode is not None
            else None
        ),
    }
```

Add `update_wb_state` helper:

```python
def update_wb_state(
    result_id: int,
    *,
    mode: str | None,
    anchor_rgb: list | None,
    correction: list | dict | None,
    canonical_id: str | None,
    owner_id: int = STANDALONE_USER_ID,
) -> None:
    """Patch the WB-correction columns on a result row."""
    fields = {
        "wb_mode": mode,
        "wb_anchor_rgb_json": (
            json.dumps(anchor_rgb) if anchor_rgb is not None else None
        ),
        "wb_correction_json": (
            json.dumps(correction) if correction is not None else None
        ),
        "wb_canonical_id": canonical_id,
    }
    with session_scope() as s:
        result = s.execute(
            results.update()
            .where(
                and_(results.c.id == result_id, results.c.owner_id == owner_id),
            )
            .values(**fields)
        )
        if result.rowcount == 0:
            raise KeyError(result_id)
```

- [ ] **Step 3: Run full backend suite, no regressions**

```bash
PYTHONPATH=src XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/repositories/materials.py \
  src/xcs_gen_web/repositories/results.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): repository read/write for new columns"
```

---

## Task 12: Pydantic schemas

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`

- [ ] **Step 1: Append the new schemas**

At the bottom of `src/xcs_gen_web/schemas.py`:

```python
# ---------------------------------------------------------------------------
# WB flat-field calibration.
# Spec: docs/superpowers/specs/2026-05-07-wb-flatfield-design.md
# ---------------------------------------------------------------------------


class MaterialCalibrationConfig(BaseModel):
    """The WB-related fields of a material."""

    wb_supported: bool = True
    clean_pass_params: BaseParams | None = None


class MaterialCalibrationPatch(BaseModel):
    """Wire-format for PATCH /api/materials/{id}/calibration."""

    wb_supported: bool | None = None
    clean_pass_params: BaseParams | None = None


class ResultWBState(BaseModel):
    """Embedded into ResultResponse so the UI can render the badge."""

    mode: str | None = None
    # flat-field: list of 4 [R, G, B] (top, right, bottom, left).
    # chromaticity: single [R, G, B].
    anchor_rgb: list[float] | list[list[float]] | None = None
    # flat-field: list of 4 {x_mm, y_mm, R, G, B}.
    # chromaticity: per-channel [sR, sG, sB] flat list.
    correction: list[dict] | list[float] | None = None
    canonical_id: str | None = None
```

- [ ] **Step 2: Extend `MaterialResponse` and `ResultResponse`**

Find `class MaterialResponse(BaseModel):` and add (near other optional fields):

```python
    calibration: MaterialCalibrationConfig | None = None
```

Find `class ResultResponse(BaseModel):` and add:

```python
    wb: ResultWBState | None = None
```

- [ ] **Step 3: Verify imports**

```bash
PYTHONPATH=src .venv/bin/python -c "from xcs_gen_web.schemas import MaterialCalibrationConfig, MaterialCalibrationPatch, ResultWBState; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add src/xcs_gen_web/schemas.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): Pydantic schemas for calibration + result wb state"
```

---

## Task 13: API — GET/PATCH `/api/materials/{id}/calibration` (TDD)

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_materials_calibration_api.py`

- [ ] **Step 1: Failing tests**

Create `tests/test_materials_calibration_api.py`:

```python
"""Tests for the materials calibration API."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _create_material(client: TestClient) -> int:
    resp = client.post("/api/materials", json={
        "name": "Stainless Test Plate",
        "shape": "rect",
        "width_mm": 80, "height_mm": 60,
    })
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def test_get_calibration_returns_defaults_for_new_material():
    client = TestClient(create_app())
    mid = _create_material(client)
    resp = client.get(f"/api/materials/{mid}/calibration")
    assert resp.status_code == 200
    body = resp.json()
    assert body["wb_supported"] is True
    assert body["clean_pass_params"] is None


def test_patch_calibration_persists():
    client = TestClient(create_app())
    mid = _create_material(client)
    payload = {
        "clean_pass_params": {
            "power": 30, "speed": 800, "frequency": 60, "density": 1000,
            "passes": 2, "pulse_width": 200, "laser": "red",
        },
    }
    resp = client.patch(f"/api/materials/{mid}/calibration", json=payload)
    assert resp.status_code == 200, resp.text
    again = client.get(f"/api/materials/{mid}/calibration").json()
    assert again["clean_pass_params"]["power"] == 30


def test_patch_can_disable_wb_support():
    client = TestClient(create_app())
    mid = _create_material(client)
    resp = client.patch(f"/api/materials/{mid}/calibration", json={"wb_supported": False})
    assert resp.status_code == 200
    assert resp.json()["wb_supported"] is False
```

- [ ] **Step 2: Run, expect 404**

- [ ] **Step 3: Add the routes**

In `src/xcs_gen_web/app.py`, add the imports near the existing `from .schemas import` block:

```python
    MaterialCalibrationConfig,
    MaterialCalibrationPatch,
```

Inside `create_app(...)`, alongside the existing material routes:

```python
    @app.get("/api/materials/{material_id}/calibration")
    def get_material_calibration(
        material_id: int,
        user_id: int = Depends(get_current_user),
    ) -> MaterialCalibrationConfig:
        material = m_repo.get(material_id, owner_id=user_id)
        if material is None:
            raise HTTPException(status_code=404, detail="material not found")
        return MaterialCalibrationConfig(
            wb_supported=material.get("wb_supported", True),
            clean_pass_params=material.get("clean_pass_params"),
        )

    @app.patch("/api/materials/{material_id}/calibration")
    def patch_material_calibration(
        material_id: int,
        body: MaterialCalibrationPatch,
        user_id: int = Depends(get_current_user),
    ) -> MaterialCalibrationConfig:
        try:
            m_repo.update_material_calibration(
                material_id,
                owner_id=user_id,
                wb_supported=body.wb_supported,
                clean_pass_params=(
                    body.clean_pass_params.model_dump()
                    if body.clean_pass_params else None
                ),
            )
        except KeyError:
            raise HTTPException(status_code=404, detail="material not found")
        return get_material_calibration(material_id, user_id=user_id)
```

- [ ] **Step 4: Pass `wb` through `_result_to_response`**

Find `def _result_to_response(r: dict) -> ResultResponse:` and add `wb=r.get("wb")` to the constructor call.

- [ ] **Step 5: Run, expect 3 passed**

- [ ] **Step 6: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/app.py tests/test_materials_calibration_api.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): GET/PATCH /api/materials/{id}/calibration"
```

---

## Task 14: Capture pipeline integration — sample 4 strips, apply correction

**Files:**
- Modify: `src/xcs_gen_web/capture_pipeline.py`
- Modify: `src/xcs_gen_web/services/capture.py`
- Modify: `src/xcs_gen_web/services/xcs.py`
- Modify: `src/xcs_gen_web/converter.py`
- Create: `tests/test_capture_pipeline_wb.py`

This task wires the new `wb_correction.py` orchestrator into the live ingest path. Read `services/capture.py::run_capture` first to find where the warped frame is produced — that's the insertion point.

- [ ] **Step 1: Failing test**

Create `tests/test_capture_pipeline_wb.py`:

```python
"""Integration tests for WB correction in the live capture pipeline."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.capture_pipeline import (
    apply_wb_correction_to_warped,
    sample_perimeter_strips,
)


def test_apply_wb_correction_disabled_returns_input_unchanged():
    img = np.full((200, 200, 3), (140, 160, 160), dtype=np.uint8)   # BGR
    out = apply_wb_correction_to_warped(
        img,
        edge_means={"top": None, "right": None, "bottom": None, "left": None},
        edge_positions={
            "top": (50, 0), "right": (100, 50),
            "bottom": (50, 100), "left": (0, 50),
        },
        grid_bbox=(0, 0, 100, 100),
        canonical_neutral=(160, 160, 145),
        px_per_mm=1.0,
        unburned_rgb=None,
        canonical_id=None,
        enabled=False,
    )
    assert out.mode == "disabled"
    assert out.applied is False
    assert np.array_equal(out.frame, img)


def test_sample_perimeter_strips_pools_each_segment():
    # 200x200 px frame. Plant a known colour along a horizontal band
    # at y=10 mm (with px_per_mm=4 → row 40) for the top strip.
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[35:46, 20:181, 0] = 80     # B
    img[35:46, 20:181, 1] = 160    # G
    img[35:46, 20:181, 2] = 200    # R
    segments = [
        {"side": "top", "x0": 5, "y0": 10, "x1": 45, "y1": 10},
        # Other sides intentionally on solid black so they read as
        # zeros — testing that the top sampler returns the planted
        # colour and the others return None.
        {"side": "right", "x0": 49, "y0": 5, "x1": 49, "y1": 45},
        {"side": "bottom", "x0": 45, "y0": 49, "x1": 5, "y1": 49},
        {"side": "left", "x0": 0, "y0": 45, "x1": 0, "y1": 5},
    ]
    out = sample_perimeter_strips(img, segments, px_per_mm=4.0)
    assert out["top"] is not None
    R, G, B = out["top"]
    assert abs(R - 200) < 5 and abs(G - 160) < 5 and abs(B - 80) < 5
```

- [ ] **Step 2: Run, expect ImportError**

- [ ] **Step 3: Implement the bridge layer**

Append to `src/xcs_gen_web/capture_pipeline.py`:

```python
from .wb_correction import (
    correct_warped_frame, CorrectionOutcome, sample_strip_line,
)


def sample_perimeter_strips(
    frame_bgr: np.ndarray,
    segments: list[dict],
    *,
    px_per_mm: float,
    sample_step_mm: float = 2.0,
    sample_size_mm: float = 1.5,
) -> dict[str, tuple[float, float, float] | None]:
    """Run ``sample_strip_line`` over each segment of the perimeter
    strip; return a dict keyed by side. ``None`` for any segment
    that produced no usable samples."""
    out: dict[str, tuple[float, float, float] | None] = {
        "top": None, "right": None, "bottom": None, "left": None,
    }
    for seg in segments:
        out[seg["side"]] = sample_strip_line(
            frame_bgr,
            x0_mm=seg["x0"], y0_mm=seg["y0"],
            x1_mm=seg["x1"], y1_mm=seg["y1"],
            px_per_mm=px_per_mm,
            sample_step_mm=sample_step_mm,
            sample_size_mm=sample_size_mm,
        )
    return out


def apply_wb_correction_to_warped(
    frame_bgr: np.ndarray,
    *,
    edge_means: dict[str, tuple[float, float, float] | None],
    edge_positions: dict[str, tuple[float, float]],
    grid_bbox: tuple[float, float, float, float],
    canonical_neutral: tuple[float, float, float] = (160.0, 160.0, 145.0),
    px_per_mm: float = 10.0,
    unburned_rgb: tuple[float, float, float] | None = None,
    canonical_id: str | None = None,
    enabled: bool = True,
) -> CorrectionOutcome:
    """Pipeline-facing wrapper that adds the ``enabled=False`` short-
    circuit on top of the orchestrator."""
    if not enabled:
        return CorrectionOutcome(
            frame=frame_bgr.copy(),
            mode="disabled",
            applied=False,
            edge_means=None,
            edge_positions=None,
            chromaticity_anchor_rgb=None,
            chromaticity_scales=None,
            canonical_id=canonical_id,
        )
    return correct_warped_frame(
        frame_bgr,
        edge_means=edge_means,
        edge_positions=edge_positions,
        grid_bbox=grid_bbox,
        canonical_neutral=canonical_neutral,
        px_per_mm=px_per_mm,
        unburned_rgb=unburned_rgb,
        canonical_id=canonical_id,
    )
```

- [ ] **Step 4: Run, expect 2 passed**

- [ ] **Step 5: Wire into the live pipeline**

In `src/xcs_gen_web/services/capture.py::run_capture`:

**a)** Accept an optional `material` kwarg (default `None`). If existing tests' fake `run_capture` stubs don't accept the kwarg, add `**_kwargs` to those test stubs.

**b)** When the material qualifies (`wb_supported=True` AND `clean_pass_params` non-None), call `compute_layout(..., with_perimeter_strip=True)` so `layout.perimeter_strip` is populated.

**c)** After `warp_to_burn_space`, sample the strips:

```python
edge_means: dict[str, tuple[float, float, float] | None] = {
    "top": None, "right": None, "bottom": None, "left": None,
}
edge_positions: dict[str, tuple[float, float]] = {
    "top": (0.0, 0.0), "right": (0.0, 0.0),
    "bottom": (0.0, 0.0), "left": (0.0, 0.0),
}
if material is not None and material.get("wb_supported", True) \
        and material.get("clean_pass_params") and layout.perimeter_strip is not None:
    seg_dicts = [
        {"side": s.side, "x0": s.x0, "y0": s.y0, "x1": s.x1, "y1": s.y1}
        for s in layout.perimeter_strip.segments
    ]
    edge_means = sample_perimeter_strips(
        warped, seg_dicts, px_per_mm=10.0,
    )
    for s in layout.perimeter_strip.segments:
        edge_positions[s.side] = (
            (s.x0 + s.x1) / 2.0,
            (s.y0 + s.y1) / 2.0,
        )

unburned_rgb = sample_unburned_around_markers(
    warped, [{"x": ar.x, "y": ar.y, "size_mm": ar.size} for ar in layout.arucos],
    px_per_mm=10.0,
)   # add this helper to wb_correction if not already present (see note)

wb_outcome = apply_wb_correction_to_warped(
    warped,
    edge_means=edge_means,
    edge_positions=edge_positions,
    grid_bbox=(grid_origin_mm[0], grid_origin_mm[1],
               grid_origin_mm[0] + grid_w, grid_origin_mm[1] + grid_h),
    canonical_neutral=(160.0, 160.0, 145.0),
    px_per_mm=10.0,
    unburned_rgb=unburned_rgb,
    canonical_id=_DEFAULT_CANONICAL_ID,
    enabled=True,
)
warped = wb_outcome.frame
```

(Define `_DEFAULT_CANONICAL_ID = "v1.steel-default.2026-05-07"` near the top of `capture.py`.)

If `sample_unburned_around_markers` doesn't exist yet, add a tiny version of it to `wb_correction.py` mirroring `sample_strip_line` — sample a small box just outside each marker, pool, return one RGB or None. ~30 lines.

- [ ] **Step 6: Persist the outcome**

After the result row is created in `_persist_upload` (or wherever the result_id becomes known), add:

```python
r_repo.update_wb_state(
    result_id,
    mode=wb_outcome.mode,
    anchor_rgb=(
        list(wb_outcome.edge_means.values())
        if wb_outcome.mode == "flatfield"
        else (
            list(wb_outcome.chromaticity_anchor_rgb)
            if wb_outcome.chromaticity_anchor_rgb else None
        )
    ),
    correction=(
        [
            {"side": k, "x_mm": p[0], "y_mm": p[1],
             "R": v[0], "G": v[1], "B": v[2]}
            for k, v in wb_outcome.edge_means.items()
            for p in [wb_outcome.edge_positions[k]] if v is not None
        ]
        if wb_outcome.mode == "flatfield" else (
            list(wb_outcome.chromaticity_scales)
            if wb_outcome.chromaticity_scales else None
        )
    ),
    canonical_id=wb_outcome.canonical_id,
    owner_id=user_id,
)
```

- [ ] **Step 7: Plumb material into the converter (for test-plate emission)**

`services/xcs.py::build_xcs_for_test`: look up the material's calibration, build a `calibration_by_material_id` dict, pass to `converter.project_to_xcs_bytes`.

```python
calibration_by_material_id: dict[str, dict] = {}
if material_id and owner_id is not None:
    from ..repositories import materials as m_repo
    try:
        mat = m_repo.get(int(material_id), owner_id=owner_id)
    except (TypeError, ValueError):
        mat = None
    if mat and mat.get("wb_supported", True) and mat.get("clean_pass_params"):
        calibration_by_material_id[str(material_id)] = {
            "clean_pass_params": mat["clean_pass_params"],
        }

return converter.project_to_xcs_bytes(
    Project.model_validate(project), machine_id=machine_id,
    annotation_params=annotation_params,
    calibration_by_material_id=calibration_by_material_id or None,
)
```

`converter.py::project_to_xcs[_bytes]`: add `calibration_by_material_id` kwarg; in the per-test loop, splat the matching dict's `clean_pass_params` into `generate_gradient` as `perimeter_strip_params`.

- [ ] **Step 8: Run full backend suite**

Expected: ~684 passing (existing + 13 wb-correction + 2 wb-pipeline + 4 layout + 1 marker + 2 generator + 3 calibration-api + 3 calibration-defaults). Tweak fake `run_capture` stubs in any test file that breaks because of the new `material` kwarg by adding `**_kwargs`.

- [ ] **Step 9: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/capture_pipeline.py \
  src/xcs_gen_web/services/capture.py \
  src/xcs_gen_web/services/xcs.py \
  src/xcs_gen_web/converter.py \
  tests/test_capture_pipeline_wb.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): live pipeline samples 4 strips + applies correction"
```

---

## Task 15: API — POST `/api/results/{id}/reingest` (TDD)

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen_web/capture_pipeline.py`
- Create: `tests/test_results_reingest_api.py`

- [ ] **Step 1: Failing test**

Create `tests/test_results_reingest_api.py`:

```python
"""Reingest endpoint tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def test_reingest_route_returns_404_for_missing_result():
    client = TestClient(create_app())
    resp = client.post("/api/results/9999/reingest")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run, expect 404 for "not found" (which is what we want eventually) but currently the route doesn't exist so we'll get 404 anyway**. The test will pass once we add the route + return 404 when the result doesn't exist.

- [ ] **Step 3: Add the route**

Inside `create_app(...)` in `src/xcs_gen_web/app.py`:

```python
    @app.post("/api/results/{result_id}/reingest")
    def reingest_result(
        result_id: int, user_id: int = Depends(get_current_user),
    ) -> ResultResponse:
        """Re-run WB correction on an existing result."""
        result = r_repo.get(result_id, owner_id=user_id)
        if result is None:
            raise HTTPException(status_code=404, detail="result not found")
        from .capture_pipeline import reingest_with_wb
        try:
            reingest_with_wb(result_id, owner_id=user_id)
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        updated = r_repo.get(result_id, owner_id=user_id)
        return _result_to_response(updated)
```

Add to `capture_pipeline.py`:

```python
def reingest_with_wb(result_id: int, *, owner_id: int) -> None:
    """Re-run WB correction on an existing result's stored warped image."""
    from .repositories import results as r_repo
    result = r_repo.get(result_id, owner_id=owner_id)
    if result is None:
        raise KeyError(result_id)
    warped_path = result.get("warped_image_path")
    if warped_path is None:
        raise FileNotFoundError(
            f"result {result_id} has no warped_image_path; "
            "re-shoot the original photo to recompute"
        )
    img = cv2.imread(warped_path)
    if img is None:
        raise FileNotFoundError(f"can't read warped image at {warped_path}")
    # v1: chromaticity-only on reingest. Strip-based reingest needs
    # the original layout context (grid bbox, strip segments) which
    # the warped image alone doesn't carry; rely on a re-upload to
    # pick up flat-field. Surfacing the new mode in the badge is
    # still useful.
    outcome = apply_wb_correction_to_warped(
        img,
        edge_means={"top": None, "right": None, "bottom": None, "left": None},
        edge_positions={
            "top": (0.0, 0.0), "right": (0.0, 0.0),
            "bottom": (0.0, 0.0), "left": (0.0, 0.0),
        },
        grid_bbox=(0.0, 0.0, 1.0, 1.0),
        unburned_rgb=None,
        canonical_id="v1.steel-default.2026-05-07",
        enabled=True,
    )
    r_repo.update_wb_state(
        result_id,
        mode=outcome.mode,
        anchor_rgb=None,
        correction=None,
        canonical_id=outcome.canonical_id,
        owner_id=owner_id,
    )
```

- [ ] **Step 4: Run, expect 1 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/app.py \
  src/xcs_gen_web/capture_pipeline.py \
  tests/test_results_reingest_api.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): POST /api/results/{id}/reingest"
```

---

## Task 16: Low-contrast preprocessing variant (TDD)

**Files:**
- Modify: `src/xcs_gen_web/capture_pipeline.py`
- Modify: `tests/test_capture_pipeline.py`

Stainless engravings have low contrast and need an inverted-stretched variant for pyzbar/ArUco to detect them.

- [ ] **Step 1: Update existing test to expect 5 variants**

Find `def test_preprocessing_variants_returns_*_variants` in `tests/test_capture_pipeline.py`. Change the asserted count from 4 to 5 and update the docstring accordingly.

- [ ] **Step 2: Run, expect failure (still 4)**

- [ ] **Step 3: Add the 5th variant**

In `_preprocessing_variants` in `src/xcs_gen_web/capture_pipeline.py`, append before the final `return`:

```python
    # Stretch the 2nd–98th percentile to full range, then invert.
    # Stainless engravings flip contrast vs typical printed QRs, and
    # the percentile clip rescues photos with specular hot-spots.
    mn, mx = np.percentile(gray, [2, 98])
    rng = max(1.0, float(mx - mn))
    stretched = np.clip(
        (gray.astype(np.float32) - float(mn)) * 255.0 / rng, 0, 255,
    ).astype(np.uint8)
    stretched_inverted = cv2.bitwise_not(stretched)
    return [gray, otsu, clahe, adaptive, stretched_inverted]
```

(Update the docstring to mention the 5th variant.)

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Run full backend suite**

- [ ] **Step 6: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  src/xcs_gen_web/capture_pipeline.py tests/test_capture_pipeline.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): contrast-stretched-inverted preprocessing variant"
```

---

## Task 17: Frontend types + API client

**Files:**
- Modify: `web/src/types.ts`
- Create: `web/src/api/wbCalibration.ts`

- [ ] **Step 1: Append types**

At the bottom of `web/src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// WB flat-field calibration (mirrors src/xcs_gen_web/schemas.py).
// ---------------------------------------------------------------------------

export interface MaterialCalibrationConfig {
  wb_supported: boolean;
  clean_pass_params: BaseParams | null;
}

export interface ResultWBState {
  mode: "flatfield" | "chromaticity" | "skipped" | "disabled" | null;
  /** flat-field: list of 4 [R, G, B] (top, right, bottom, left).
   *  chromaticity: single [R, G, B]. */
  anchor_rgb: [number, number, number] | [number, number, number][] | null;
  /** flat-field: list of 4 {side, x_mm, y_mm, R, G, B}.
   *  chromaticity: per-channel [sR, sG, sB]. */
  correction: number[] | Array<Record<string, number | string>> | null;
  canonical_id: string | null;
}
```

If existing `Material` and `Result` types live in this file, extend them with optional `calibration?: MaterialCalibrationConfig | null` and `wb?: ResultWBState | null`. Otherwise grep the codebase for where they live and edit there.

- [ ] **Step 2: Create the API client**

Create `web/src/api/wbCalibration.ts`:

```typescript
import type {
  MaterialCalibrationConfig,
} from "../types";
import { j } from "./_fetch";

export async function getMaterialCalibration(
  materialId: number,
): Promise<MaterialCalibrationConfig> {
  return j(await fetch(`/api/materials/${materialId}/calibration`));
}

export async function patchMaterialCalibration(
  materialId: number,
  patch: Partial<MaterialCalibrationConfig>,
): Promise<MaterialCalibrationConfig> {
  return j(await fetch(`/api/materials/${materialId}/calibration`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }));
}

export async function reingestResult(resultId: number): Promise<unknown> {
  return j(await fetch(`/api/results/${resultId}/reingest`, { method: "POST" }));
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/web && npx tsc --noEmit
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  web/src/types.ts web/src/api/wbCalibration.ts
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): TypeScript types + API helpers"
```

---

## Task 18: Material edit dialog — Calibration section

**Files:**
- Create: `web/src/components/BaseParamsEditor.tsx`
- Modify: `web/src/components/MaterialEditDialog.tsx`

- [ ] **Step 1: Extract `BaseParamsEditor`**

Create `web/src/components/BaseParamsEditor.tsx`:

```typescript
import type { BaseParams } from "../types";
import { Field, Input, NumberField, Select } from "../ui";

interface Props {
  value: BaseParams;
  onChange: (value: BaseParams) => void;
  disabled?: boolean;
}

const LASERS = [
  { value: "red", label: "Red (MOPA)" },
  { value: "blue", label: "Blue (diode)" },
];

export function BaseParamsEditor({ value, onChange, disabled }: Props) {
  const update = <K extends keyof BaseParams>(k: K, v: BaseParams[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-3" aria-disabled={disabled}>
      <Field label="Power %">
        <NumberField
          value={value.power}
          onChange={(v) => update("power", v ?? 0)}
          min={0} max={100} step={0.1}
          disabled={disabled}
        />
      </Field>
      <Field label="Speed (mm/s)">
        <NumberField
          value={value.speed}
          onChange={(v) => update("speed", v ?? 0)}
          min={1} step={1}
          disabled={disabled}
        />
      </Field>
      <Field label="Frequency (kHz)">
        <NumberField
          value={value.frequency}
          onChange={(v) => update("frequency", v ?? 0)}
          min={1} step={1}
          disabled={disabled}
        />
      </Field>
      <Field label="Lines/cm">
        <NumberField
          value={value.density}
          onChange={(v) => update("density", v ?? 0)}
          min={1} step={1}
          disabled={disabled}
        />
      </Field>
      <Field label="Passes">
        <NumberField
          value={value.passes}
          onChange={(v) => update("passes", v ?? 0)}
          min={1} step={1}
          disabled={disabled}
        />
      </Field>
      <Field label="Pulse width (ns)">
        <NumberField
          value={value.pulse_width}
          onChange={(v) => update("pulse_width", v ?? 0)}
          min={1} step={1}
          disabled={disabled}
        />
      </Field>
      <Field label="Laser" className="col-span-2">
        <Select
          value={value.laser}
          onChange={(v) => update("laser", v as "red" | "blue")}
          options={LASERS}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}
```

(If `NumberField` / `Select` don't have those exact prop shapes, mirror existing usage in another `MaterialEditDialog`-adjacent component. Look at how params are edited in the test-edit form.)

- [ ] **Step 2: Add Calibration section to `MaterialEditDialog.tsx`**

In `MaterialEditDialog.tsx`:

**a)** Add state:

```typescript
const [calibration, setCalibration] = useState<MaterialCalibrationConfig | null>(null);
const [calibrationDirty, setCalibrationDirty] = useState(false);
```

**b)** On dialog open (when `isEdit && initial`), fetch calibration:

```typescript
useEffect(() => {
  if (!open || !isEdit || !initial) return;
  getMaterialCalibration(initial.id).then(setCalibration).catch(() => {
    setCalibration({ wb_supported: true, clean_pass_params: null });
  });
}, [open, isEdit, initial]);
```

**c)** Render the Calibration section (between physical-shape and danger-zone, edit-mode only). Section content:

- `wb_supported` checkbox + helper line ("Disable for substrates that don't tolerate the clean pass — calibration is skipped at ingest.")
- When `wb_supported` is on: clean-pass `BaseParamsEditor` with a "Use stainless-steel defaults" CTA that loads sensible values into the form.
- Save: in the dialog's `onSubmit` handler, after the material PATCH, if `calibrationDirty && calibration`, call `patchMaterialCalibration(initial.id, calibration)`.

Match the existing dialog's section idiom; reuse `Section`, `Field`, `Checkbox`. Cap dialog at viewport height with internal scroll (DialogContent gets `max-h-[calc(100vh-4rem)] overflow-hidden flex flex-col`; form body gets `flex-1 overflow-y-auto`; footer stays sticky with `shrink-0 border-t`).

- [ ] **Step 3: Typecheck + build**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/web && \
  npx tsc --noEmit && npm run build > /dev/null 2>&1 && echo "build ok"
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  web/src/components/BaseParamsEditor.tsx web/src/components/MaterialEditDialog.tsx
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): material-edit Calibration section"
```

---

## Task 19: WB badge + result detail diagnostic panel

**Files:**
- Create: `web/src/components/WBBadge.tsx`
- Modify: `web/src/components/ResultDebugDialog.tsx`
- Modify: `web/src/components/ResultDetailDialog.tsx`
- Modify: `web/src/components/ResultsPanel.tsx` (to pass `result.wb` to the debug dialog)

- [ ] **Step 1: Create `WBBadge`**

Create `web/src/components/WBBadge.tsx`:

```typescript
import type { ResultWBState } from "../types";
import { Badge } from "../ui";

const TONE: Record<string, { tone: "success" | "warning" | "destructive" | "neutral"; label: string }> = {
  flatfield:    { tone: "success",    label: "WB · FLATFIELD" },
  chromaticity: { tone: "warning",    label: "WB · CHROMA" },
  skipped:      { tone: "destructive", label: "WB · SKIPPED" },
  disabled:     { tone: "neutral",    label: "WB · DISABLED" },
};

export function WBBadge({ wb }: { wb: ResultWBState | null | undefined }) {
  const mode = wb?.mode ?? null;
  const cfg = mode != null ? TONE[mode] : { tone: "neutral" as const, label: "WB · UNKNOWN" };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
```

(If `Badge` doesn't have those tones, look at existing badges in the codebase and use the matching tokens.)

- [ ] **Step 2: Render in `ResultDebugDialog`**

Add the badge in the dialog header next to "Result #N", and render a small diagnostic panel below the warped image when `wb && wb.mode != null && wb.mode !== "disabled"`:

```tsx
{result.wb && result.wb.mode != null && result.wb.mode !== "disabled" && (
  <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px]">
    <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
      WB · {result.wb.mode.toUpperCase()}
      {result.wb.canonical_id && (
        <span className="ml-2 text-neutral-400">{result.wb.canonical_id}</span>
      )}
    </div>
    {result.wb.anchor_rgb && (
      <pre className="text-[11px]">{JSON.stringify(result.wb.anchor_rgb, null, 2)}</pre>
    )}
    {result.wb.correction && (
      <pre className="mt-2 text-[11px]">{JSON.stringify(result.wb.correction, null, 2)}</pre>
    )}
  </div>
)}
```

Add `wb` to the dialog's props.

- [ ] **Step 3: Pass `result.wb` from `ResultsPanel`**

Find where `ResultsPanel.tsx` opens `ResultDebugDialog` and pass `wb={results.find((r) => r.id === debugId)?.wb ?? null}`.

- [ ] **Step 4: Add Re-ingest button to `ResultDetailDialog.tsx`**

Add a button in the existing actions row:

```tsx
import { reingestResult } from "../api/wbCalibration";

const [reingesting, setReingesting] = useState(false);
const onReingest = async () => {
  setReingesting(true);
  try {
    await reingestResult(result.id);
    window.dispatchEvent(new CustomEvent("result:refetch"));
  } finally {
    setReingesting(false);
  }
};

<Button variant="ghost" onClick={onReingest} disabled={reingesting}>
  {reingesting ? "Re-ingesting…" : "Re-ingest with WB"}
</Button>
```

Match the pattern used by the existing "Save as default" / similar buttons.

- [ ] **Step 5: Typecheck + build + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/web && \
  npx tsc --noEmit && npm run build > /dev/null 2>&1
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  web/src/components/WBBadge.tsx \
  web/src/components/ResultDebugDialog.tsx \
  web/src/components/ResultDetailDialog.tsx \
  web/src/components/ResultsPanel.tsx
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): WB badge + diagnostic panel + re-ingest button"
```

---

## Task 20: Stability page A/B toggle

**Files:**
- Modify: `web/src/pages/StabilityPage.tsx`

The toggle reverse-applies the flat-field gain when off. For each result with `wb.mode === "flatfield"` and a stored `correction` containing the 4 edge positions + RGBs, build a per-cell inverse gain identical to what the backend applied at ingest, but multiplied by the cell's current corrected RGB to recover the raw value.

- [ ] **Step 1: Add reverse-apply helper near the top of `StabilityPage.tsx`**

```typescript
import type { ResultWBState } from "../types";
import { hexToLab, hexToRgb, rgbToHex, type Lab } from "../color/math";

interface FlatFieldEdge {
  side: string;
  x_mm: number;
  y_mm: number;
  R: number;
  G: number;
  B: number;
}

function reverseApplyFlatField(
  hex: string,
  cellX_mm: number,
  cellY_mm: number,
  gridBbox: { x_min: number; y_min: number; x_max: number; y_max: number },
  edges: FlatFieldEdge[],
  canonical: [number, number, number] = [160, 160, 145],
): string {
  const byside = new Map(edges.map((e) => [e.side, e]));
  const top = byside.get("top");
  const right = byside.get("right");
  const bottom = byside.get("bottom");
  const left = byside.get("left");
  if (!top || !right || !bottom || !left) return hex;
  const u = Math.min(1, Math.max(0,
    (cellX_mm - gridBbox.x_min) / Math.max(1e-3, gridBbox.x_max - gridBbox.x_min)));
  const v = Math.min(1, Math.max(0,
    (cellY_mm - gridBbox.y_min) / Math.max(1e-3, gridBbox.y_max - gridBbox.y_min)));
  const interp = (a: FlatFieldEdge, b: FlatFieldEdge, t: number, key: "R" | "G" | "B") =>
    (1 - t) * a[key] + t * b[key];
  const blendChannel = (key: "R" | "G" | "B") => {
    const h = (1 - u) * left[key] + u * right[key];
    const w = (1 - v) * top[key] + v * bottom[key];
    return (h + w) / 2;
  };
  const rgb = hexToRgb(hex);
  const interpolated = [blendChannel("R"), blendChannel("G"), blendChannel("B")];
  const gain = canonical.map((c, i) => c / Math.max(1, interpolated[i]));
  const raw: [number, number, number] = [
    Math.max(0, Math.min(255, rgb[0] / Math.max(1e-3, gain[0]))),
    Math.max(0, Math.min(255, rgb[1] / Math.max(1e-3, gain[1]))),
    Math.max(0, Math.min(255, rgb[2] / Math.max(1e-3, gain[2]))),
  ];
  return rgbToHex(raw[0], raw[1], raw[2]);
}
```

- [ ] **Step 2: Add toggle state + use in chartSeries**

```typescript
const [wbApplied, setWbApplied] = useState(true);

// inside the chartSeries useMemo, when building cells:
const wb = r.wb;
const reverse = !wbApplied && wb?.mode === "flatfield"
  && Array.isArray(wb.correction) && wb.correction.length === 4;
for (const sw of r.swatches) {
  ...
  if (reverse) {
    const edges = wb.correction as unknown as FlatFieldEdge[];
    const rawHex = reverseApplyFlatField(
      sw.hex,
      sw.col * cellWidthMm,    // approximate cell mm-position
      sw.row * cellHeightMm,
      { x_min: 0, y_min: 0, x_max: gridW, y_max: gridH },
      edges,
    );
    cells.set(idx, { hex: rawHex, lab: hexToLab(rawHex) });
  } else {
    cells.set(idx, { hex: sw.hex, lab: [sw.lab[0], sw.lab[1], sw.lab[2]] });
  }
}
```

(`cellWidthMm`, `cellHeightMm`, `gridW`, `gridH` come from the test spec; reuse existing computations in the page.)

- [ ] **Step 3: Render the toggle**

```tsx
{selectedResultIds.some((id) => resultCache[id]?.wb?.mode === "flatfield") && (
  <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-[color:var(--color-border)] text-[11px] font-mono uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
    <label className="inline-flex items-center gap-1.5 cursor-pointer normal-case font-mono tracking-[0.14em]">
      <input
        type="checkbox"
        checked={wbApplied}
        onChange={(e) => setWbApplied(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--color-primary)]"
      />
      <span>WB CORRECTION</span>
    </label>
  </div>
)}
```

Insert above the `StabilityChart`.

- [ ] **Step 4: Typecheck + build + commit**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/web && \
  npx tsc --noEmit && npm run build > /dev/null 2>&1
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add \
  web/src/pages/StabilityPage.tsx
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "feat(wb-flatfield): stability page A/B toggle (reverse-apply flat-field)"
```

---

## Task 21: Browser smoke test + screenshot

**Files:** none (manual verification)

- [ ] **Step 1: Build + start server with copied DB**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/web && npm run build > /dev/null 2>&1
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  cp ~/.xcs-gen/app.db .review-copy.db && \
  PYTHONPATH=src XCS_GEN_DB_URL="sqlite:///$(pwd)/.review-copy.db" XCS_GEN_AUTO_MIGRATE=true \
  .venv/bin/xcs-gen serve --host 127.0.0.1 --port 8027 &
```

- [ ] **Step 2: Walk the golden path with Playwright MCP**

1. Open `http://127.0.0.1:8027/#/library`.
2. Edit a stainless-shaped material → Calibration section opens → toggle `wb_supported` → click "Use stainless-steel defaults" → Save.
3. Generate a new test for that material; download the .xcs and confirm 4 perimeter strip Rects are present in the JSON (look for `"layerColor": "#wb_top"` etc.).
4. Open an existing stainless result detail → see the WB badge (likely UNKNOWN on legacy data; FLATFIELD or CHROMA on freshly-ingested).
5. Click "Re-ingest with WB" on a result → badge updates.
6. Open `#/stability`, pick a test with new results, see the WB CORRECTION toggle in the chart toolbar; flip it and watch the points shift.

Take 1-2 screenshots of: (a) the calibration section in MaterialEditDialog, (b) the FLATFIELD badge in ResultDebugDialog. Save as `changelog/images/wb-flatfield-hero.png`.

- [ ] **Step 3: Stop server + clean up**

```bash
kill $(lsof -nP -iTCP:8027 -t) 2>/dev/null
rm -f /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield/.review-copy.db
```

- [ ] **Step 4: Commit screenshot**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add changelog/images/wb-flatfield-hero.png
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "docs(wb-flatfield): hero screenshot"
```

---

## Task 22: Changelog

**Files:**
- Create: `changelog/2026-05-07-wb-flatfield.md`

- [ ] **Step 1: Write the entry**

```markdown
---
id: 2026-05-07-wb-flatfield
date: 2026-05-07
level: minor
title: WB flat-field — automatic colour correction at ingest
summary: Burns a thin clean-pass strip around every test plate; ingest samples it to neutralise camera-WB drift and uneven lighting.
images:
  - src: wb-flatfield-hero.png
    caption: Calibration panel in the material editor + the FLATFIELD badge on a result.
---

A new "Calibration" section in the material editor lets you pin a
**clean-pass recipe** per material. From then on, every test plate
emitted for that material burns a thin clean-passed strip around its
perimeter.

At ingest the pipeline samples the strip in 4 edge regions, builds
a bilinear flat-field across the colour grid, and applies a per-cell
gain *before* sampling each cell. That neutralises both colour cast
(camera auto-WB drift, lighting temperature) and spatial brightness
variance (specular gradients, flash falloff) — the dominant noise
source on reflective substrates like stainless.

Three correction modes show up on the result-detail dialog:

- **FLATFIELD** (green) — strip detected on all 4 sides, full
  flat-field gain applied.
- **CHROMA** (yellow) — fewer than 3 strips usable but markers were
  detected; per-channel ratio neutralisation against unburned
  material.
- **RAW · NO WB** (red) — neither anchors nor markers usable.
- **WB DISABLED** (grey) — toggled off for that material.

A new toggle on the stability page lets you A/B-compare with vs
without the correction so you can see whether your setup is
benefiting. Per-result "Re-ingest with WB" applies the latest
settings to a stored warped image without re-shooting.

Substrates can opt out via a per-material `wb_supported` flag —
default on; intended only for substrates that don't tolerate a
clean pass.
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield add changelog/2026-05-07-wb-flatfield.md
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield commit \
  -m "docs(wb-flatfield): changelog entry"
```

---

## Task 23: Open the PR

- [ ] **Step 1: Final test sweep**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  PYTHONPATH=src XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3 && \
  cd web && npx tsc --noEmit && npm test -- --run 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 2: Push**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield push -u origin feat/wb-flatfield
```

- [ ] **Step 3: Open draft PR**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-flatfield && \
  gh pr create --draft --title "feat: WB flat-field via perimeter clean strip" --body "$(cat <<'EOF'
## Summary

- New per-material setting (`clean_pass_params`) drives a **perimeter clean-pass strip** burned around every test plate (4 thin segments between adjacent registration markers).
- At ingest, each strip is sampled at ~25 points, pooled to one RGB per edge, and used to build a bilinear flat-field across the colour grid. Per-cell gain corrects both colour cast and spatial brightness variance before cell sampling.
- Falls back to chromaticity-only on unburned-around-markers when fewer than 3 strips read cleanly; falls back to skip when even fiducials fail.
- Replaces the abandoned `feat/wb-calibration` (PR #71) approach. The previous branch is preserved on origin for reference / comparison.

Spec: `docs/superpowers/specs/2026-05-07-wb-flatfield-design.md`
Plan: `docs/superpowers/plans/2026-05-07-wb-flatfield.md`

## Test plan

- [x] `pytest tests/` green
- [x] `cd web && npx tsc --noEmit && npm test -- --run` green
- [ ] Manual: configure clean-pass on a stainless material → emit a test plate → verify 4 perimeter Rects in the .xcs
- [ ] Manual: ingest a real burned plate → confirm FLATFIELD badge in result detail
- [ ] Manual: ingest a result without a strip → CHROMA fallback badge
- [ ] Manual: stability A/B toggle visibly shifts the chart points

## v1 trade-offs

- One canonical neutral RGB hardcoded for stainless. Per-substrate library is a follow-up.
- Bilinear interpolation only. Higher-order (TPS / RBF) deferred until measured needed.
- Reingest-on-existing-warped-image runs chromaticity-only (no strip context); re-uploading the photo runs the full flat-field path.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: When CI green, flip to ready**

```bash
gh pr ready
```

---

## Out of scope (do NOT add to this PR)

- Per-substrate canonical neutral library.
- Higher-order interpolation (RBF / thin-plate spline).
- Per-cell quality flag (gain extreme).
- Drift dashboard.
- Resurrection of the prior anchored mode.
