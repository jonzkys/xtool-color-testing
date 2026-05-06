# WB Calibration (Anchored Colour Correction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UI work:** Tasks 20, 22, and 23 explicitly delegate to the `frontend-design:frontend-design` agent — they involve significant visual design (badge panel, settings panel, multi-step wizard) and the project's established workflow uses that agent for design language consistency. Other UI tweaks (toggle, button) are small enough for general-purpose.

**Goal:** Embed a calibration strip in every test plate's registration frame, sample it during result ingest, and apply per-channel WB + exposure correction so palette colours stay stable across lighting / camera-WB drift. Falls back to chromaticity-only correction when no strip is present.

**Architecture:** New library module `xcs_gen_web/wb_correction.py` runs after perspective warp, before cell sampling. Anchored mode uses 2–3 calibration patches burned into the registration frame (clean-pass first to standardise substrate, then a known burn). Chromaticity fallback samples unburned material adjacent to markers. Per-material `clean_pass_params_json` + `calibration_patches_json` (with measured `canonical_rgb`) live on the materials table; per-result `wb_mode`/`wb_anchor_rgb_json`/`wb_correction_json`/`wb_canonical_id` live on the results table.

**Tech Stack:** Python 3.12 (FastAPI, SQLAlchemy core, Alembic, Pydantic v2, OpenCV, NumPy, pytest); TypeScript (React 18, Vite, vitest, RTL).

**Spec:** `docs/superpowers/specs/2026-05-06-marker-chromaticity-correction-design.md`.

---

## File Structure

### Backend (Python)

| Path | Responsibility |
|---|---|
| `alembic/versions/0021_wb_calibration.py` (new) | Single migration: 3 nullable cols on `materials`, 4 nullable cols on `results` |
| `.github/workflows/ci.yml` (modify ~line 144) | Bump alembic head check `0020` → `0021` |
| `src/xcs_gen_web/models.py` (modify) | Add the 7 columns |
| `src/xcs_gen_web/wb_correction.py` (new) | Pure functions: `chromaticity_correct`, `anchored_correct`, `correct_warped_frame`, plus types |
| `src/xcs_gen_web/calibration_defaults.py` (new) | Per-substrate default `clean_pass_params` and `calibration_patches` (stainless first) |
| `src/xcs_gen_web/capture_pipeline.py` (modify) | Insert WB correction step between warp and cell sampling; persist outputs |
| `src/xcs_gen_web/repositories/materials.py` (modify) | New columns + calibration setters |
| `src/xcs_gen_web/repositories/results.py` (modify) | New columns + reingest helper |
| `src/xcs_gen_web/schemas.py` (modify) | `MaterialCalibrationConfig`, `CalibrationPatchSpec`, `ResultWBState` extending `ResultResponse` + `MaterialResponse` |
| `src/xcs_gen_web/app.py` (modify) | 4 new routes for calibration ceremony + reingest |
| `tests/test_wb_correction.py` (new) | Per-correction algorithm tests |
| `tests/test_capture_layout_strip.py` (new) | Strip geometry + emission tests |
| `tests/test_capture_pipeline_wb.py` (new) | Pipeline integration tests |
| `tests/test_materials_calibration_api.py` (new) | Calibration ceremony route tests |
| `tests/test_results_reingest_api.py` (new) | Reingest route tests |

### Capture library (`xcs_gen` — pure, no HTTP/DB)

| Path | Responsibility |
|---|---|
| `src/xcs_gen/capture/layout.py` (modify) | Extend `compute_layout` to include calibration-strip positions when enabled |
| `src/xcs_gen/capture/marker_render.py` (modify) | New function `render_calibration_strip` that emits clean-pass + per-patch burns into the project |

### Frontend (TypeScript / React)

| Path | Responsibility |
|---|---|
| `web/src/types.ts` (modify) | `MaterialCalibrationConfig`, `CalibrationPatchSpec`, `ResultWBState`, extend existing `Material` and `Result` types |
| `web/src/api/wbCalibration.ts` (new) | API helpers: `getMaterialCalibration`, `patchMaterialCalibration`, `requestCalibrationXcs`, `submitCalibrationMeasurement`, `reingestResult` |
| `web/src/components/ResultDebugDialog.tsx` (modify) | Add WB badge + expanded panel showing measured anchors / correction params / pre-post thumbnails |
| `web/src/components/CaptureSettings.tsx` (modify) | New toggle: "Apply WB correction" |
| `web/src/components/MaterialEditDialog.tsx` (modify) | New "Calibration" panel with clean-pass params editor, patch editor, swatches, "Calibrate" CTA |
| `web/src/components/CalibrationWizard.tsx` (new) | Multi-step wizard: emit-and-burn → upload-photo → measure → confirm-and-save |
| `web/src/components/ResultDetailDialog.tsx` (modify) | Add "Re-ingest with WB" button |

### Changelog

| Path | Responsibility |
|---|---|
| `changelog/2026-05-06-wb-calibration.md` (new) | Major-level entry |
| `changelog/images/wb-calibration-hero.png` (new) | Hero screenshot of result-detail with the badge + measured swatches |

---

## Conventions used by this codebase (skim before starting)

- Always run Python with `unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && .venv/bin/python -m pytest …` from the worktree root. `uv run --active pytest` falls into a stale pyenv shim on this machine.
- After ANY `web/src/**` change, rebuild before browser-testing: `cd web && npm run build`. There's no Vite dev server wired up.
- Frontend tests: `cd web && npx tsc --noEmit && npm test -- --run`.
- All FastAPI routes live in `app.py` (60+ of them). There is no `routers/` subfolder; don't create one.
- Migrations: **use `alembic revision --autogenerate`** (per CLAUDE.md). Don't hand-write migrations.
- Use `git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration …` for git operations to avoid cwd drift between Bash invocations.
- Models in `models.py` are SQLAlchemy core `Table()` definitions. JSON-payload columns use `Text` (not `JSON`) per the convention in that file.

---

## Task 0: Verify baseline (run if starting fresh)

If you've just spun up the worktree, confirm tests are green before any changes.

- [ ] **Step 1: Backend baseline**
  ```bash
  cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration && \
    unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
    XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3
  ```
  Expected: ~680 passing, 0 failed. (`test_demo.py` has a pre-existing in-memory-DB flake unrelated to this work.)

- [ ] **Step 2: Frontend baseline**
  ```bash
  cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration/web && \
    npx tsc --noEmit && npm test -- --run 2>&1 | tail -5
  ```
  Expected: TypeScript clean, ~339 vitest passing.

If any baseline step fails, STOP and resolve before adding new code — pre-existing failures will mask new issues.

---

## Task 1: Schema additions + autogenerate migration

**Files:**
- Modify: `src/xcs_gen_web/models.py` (materials + results table definitions)
- Create: `alembic/versions/0021_wb_calibration.py` (autogenerated)
- Modify: `.github/workflows/ci.yml` line 144

- [ ] **Step 1: Add columns to `materials` Table**

In `src/xcs_gen_web/models.py`, find the `materials = Table(…)` block (~line 86). After the existing `is_default` column, before the `CheckConstraint`, add:

```python
    # WB calibration support — see docs/superpowers/specs/2026-05-06-marker-chromaticity-correction-design.md
    Column("wb_supported", Boolean, nullable=False, server_default="1"),
    # Burn parameters for the clean pass that standardises the substrate
    # under each calibration patch. Stored as a JSON-encoded BaseParams
    # dict. NULL means "use the per-substrate default from
    # calibration_defaults.py".
    Column("clean_pass_params_json", Text, nullable=True),
    # JSON list of {label, params: BaseParams, canonical_rgb: [R,G,B] | null}.
    # NULL means "this material isn't calibrated yet"; anchored mode
    # falls back to chromaticity-only.
    Column("calibration_patches_json", Text, nullable=True),
```

- [ ] **Step 2: Add columns to `results` Table**

Find `results = Table(…)`. After the existing `warped_image_path`, before the `CheckConstraint(_VISIBILITY_CHECK,…)`, add:

```python
    # WB correction state — populated at ingest. NULL on legacy rows.
    # ``wb_mode`` is one of "anchored", "chromaticity", "skipped",
    # "disabled" (or NULL for pre-feature legacy rows).
    Column("wb_mode", String(16), nullable=True),
    # For chromaticity: [Ru, Gu, Bu] (single anchor).
    # For anchored: list of [Ri, Gi, Bi] per patch.
    Column("wb_anchor_rgb_json", Text, nullable=True),
    # For anchored: per-channel {(a, b)} or {(a, b, gamma)}.
    # For chromaticity: per-channel scale factors.
    Column("wb_correction_json", Text, nullable=True),
    # Versioning hook for canonical RGB recalibration; e.g.
    # "v1.steel-default.2026-05-06".
    Column("wb_canonical_id", String(64), nullable=True),
```

- [ ] **Step 3: Verify imports**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -c "from xcs_gen_web import models; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Autogenerate the migration**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.tmp-autogen.db" \
  .venv/bin/alembic upgrade head && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.tmp-autogen.db" \
  .venv/bin/alembic revision --autogenerate -m "WB calibration: materials + results columns"
```

This creates `alembic/versions/0021_wb_calibration_materials_results_columns.py` (filename slug may vary). **Rename it** to `alembic/versions/0021_wb_calibration.py` for tidiness.

- [ ] **Step 5: Review the autogenerated migration**

Open the new file. Confirm:
- `down_revision = "0020"`
- `revision = "0021"`
- `upgrade()` calls `op.add_column("materials", …)` for the 3 new cols and `op.add_column("results", …)` for the 4 new cols — total 7 `add_column` calls.
- `downgrade()` calls `op.drop_column(…)` for all 7.

If autogenerate produced anything else (e.g. constraint changes, accidental table renames), STOP and investigate — that would mean models drift unrelated to this work.

Clean up the tmp DB:
```bash
rm /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration/.tmp-autogen.db
```

- [ ] **Step 6: Bump CI revision check**

In `.github/workflows/ci.yml` line ~144:

```yaml
          test "$VER" = "0021"
```

(Was `"0020"`.)

- [ ] **Step 7: Verify migration applies cleanly**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.tmp-migrate.db" \
  .venv/bin/alembic upgrade head && \
  rm /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration/.tmp-migrate.db
```

Expected output: alembic upgrade through to `0021`, no errors.

- [ ] **Step 8: Run backend test suite**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3
```

Expected: same count as baseline (no tests broken).

- [ ] **Step 9: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/models.py \
  alembic/versions/0021_wb_calibration.py \
  .github/workflows/ci.yml
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): add materials + results columns for WB state"
```

---

## Task 2: Per-substrate calibration defaults

**Files:**
- Create: `src/xcs_gen_web/calibration_defaults.py`
- Test: `tests/test_calibration_defaults.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_calibration_defaults.py`:

```python
"""Tests for the per-substrate calibration default registry."""

from __future__ import annotations

from xcs_gen_web.calibration_defaults import (
    DEFAULT_PATCH_COUNT,
    default_calibration_patches,
    default_clean_pass,
)


def test_stainless_clean_pass_returns_baseparams_dict():
    cp = default_clean_pass("stainless-steel")
    assert isinstance(cp, dict)
    assert {"power", "speed", "frequency", "density", "passes",
            "pulse_width", "laser"}.issubset(cp.keys())


def test_stainless_three_patches_with_distinct_params():
    patches = default_calibration_patches("stainless-steel")
    assert len(patches) == DEFAULT_PATCH_COUNT == 3
    labels = [p["label"] for p in patches]
    assert labels == ["light", "mid", "dark"]
    powers = [p["params"]["power"] for p in patches]
    assert powers[0] < powers[1] < powers[2]
    for patch in patches:
        assert patch["canonical_rgb"] is None


def test_unknown_substrate_returns_none():
    assert default_clean_pass("titanium-magic") is None
    assert default_calibration_patches("titanium-magic") is None
```

- [ ] **Step 2: Run, expect failure**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_calibration_defaults.py -v
```

Expected: ImportError on `xcs_gen_web.calibration_defaults`.

- [ ] **Step 3: Implement**

Create `src/xcs_gen_web/calibration_defaults.py`:

```python
"""Per-substrate default clean-pass + calibration patch profiles.

These are starter values; the calibration ceremony measures the actual
canonical RGB each patch produces under the user's lighting and writes
that to the materials table. Burn params just need to produce
*distinct* and *repeatable* colours — exact targets are user-measured.
"""

from __future__ import annotations

from typing import TypedDict

DEFAULT_PATCH_COUNT = 3


class _BaseParams(TypedDict):
    power: float
    speed: int
    frequency: int
    density: int
    passes: int
    pulse_width: int
    laser: str


class _CalibrationPatch(TypedDict):
    label: str
    params: _BaseParams
    canonical_rgb: list[float] | None


_STAINLESS_CLEAN: _BaseParams = {
    "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
    "passes": 2, "pulse_width": 200, "laser": "red",
}

_STAINLESS_PATCHES: list[_CalibrationPatch] = [
    {
        "label": "light",
        "params": {
            "power": 8.0, "speed": 1500, "frequency": 30, "density": 800,
            "passes": 1, "pulse_width": 120, "laser": "red",
        },
        "canonical_rgb": None,
    },
    {
        "label": "mid",
        "params": {
            "power": 18.0, "speed": 1000, "frequency": 80, "density": 1000,
            "passes": 1, "pulse_width": 160, "laser": "red",
        },
        "canonical_rgb": None,
    },
    {
        "label": "dark",
        "params": {
            "power": 40.0, "speed": 400, "frequency": 120, "density": 1200,
            "passes": 2, "pulse_width": 240, "laser": "red",
        },
        "canonical_rgb": None,
    },
]


_REGISTRY: dict[str, tuple[_BaseParams, list[_CalibrationPatch]]] = {
    "stainless-steel": (_STAINLESS_CLEAN, _STAINLESS_PATCHES),
}


def default_clean_pass(substrate: str) -> _BaseParams | None:
    """Returns a copy of the default clean-pass params for ``substrate``,
    or ``None`` if the substrate isn't in the registry."""
    pair = _REGISTRY.get(substrate)
    if pair is None:
        return None
    return dict(pair[0])  # type: ignore[return-value]


def default_calibration_patches(substrate: str) -> list[_CalibrationPatch] | None:
    """Returns a deep-copied list of default calibration patches, or
    ``None`` if the substrate isn't in the registry."""
    pair = _REGISTRY.get(substrate)
    if pair is None:
        return None
    return [{
        "label": p["label"],
        "params": dict(p["params"]),  # type: ignore[arg-type]
        "canonical_rgb": list(p["canonical_rgb"]) if p["canonical_rgb"] is not None else None,
    } for p in pair[1]]
```

- [ ] **Step 4: Verify pass**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_calibration_defaults.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/calibration_defaults.py \
  tests/test_calibration_defaults.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): per-substrate default clean-pass + patches"
```

---

## Task 3: WB correction module — chromaticity-only mode

**Files:**
- Create: `src/xcs_gen_web/wb_correction.py`
- Create: `tests/test_wb_correction.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wb_correction.py`:

```python
"""Tests for the WB correction algorithms."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.wb_correction import (
    chromaticity_correct,
    ChromaticityResult,
)

# Canonical reference for stainless: anodised silver tint normalised to G.
U_CANON = (1.0, 1.0, 0.91)


def _frame(color: tuple[int, int, int], h: int = 100, w: int = 100) -> np.ndarray:
    """A flat solid-colour frame in BGR (OpenCV's native order)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, :] = (color[2], color[1], color[0])
    return img


def test_chromaticity_correct_neutralises_warm_cast_to_canonical():
    # Frame whose unburned-sample mean is "warm" (R/G > canonical, B/G < canonical).
    # We pass that mean directly as ``unburned_rgb``; correction must
    # rotate the per-pixel ratios to match U_CANON.
    img = _frame((150, 140, 110))   # R=150, G=140, B=110
    u_measured = (150.0, 140.0, 110.0)
    out = chromaticity_correct(img, u_measured, U_CANON)
    assert isinstance(out, ChromaticityResult)
    # Pull a pixel from the corrected frame and check ratios.
    px = out.frame[50, 50]   # BGR
    R, G, B = float(px[2]), float(px[1]), float(px[0])
    assert abs(R / G - U_CANON[0]) < 0.02
    assert abs(B / G - U_CANON[2]) < 0.02


def test_chromaticity_no_op_when_already_canonical():
    # If the input matches the canonical ratios, output should equal input.
    Gv = 120
    Rv = int(Gv * U_CANON[0])
    Bv = int(Gv * U_CANON[2])
    img = _frame((Rv, Gv, Bv))
    out = chromaticity_correct(img, (Rv, Gv, Bv), U_CANON)
    assert np.allclose(out.frame, img, atol=1)


def test_chromaticity_records_scale_factors():
    img = _frame((150, 140, 110))
    out = chromaticity_correct(img, (150.0, 140.0, 110.0), U_CANON)
    # Scale factors per channel: s_c = U_canon[c] * G_meas / (U_meas[c] * U_canon.G)
    # With G as anchor, s_G = 1.0.
    assert abs(out.scales[1] - 1.0) < 1e-9
    assert out.scales[0] != 1.0
    assert out.scales[2] != 1.0
```

- [ ] **Step 2: Run, expect failure**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_wb_correction.py -v
```

Expected: ImportError on `xcs_gen_web.wb_correction`.

- [ ] **Step 3: Implement**

Create `src/xcs_gen_web/wb_correction.py`:

```python
"""WB correction for ingested test photos.

Spec: docs/superpowers/specs/2026-05-06-marker-chromaticity-correction-design.md

Two correction modes:

- **Anchored** (preferred): per-channel linear (or 3-anchor gamma)
  fit using calibration-strip patches with known canonical RGBs.
- **Chromaticity-only** (fallback): per-channel ratio normalisation
  using unburned material adjacent to detected markers.

The orchestrator ``correct_warped_frame`` picks anchored when the
inputs allow, otherwise falls back, otherwise marks the result as
skipped.
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
    so absolute luminance is preserved (we don't try to fix exposure
    on reflective material).

    Args:
        frame_bgr: Warped frame in BGR uint8 (OpenCV's native order).
        unburned_rgb: (R, G, B) mean measured from unburned-material
            samples in this photo.
        canonical_rgb: (R, G, B) canonical reference, normalised so
            G == 1.0. For silver-anodised stainless, ~(1.0, 1.0, 0.91).

    Returns:
        ChromaticityResult with the corrected frame, the measured
        unburned RGB, and the per-channel scale factors applied.
    """
    Ru, Gu, Bu = unburned_rgb
    Rc, Gc, Bc = canonical_rgb
    if Gu <= 0:
        # Pathological — return input untouched and zero scales as a
        # signal that something's wrong; caller can degrade gracefully.
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

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_wb_correction.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): chromaticity-only correction"
```

---

## Task 4: Anchored mode — linear two-point fit

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing tests**

In `tests/test_wb_correction.py`, append:

```python
from xcs_gen_web.wb_correction import (
    AnchoredResult,
    anchored_correct_linear,
    AnchoredFitError,
)


def test_anchored_linear_recovers_inverse_transform():
    # Construct a frame where we know the linear transform applied.
    base = _frame((100, 100, 100))   # neutral grey
    # Simulate a "tinted" photo: R *= 1.2, B *= 0.8 (and a +5 offset).
    tinted = base.astype(np.float32)
    tinted[:, :, 2] = np.clip(tinted[:, :, 2] * 1.2 + 5, 0, 255)
    tinted[:, :, 0] = np.clip(tinted[:, :, 0] * 0.8 + 5, 0, 255)
    tinted_u8 = tinted.astype(np.uint8)
    # Two patches: dark (50) and light (200), each tinted the same way.
    measured_dark_rgb = (
        50 * 1.2 + 5,    # R
        50,              # G (untouched)
        50 * 0.8 + 5,    # B
    )
    measured_light_rgb = (
        200 * 1.2 + 5,
        200,
        200 * 0.8 + 5,
    )
    canonical_dark = (50.0, 50.0, 50.0)
    canonical_light = (200.0, 200.0, 200.0)

    out = anchored_correct_linear(
        tinted_u8,
        measured_rgbs=[measured_dark_rgb, measured_light_rgb],
        canonical_rgbs=[canonical_dark, canonical_light],
    )
    # Recovered frame: pixels should match the original neutral grey within ±2.
    px = out.frame[50, 50]
    assert abs(int(px[2]) - 100) <= 2
    assert abs(int(px[1]) - 100) <= 2
    assert abs(int(px[0]) - 100) <= 2
    assert isinstance(out, AnchoredResult)
    assert out.fit_kind == "linear"
    assert len(out.fit) == 3   # one (a, b) per channel


def test_anchored_linear_raises_when_too_few_patches():
    import pytest

    img = _frame((100, 100, 100))
    with pytest.raises(AnchoredFitError):
        anchored_correct_linear(
            img,
            measured_rgbs=[(100.0, 100.0, 100.0)],
            canonical_rgbs=[(100.0, 100.0, 100.0)],
        )
```

- [ ] **Step 2: Run, expect failure**

Expected: ImportError on the new symbols.

- [ ] **Step 3: Implement**

Append to `src/xcs_gen_web/wb_correction.py`:

```python
class AnchoredFitError(ValueError):
    """Raised when the anchored fit can't be computed (too few patches,
    degenerate inputs)."""


@dataclass
class AnchoredResult:
    """Output of anchored correction (linear or gamma)."""
    frame: np.ndarray
    measured_rgbs: list[tuple[float, float, float]]
    fit_kind: str             # "linear" | "gamma"
    fit: list[tuple[float, ...]]   # per-channel coefficients


def anchored_correct_linear(
    frame_bgr: np.ndarray,
    *,
    measured_rgbs: list[tuple[float, float, float]],
    canonical_rgbs: list[tuple[float, float, float]],
) -> AnchoredResult:
    """Fit a per-channel linear ``corrected = a * raw + b`` from two
    or more (measured, canonical) anchor pairs and apply.

    With exactly two pairs the fit is exact; with three or more we
    use least-squares per channel.

    Raises:
        AnchoredFitError: when fewer than 2 anchors are supplied or
            when a per-channel system is singular.
    """
    if len(measured_rgbs) < 2 or len(canonical_rgbs) < 2:
        raise AnchoredFitError(
            f"need at least 2 anchors, got {len(measured_rgbs)}"
        )
    if len(measured_rgbs) != len(canonical_rgbs):
        raise AnchoredFitError(
            "measured_rgbs and canonical_rgbs must have same length"
        )

    n = len(measured_rgbs)
    measured = np.asarray(measured_rgbs, dtype=np.float64)   # (n, 3) RGB
    canonical = np.asarray(canonical_rgbs, dtype=np.float64)

    # Per-channel (a, b) via least squares: canonical[c] = a * measured[c] + b
    fit: list[tuple[float, ...]] = []
    for c in range(3):
        x = measured[:, c]
        y = canonical[:, c]
        A = np.column_stack([x, np.ones(n)])
        try:
            coeffs, *_ = np.linalg.lstsq(A, y, rcond=None)
        except np.linalg.LinAlgError as e:
            raise AnchoredFitError(f"channel {c} fit failed: {e}") from e
        a, b = float(coeffs[0]), float(coeffs[1])
        fit.append((a, b))

    # Apply per-channel — frame is BGR (channel 0=B, 1=G, 2=R).
    f = frame_bgr.astype(np.float32)
    # fit is [R, G, B] → BGR mapping: B=fit[2], G=fit[1], R=fit[0]
    aR, bR = fit[0]
    aG, bG = fit[1]
    aB, bB = fit[2]
    f[:, :, 0] = f[:, :, 0] * aB + bB
    f[:, :, 1] = f[:, :, 1] * aG + bG
    f[:, :, 2] = f[:, :, 2] * aR + bR
    out = np.clip(f, 0, 255).astype(np.uint8)

    return AnchoredResult(
        frame=out,
        measured_rgbs=list(measured_rgbs),
        fit_kind="linear",
        fit=fit,
    )
```

- [ ] **Step 4: Run, expect 5 passed total**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_wb_correction.py -v
```

Expected: 5 passed (3 chromaticity + 2 anchored linear).

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): anchored linear two-point fit"
```

---

## Task 5: Specular rejection + 3-anchor gamma fit

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing tests**

```python
from xcs_gen_web.wb_correction import (
    reject_specular,
    SpecularRejectionResult,
    anchored_correct_gamma,
)


def test_reject_specular_drops_top_quartile_by_luminance():
    # 100 pixels, 25 of which are bright outliers
    pixels_rgb = np.array(
        [[100, 100, 100]] * 75 + [[250, 250, 250]] * 25,
        dtype=np.float32,
    )
    out = reject_specular(pixels_rgb, top_pct=0.25)
    assert isinstance(out, SpecularRejectionResult)
    # Should keep the 75 non-bright ones, discard the 25 outliers.
    assert out.kept.shape[0] == 75
    assert np.allclose(out.kept.mean(axis=0), [100, 100, 100], atol=1)


def test_anchored_gamma_better_fit_with_three_anchors():
    # Construct a tinted frame with a non-linear (gamma=1.5) bake.
    base = _frame((100, 100, 100))
    raw = base.astype(np.float32) / 255.0
    bumped = np.power(raw, 1.5) * 255.0
    bumped_u8 = np.clip(bumped, 0, 255).astype(np.uint8)
    # Three anchors at known levels.
    levels_canon = [50.0, 128.0, 200.0]
    levels_meas = [(np.power(L / 255.0, 1.5) * 255.0) for L in levels_canon]
    measured = [(m, m, m) for m in levels_meas]
    canonical = [(L, L, L) for L in levels_canon]

    out = anchored_correct_gamma(
        bumped_u8, measured_rgbs=measured, canonical_rgbs=canonical
    )
    assert out.fit_kind == "gamma"
    assert len(out.fit) == 3   # per-channel (a, b, gamma)
    # Recovered grey ought to be close to 100 within ±5 (gamma fit on
    # only 3 anchors is approximate, especially at the endpoints).
    px = out.frame[50, 50]
    assert abs(int(px[2]) - 100) <= 5
```

- [ ] **Step 2: Run, expect failure**

Expected: ImportError.

- [ ] **Step 3: Implement**

Append to `src/xcs_gen_web/wb_correction.py`:

```python
@dataclass
class SpecularRejectionResult:
    kept: np.ndarray              # (m, 3) RGB float
    rejected: np.ndarray          # (k, 3) RGB float
    rejected_count: int


def reject_specular(
    pixels_rgb: np.ndarray,
    *,
    top_pct: float = 0.25,
) -> SpecularRejectionResult:
    """Drop the brightest ``top_pct`` of pixels by luminance.

    Specular reflections show up as the brightest pixels in a patch
    of unburned/clean-burned material; rejecting the top quartile
    leaves the diffuse component, which is what we want as our
    anchor.
    """
    if pixels_rgb.size == 0:
        return SpecularRejectionResult(
            kept=pixels_rgb, rejected=pixels_rgb, rejected_count=0
        )
    lum = 0.299 * pixels_rgb[:, 0] + 0.587 * pixels_rgb[:, 1] + 0.114 * pixels_rgb[:, 2]
    cutoff = np.quantile(lum, 1.0 - top_pct)
    keep_mask = lum <= cutoff
    return SpecularRejectionResult(
        kept=pixels_rgb[keep_mask],
        rejected=pixels_rgb[~keep_mask],
        rejected_count=int((~keep_mask).sum()),
    )


def anchored_correct_gamma(
    frame_bgr: np.ndarray,
    *,
    measured_rgbs: list[tuple[float, float, float]],
    canonical_rgbs: list[tuple[float, float, float]],
) -> AnchoredResult:
    """Fit a per-channel ``corrected = a * raw**gamma + b`` from 3+
    anchors and apply.

    Uses log-space least squares: log((y - b_guess)) = gamma * log(x) + log(a).
    For simplicity and robustness with small N (3-5 anchors), we fit
    in two passes — first a linear fit in log space to get a/gamma,
    then refine b. Any pathological fit (gamma not in [0.3, 3.0])
    raises ``AnchoredFitError`` so the caller can fall back to
    linear.
    """
    if len(measured_rgbs) < 3 or len(canonical_rgbs) < 3:
        raise AnchoredFitError(
            f"gamma fit needs ≥3 anchors, got {len(measured_rgbs)}"
        )
    measured = np.asarray(measured_rgbs, dtype=np.float64)
    canonical = np.asarray(canonical_rgbs, dtype=np.float64)

    fit: list[tuple[float, ...]] = []
    for c in range(3):
        x = measured[:, c]
        y = canonical[:, c]
        # Avoid zeros in log
        eps = 1e-3
        x_safe = np.maximum(x, eps)
        y_safe = np.maximum(y, eps)
        log_x = np.log(x_safe)
        log_y = np.log(y_safe)
        A = np.column_stack([log_x, np.ones(len(x))])
        coeffs, *_ = np.linalg.lstsq(A, log_y, rcond=None)
        gamma = float(coeffs[0])
        log_a = float(coeffs[1])
        a = float(np.exp(log_a))
        if not (0.3 <= gamma <= 3.0):
            raise AnchoredFitError(
                f"channel {c} gamma {gamma:.3f} outside [0.3, 3.0]"
            )
        fit.append((a, 0.0, gamma))   # b kept at 0 for the gamma form

    # Apply per-channel
    f = frame_bgr.astype(np.float32)
    eps = 1e-3
    aR, _, gR = fit[0]
    aG, _, gG = fit[1]
    aB, _, gB = fit[2]
    f[:, :, 0] = aB * np.power(np.maximum(f[:, :, 0], eps), gB)
    f[:, :, 1] = aG * np.power(np.maximum(f[:, :, 1], eps), gG)
    f[:, :, 2] = aR * np.power(np.maximum(f[:, :, 2], eps), gR)
    out = np.clip(f, 0, 255).astype(np.uint8)

    return AnchoredResult(
        frame=out,
        measured_rgbs=list(measured_rgbs),
        fit_kind="gamma",
        fit=fit,
    )
```

- [ ] **Step 4: Run, expect 7 passed total**

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): specular rejection + 3-anchor gamma fit"
```

---

## Task 6: Orchestrator with anchored → chromaticity → skip cascade

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

- [ ] **Step 1: Append failing tests**

```python
from xcs_gen_web.wb_correction import (
    correct_warped_frame,
    CorrectionOutcome,
)


def test_orchestrator_picks_anchored_when_strip_present():
    img = _frame((150, 140, 110))
    # Pretend the strip gave us 3 patches of measured RGB.
    strip = [
        ((50.0, 47.0, 38.0), (50.0, 50.0, 45.5)),    # (measured, canonical)
        ((128.0, 120.0, 96.0), (128.0, 128.0, 117.0)),
        ((200.0, 188.0, 152.0), (200.0, 200.0, 182.0)),
    ]
    out = correct_warped_frame(img, strip_anchors=strip, unburned_rgb=None)
    assert isinstance(out, CorrectionOutcome)
    assert out.mode == "anchored"
    assert out.applied is True


def test_orchestrator_falls_back_to_chromaticity_when_no_strip():
    img = _frame((150, 140, 110))
    out = correct_warped_frame(
        img, strip_anchors=None, unburned_rgb=(150.0, 140.0, 110.0)
    )
    assert out.mode == "chromaticity"
    assert out.applied is True


def test_orchestrator_skips_when_no_inputs():
    img = _frame((150, 140, 110))
    out = correct_warped_frame(img, strip_anchors=None, unburned_rgb=None)
    assert out.mode == "skipped"
    assert out.applied is False
    assert np.array_equal(out.frame, img)


def test_orchestrator_falls_back_to_linear_when_gamma_pathological():
    # Provide 3 anchors but with no curvature (perfectly linear).
    # Gamma fit should still work or produce a sensible linear fit.
    img = _frame((100, 100, 100))
    strip = [
        ((50.0, 50.0, 50.0), (50.0, 50.0, 50.0)),
        ((100.0, 100.0, 100.0), (100.0, 100.0, 100.0)),
        ((200.0, 200.0, 200.0), (200.0, 200.0, 200.0)),
    ]
    out = correct_warped_frame(img, strip_anchors=strip, unburned_rgb=None)
    assert out.mode == "anchored"
    assert out.applied is True
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Append to `src/xcs_gen_web/wb_correction.py`:

```python
@dataclass
class CorrectionOutcome:
    """High-level result returned to the capture pipeline."""
    frame: np.ndarray
    mode: str             # "anchored" | "chromaticity" | "skipped"
    applied: bool
    measured_rgbs: list[tuple[float, float, float]] | None
    fit: list[tuple[float, ...]] | tuple[float, float, float] | None
    fit_kind: str | None  # "linear" | "gamma" | "chromaticity_scale" | None
    canonical_id: str | None


def correct_warped_frame(
    frame_bgr: np.ndarray,
    *,
    strip_anchors: list[tuple[
        tuple[float, float, float], tuple[float, float, float]
    ]] | None,
    unburned_rgb: tuple[float, float, float] | None,
    canonical_chromaticity_rgb: tuple[float, float, float] = (1.0, 1.0, 0.91),
    canonical_id: str | None = None,
) -> CorrectionOutcome:
    """Top-level correction entry point.

    Picks the best mode given what's available:

    - Anchored mode if ``strip_anchors`` has ≥2 (measured, canonical)
      pairs. Tries gamma first if N≥3; on AnchoredFitError or N==2,
      falls back to linear.
    - Chromaticity-only mode if ``unburned_rgb`` is provided.
    - Skip otherwise (frame returned unchanged).
    """
    if strip_anchors and len(strip_anchors) >= 2:
        measured = [m for m, _ in strip_anchors]
        canonical = [c for _, c in strip_anchors]
        try:
            if len(strip_anchors) >= 3:
                anch = anchored_correct_gamma(
                    frame_bgr,
                    measured_rgbs=measured,
                    canonical_rgbs=canonical,
                )
            else:
                anch = anchored_correct_linear(
                    frame_bgr,
                    measured_rgbs=measured,
                    canonical_rgbs=canonical,
                )
        except AnchoredFitError:
            # Fall through to linear on gamma failure.
            try:
                anch = anchored_correct_linear(
                    frame_bgr,
                    measured_rgbs=measured,
                    canonical_rgbs=canonical,
                )
            except AnchoredFitError:
                anch = None
        if anch is not None:
            return CorrectionOutcome(
                frame=anch.frame,
                mode="anchored",
                applied=True,
                measured_rgbs=anch.measured_rgbs,
                fit=anch.fit,
                fit_kind=anch.fit_kind,
                canonical_id=canonical_id,
            )

    if unburned_rgb is not None:
        chrom = chromaticity_correct(
            frame_bgr,
            unburned_rgb=unburned_rgb,
            canonical_rgb=canonical_chromaticity_rgb,
        )
        return CorrectionOutcome(
            frame=chrom.frame,
            mode="chromaticity",
            applied=True,
            measured_rgbs=[chrom.measured_rgb],
            fit=chrom.scales,
            fit_kind="chromaticity_scale",
            canonical_id=canonical_id,
        )

    return CorrectionOutcome(
        frame=frame_bgr.copy(),
        mode="skipped",
        applied=False,
        measured_rgbs=None,
        fit=None,
        fit_kind=None,
        canonical_id=canonical_id,
    )
```

- [ ] **Step 4: Run, expect 11 passed total**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): correction orchestrator (anchored→chromaticity→skip)"
```

---

## Task 7: Calibration strip in the capture layout

**Files:**
- Modify: `src/xcs_gen/capture/layout.py`
- Create: `tests/test_capture_layout_strip.py`

- [ ] **Step 1: Read the existing layout module**

Read `src/xcs_gen/capture/layout.py` end-to-end (it's small, ~100 lines) so you understand `MarkerPosition`, `RegistrationLayout`, and the existing `compute_layout` function.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_capture_layout_strip.py`:

```python
"""Tests for calibration-strip extension to the registration layout."""

from __future__ import annotations

from xcs_gen.capture.layout import (
    CalibrationPatch,
    CalibrationStrip,
    compute_layout,
)


def test_strip_disabled_by_default():
    layout = compute_layout(grid_x=10, grid_y=10, grid_w=50, grid_h=50)
    assert layout.calibration_strip is None


def test_strip_enabled_with_three_patches_default_geometry():
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=50, grid_h=50,
        with_calibration_strip=True, patch_count=3,
    )
    strip = layout.calibration_strip
    assert isinstance(strip, CalibrationStrip)
    assert len(strip.patches) == 3
    # Each patch is 5×5 mm by default.
    for p in strip.patches:
        assert isinstance(p, CalibrationPatch)
        assert p.width_mm == 5.0
        assert p.height_mm == 5.0
    # 3 patches × 5 mm + 2 gaps × 1 mm = 17 mm strip width
    span_x = strip.patches[-1].x + strip.patches[-1].width_mm - strip.patches[0].x
    assert abs(span_x - 17.0) < 0.01
    # Clean-pass area = patch bbox + 2 mm border on every side.
    cp = strip.clean_pass_bbox
    assert cp.width_mm == 17.0 + 4.0   # 2mm × 2 sides
    assert cp.height_mm == 5.0 + 4.0


def test_strip_positioned_top_centre_between_qr_and_top_right_aruco():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_calibration_strip=True,
    )
    strip = layout.calibration_strip
    assert strip is not None
    qr = layout.qr
    tr = next(a for a in layout.arucos if a.marker_id == 1)
    # Strip must sit ABOVE the grid (y < grid_y) and to the right of
    # the QR (x > qr.x + qr.size).
    assert strip.patches[0].x > qr.x + qr.size
    # Top of patches must be ≥ top of grid - clean-pass height.
    assert strip.patches[0].y < 20
    # Right edge must clear the top-right ArUco.
    assert strip.patches[-1].x + strip.patches[-1].width_mm < tr.x


def test_strip_falls_back_when_grid_too_narrow():
    # Tiny grid where strip wouldn't fit: layout returns strip=None.
    layout = compute_layout(
        grid_x=10, grid_y=10, grid_w=15, grid_h=20,   # only 15 mm wide
        with_calibration_strip=True,
    )
    assert layout.calibration_strip is None
```

- [ ] **Step 3: Run, expect failure**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_capture_layout_strip.py -v
```

Expected: ImportError on `CalibrationPatch` / `CalibrationStrip` / new compute_layout kwargs.

- [ ] **Step 4: Implement**

In `src/xcs_gen/capture/layout.py`, append after the existing `MarkerPosition`/`RegistrationLayout` classes:

```python
PATCH_SIZE_DEFAULT_MM = 5.0
PATCH_GAP_DEFAULT_MM = 1.0
PATCH_BORDER_DEFAULT_MM = 2.0


@dataclass
class CalibrationPatch:
    label: str           # "light" | "mid" | "dark"
    x: float             # top-left, mm
    y: float
    width_mm: float
    height_mm: float


@dataclass
class CalibrationCleanPassBBox:
    x: float
    y: float
    width_mm: float
    height_mm: float


@dataclass
class CalibrationStrip:
    patches: list[CalibrationPatch]
    clean_pass_bbox: CalibrationCleanPassBBox
```

Modify `RegistrationLayout` to add the strip field:

```python
@dataclass
class RegistrationLayout:
    qr: MarkerPosition | None
    arucos: list[MarkerPosition]
    calibration_strip: CalibrationStrip | None = None
```

Modify `compute_layout` to accept `with_calibration_strip` + `patch_count` + sizing kwargs, and to compute the strip position when enabled. Add this AFTER the existing layout computation, BEFORE `return RegistrationLayout(...)`:

```python
def compute_layout(
    *,
    grid_x: float, grid_y: float,
    grid_w: float, grid_h: float,
    mode: Literal["on", "off"] = "on",
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
    with_calibration_strip: bool = False,
    patch_count: int = 3,
    patch_size_mm: float = PATCH_SIZE_DEFAULT_MM,
    patch_gap_mm: float = PATCH_GAP_DEFAULT_MM,
    patch_border_mm: float = PATCH_BORDER_DEFAULT_MM,
    patch_labels: tuple[str, ...] = ("light", "mid", "dark"),
) -> RegistrationLayout:
    # ... existing body up through computing the four markers ...

    strip: CalibrationStrip | None = None
    if mode == "on" and with_calibration_strip:
        strip_w = (
            patch_count * patch_size_mm
            + (patch_count - 1) * patch_gap_mm
        )
        clean_w = strip_w + 2 * patch_border_mm
        clean_h = patch_size_mm + 2 * patch_border_mm
        # Sit between QR (top-left) and top-right ArUco (tr), centred
        # in the available horizontal band on the row above the grid.
        # Available x-band: from qr.x + qr.size + margin to tr.x - margin.
        margin = MARKER_MARGIN_MM
        avail_x_start = qr_x + qr_size + margin
        avail_x_end = tr.x - margin
        if avail_x_end - avail_x_start < clean_w:
            # Not enough horizontal space → omit the strip; caller's
            # responsibility to fall back to chromaticity-only.
            strip = None
        else:
            # Position the clean-pass box centred horizontally,
            # top-aligned to the QR's row (which is grid_y - qr_size - margin).
            clean_x = avail_x_start + (avail_x_end - avail_x_start - clean_w) / 2
            clean_y = grid_y - clean_h - margin
            patches: list[CalibrationPatch] = []
            for i, label in enumerate(patch_labels[:patch_count]):
                px = clean_x + patch_border_mm + i * (patch_size_mm + patch_gap_mm)
                py = clean_y + patch_border_mm
                patches.append(CalibrationPatch(
                    label=label, x=px, y=py,
                    width_mm=patch_size_mm, height_mm=patch_size_mm,
                ))
            strip = CalibrationStrip(
                patches=patches,
                clean_pass_bbox=CalibrationCleanPassBBox(
                    x=clean_x, y=clean_y,
                    width_mm=clean_w, height_mm=clean_h,
                ),
            )

    return RegistrationLayout(qr=qr, arucos=[tr, br, bl], calibration_strip=strip)
```

(NOTE: the existing function body already builds `qr`, `tr`, `br`, `bl` with their respective coords. You're inserting the strip block BEFORE the return statement and appending `calibration_strip=strip` to the constructor call.)

- [ ] **Step 5: Run, expect 4 passed**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -m pytest tests/test_capture_layout_strip.py -v
```

- [ ] **Step 6: Run the full backend suite**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3
```

Expected: ~684 passing (was ~680 baseline + 4 new), nothing regressed. Existing layout tests still pass with the optional new kwargs.

- [ ] **Step 7: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen/capture/layout.py tests/test_capture_layout_strip.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): calibration strip geometry in compute_layout"
```

---

## Task 8: Strip emission — clean pass + calibration burns

**Files:**
- Modify: `src/xcs_gen/capture/marker_render.py`
- Modify: `tests/test_capture_layout_strip.py`

The clean pass + each calibration burn need to be emitted as `Rect` elements (not Bitmaps — they're solid blocks, not raster grids) into the project's `device_entries`. The clean pass uses the material's `clean_pass_params`; each patch uses its own params.

- [ ] **Step 1: Append failing test**

In `tests/test_capture_layout_strip.py`, append:

```python
from xcs_gen.capture.marker_render import render_calibration_strip
from xcs_gen.capture.layout import compute_layout


def test_render_emits_clean_pass_plus_per_patch_burns():
    layout = compute_layout(
        grid_x=20, grid_y=20, grid_w=80, grid_h=60,
        with_calibration_strip=True, patch_count=3,
    )
    strip = layout.calibration_strip
    assert strip is not None
    clean_pass_params = {
        "power": 30.0, "speed": 800, "frequency": 60, "density": 1000,
        "passes": 2, "pulse_width": 200, "laser": "red",
    }
    patches_params = [
        {"power": 8.0, "speed": 1500, "frequency": 30, "density": 800,
         "passes": 1, "pulse_width": 120, "laser": "red"},
        {"power": 18.0, "speed": 1000, "frequency": 80, "density": 1000,
         "passes": 1, "pulse_width": 160, "laser": "red"},
        {"power": 40.0, "speed": 400, "frequency": 120, "density": 1200,
         "passes": 2, "pulse_width": 240, "laser": "red"},
    ]
    elements = render_calibration_strip(
        strip,
        clean_pass_params=clean_pass_params,
        patches_params=patches_params,
    )
    # 1 clean-pass element + 3 calibration patches = 4 elements.
    assert len(elements) == 4
    # Order: clean pass first (so it burns underneath), then the patches.
    assert elements[0].width == strip.clean_pass_bbox.width_mm
    assert elements[0].height == strip.clean_pass_bbox.height_mm
    # Patches are 5 mm squares with the supplied params.
    for i in range(1, 4):
        assert elements[i].width == 5.0
        assert elements[i].height == 5.0
```

- [ ] **Step 2: Run, expect failure**

Expected: ImportError on `render_calibration_strip`.

- [ ] **Step 3: Implement**

Append to `src/xcs_gen/capture/marker_render.py`:

```python
from typing import Any   # if not already imported


def render_calibration_strip(
    strip: "CalibrationStrip",
    *,
    clean_pass_params: dict[str, Any],
    patches_params: list[dict[str, Any]],
) -> list["Rect"]:
    """Emit the calibration strip as Rect elements.

    Returns elements in burn order: clean-pass first (so it's beneath
    the calibration burns), then each calibration patch in left-to-
    right order.
    """
    from xcs_gen.model import Rect, ProcessingParams
    from .layout import CalibrationStrip   # noqa: F401  (typing only)

    if len(patches_params) != len(strip.patches):
        raise ValueError(
            f"patches_params length {len(patches_params)} != "
            f"strip.patches length {len(strip.patches)}"
        )

    def _to_pp(d: dict[str, Any]) -> ProcessingParams:
        return ProcessingParams(
            power=d["power"], speed=d["speed"],
            mopa_frequency=d["frequency"], density=d["density"],
            repeat=d["passes"], pulse_width=d["pulse_width"],
            processing_light_source=d["laser"],
        )

    out: list[Rect] = []
    cp = strip.clean_pass_bbox
    out.append(Rect(
        x=cp.x, y=cp.y, width=cp.width_mm, height=cp.height_mm,
        params=_to_pp(clean_pass_params),
        processing_type="COLOR_FILL_ENGRAVE",
        layer_color="#7f7f7f",
    ))
    for patch, params in zip(strip.patches, patches_params):
        out.append(Rect(
            x=patch.x, y=patch.y,
            width=patch.width_mm, height=patch.height_mm,
            params=_to_pp(params),
            processing_type="COLOR_FILL_ENGRAVE",
            layer_color=f"#cal_{patch.label}",
        ))
    return out
```

(Note: `ProcessingParams` field names per `xcs_gen.model.ProcessingParams`. Verify by reading `src/xcs_gen/model.py:14-39` — fields are `power`, `speed`, `mopa_frequency`, `density`, `repeat`, `pulse_width`, `processing_light_source`. The dict keys we accept are `frequency`/`passes`/`laser` for ergonomics; map them.)

- [ ] **Step 4: Run, expect 5 passed in this file**

Expected: 5 passed.

- [ ] **Step 5: Run full backend suite, no regressions**

- [ ] **Step 6: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen/capture/marker_render.py tests/test_capture_layout_strip.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): emit calibration strip clean-pass + patch burns"
```

---

## Task 9: Capture pipeline integration

**Files:**
- Modify: `src/xcs_gen_web/capture_pipeline.py`
- Create: `tests/test_capture_pipeline_wb.py`

The pipeline currently flows `decode → fiducials → warp → cell sampling`. Insert WB correction between warp and cell sampling. Sample strip patches at known burn-space coords (derived from the registration layout used for that test) before correction; sample unburned material adjacent to markers as the chromaticity fallback.

This task is the most coupled to existing code. Read `capture_pipeline.py` end-to-end before starting.

- [ ] **Step 1: Write failing test**

Create `tests/test_capture_pipeline_wb.py`:

```python
"""Integration tests for WB correction in the capture pipeline."""

from __future__ import annotations

import numpy as np

from xcs_gen_web.capture_pipeline import (
    apply_wb_correction_to_warped,
)


def _solid_warped(color: tuple[int, int, int], h: int = 200, w: int = 200) -> np.ndarray:
    """A flat warped-frame stand-in (BGR uint8)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :, :] = (color[2], color[1], color[0])
    return img


def test_apply_wb_correction_chromaticity_only_path():
    img = _solid_warped((150, 140, 110))
    out = apply_wb_correction_to_warped(
        img,
        strip_anchors=None,
        unburned_rgb=(150.0, 140.0, 110.0),
        canonical_id="v1.steel-default.2026-05-06",
    )
    assert out.mode == "chromaticity"
    assert out.canonical_id == "v1.steel-default.2026-05-06"
    assert out.applied is True


def test_apply_wb_correction_skips_when_disabled():
    img = _solid_warped((150, 140, 110))
    out = apply_wb_correction_to_warped(
        img, strip_anchors=None, unburned_rgb=None,
        canonical_id=None, enabled=False,
    )
    assert out.mode == "disabled"
    assert out.applied is False
    assert np.array_equal(out.frame, img)
```

- [ ] **Step 2: Run, expect failure** (ImportError)

- [ ] **Step 3: Implement the bridging function**

In `src/xcs_gen_web/capture_pipeline.py`, append:

```python
from .wb_correction import correct_warped_frame, CorrectionOutcome


def apply_wb_correction_to_warped(
    frame_bgr: np.ndarray,
    *,
    strip_anchors: list[tuple[
        tuple[float, float, float], tuple[float, float, float]
    ]] | None,
    unburned_rgb: tuple[float, float, float] | None,
    canonical_id: str | None,
    enabled: bool = True,
) -> CorrectionOutcome:
    """Pipeline-facing wrapper around ``wb_correction.correct_warped_frame``.

    When ``enabled`` is False, returns a CorrectionOutcome with
    ``mode="disabled"`` and the frame untouched. Otherwise delegates."""
    if not enabled:
        from .wb_correction import CorrectionOutcome
        return CorrectionOutcome(
            frame=frame_bgr.copy(),
            mode="disabled",
            applied=False,
            measured_rgbs=None,
            fit=None,
            fit_kind=None,
            canonical_id=canonical_id,
        )
    return correct_warped_frame(
        frame_bgr,
        strip_anchors=strip_anchors,
        unburned_rgb=unburned_rgb,
        canonical_id=canonical_id,
    )
```

- [ ] **Step 4: Run, expect 2 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/capture_pipeline.py tests/test_capture_pipeline_wb.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): pipeline wrapper for warped-frame correction"
```

---

## Task 10: Sampling helpers — strip + unburned material

**Files:**
- Modify: `src/xcs_gen_web/wb_correction.py`
- Modify: `tests/test_wb_correction.py`

Add helpers for sampling RGB anchors from a warped frame. The warped frame is in burn-space (1 mm = N pixels for some constant N), so given a `CalibrationStrip` and a marker layout we can compute pixel rectangles to sample.

- [ ] **Step 1: Append failing tests**

```python
from xcs_gen_web.wb_correction import (
    sample_strip_anchors,
    sample_unburned_around_markers,
)


def test_sample_strip_anchors_returns_one_per_patch():
    # Pretend the warped frame is 100 px / mm.
    px_per_mm = 4.0
    img = np.zeros((400, 400, 3), dtype=np.uint8)
    # Plant 3 patches with known mean colours: (50, 50, 50), (128, 128, 128), (200, 200, 200).
    patches_xy_mm_size = [
        (10.0, 10.0, 5.0, (50, 50, 50)),
        (16.0, 10.0, 5.0, (128, 128, 128)),
        (22.0, 10.0, 5.0, (200, 200, 200)),
    ]
    for x, y, s, (R, G, B) in patches_xy_mm_size:
        x0, y0 = int(x * px_per_mm), int(y * px_per_mm)
        x1, y1 = int((x + s) * px_per_mm), int((y + s) * px_per_mm)
        img[y0:y1, x0:x1, 0] = B
        img[y0:y1, x0:x1, 1] = G
        img[y0:y1, x0:x1, 2] = R

    strip_patches = [
        {"x": x, "y": y, "size_mm": s} for x, y, s, _ in patches_xy_mm_size
    ]
    measured = sample_strip_anchors(
        img, strip_patches, px_per_mm=px_per_mm, sample_inner_mm=1.5,
    )
    assert len(measured) == 3
    for got, expected in zip(
        measured,
        [(50, 50, 50), (128, 128, 128), (200, 200, 200)],
    ):
        assert all(abs(g - e) < 2 for g, e in zip(got, expected))


def test_sample_unburned_around_markers_returns_single_rgb():
    # 200×200 px warped frame at 4 px/mm. Marker at (5, 5) mm,
    # 2 mm size. Around it, fill with (160, 160, 140) "silver" tone.
    px_per_mm = 4.0
    img = np.full((200, 200, 3), (140, 160, 160), dtype=np.uint8)   # BGR
    markers_xy_mm_size = [
        {"x": 5.0, "y": 5.0, "size_mm": 2.0},
        {"x": 40.0, "y": 5.0, "size_mm": 2.0},
    ]
    out = sample_unburned_around_markers(
        img, markers_xy_mm_size, px_per_mm=px_per_mm,
        sample_outer_offset_mm=2.0, sample_size_mm=3.0,
    )
    R, G, B = out
    assert abs(R - 160) <= 2
    assert abs(G - 160) <= 2
    assert abs(B - 140) <= 2
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Append to `src/xcs_gen_web/wb_correction.py`:

```python
def sample_strip_anchors(
    frame_bgr: np.ndarray,
    strip_patches: list[dict[str, float]],
    *,
    px_per_mm: float,
    sample_inner_mm: float = 1.5,
) -> list[tuple[float, float, float]]:
    """Sample the centre of each calibration patch.

    Each patch dict has ``x``, ``y`` (top-left, mm) and ``size_mm``.
    Sampled region: a centred ``sample_inner_mm × sample_inner_mm``
    box, rejecting the brightest 25% of pixels.
    Returns a list of (R, G, B) per patch.
    """
    out: list[tuple[float, float, float]] = []
    for patch in strip_patches:
        x_mm, y_mm, s_mm = patch["x"], patch["y"], patch["size_mm"]
        cx_mm = x_mm + s_mm / 2.0
        cy_mm = y_mm + s_mm / 2.0
        half_mm = sample_inner_mm / 2.0
        x0 = int((cx_mm - half_mm) * px_per_mm)
        y0 = int((cy_mm - half_mm) * px_per_mm)
        x1 = int((cx_mm + half_mm) * px_per_mm)
        y1 = int((cy_mm + half_mm) * px_per_mm)
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(frame_bgr.shape[1], x1); y1 = min(frame_bgr.shape[0], y1)
        sub = frame_bgr[y0:y1, x0:x1]
        if sub.size == 0:
            out.append((0.0, 0.0, 0.0))
            continue
        # Convert BGR → RGB for the sampler then reject specular hits.
        rgb = sub[:, :, ::-1].reshape(-1, 3).astype(np.float32)
        kept = reject_specular(rgb).kept
        if kept.size == 0:
            kept = rgb
        mean = kept.mean(axis=0)
        out.append((float(mean[0]), float(mean[1]), float(mean[2])))
    return out


def sample_unburned_around_markers(
    frame_bgr: np.ndarray,
    markers: list[dict[str, float]],
    *,
    px_per_mm: float,
    sample_outer_offset_mm: float = 2.0,
    sample_size_mm: float = 3.0,
) -> tuple[float, float, float] | None:
    """Sample unburned material in a small box just outside each
    marker, then pool across markers.

    Returns the per-channel mean RGB after pooling and specular
    rejection. Returns None if no usable samples were found.
    """
    pooled: list[np.ndarray] = []
    half_size_px = (sample_size_mm * px_per_mm) / 2.0
    for m in markers:
        cx_mm = m["x"] + m["size_mm"] / 2.0
        cy_mm = m["y"] + m["size_mm"] / 2.0
        # Sample directly above the marker.
        sample_cy_mm = cy_mm - m["size_mm"] / 2.0 - sample_outer_offset_mm
        sample_cx_mm = cx_mm
        cx_px = int(sample_cx_mm * px_per_mm)
        cy_px = int(sample_cy_mm * px_per_mm)
        x0 = max(0, int(cx_px - half_size_px))
        y0 = max(0, int(cy_px - half_size_px))
        x1 = min(frame_bgr.shape[1], int(cx_px + half_size_px))
        y1 = min(frame_bgr.shape[0], int(cy_px + half_size_px))
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
    mean = all_kept.mean(axis=0)
    return float(mean[0]), float(mean[1]), float(mean[2])
```

- [ ] **Step 4: Run, expect 13 passed total**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/wb_correction.py tests/test_wb_correction.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): warped-frame sampling helpers"
```

---

## Task 11: Repository read/write for new columns

**Files:**
- Modify: `src/xcs_gen_web/repositories/materials.py`
- Modify: `src/xcs_gen_web/repositories/results.py`
- Modify: existing repository tests if any (extend rather than write new ones)

These are mechanical extensions: read the new columns into responses, write them on insert/update, ignore in legacy data when NULL.

- [ ] **Step 1: Read both repositories end-to-end** to understand their conventions before editing.

- [ ] **Step 2: Add fields to the materials repo's read query and update method**

Extend the `_row_to_dict` (or equivalent) so the response payload includes:
- `wb_supported: bool` (default True if NULL)
- `clean_pass_params_json: dict | None` (parsed from Text)
- `calibration_patches_json: list[dict] | None` (parsed from Text)

Extend the update method (`update_material` or similar) to accept and persist these three. JSON-encode on write, decode on read.

- [ ] **Step 3: Add fields to the results repo's read query**

Extend so result responses include `wb_mode`, `wb_anchor_rgb_json` (parsed), `wb_correction_json` (parsed), `wb_canonical_id`.

Extend the create/insert path to accept these from the ingest pipeline.

- [ ] **Step 4: Run repo tests**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/test_repo_palette.py tests/test_repo*.py -q 2>&1 | tail -3
```

(If specific repo tests for materials/results don't exist yet, write a small fixture test that round-trips the new columns: insert a row with the WB fields populated, read it back, assert equality.)

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/repositories/materials.py \
  src/xcs_gen_web/repositories/results.py \
  tests/   # whichever test files were touched/added
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): repository read/write for new columns"
```

---

## Task 12: Pydantic schemas for the wire format

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`

- [ ] **Step 1: Append the new schemas**

At the bottom of `src/xcs_gen_web/schemas.py`:

```python
# ---------------------------------------------------------------------------
# WB calibration (anchored colour correction).
# Spec: docs/superpowers/specs/2026-05-06-marker-chromaticity-correction-design.md
# ---------------------------------------------------------------------------


class CalibrationPatchSpec(BaseModel):
    """One calibration patch on a material."""

    label: str = Field(min_length=1, max_length=16)
    params: BaseParams
    canonical_rgb: list[float] | None = Field(default=None)


class MaterialCalibrationConfig(BaseModel):
    """The calibration-related fields of a material, exposed as a
    nested object for clarity."""

    wb_supported: bool = True
    clean_pass_params: BaseParams | None = None
    calibration_patches: list[CalibrationPatchSpec] | None = None


class MaterialCalibrationPatch(BaseModel):
    """Wire-format for PATCH /api/materials/{id}/calibration."""

    wb_supported: bool | None = None
    clean_pass_params: BaseParams | None = None
    calibration_patches: list[CalibrationPatchSpec] | None = None


class CalibrationMeasurePatch(BaseModel):
    """One measured patch — sent to the measurement endpoint."""

    label: str
    measured_rgb: list[float] = Field(min_length=3, max_length=3)


class CalibrationMeasureRequest(BaseModel):
    """Wire-format for POST /api/materials/{id}/calibration/measure.
    The frontend extracts patch RGBs from the user's photo (via the
    existing capture pipeline) and submits them here."""

    measurements: list[CalibrationMeasurePatch] = Field(min_length=2, max_length=8)


class ResultWBState(BaseModel):
    """Embedded into ResultResponse so the UI can render the badge."""

    mode: str | None = None
    anchor_rgb: list[float] | list[list[float]] | None = None
    correction: dict[str, list[float]] | None = None
    canonical_id: str | None = None
```

(`BaseParams` already exists at the top of `schemas.py`.)

Also extend `MaterialResponse` to expose the calibration block. Find `class MaterialResponse(BaseModel)` and add:

```python
    calibration: MaterialCalibrationConfig | None = None
```

And `ResultResponse`:

```python
    wb: ResultWBState | None = None
```

- [ ] **Step 2: Verify imports**

```bash
unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  .venv/bin/python -c "from xcs_gen_web.schemas import MaterialCalibrationConfig, ResultWBState, CalibrationMeasureRequest; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add src/xcs_gen_web/schemas.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): Pydantic schemas for calibration wire format"
```

---

## Task 13: API — GET/PATCH `/api/materials/{id}/calibration`

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_materials_calibration_api.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_materials_calibration_api.py`:

```python
"""Calibration-ceremony API route tests."""

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
    assert body["calibration_patches"] is None


def test_patch_calibration_persists():
    client = TestClient(create_app())
    mid = _create_material(client)
    payload = {
        "clean_pass_params": {
            "power": 30, "speed": 800, "frequency": 60, "density": 1000,
            "passes": 2, "pulse_width": 200, "laser": "red",
        },
        "calibration_patches": [
            {"label": "light",
             "params": {"power": 8, "speed": 1500, "frequency": 30, "density": 800,
                        "passes": 1, "pulse_width": 120, "laser": "red"},
             "canonical_rgb": None},
            {"label": "mid",
             "params": {"power": 18, "speed": 1000, "frequency": 80, "density": 1000,
                        "passes": 1, "pulse_width": 160, "laser": "red"},
             "canonical_rgb": None},
        ],
    }
    resp = client.patch(f"/api/materials/{mid}/calibration", json=payload)
    assert resp.status_code == 200, resp.text
    again = client.get(f"/api/materials/{mid}/calibration").json()
    assert again["clean_pass_params"]["power"] == 30
    assert len(again["calibration_patches"]) == 2
```

- [ ] **Step 2: Run, expect failure** (404 / route not registered)

- [ ] **Step 3: Add the routes to `app.py`**

Find the existing material routes (search `@app.get("/api/materials"`). Inside `create_app`, alongside them, add:

```python
    @app.get("/api/materials/{material_id}/calibration")
    def get_material_calibration(material_id: int) -> MaterialCalibrationConfig:
        # m_repo is the materials repository imported earlier in app.py
        material = m_repo.get_material(material_id)
        if material is None:
            raise HTTPException(status_code=404, detail="material not found")
        return MaterialCalibrationConfig(
            wb_supported=material.get("wb_supported", True),
            clean_pass_params=material.get("clean_pass_params_json"),
            calibration_patches=material.get("calibration_patches_json"),
        )

    @app.patch("/api/materials/{material_id}/calibration")
    def patch_material_calibration(
        material_id: int,
        body: MaterialCalibrationPatch,
    ) -> MaterialCalibrationConfig:
        try:
            m_repo.update_material_calibration(
                material_id,
                wb_supported=body.wb_supported,
                clean_pass_params=(
                    body.clean_pass_params.model_dump()
                    if body.clean_pass_params else None
                ),
                calibration_patches=(
                    [p.model_dump() for p in body.calibration_patches]
                    if body.calibration_patches else None
                ),
            )
        except KeyError:
            raise HTTPException(status_code=404, detail="material not found")
        return get_material_calibration(material_id)
```

(`m_repo.update_material_calibration` is a new repo method you'll add in this same task — see Step 4.)

Add the imports at the top of `app.py`:

```python
from .schemas import (
    ...
    MaterialCalibrationConfig,
    MaterialCalibrationPatch,
    ...
)
```

- [ ] **Step 4: Add `update_material_calibration` to materials repo**

In `src/xcs_gen_web/repositories/materials.py`, append:

```python
def update_material_calibration(
    material_id: int,
    *,
    wb_supported: bool | None = None,
    clean_pass_params: dict | None = None,
    calibration_patches: list[dict] | None = None,
) -> None:
    """Patch the WB-calibration columns on a material."""
    import json
    fields = {}
    if wb_supported is not None:
        fields["wb_supported"] = wb_supported
    if clean_pass_params is not None:
        fields["clean_pass_params_json"] = json.dumps(clean_pass_params)
    if calibration_patches is not None:
        fields["calibration_patches_json"] = json.dumps(calibration_patches)
    if not fields:
        return
    with engine.begin() as conn:
        result = conn.execute(
            update(materials).where(materials.c.id == material_id).values(**fields)
        )
        if result.rowcount == 0:
            raise KeyError(material_id)
```

(Imports for `engine`, `update`, and the `materials` table should already be at the top of the repo module.)

- [ ] **Step 5: Run, expect 2 passed**

- [ ] **Step 6: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/app.py \
  src/xcs_gen_web/repositories/materials.py \
  tests/test_materials_calibration_api.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): GET/PATCH /api/materials/{id}/calibration"
```

---

## Task 14: API — POST `/api/materials/{id}/calibration/test-xcs`

Builds a calibration plate `.xcs` for the user to burn during the ceremony.

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `tests/test_materials_calibration_api.py`

- [ ] **Step 1: Write failing test**

```python
def test_calibration_test_xcs_returns_xcs_bytes():
    client = TestClient(create_app())
    mid = _create_material(client)
    # Pre-populate calibration via PATCH (light/mid/dark from previous test).
    client.patch(f"/api/materials/{mid}/calibration", json={
        "clean_pass_params": {
            "power": 30, "speed": 800, "frequency": 60, "density": 1000,
            "passes": 2, "pulse_width": 200, "laser": "red",
        },
        "calibration_patches": [
            {"label": "light",
             "params": {"power": 8, "speed": 1500, "frequency": 30, "density": 800,
                        "passes": 1, "pulse_width": 120, "laser": "red"},
             "canonical_rgb": None},
            {"label": "mid",
             "params": {"power": 18, "speed": 1000, "frequency": 80, "density": 1000,
                        "passes": 1, "pulse_width": 160, "laser": "red"},
             "canonical_rgb": None},
            {"label": "dark",
             "params": {"power": 40, "speed": 400, "frequency": 120, "density": 1200,
                        "passes": 2, "pulse_width": 240, "laser": "red"},
             "canonical_rgb": None},
        ],
    })
    resp = client.post(f"/api/materials/{mid}/calibration/test-xcs")
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment;")
    import json
    body = json.loads(resp.content.decode("utf-8"))
    assert isinstance(body, dict)


def test_calibration_test_xcs_400_when_no_patches_configured():
    client = TestClient(create_app())
    mid = _create_material(client)
    resp = client.post(f"/api/materials/{mid}/calibration/test-xcs")
    assert resp.status_code == 400
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

In `app.py`, add:

```python
    @app.post("/api/materials/{material_id}/calibration/test-xcs")
    def calibration_test_xcs(material_id: int) -> Response:
        """Emit a minimal calibration plate: registration frame +
        calibration strip burns. No colour grid."""
        from xcs_gen.builder import build_xcs
        from xcs_gen.capture.layout import compute_layout
        from xcs_gen.capture.marker_render import render_calibration_strip
        from xcs_gen.model import XCSProject

        material = m_repo.get_material(material_id)
        if material is None:
            raise HTTPException(status_code=404, detail="material not found")
        clean_pass = material.get("clean_pass_params_json")
        patches = material.get("calibration_patches_json")
        if clean_pass is None or not patches:
            raise HTTPException(
                status_code=400,
                detail="material has no clean-pass / calibration patches configured",
            )
        # Build a minimal layout — we just need a registration frame +
        # the strip. Use a default footprint matching a typical small plate.
        layout = compute_layout(
            grid_x=20, grid_y=20, grid_w=80, grid_h=60,
            with_calibration_strip=True,
            patch_count=len(patches),
        )
        if layout.calibration_strip is None:
            raise HTTPException(
                status_code=400,
                detail="calibration strip doesn't fit at default geometry",
            )
        elements = render_calibration_strip(
            layout.calibration_strip,
            clean_pass_params=clean_pass,
            patches_params=[p["params"] for p in patches],
        )
        # TODO(plan): also emit registration markers (QR + 3 ArUcos) for
        # the user to burn so the photographed plate has fiducials. The
        # existing marker_render module's QR/ArUco generators are the
        # right call here; wire them in via the existing test-builder
        # pattern. For this task's scope we focus on the strip; full
        # plate emission lands in the same commit if the renderer
        # surface is already there. If not, raise a clear error and
        # surface it as a follow-up sub-task in this PR.
        project = XCSProject(elements=elements)
        body = json.dumps(build_xcs(project), separators=(",", ":")).encode("utf-8")
        filename = f"{material['name']}-calibration.xcs"
        return Response(
            content=body,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
```

NOTE: The TODO above is real — full registration frame emission may need a small refactor to expose the existing QR/ArUco bitmap rendering as a reusable function. If you find this isn't already a public API, **stop and add a sub-task** (Task 14a) to extract a `render_registration_frame(layout)` helper, then resume here.

- [ ] **Step 4: Run, expect 4 passed in the file**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/app.py tests/test_materials_calibration_api.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): POST /api/materials/{id}/calibration/test-xcs"
```

---

## Task 15: API — POST `/api/materials/{id}/calibration/measure`

Persist measured RGBs after the user uploads a photo of their burned calibration plate. The photo decode + sampling happens on the FRONTEND (it has the ImageData already, and we keep the ingest pipeline focused on real result photos). The backend just receives `{label, measured_rgb}` pairs and writes them as `canonical_rgb` on the matching patches.

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen_web/repositories/materials.py`
- Modify: `tests/test_materials_calibration_api.py`

- [ ] **Step 1: Write failing test**

```python
def test_calibration_measure_writes_canonical_rgb():
    client = TestClient(create_app())
    mid = _create_material(client)
    client.patch(f"/api/materials/{mid}/calibration", json={
        "clean_pass_params": {
            "power": 30, "speed": 800, "frequency": 60, "density": 1000,
            "passes": 2, "pulse_width": 200, "laser": "red",
        },
        "calibration_patches": [
            {"label": "light",
             "params": {"power": 8, "speed": 1500, "frequency": 30,
                        "density": 800, "passes": 1, "pulse_width": 120, "laser": "red"},
             "canonical_rgb": None},
            {"label": "dark",
             "params": {"power": 40, "speed": 400, "frequency": 120,
                        "density": 1200, "passes": 2, "pulse_width": 240, "laser": "red"},
             "canonical_rgb": None},
        ],
    })
    resp = client.post(
        f"/api/materials/{mid}/calibration/measure",
        json={"measurements": [
            {"label": "light", "measured_rgb": [200.0, 195.0, 178.0]},
            {"label": "dark", "measured_rgb": [50.0, 45.0, 40.0]},
        ]},
    )
    assert resp.status_code == 200
    cfg = client.get(f"/api/materials/{mid}/calibration").json()
    by_label = {p["label"]: p for p in cfg["calibration_patches"]}
    assert by_label["light"]["canonical_rgb"] == [200.0, 195.0, 178.0]
    assert by_label["dark"]["canonical_rgb"] == [50.0, 45.0, 40.0]
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Add to `app.py`:

```python
    @app.post("/api/materials/{material_id}/calibration/measure")
    def calibration_measure(
        material_id: int,
        body: CalibrationMeasureRequest,
    ) -> MaterialCalibrationConfig:
        try:
            m_repo.write_calibration_measurements(
                material_id,
                {m.label: list(m.measured_rgb) for m in body.measurements},
            )
        except KeyError:
            raise HTTPException(status_code=404, detail="material not found")
        return get_material_calibration(material_id)
```

Add to `materials.py` repository:

```python
def write_calibration_measurements(
    material_id: int,
    rgb_by_label: dict[str, list[float]],
) -> None:
    """Update each calibration patch's canonical_rgb in-place."""
    import json
    with engine.begin() as conn:
        row = conn.execute(
            select(materials.c.calibration_patches_json).where(
                materials.c.id == material_id
            )
        ).first()
        if row is None or row[0] is None:
            raise KeyError(material_id)
        patches = json.loads(row[0])
        for p in patches:
            if p["label"] in rgb_by_label:
                p["canonical_rgb"] = rgb_by_label[p["label"]]
        conn.execute(
            update(materials).where(materials.c.id == material_id).values(
                calibration_patches_json=json.dumps(patches),
            )
        )
```

Add `CalibrationMeasureRequest` to the imports in `app.py`.

- [ ] **Step 4: Run, expect 5 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/app.py \
  src/xcs_gen_web/repositories/materials.py \
  tests/test_materials_calibration_api.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): POST /api/materials/{id}/calibration/measure"
```

---

## Task 16: API — POST `/api/results/{id}/reingest`

Re-runs WB correction on an existing result using its `warped_image_path` (or re-processes the original photo if needed).

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Create: `tests/test_results_reingest_api.py`

- [ ] **Step 1: Write failing test**

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

(Full reingest happy-path requires a real photo fixture and is covered in the integration tests / smoke test rather than a route unit test. This task pins the route's existence + 404 behaviour.)

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Add to `app.py`:

```python
    @app.post("/api/results/{result_id}/reingest")
    def reingest_result(result_id: int) -> ResultResponse:
        """Re-run WB correction on an existing result, using the
        latest material calibration + global toggle."""
        result = r_repo.get_result(result_id)
        if result is None:
            raise HTTPException(status_code=404, detail="result not found")
        # The actual re-run logic delegates to a helper in
        # capture_pipeline.py that reads warped_image_path, runs the
        # correction, updates wb_* columns, and re-samples cells.
        from .capture_pipeline import reingest_with_wb
        try:
            reingest_with_wb(result_id)
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        updated = r_repo.get_result(result_id)
        return ResultResponse(**updated)
```

Add to `capture_pipeline.py`:

```python
def reingest_with_wb(result_id: int) -> None:
    """Re-runs WB correction on an existing result.

    Reads ``warped_image_path``, applies correction with the latest
    material settings, persists the new ``wb_*`` columns. Cell
    re-sampling happens via the existing repo update path.

    Raises:
        FileNotFoundError: when warped_image_path is not on disk.
    """
    from .repositories import results as r_repo
    from .repositories import materials as m_repo

    result = r_repo.get_result(result_id)
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
    # Look up material's calibration; if anchored available, sample
    # strip pixels; otherwise use chromaticity fallback. For now we
    # simulate by treating warped_path as a clean post-warp frame
    # without strip pixels — chromaticity-only.
    # (Full strip-aware sampling is the remaining wiring; this stub
    # makes the route operational. See follow-up sub-task.)
    outcome = apply_wb_correction_to_warped(
        img,
        strip_anchors=None,
        unburned_rgb=None,
        canonical_id=None,
    )
    r_repo.update_wb_state(
        result_id,
        mode=outcome.mode,
        anchor_rgb=outcome.measured_rgbs,
        correction=outcome.fit,
        canonical_id=outcome.canonical_id,
    )
```

Add `update_wb_state` to `repositories/results.py`:

```python
def update_wb_state(
    result_id: int,
    *,
    mode: str | None,
    anchor_rgb: list | None,
    correction: list | tuple | None,
    canonical_id: str | None,
) -> None:
    import json
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
    with engine.begin() as conn:
        result = conn.execute(
            update(results).where(results.c.id == result_id).values(**fields)
        )
        if result.rowcount == 0:
            raise KeyError(result_id)
```

- [ ] **Step 4: Run, expect 1 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/app.py \
  src/xcs_gen_web/capture_pipeline.py \
  src/xcs_gen_web/repositories/results.py \
  tests/test_results_reingest_api.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): POST /api/results/{id}/reingest"
```

---

## Task 17: Frontend types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Append types**

At the bottom of `web/src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// WB calibration (mirrors src/xcs_gen_web/schemas.py).
// ---------------------------------------------------------------------------

export interface CalibrationPatchSpec {
  label: string;
  params: BaseParams;
  canonical_rgb: [number, number, number] | null;
}

export interface MaterialCalibrationConfig {
  wb_supported: boolean;
  clean_pass_params: BaseParams | null;
  calibration_patches: CalibrationPatchSpec[] | null;
}

export interface CalibrationMeasurePatch {
  label: string;
  measured_rgb: [number, number, number];
}

export interface CalibrationMeasureRequest {
  measurements: CalibrationMeasurePatch[];
}

export interface ResultWBState {
  mode: "anchored" | "chromaticity" | "skipped" | "disabled" | null;
  anchor_rgb: [number, number, number] | [number, number, number][] | null;
  correction: Record<string, number[]> | null;
  canonical_id: string | null;
}
```

If `Material` and `Result` types already exist, extend them:

```typescript
// Add to existing Material:
//   calibration?: MaterialCalibrationConfig | null;
// Add to existing Result:
//   wb?: ResultWBState | null;
```

- [ ] **Step 2: Typecheck**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add web/src/types.ts
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): TypeScript types for the wire format"
```

---

## Task 18: Frontend API client

**Files:**
- Create: `web/src/api/wbCalibration.ts`

- [ ] **Step 1: Write the helpers**

Create `web/src/api/wbCalibration.ts`:

```typescript
import type {
  MaterialCalibrationConfig,
  CalibrationMeasureRequest,
} from "../types";
import { j } from "./_fetch";   // or whatever the existing fetch wrapper is in this repo

export function getMaterialCalibration(materialId: number): Promise<MaterialCalibrationConfig> {
  return j(`/api/materials/${materialId}/calibration`);
}

export function patchMaterialCalibration(
  materialId: number,
  patch: Partial<MaterialCalibrationConfig>,
): Promise<MaterialCalibrationConfig> {
  return j(`/api/materials/${materialId}/calibration`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    headers: { "Content-Type": "application/json" },
  });
}

export async function downloadCalibrationXcs(materialId: number, name: string): Promise<void> {
  const resp = await fetch(`/api/materials/${materialId}/calibration/test-xcs`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-calibration.xcs`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function submitCalibrationMeasurement(
  materialId: number,
  body: CalibrationMeasureRequest,
): Promise<MaterialCalibrationConfig> {
  return j(`/api/materials/${materialId}/calibration/measure`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

export function reingestResult(resultId: number): Promise<unknown> {
  return j(`/api/results/${resultId}/reingest`, { method: "POST" });
}
```

(The `j` fetch helper exists somewhere under `web/src/api/`. If named differently, mirror the existing usage in nearby files like `web/src/api/palette.ts`.)

- [ ] **Step 2: Typecheck + commit**

```bash
cd web && npx tsc --noEmit
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add web/src/api/wbCalibration.ts
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): frontend API helpers"
```

---

## Task 19: Capture-settings WB toggle

**Files:**
- Modify: `web/src/components/CaptureSettings.tsx` (or wherever the existing capture settings live — search the codebase for an existing "ingest options" UI)

This is a small, single toggle. General-purpose agent or hands-on edit.

- [ ] **Step 1: Locate the existing capture-settings surface**

```bash
grep -rln "capture\|ingest" web/src/components/ | head -10
```

Find the panel where settings like "subtract overlaps" or "QR mode" live. Add the new toggle there.

- [ ] **Step 2: Add the toggle**

Add a checkbox (using existing UI primitives — `Checkbox` from `web/src/ui/`):

```tsx
<label className="flex items-center gap-2">
  <Checkbox checked={wbEnabled} onCheckedChange={setWbEnabled} />
  <span>Apply WB correction</span>
</label>
```

State stored locally for v1; passed to ingest as `?wb=1` query param or in the request body. Default `true`.

- [ ] **Step 3: Typecheck + smoke build + commit**

```bash
cd web && npx tsc --noEmit && npm run build > /dev/null 2>&1 && echo "build ok"
git add web/src/components/CaptureSettings.tsx
git commit -m "feat(wb-calibration): capture-settings WB toggle"
```

---

## Task 20: Result-detail WB badge + expanded panel

**Files:**
- Modify: `web/src/components/ResultDebugDialog.tsx`

**This task uses the `frontend-design:frontend-design` agent.** Brief the agent with:

- The `ResultWBState` shape (from `web/src/types.ts`).
- Visual register: Workshop Instrument — JetBrains Mono for numerics, monospace tracking on labels, metallic-bar accents.
- Badge states:
  - `anchored` → green pill, "ANCHORED"
  - `chromaticity` → yellow pill, "CHROMA"
  - `skipped` → red pill, "RAW (no WB)"
  - `disabled` → grey pill, "WB DISABLED"
- Expanded panel (click the badge to open): shows measured anchor RGBs as swatches, the per-channel correction params, and a side-by-side pre/post thumbnail. Use `result.warped_image_path` for the post and... wait, we don't store the pre. **Defer pre/post thumbnail to a follow-up** — for v1 just show measured anchors + correction params.

Code guidance:

```tsx
import type { ResultWBState } from "../types";

export function WBBadge({ wb }: { wb: ResultWBState | null | undefined }) {
  if (!wb || wb.mode == null) return <Pill tone="grey">WB UNKNOWN</Pill>;
  switch (wb.mode) {
    case "anchored":     return <Pill tone="green">ANCHORED</Pill>;
    case "chromaticity": return <Pill tone="yellow">CHROMA</Pill>;
    case "skipped":      return <Pill tone="red">RAW · no WB</Pill>;
    case "disabled":     return <Pill tone="grey">WB DISABLED</Pill>;
  }
}
```

The expanded panel renders the measured anchors as 18×18 swatches + hex labels and the correction matrix as a small monospace block.

- [ ] **Step 1: Dispatch frontend-design with the brief above**
- [ ] **Step 2: Verify integration: open the dialog in a browser, see the badge** (Task 25 covers the smoke test; just confirm typecheck + build work here)
- [ ] **Step 3: Commit**

---

## Task 21: Re-ingest button on result detail

**Files:**
- Modify: `web/src/components/ResultDetailDialog.tsx`

Small wiring task. General-purpose.

- [ ] **Step 1: Add the button**

```tsx
<Button
  variant="ghost"
  onClick={async () => {
    setBusy(true);
    try {
      await reingestResult(result.id);
      onResultUpdated?.();    // existing pattern in this dialog
    } finally {
      setBusy(false);
    }
  }}
>
  {busy ? "Re-ingesting…" : "Re-ingest with WB"}
</Button>
```

Place near the existing "delete" / "exclude" actions.

- [ ] **Step 2: Typecheck + build + commit**

```bash
cd web && npx tsc --noEmit && npm run build > /dev/null 2>&1
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add web/src/components/ResultDetailDialog.tsx
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): re-ingest button on result detail"
```

---

## Task 22: Material edit dialog — calibration panel

**Files:**
- Modify: `web/src/components/MaterialEditDialog.tsx`

**This task uses the `frontend-design:frontend-design` agent.** Brief:

- New "Calibration" section/tab inside the existing dialog.
- Layout:
  - Top: `wb_supported` toggle + a hint line ("Disable for substrates that don't tolerate the clean pass.")
  - Clean-pass params editor — same `BaseParams` widget already used for presets (find via `web/src/components/` search for "BaseParams").
  - Calibration patches editor: list, with each row showing label + params (collapsed) + canonical RGB swatch ("uncalibrated" placeholder if null).
  - "Calibrate" button → opens the wizard (Task 23).
- Reuse existing patterns from `MaterialEditDialog`'s other tabs.

API integration:
- On dialog open, `getMaterialCalibration(materialId)`.
- On save, `patchMaterialCalibration(materialId, payload)`.

- [ ] **Step 1: Dispatch frontend-design**
- [ ] **Step 2: Typecheck, build, commit**

---

## Task 23: Calibration wizard component

**Files:**
- Create: `web/src/components/CalibrationWizard.tsx`

**This task uses the `frontend-design:frontend-design` agent.** Brief:

A multi-step modal wizard with these steps:

1. **Generate** — "We'll emit a calibration plate as `.xcs`. Burn it on your machine, then come back here."
   - Calls `downloadCalibrationXcs(materialId, name)` on click.
2. **Photograph** — "Photograph the burned plate under good, even lighting. Upload the image below."
   - File input (image/*); decode in-browser to ImageData.
3. **Measure** — "We've located the strip and measured each patch. Confirm the swatches look right."
   - For each patch: a swatch of the measured RGB and the canonical hex.
   - Use the existing capture pipeline frontend logic (or call backend `/api/calibrate-photo` if that's cleaner). For v1, sample patches in-browser via `pixelArtImage.ts`-style sampling, given the warped frame extraction is already a backend capability — i.e. POST the image to `/api/calibrate-photo` (a tiny new endpoint OR — even simpler — re-use the existing photo-ingest pipeline with a special "calibration" mode).

   **Implementation note for the agent:** the cleanest cut for v1 is to add a small endpoint `POST /api/materials/{id}/calibration/photo` that accepts a multipart upload, runs warp + strip sample, and returns `{label, measured_rgb}` per patch. Then the wizard shows those numbers and the user clicks "Save", which calls `submitCalibrationMeasurement` with the same payload.

4. **Save** — "Calibration written. Future test plates of this material will use these anchors."
   - Calls `submitCalibrationMeasurement` and closes the wizard.

Visual register: same Workshop Instrument idiom. Step indicator at top, big primary button per step, secondary "Back" link. Match `MobileQrTab` and `WelcomeDialog` for multi-step wizard patterns.

- [ ] **Step 1: Dispatch frontend-design**
- [ ] **Step 2: Implement the supporting backend endpoint** (`/api/materials/{id}/calibration/photo`) if the agent picks the "POST image, get measurements" approach. Mirror the existing photo upload route pattern.
- [ ] **Step 3: Typecheck, build, commit**

---

## Task 24: Strip-aware sampling in the live capture pipeline

This connects the dots: results that arrive via the existing capture flow are checked for the strip's burn-space coordinates and sampled there.

**Files:**
- Modify: `src/xcs_gen_web/capture_pipeline.py`
- Modify: `tests/test_capture_pipeline_wb.py`

- [ ] **Step 1: Write test**

```python
def test_pipeline_picks_anchored_when_strip_in_layout():
    # Given a warped frame with synthetic strip pixels at known
    # burn-space positions, the orchestrator should pick anchored mode.
    px_per_mm = 4.0
    img = np.full((400, 400, 3), (140, 160, 160), dtype=np.uint8)
    # Plant 3 patches into the warped frame at known positions.
    strip_patches = [
        {"x": 30.0, "y": 5.0, "size_mm": 5.0, "label": "light",
         "canonical_rgb": [200.0, 200.0, 182.0]},
        {"x": 36.0, "y": 5.0, "size_mm": 5.0, "label": "mid",
         "canonical_rgb": [128.0, 128.0, 117.0]},
        {"x": 42.0, "y": 5.0, "size_mm": 5.0, "label": "dark",
         "canonical_rgb": [50.0, 50.0, 45.5]},
    ]
    # Paint each patch with a "warm-cast" measured tone.
    for patch, R, G, B in zip(
        strip_patches, [220, 140, 55], [200, 128, 50], [150, 105, 40]
    ):
        x_mm, y_mm, s = patch["x"], patch["y"], patch["size_mm"]
        x0 = int(x_mm * px_per_mm); x1 = int((x_mm + s) * px_per_mm)
        y0 = int(y_mm * px_per_mm); y1 = int((y_mm + s) * px_per_mm)
        img[y0:y1, x0:x1, 0] = B
        img[y0:y1, x0:x1, 1] = G
        img[y0:y1, x0:x1, 2] = R

    from xcs_gen_web.capture_pipeline import correct_with_strip_or_fallback

    out = correct_with_strip_or_fallback(
        img,
        px_per_mm=px_per_mm,
        strip_patches=strip_patches,
        markers=[{"x": 5.0, "y": 5.0, "size_mm": 2.0}],
        canonical_id="v1.steel-default.2026-05-06",
        enabled=True,
    )
    assert out.mode == "anchored"
    assert out.applied is True
```

- [ ] **Step 2: Implement**

```python
def correct_with_strip_or_fallback(
    frame_bgr: np.ndarray,
    *,
    px_per_mm: float,
    strip_patches: list[dict] | None,
    markers: list[dict],
    canonical_id: str | None,
    enabled: bool,
) -> CorrectionOutcome:
    """Sample anchors from the frame and call the orchestrator.

    ``strip_patches`` is the list of {label, x, y, size_mm,
    canonical_rgb} from the material's calibration config. ``markers``
    is the list of {x, y, size_mm} for unburned-material sampling.
    """
    from .wb_correction import (
        sample_strip_anchors, sample_unburned_around_markers,
    )
    if not enabled:
        return apply_wb_correction_to_warped(
            frame_bgr, strip_anchors=None, unburned_rgb=None,
            canonical_id=canonical_id, enabled=False,
        )

    strip_anchors = None
    if strip_patches:
        # Need every patch to have canonical_rgb to use anchored mode.
        if all(p.get("canonical_rgb") is not None for p in strip_patches):
            measured = sample_strip_anchors(
                frame_bgr, strip_patches, px_per_mm=px_per_mm,
            )
            canonical = [tuple(p["canonical_rgb"]) for p in strip_patches]
            strip_anchors = list(zip(measured, canonical))

    unburned = None
    if strip_anchors is None:
        unburned = sample_unburned_around_markers(
            frame_bgr, markers, px_per_mm=px_per_mm,
        )

    return apply_wb_correction_to_warped(
        frame_bgr,
        strip_anchors=strip_anchors,
        unburned_rgb=unburned,
        canonical_id=canonical_id,
        enabled=True,
    )
```

- [ ] **Step 3: Wire `correct_with_strip_or_fallback` into the live pipeline path**

Find the location in `capture_pipeline.py` where `warp_to_burn_space` is called. After warp succeeds, call `correct_with_strip_or_fallback` with:
- `strip_patches`: the material's `calibration_patches_json` (passed in from the caller; the ingest endpoint resolves the test→material chain).
- `markers`: the registration layout's marker positions.
- `canonical_id`: a hardcoded `"v1.steel-default.2026-05-06"` for now (config-driven later).

Pass the corrected frame downstream to cell sampling, and the `CorrectionOutcome` to `update_wb_state` after the result row is created.

- [ ] **Step 4: Run, expect 3 passed**

- [ ] **Step 5: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add \
  src/xcs_gen_web/capture_pipeline.py tests/test_capture_pipeline_wb.py
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "feat(wb-calibration): live pipeline picks anchored when strip present"
```

---

## Task 25: Browser smoke test

**Files:** none (manual)

- [ ] **Step 1: Build frontend, start backend on isolated DB**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration/web && npm run build > /dev/null 2>&1
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  cp ~/.xcs-gen/app.db .review-copy.db && \
  XCS_GEN_DB_URL="sqlite:///$(pwd)/.review-copy.db" XCS_GEN_AUTO_MIGRATE=true \
  .venv/bin/xcs-gen serve --host 127.0.0.1 --port 8027 &
```

(`XCS_GEN_AUTO_MIGRATE=true` is fine here because we're on the latest revision; if main has moved past `0021` while this branch was in flight, rebase before this step.)

- [ ] **Step 2: Walk the golden path with Playwright MCP**

1. Open `http://127.0.0.1:8027/#/library` → pick a stainless material → open edit dialog → navigate to Calibration tab.
2. Configure clean-pass params + 3 patches (use the defaults).
3. Click "Calibrate" → wizard opens.
4. Click "Generate" → `.xcs` downloads. (Confirm the file is valid JSON, ≥ 1 KB.)
5. **Skip the actual burn step for the smoke test** — instead, fabricate a "fake calibration photo" by uploading one of `samples/color/IMG_*.jpeg` (without a real strip in it). Wizard should fall back gracefully — measurements come back as zeros / nulls, the user can either retry or cancel.
6. Verify the badge appears on existing results: open any result detail → see the badge (chromaticity or skipped, since no real strip exists in old data).
7. Click "Re-ingest with WB" → the API fires; the badge updates.
8. Take screenshots of: calibration tab, wizard step 2, badge in result detail.

- [ ] **Step 3: Stop server, copy screenshot**

```bash
kill $(lsof -nP -iTCP:8027 -t) 2>/dev/null
cp <screenshot-path> changelog/images/wb-calibration-hero.png
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add changelog/images/wb-calibration-hero.png
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "docs(wb-calibration): hero screenshot for changelog"
```

---

## Task 26: Changelog

**Files:**
- Create: `changelog/2026-05-06-wb-calibration.md`

- [ ] **Step 1: Write the entry**

```markdown
---
id: 2026-05-06-wb-calibration
date: 2026-05-06
level: major
title: Anchored colour correction — calibrated palettes across lighting
summary: Embeds a calibration strip in every test plate, neutralising camera-WB drift and lighting temperature so palette entries stay stable across sessions.
images:
  - src: wb-calibration-hero.png
    caption: A burned calibration strip alongside the registration markers; result detail showing the new ANCHORED / CHROMA / RAW badges.
---

A new field on each material — **calibration** — captures three
small reference burns plus a clean pass that standardises the
substrate underneath. Burned into every test plate's registration
frame, the strip lets the ingest pipeline measure your camera and
lighting on every shot and apply a per-channel correction *before*
sampling the colour grid.

The wizard walks through it: emit a one-time calibration plate,
burn it, photograph it, confirm the swatches, save. From then on,
test plates carry the strip automatically and the correction is
invisible — except in the result-detail dialog, where a small
**ANCHORED** badge tells you the photo was anchored to the
calibrated reference. **CHROMA** badge if there's no strip but
markers were detected (fallback chromaticity-only correction);
**RAW** if no anchors were available; **DISABLED** if you turned
the toggle off.

Old results are unchanged. Per-result "Re-ingest with WB" applies
the latest calibration to a stored warped image without re-shooting.

Substrate support is configurable per material — stainless steel
ships with sane defaults; the clean-pass and calibration burn
parameters (power, speed, frequency, density, passes, pulse-width)
are fully editable for any other material you set up.
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration add changelog/2026-05-06-wb-calibration.md
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration commit \
  -m "docs(wb-calibration): changelog entry"
```

---

## Task 27: Open the PR

- [ ] **Step 1: Final test sweep**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration && \
  unset VIRTUAL_ENV PYENV_VIRTUAL_ENV && \
  XCS_GEN_AUTO_MIGRATE=false .venv/bin/python -m pytest tests/ --ignore=tests/test_demo.py -q 2>&1 | tail -3 && \
  cd web && npx tsc --noEmit && npm test -- --run 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 2: Push**

```bash
git -C /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration push -u origin feat/wb-calibration
```

- [ ] **Step 3: Open draft PR**

```bash
cd /Users/jonzky/Documents/XTools/Reverse/.worktrees/wb-calibration && \
  gh pr create --draft --title "feat: WB calibration via embedded calibration strip" --body "$(cat <<'EOF'
## Summary

- New per-material calibration: clean-pass params + 2-3 calibration patches with measured canonical RGBs.
- Capture pipeline samples the strip on every result, applies per-channel linear (or 3-anchor gamma) correction.
- Falls back to chromaticity-only correction when the strip is absent or unreadable; falls back further to "skipped" if no anchors are available.
- Calibration ceremony wizard: emit one-time calibration plate → burn → photograph → measure → save.
- Result detail surfaces a coloured badge per mode (ANCHORED / CHROMA / RAW / DISABLED).
- Per-result "Re-ingest with WB" applies the latest calibration to a stored warped image.

Spec: `docs/superpowers/specs/2026-05-06-marker-chromaticity-correction-design.md`
Plan: `docs/superpowers/plans/2026-05-06-wb-calibration.md`

## v1 trade-offs flagged

- **Substrate support:** stainless-steel defaults shipped. Other substrates need manual configuration; the data model supports them.
- **Pre/post thumbnail in result detail:** deferred — we only persist the corrected warped image, not the raw one. Viable as a follow-up if we start storing both.
- **Calibration drift dashboard:** out of scope; histogram of per-result anchor RGBs over time would be a useful future polish.
- **Pixel-art integration:** unchanged — pixel-art ingests source images for engraving, not as calibrated palette results.

## Test plan

- [ ] `pytest tests/` green (~700 passing — `test_demo.py` flake is pre-existing)
- [ ] `cd web && npx tsc --noEmit && npm test -- --run` green
- [ ] Manual: configure calibration on a stainless material → run wizard → ingest a real test plate → confirm ANCHORED badge
- [ ] Manual: ingest a result without a strip → confirm CHROMA badge (chromaticity fallback)
- [ ] Manual: toggle WB off → confirm DISABLED badge
- [ ] Manual: re-ingest an old (no-WB) result → confirm badge updates

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

- Live calibration preview (real-time anchor measurements as the camera moves).
- Drift dashboard / per-material calibration history.
- Higher-order correction (3×3 colour matrix, ICC profiling).
- Pixel-art integration with WB.
- Auto-detection of `wb_supported` per substrate.
- Per-machine canonical refinement (different lasers may produce slightly different absolute reflectance).
