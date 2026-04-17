# Photo-Based Palette Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user photograph a burned param test, auto-extract per-cell colors via registration markers + QR code, and query the stored palette by hex to get matching laser params back.

**Architecture:** Server-side Python pipeline. Generator emits a QR (and optional ArUco corner markers) on the blue-diode annotation layer. Capture endpoint decodes the QR, runs a homography warp, samples each cell's median color, and appends to a JSON palette DB queried by ΔE2000 distance.

**Tech Stack:** Python (FastAPI, opencv-python-headless, segno, numpy, Pillow) / TypeScript (React, Vite). Tests: pytest (backend), vitest (frontend logic).

**Design doc:** `docs/superpowers/specs/2026-04-17-photo-palette-ingest-design.md`

---

## Preamble: Working directory

No worktree was created by the prior brainstorming run; this plan executes against `main` in the existing repo. If you want isolation, create a worktree before starting.

## Task ordering

Tasks 1–7 build the generation + detection primitives needed to *produce* a burned sheet with a decodable QR. Between task 7 and task 8 is a **human-in-the-loop validation gate**: burn a sheet, take a phone photo, confirm the pipeline reads the QR. If it doesn't, the sampling/palette/UI work that follows is pointless.

---

### Task 1: Add capture-side dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add deps**

Edit `pyproject.toml`, extending the `dependencies` list:

```toml
dependencies = [
    "Pillow>=10.0",
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "svgelements>=1.9",
    "shapely>=2.0",
    "pyyaml>=6.0",
    "vtracer>=0.6",
    "opencv-python-headless>=4.8",
    "segno>=1.6",
    "numpy>=1.24",
]
```

- [ ] **Step 2: Reinstall editable**

Run: `pip install -e .`
Expected: success, no version conflicts.

- [ ] **Step 3: Smoke-import the new libs**

Run: `python -c "import cv2, segno, numpy; print(cv2.__version__, segno.__version__, numpy.__version__)"`
Expected: three version strings print with no errors.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "Add capture-pipeline dependencies (opencv, segno, numpy)"
```

---

### Task 2: QR payload codec

**Files:**
- Create: `src/xcs_gen/capture/__init__.py`
- Create: `src/xcs_gen/capture/qr_payload.py`
- Create: `tests/test_qr_payload.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_qr_payload.py`:

```python
"""Tests for QR payload encode/decode."""

import pytest

from xcs_gen.capture.qr_payload import (
    encode_inline, encode_id_only, decode_payload, PayloadError,
)


def _sample_spec():
    return {
        "id": "a1b2c3d4",
        "t": "grid",
        "x": {"p": "speed", "min": 100, "max": 5000, "n": 50},
        "y": {"p": "power", "min": 10, "max": 100, "n": 10},
        "grid": {"w": 22.0, "h": 44.0, "rows": 1, "gap": 0.0},
        "b": {"p": 80, "s": 230, "f": 60000, "d": 200, "r": 1, "pw": 200, "l": "red"},
    }


def test_encode_decode_inline_roundtrip():
    spec = _sample_spec()
    encoded = encode_inline(spec)
    decoded = decode_payload(encoded)
    assert decoded["v"] == 1
    assert decoded["id"] == spec["id"]
    assert decoded["x"] == spec["x"]
    assert decoded["grid"] == spec["grid"]


def test_encode_id_only_is_compact():
    encoded = encode_id_only("a1b2c3d4")
    assert len(encoded) < 40
    decoded = decode_payload(encoded)
    assert decoded == {"v": 1, "id": "a1b2c3d4"}


def test_inline_payload_fits_in_reasonable_qr_size():
    spec = _sample_spec()
    encoded = encode_inline(spec)
    # Must comfortably fit in QR v6 alphanumeric ECC-M (~230 chars) or v8 binary ECC-M (~250).
    assert len(encoded) <= 260, f"payload is {len(encoded)} chars"


def test_decode_rejects_unknown_version():
    bad = '{"v": 99, "id": "x"}'
    with pytest.raises(PayloadError, match="version"):
        decode_payload(bad)


def test_decode_rejects_malformed_json():
    with pytest.raises(PayloadError):
        decode_payload("not-json")


def test_encode_inline_without_y_axis():
    spec = {
        "id": "aaaaaaaa",
        "t": "grid",
        "x": {"p": "speed", "min": 100, "max": 5000, "n": 50},
        "grid": {"w": 22.0, "h": 5.0, "rows": 1, "gap": 0.0},
        "b": {"p": 80, "s": 230, "f": 60000, "d": 200, "r": 1, "pw": 200, "l": "red"},
    }
    encoded = encode_inline(spec)
    decoded = decode_payload(encoded)
    assert "y" not in decoded
    assert decoded["t"] == "grid"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_qr_payload.py -v`
Expected: all fail with ImportError (module doesn't exist yet).

- [ ] **Step 3: Create the package and codec**

Create `src/xcs_gen/capture/__init__.py` (empty).

Create `src/xcs_gen/capture/qr_payload.py`:

```python
"""QR payload codec for registration blocks.

Payloads are compact JSON objects. Two modes:
- inline: full spec embedded (self-describing sheet)
- id_only: just {"v": 1, "id": "..."} — requires local lookup to decode
"""

from __future__ import annotations

import json
from typing import Any

_SCHEMA_VERSION = 1


class PayloadError(ValueError):
    """Raised when a QR payload cannot be decoded or has an unknown version."""


def encode_inline(spec: dict[str, Any]) -> str:
    """Encode a full test spec into a compact JSON string.

    `spec` must contain at minimum: id, t, x, grid, b. `y` optional.
    Keys are kept short (already-abbreviated by the caller); this function
    only adds the version tag and serializes with minimal whitespace.
    """
    payload = {"v": _SCHEMA_VERSION, **spec}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def encode_id_only(test_id: str) -> str:
    """Encode just the schema version + ID."""
    return json.dumps({"v": _SCHEMA_VERSION, "id": test_id}, separators=(",", ":"))


def decode_payload(s: str) -> dict[str, Any]:
    """Decode a payload string, validating schema version.

    Raises PayloadError on bad JSON or unknown schema version.
    """
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise PayloadError(f"invalid JSON: {e}")
    if not isinstance(data, dict):
        raise PayloadError("payload must be a JSON object")
    v = data.get("v")
    if v != _SCHEMA_VERSION:
        raise PayloadError(f"unsupported schema version: {v!r}")
    if "id" not in data:
        raise PayloadError("missing required field: id")
    return data
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_qr_payload.py -v`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/capture/__init__.py src/xcs_gen/capture/qr_payload.py tests/test_qr_payload.py
git commit -m "Add QR payload codec for registration blocks"
```

---

### Task 3: Registration layout math

**Files:**
- Create: `src/xcs_gen/capture/layout.py`
- Create: `tests/test_capture_layout.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_capture_layout.py`:

```python
"""Tests for registration marker layout math."""

import pytest

from xcs_gen.capture.layout import (
    RegistrationLayout,
    MarkerPosition,
    compute_layout,
    AUTO_FULL_THRESHOLD_MM,
)


def test_compact_mode_returns_qr_only():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=22.0, grid_h=5.0,
        mode="compact",
    )
    assert layout.qr is not None
    assert layout.aruco_markers == []
    # QR should sit just outside the grid, in a corner
    assert layout.qr.x >= 10.0 or layout.qr.x + layout.qr.size <= 10.0 + 22.0


def test_full_mode_returns_qr_plus_3_aruco():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=100.0, grid_h=100.0,
        mode="full",
    )
    assert layout.qr is not None
    assert len(layout.aruco_markers) == 3
    # Each marker has an ID in 0..3 (4 corners; QR occupies one, 3 ArUco for the others)
    ids = {m.marker_id for m in layout.aruco_markers}
    assert ids.issubset({0, 1, 2, 3})
    assert len(ids) == 3


def test_auto_mode_small_grid_uses_compact():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=22.0, grid_h=5.0,
        mode="auto",
    )
    assert layout.aruco_markers == []


def test_auto_mode_large_grid_uses_full():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=AUTO_FULL_THRESHOLD_MM + 10,
        grid_h=AUTO_FULL_THRESHOLD_MM + 10,
        mode="auto",
    )
    assert len(layout.aruco_markers) == 3


def test_off_mode_returns_empty():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0,
        grid_w=100.0, grid_h=100.0,
        mode="off",
    )
    assert layout.qr is None
    assert layout.aruco_markers == []


def test_compact_qr_size_scales_with_payload_mode():
    compact_inline = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="inline",
    )
    compact_id_only = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=22.0, grid_h=5.0,
        mode="compact", qr_mode="id_only",
    )
    # id-only QR is smaller
    assert compact_id_only.qr.size < compact_inline.qr.size


def test_marker_positions_do_not_overlap_grid():
    layout = compute_layout(
        grid_x=10.0, grid_y=10.0, grid_w=50.0, grid_h=50.0,
        mode="full",
    )
    grid_right = 10.0 + 50.0
    grid_bottom = 10.0 + 50.0
    for m in layout.aruco_markers:
        m_right = m.x + m.size
        m_bottom = m.y + m.size
        # Either entirely left of grid, right of grid, above, or below
        outside = (
            m_right <= 10.0 or m.x >= grid_right
            or m_bottom <= 10.0 or m.y >= grid_bottom
        )
        assert outside, f"marker at ({m.x},{m.y}) size {m.size} overlaps grid"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_capture_layout.py -v`
Expected: all fail (module missing).

- [ ] **Step 3: Implement layout**

Create `src/xcs_gen/capture/layout.py`:

```python
"""Compute positions of registration markers (QR + optional ArUco) in burn-space mm.

Coordinates use the same convention as the rest of xcs_gen: (x, y) top-left
of each marker, all values in bed-mm.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# When in "auto" mode, the test switches from compact to full if BOTH dims
# exceed this threshold. Below that, compact (QR-only) mode is used to
# conserve substrate space.
AUTO_FULL_THRESHOLD_MM = 80.0

# QR dimensions by payload mode, chosen to burn reliably on blue-diode.
_QR_SIZE_INLINE_MM = 12.0
_QR_SIZE_ID_ONLY_MM = 9.0

# ArUco marker physical size in full mode.
_ARUCO_SIZE_MM = 5.0

# Margin from grid edge to marker edge. Public because capture pipeline needs it
# to translate from QR-anchored frame to grid-origin frame.
MARKER_MARGIN_MM = 1.5


@dataclass
class MarkerPosition:
    """A physical marker's top-left position and edge length in mm."""
    x: float
    y: float
    size: float
    marker_id: int  # 0..3, identifies which corner


@dataclass
class RegistrationLayout:
    """All registration markers for one param test."""
    qr: MarkerPosition | None = None  # None if mode == "off"
    aruco_markers: list[MarkerPosition] = field(default_factory=list)


def compute_layout(
    *,
    grid_x: float,
    grid_y: float,
    grid_w: float,
    grid_h: float,
    mode: Literal["auto", "compact", "full", "off"] = "auto",
    qr_mode: Literal["inline", "id_only"] = "inline",
) -> RegistrationLayout:
    """Compute marker positions for a test grid placed at (grid_x, grid_y)
    with dimensions (grid_w, grid_h).

    Returns a RegistrationLayout with QR position and zero or three ArUco
    marker positions depending on mode.
    """
    if mode == "off":
        return RegistrationLayout()

    effective_mode = mode
    if mode == "auto":
        effective_mode = "full" if (grid_w > AUTO_FULL_THRESHOLD_MM and grid_h > AUTO_FULL_THRESHOLD_MM) else "compact"

    qr_size = _QR_SIZE_INLINE_MM if qr_mode == "inline" else _QR_SIZE_ID_ONLY_MM

    # QR always sits at the top-left corner, outside the grid, offset by margin.
    qr_x = grid_x - qr_size - MARKER_MARGIN_MM
    qr_y = grid_y - qr_size - MARKER_MARGIN_MM
    # Corner 0 = top-left (QR).
    qr = MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0)

    layout = RegistrationLayout(qr=qr)

    if effective_mode == "full":
        # Three ArUco markers at top-right, bottom-right, bottom-left corners.
        # IDs 1, 2, 3 — QR carries logical id 0.
        tr = MarkerPosition(
            x=grid_x + grid_w + MARKER_MARGIN_MM,
            y=grid_y - _ARUCO_SIZE_MM - MARKER_MARGIN_MM,
            size=_ARUCO_SIZE_MM,
            marker_id=1,
        )
        br = MarkerPosition(
            x=grid_x + grid_w + MARKER_MARGIN_MM,
            y=grid_y + grid_h + MARKER_MARGIN_MM,
            size=_ARUCO_SIZE_MM,
            marker_id=2,
        )
        bl = MarkerPosition(
            x=grid_x - _ARUCO_SIZE_MM - MARKER_MARGIN_MM,
            y=grid_y + grid_h + MARKER_MARGIN_MM,
            size=_ARUCO_SIZE_MM,
            marker_id=3,
        )
        layout.aruco_markers = [tr, br, bl]

    return layout
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_capture_layout.py -v`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/capture/layout.py tests/test_capture_layout.py
git commit -m "Add registration marker layout math"
```

---

### Task 4: Generator — burn QR + ArUco onto annotation layer

**Files:**
- Create: `src/xcs_gen/capture/marker_render.py`
- Modify: `src/xcs_gen/generators.py` — extend `generate_gradient` with registration params
- Create: `tests/test_capture_markers.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_capture_markers.py`:

```python
"""Tests for burning registration markers into an XCSProject."""

import pytest

from xcs_gen.capture.layout import compute_layout
from xcs_gen.capture.marker_render import (
    emit_registration_markers,
    qr_payload_for_test,
)
from xcs_gen.capture.qr_payload import decode_payload
from xcs_gen.model import (
    ANNOTATION_LAYER_COLOR,
    ProcessingParams,
    XCSProject,
)


def test_qr_payload_for_test_includes_required_fields():
    payload = qr_payload_for_test(
        test_id="a1b2c3d4",
        x_param="speed", x_min=100, x_max=5000, x_steps=50,
        y_param="power", y_min=10, y_max=100, y_steps=10,
        grid_w=22.0, grid_h=44.0, rows=1, gap=0.0,
        base_params=ProcessingParams(),
        kind="grid",
    )
    decoded = decode_payload(payload)
    assert decoded["id"] == "a1b2c3d4"
    assert decoded["t"] == "grid"
    assert decoded["x"] == {"p": "speed", "min": 100, "max": 5000, "n": 50}
    assert decoded["y"] == {"p": "power", "min": 10, "max": 100, "n": 10}


def test_qr_payload_without_y():
    payload = qr_payload_for_test(
        test_id="abcdefgh",
        x_param="speed", x_min=100, x_max=5000, x_steps=50,
        y_param=None, y_min=0, y_max=0, y_steps=1,
        grid_w=22.0, grid_h=5.0, rows=1, gap=0.0,
        base_params=ProcessingParams(),
        kind="grid",
    )
    decoded = decode_payload(payload)
    assert "y" not in decoded


def test_emit_adds_annotation_layer_rects_for_qr():
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=22.0, grid_h=5.0,
        mode="compact",
    )
    emit_registration_markers(
        project,
        layout=layout,
        qr_text='{"v":1,"id":"abcdefgh"}',
        annotation_params=ProcessingParams(),
    )
    # Every extra_display added for markers should be on the annotation layer.
    assert len(project.extra_displays) > 0
    for disp in project.extra_displays:
        assert disp.get("layerColor") == ANNOTATION_LAYER_COLOR


def test_emit_full_mode_produces_more_displays_than_compact():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    compact = XCSProject()
    emit_registration_markers(
        compact,
        layout=compute_layout(
            grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
            mode="compact",
        ),
        qr_text=qr_text,
        annotation_params=ProcessingParams(),
    )
    full = XCSProject()
    emit_registration_markers(
        full,
        layout=compute_layout(
            grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
            mode="full",
        ),
        qr_text=qr_text,
        annotation_params=ProcessingParams(),
    )
    assert len(full.extra_displays) > len(compact.extra_displays)


def test_emit_off_layout_adds_nothing():
    project = XCSProject()
    layout = compute_layout(
        grid_x=20.0, grid_y=20.0, grid_w=50.0, grid_h=50.0,
        mode="off",
    )
    emit_registration_markers(
        project,
        layout=layout,
        qr_text="unused",
        annotation_params=ProcessingParams(),
    )
    assert project.extra_displays == []


def test_generate_gradient_with_registration_adds_markers():
    from xcs_gen.generators import generate_gradient

    without = generate_gradient(
        x_param="speed", x_min=100, x_max=5000, x_steps=20,
        total_width=22.0, total_height=5.0,
    )
    with_reg = generate_gradient(
        x_param="speed", x_min=100, x_max=5000, x_steps=20,
        total_width=22.0, total_height=5.0,
        registration_mode="compact",
        registration_qr_mode="inline",
        test_id="testid01",
    )
    assert len(with_reg.extra_displays) > len(without.extra_displays)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_capture_markers.py -v`
Expected: all fail.

- [ ] **Step 3: Implement marker renderer**

Create `src/xcs_gen/capture/marker_render.py`:

```python
"""Render QR and ArUco registration markers into an XCSProject.

QR is generated via segno, rasterized to a bit grid, and emitted as a set
of filled rects on the annotation layer. ArUco markers are generated via
cv2.aruco at render time (IDs 1, 2, 3 from DICT_4X4_50; QR occupies ID 0
slot logically).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import segno

from ..builder import build_device_entry
from ..model import (
    ANNOTATION_LAYER_COLOR,
    ProcessingParams,
    Rect,
    XCSProject,
    _uuid,
)
from .layout import MarkerPosition, RegistrationLayout
from .qr_payload import encode_id_only, encode_inline


def qr_payload_for_test(
    *,
    test_id: str,
    x_param: str, x_min: float, x_max: float, x_steps: int,
    y_param: str | None, y_min: float, y_max: float, y_steps: int,
    grid_w: float, grid_h: float, rows: int, gap: float,
    base_params: ProcessingParams,
    kind: str = "grid",
    mode: str = "inline",
) -> str:
    """Build a QR payload string for one param test.

    mode = "inline" → full spec, "id_only" → just {"v":1,"id":...}.
    """
    if mode == "id_only":
        return encode_id_only(test_id)

    spec: dict[str, Any] = {
        "id": test_id,
        "t": kind,
        "x": {"p": x_param, "min": x_min, "max": x_max, "n": x_steps},
        "grid": {"w": grid_w, "h": grid_h, "rows": rows, "gap": gap},
        "b": {
            "p": base_params.power,
            "s": base_params.speed,
            "f": base_params.mopa_frequency,
            "d": base_params.density,
            "r": base_params.repeat,
            "pw": base_params.pulse_width,
            "l": base_params.processing_light_source,
        },
    }
    if y_param is not None:
        spec["y"] = {"p": y_param, "min": y_min, "max": y_max, "n": y_steps}

    return encode_inline(spec)


def _qr_bits(text: str) -> np.ndarray:
    """Render a QR code as a 2-D numpy array of booleans (True = dark module).

    Uses segno with ECC level M for balance of density and robustness.
    """
    qr = segno.make(text, error="m")
    matrix = np.array(qr.matrix, dtype=bool)
    return matrix


def _aruco_bits(marker_id: int) -> np.ndarray:
    """Render an ArUco marker (DICT_4X4_50) as a bool matrix with 1-module border.

    The returned matrix is (marker_size + 2) x (marker_size + 2) including
    the mandatory black border, where marker_size = 4 for DICT_4X4_50.
    True = dark (filled) module.
    """
    import cv2

    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    # generateImageMarker returns a grayscale image at specified pixel size.
    # Request (side_bits * 10) pixels and then downsample to bits by taking
    # the min value per block.
    bits = 6  # 4x4 marker + 1-module border on each side
    scale = 10
    img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, bits * scale)
    # Downsample: each block is `scale` px; dark if all black.
    out = np.zeros((bits, bits), dtype=bool)
    for r in range(bits):
        for c in range(bits):
            block = img[r * scale:(r + 1) * scale, c * scale:(c + 1) * scale]
            out[r, c] = bool(block.mean() < 128)
    return out


def _emit_bit_matrix(
    project: XCSProject,
    *,
    bits: np.ndarray,
    origin_x: float,
    origin_y: float,
    total_size: float,
    annotation_params: ProcessingParams,
) -> None:
    """Add one filled annotation-layer Rect per dark bit in `bits`."""
    rows, cols = bits.shape
    cell = total_size / cols  # assume square
    for r in range(rows):
        for c in range(cols):
            if not bits[r, c]:
                continue
            elem = Rect(
                x=origin_x + c * cell,
                y=origin_y + r * cell,
                width=cell,
                height=cell,
                params=annotation_params,
                processing_type="COLOR_FILL_ENGRAVE",
                is_fill=True,
                layer_color=ANNOTATION_LAYER_COLOR,
            )
            # Add as an extra_display so it joins the annotation stream
            # (rather than as project.elements which would mix with the
            # gradient layer). Build the display + device entry directly.
            from ..builder import _build_rect_display  # internal helper reused for uniformity
            disp = _build_rect_display(elem)
            project.extra_displays.append(disp)
            project.extra_device_entries.append(
                build_device_entry(
                    elem.id, "RECT", elem.processing_type,
                    annotation_params, is_fill=True,
                )
            )


def emit_registration_markers(
    project: XCSProject,
    *,
    layout: RegistrationLayout,
    qr_text: str,
    annotation_params: ProcessingParams,
) -> None:
    """Add QR + ArUco markers to `project` on the annotation layer.

    All marker modules are emitted as filled rects using `annotation_params`
    (typically blue-diode settings). Caller is responsible for constructing
    `layout` and `qr_text` via compute_layout() and qr_payload_for_test().
    """
    if layout.qr is None:
        return

    # QR
    qr_bits = _qr_bits(qr_text)
    _emit_bit_matrix(
        project,
        bits=qr_bits,
        origin_x=layout.qr.x,
        origin_y=layout.qr.y,
        total_size=layout.qr.size,
        annotation_params=annotation_params,
    )

    # ArUco (if any)
    for marker in layout.aruco_markers:
        bits = _aruco_bits(marker.marker_id)
        _emit_bit_matrix(
            project,
            bits=bits,
            origin_x=marker.x,
            origin_y=marker.y,
            total_size=marker.size,
            annotation_params=annotation_params,
        )
```

- [ ] **Step 4: Hook into generate_gradient**

Modify `src/xcs_gen/generators.py`:

At the top of the file, add to the imports:

```python
from .capture.layout import compute_layout
from .capture.marker_render import emit_registration_markers, qr_payload_for_test
```

Extend the `generate_gradient` signature (add after `summary_suffix: str = ""`):

```python
    registration_mode: str = "off",  # "auto" | "compact" | "full" | "off"
    registration_qr_mode: str = "inline",  # "inline" | "id_only"
    test_id: str | None = None,
```

At the end of `generate_gradient`, *before* `return project`, add:

```python
    if registration_mode != "off":
        layout = compute_layout(
            grid_x=start_x,
            grid_y=gradient_start_y,
            grid_w=total_width,
            grid_h=(total_height * rows) if not is_dual else total_height,
            mode=registration_mode,  # type: ignore[arg-type]
            qr_mode=registration_qr_mode,  # type: ignore[arg-type]
        )
        qr_text = qr_payload_for_test(
            test_id=test_id or _default_test_id(),
            x_param=x_param, x_min=x_min, x_max=x_max, x_steps=x_steps,
            y_param=y_param, y_min=y_min, y_max=y_max, y_steps=y_steps,
            grid_w=total_width,
            grid_h=(total_height * rows) if not is_dual else total_height,
            rows=rows,
            gap=gap,
            base_params=base_params,
            kind="grid",
            mode=registration_qr_mode,
        )
        emit_registration_markers(
            project,
            layout=layout,
            qr_text=qr_text,
            annotation_params=annotation_params,
        )
```

Also add the helper function near the top of `generators.py` (after `_INT_FIELDS`):

```python
def _default_test_id() -> str:
    """Generate a short random ID for a test when no explicit one is provided."""
    import uuid
    return uuid.uuid4().hex[:8]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_capture_markers.py -v`
Expected: all 6 tests pass.

- [ ] **Step 6: Run the broader test suite to ensure no regression**

Run: `pytest tests/ -x -q`
Expected: all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen/capture/marker_render.py src/xcs_gen/generators.py tests/test_capture_markers.py
git commit -m "Burn QR + ArUco registration markers onto annotation layer"
```

---

### Task 5: Extend schemas (pydantic + TypeScript) for registration

**Files:**
- Modify: `src/xcs_gen_web/schemas.py`
- Modify: `src/xcs_gen_web/converter.py` — propagate registration into `generate_gradient` call
- Modify: `web/src/types.ts`
- Modify: `web/src/defaults.ts`
- Modify: `tests/test_api.py` — add a case exercising registration

- [ ] **Step 1: Write failing test**

Add to `tests/test_api.py`:

```python
def test_generate_with_registration_markers(client):
    payload = _project_payload()
    payload["tests"][0]["test"]["registration"] = {
        "mode": "compact",
        "qr_mode": "inline",
    }
    resp = client.post("/api/generate", json=payload)
    assert resp.status_code == 200
    data = json.loads(resp.content)
    # With registration, the displays list must include extras for markers.
    displays = data["canvas"][0]["displays"]
    # Baseline (no registration) for comparison
    baseline_payload = _project_payload()
    baseline = client.post("/api/generate", json=baseline_payload)
    baseline_displays = json.loads(baseline.content)["canvas"][0]["displays"]
    assert len(displays) > len(baseline_displays)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_generate_with_registration_markers -v`
Expected: FAIL (schema rejects unknown `registration` field, or produces equal-size output).

- [ ] **Step 3: Extend pydantic schema**

Modify `src/xcs_gen_web/schemas.py`. Add a new model above `ParamTest`:

```python
class RegistrationConfig(BaseModel):
    """Config for the photo-ingest registration block burned into a test."""

    mode: Literal["auto", "compact", "full", "off"] = "off"
    qr_mode: Literal["inline", "id_only"] = "inline"
```

Extend `ParamTest` (add after `crosshatch_step_deg`):

```python
    registration: RegistrationConfig = Field(default_factory=RegistrationConfig)
```

- [ ] **Step 4: Propagate into converter**

Modify `src/xcs_gen_web/converter.py`. In `project_to_xcs`, extend the `generate_gradient` call to pass registration params:

```python
        generated = generate_gradient(
            x_param=t.x_param,
            # ...existing args...
            summary_suffix=summary_suffix,
            registration_mode=t.registration.mode,
            registration_qr_mode=t.registration.qr_mode,
            test_id=t.id,
        )
```

- [ ] **Step 5: Update TypeScript types**

Modify `web/src/types.ts`. Add after `ParamName`:

```typescript
export type RegistrationMode = "auto" | "compact" | "full" | "off";
export type QrMode = "inline" | "id_only";

export interface RegistrationConfig {
  mode: RegistrationMode;
  qr_mode: QrMode;
}
```

Extend the `ParamTest` interface (add before the closing brace):

```typescript
  registration: RegistrationConfig;
```

Modify `web/src/defaults.ts` — ensure `defaultPlacement`/`defaultProject` or wherever a new `ParamTest` is constructed gets `registration: { mode: "off", qr_mode: "inline" }` so existing tests don't break.

- [ ] **Step 6: Run tests**

Run: `pytest tests/ -x -q`
Expected: all backend tests pass (including the new registration one).

Run: `cd web && npm run build`
Expected: TypeScript compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/converter.py web/src/types.ts web/src/defaults.ts tests/test_api.py
git commit -m "Add registration config to ParamTest schema + types"
```

---

### Task 6: Test editor UI — registration markers section

**Files:**
- Modify: `web/src/components/TestEditor.tsx`

- [ ] **Step 1: Add the registration section**

Open `web/src/components/TestEditor.tsx` and locate the block where other sections (crosshatch, base params) are rendered. Add a new collapsible section rendering two dropdowns:

```tsx
<section style={{ borderTop: "1px solid #eee", padding: "12px 16px" }}>
  <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>
    Registration markers
  </h3>
  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
    <label style={{ fontSize: 12 }}>
      Mode
      <select
        value={test.registration.mode}
        onChange={(e) => onChange({
          ...placement,
          test: {
            ...test,
            registration: { ...test.registration, mode: e.target.value as RegistrationMode },
          },
        })}
        style={{ display: "block", marginTop: 2 }}
      >
        <option value="off">Off</option>
        <option value="auto">Auto</option>
        <option value="compact">Compact (QR only)</option>
        <option value="full">Full (QR + ArUco)</option>
      </select>
    </label>
    <label style={{ fontSize: 12 }}>
      QR payload
      <select
        value={test.registration.qr_mode}
        onChange={(e) => onChange({
          ...placement,
          test: {
            ...test,
            registration: { ...test.registration, qr_mode: e.target.value as QrMode },
          },
        })}
        disabled={test.registration.mode === "off"}
        style={{ display: "block", marginTop: 2 }}
      >
        <option value="inline">Inline spec</option>
        <option value="id_only">ID only</option>
      </select>
    </label>
  </div>
  <p style={{ fontSize: 11, color: "#666", marginTop: 8 }}>
    Burns a QR code (and optional ArUco markers in Full mode) onto the
    annotation layer so you can photograph the result and auto-extract
    colors. ID-only QR uses less space but requires the test to still be
    in this browser's local storage when you upload the photo.
  </p>
</section>
```

At the top of the file, import the new types:

```tsx
import type { RegistrationMode, QrMode } from "../types";
```

- [ ] **Step 2: Build and verify**

Run: `cd web && npm run build`
Expected: clean TypeScript build.

- [ ] **Step 3: Smoke-check in dev**

Run: `cd web && npm run dev` (if the backend is running in another terminal; otherwise test editor UI doesn't need backend for rendering).

Navigate to the test editor, select a test, confirm the "Registration markers" section appears with both dropdowns, and both are wired to localStorage (reload, setting persists).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TestEditor.tsx web/src/types.ts
git commit -m "Add registration markers section to test editor UI"
```

---

### Task 7: QR detection + homography warp

**Files:**
- Create: `src/xcs_gen_web/capture_pipeline.py`
- Create: `tests/test_capture_pipeline.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_capture_pipeline.py`:

```python
"""Tests for the capture pipeline (QR detect + homography warp).

Uses synthetic images rendered from segno + PIL so the tests are
deterministic and don't require real photographs.
"""

from __future__ import annotations

import io

import numpy as np
import segno
from PIL import Image

from xcs_gen_web.capture_pipeline import (
    DetectionError,
    detect_qr,
    warp_to_burn_space,
)


def _render_synthetic_sheet(
    *,
    qr_text: str,
    canvas_w_px: int = 800,
    canvas_h_px: int = 600,
    qr_top_left: tuple[int, int] = (50, 50),
    qr_size_px: int = 180,
) -> np.ndarray:
    """Render a white image with a black QR pasted at a known pixel position."""
    qr = segno.make(qr_text, error="m")
    # segno.to_pil() is not a method; use the save API to bytes then reload.
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=10, border=2)
    buf.seek(0)
    qr_img = Image.open(buf).convert("L").resize((qr_size_px, qr_size_px))

    canvas = Image.new("L", (canvas_w_px, canvas_h_px), 255)
    canvas.paste(qr_img, qr_top_left)
    return np.array(canvas.convert("RGB"))


def test_detect_qr_returns_payload_and_corners():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    img = _render_synthetic_sheet(qr_text=qr_text)
    payload, corners = detect_qr(img)
    assert payload == qr_text
    assert corners.shape == (4, 2)
    # Corners should bracket the pasted position (50,50) + size (180)
    xs = corners[:, 0]
    ys = corners[:, 1]
    assert xs.min() > 40 and xs.max() < 240
    assert ys.min() > 40 and ys.max() < 240


def test_detect_qr_raises_when_no_code_present():
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    with pytest.raises(DetectionError):
        detect_qr(img)


def test_warp_produces_expected_canvas_size():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    img = _render_synthetic_sheet(qr_text=qr_text)
    _, corners = detect_qr(img)
    # Pretend QR is 12mm in burn-space, at top-left (0,0) of a 40x20mm grid.
    # Target resolution: 10 px/mm → expect warped 400x200 canvas.
    warped = warp_to_burn_space(
        img,
        qr_corners_px=corners,
        qr_size_mm=12.0,
        qr_origin_mm=(0.0, 0.0),
        burn_size_mm=(40.0, 20.0),
        px_per_mm=10.0,
    )
    assert warped.shape[0] == 200
    assert warped.shape[1] == 400


def test_warp_qr_region_is_dark():
    qr_text = '{"v":1,"id":"abcdefgh"}'
    img = _render_synthetic_sheet(qr_text=qr_text)
    _, corners = detect_qr(img)
    warped = warp_to_burn_space(
        img,
        qr_corners_px=corners,
        qr_size_mm=12.0,
        qr_origin_mm=(0.0, 0.0),
        burn_size_mm=(40.0, 20.0),
        px_per_mm=10.0,
    )
    # QR region in warped image is at (0,0) to (120,120) px.
    qr_region = warped[:120, :120]
    # Must contain some very dark pixels (QR modules)
    assert qr_region.min() < 80
```

Also add `import pytest` at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_capture_pipeline.py -v`
Expected: all fail (module missing).

- [ ] **Step 3: Implement the pipeline**

Create `src/xcs_gen_web/capture_pipeline.py`:

```python
"""Photo → canonical burn-space pipeline.

Given an uploaded image, locate the QR code, compute a homography from the
QR's 4 image-space corners to known burn-space coordinates, and warp the
image so every bed-mm maps to a fixed pixel offset.
"""

from __future__ import annotations

import cv2
import numpy as np


class DetectionError(Exception):
    """Raised when the QR code cannot be located in the image."""


def detect_qr(image: np.ndarray) -> tuple[str, np.ndarray]:
    """Find the QR code and return (decoded_text, corners).

    `corners` is a (4, 2) array of pixel coordinates in the order OpenCV
    returns: top-left, top-right, bottom-right, bottom-left.

    Raises DetectionError if no QR is found or decoding fails.
    """
    detector = cv2.QRCodeDetector()
    data, points, _ = detector.detectAndDecode(image)
    if not data or points is None:
        raise DetectionError("no QR code detected")
    # points shape: (1, 4, 2). Normalize to (4, 2).
    corners = points.reshape(4, 2).astype(np.float32)
    return data, corners


def warp_to_burn_space(
    image: np.ndarray,
    *,
    qr_corners_px: np.ndarray,
    qr_size_mm: float,
    qr_origin_mm: tuple[float, float],
    burn_size_mm: tuple[float, float],
    px_per_mm: float = 10.0,
) -> np.ndarray:
    """Warp `image` so the burn area maps to a fixed pixel canvas.

    Args:
        image: source BGR or RGB uint8 image.
        qr_corners_px: 4x2 array of QR corners in source pixel space
            (top-left, top-right, bottom-right, bottom-left).
        qr_size_mm: physical QR edge length in mm.
        qr_origin_mm: (x, y) in burn-space mm of the QR's top-left corner.
        burn_size_mm: (width, height) of the whole burn area in mm.
        px_per_mm: target resolution of the warped image.

    Returns:
        Warped image with shape (burn_h_mm * px_per_mm, burn_w_mm * px_per_mm, 3).
    """
    ox, oy = qr_origin_mm
    src = qr_corners_px
    dst = np.array([
        [(ox) * px_per_mm, (oy) * px_per_mm],
        [(ox + qr_size_mm) * px_per_mm, (oy) * px_per_mm],
        [(ox + qr_size_mm) * px_per_mm, (oy + qr_size_mm) * px_per_mm],
        [(ox) * px_per_mm, (oy + qr_size_mm) * px_per_mm],
    ], dtype=np.float32)

    H, _ = cv2.findHomography(src, dst)
    if H is None:
        raise DetectionError("could not compute homography from QR corners")

    w_mm, h_mm = burn_size_mm
    out_w = int(round(w_mm * px_per_mm))
    out_h = int(round(h_mm * px_per_mm))
    warped = cv2.warpPerspective(image, H, (out_w, out_h))
    return warped
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_capture_pipeline.py -v`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/capture_pipeline.py tests/test_capture_pipeline.py
git commit -m "Add photo → burn-space warp pipeline"
```

---

## VALIDATION GATE (human-in-the-loop)

Before proceeding with the rest of the plan, do a physical round-trip to confirm the QR reliably burns + decodes in your setup. The sampling/palette/UI work below is pointless if this fails.

**Step A: Generate a test sheet with registration**

Start the backend + UI:
```bash
xcs-gen serve
```

In the UI, create a small param test (e.g., speed 500→2000, 10 steps, 22×5 mm) and toggle Registration → compact / inline. Download the `.xcs`, open in XCS Studio, burn it on your standard 25×50mm metal blank. Also burn a second test in full mode on a larger substrate if available.

**Step B: Photograph the result**

Take a normal phone photo (≈20cm above, roughly orthogonal, no special lighting) of each burn.

**Step C: Round-trip the photo through the pipeline**

Create a throw-away debug script at the repo root:

```python
# tmp_debug_decode.py
import sys
import cv2

from xcs_gen_web.capture_pipeline import detect_qr, warp_to_burn_space
from xcs_gen.capture.qr_payload import decode_payload

path = sys.argv[1]
img = cv2.imread(path)
data, corners = detect_qr(img)
print("DECODED:", data)
spec = decode_payload(data)
print("PARSED:", spec)

warped = warp_to_burn_space(
    img,
    qr_corners_px=corners,
    qr_size_mm=12.0,
    qr_origin_mm=(0.0, 0.0),
    burn_size_mm=(spec["grid"]["w"] + 15, spec["grid"]["h"] + 15),
    px_per_mm=10.0,
)
cv2.imwrite("debug_warped.png", warped)
print("wrote debug_warped.png")
```

Run: `python tmp_debug_decode.py /path/to/photo.jpg`

**Acceptance:**
- DECODED prints the original QR string.
- PARSED shows the expected test spec.
- `debug_warped.png` shows the burn area approximately unwarped with the QR in the correct corner.

If decoding fails at 12mm QR size: retry at a larger QR size (tune `_QR_SIZE_INLINE_MM` in `layout.py`). If it fails at every reasonable size, the blue-diode burn contrast on your substrate isn't sufficient — switch to the deferred "thick-cross" fiducial strategy before continuing (out of scope for this plan).

Delete `tmp_debug_decode.py` once the round-trip works:
```bash
rm tmp_debug_decode.py
```

Do NOT commit the debug script. Proceed to Task 8 only after the gate passes.

---

### Task 8: Cell and gradient sampling

**Files:**
- Create: `src/xcs_gen_web/capture_sampling.py`
- Create: `tests/test_capture_sampling.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_capture_sampling.py`:

```python
"""Tests for sampling cells from a warped burn-space image."""

from __future__ import annotations

import numpy as np
import pytest

from xcs_gen_web.capture_sampling import (
    Swatch,
    sample_grid,
    sample_gradient,
)


def _make_warped_grid(cell_colors: list[list[tuple[int, int, int]]]) -> np.ndarray:
    """Build a synthetic warped image with uniform-color cells.

    Each cell is 50x50 px. `cell_colors[r][c]` is the (B,G,R) color of
    the cell at row r, col c.
    """
    rows = len(cell_colors)
    cols = len(cell_colors[0])
    img = np.zeros((rows * 50, cols * 50, 3), dtype=np.uint8)
    for r in range(rows):
        for c in range(cols):
            img[r * 50:(r + 1) * 50, c * 50:(c + 1) * 50] = cell_colors[r][c]
    return img


def test_sample_grid_recovers_uniform_cells():
    # 2 rows x 3 cols of pure colors
    cells = [
        [(255, 0, 0), (0, 255, 0), (0, 0, 255)],      # BGR
        [(128, 128, 128), (200, 200, 200), (50, 50, 50)],
    ]
    img = _make_warped_grid(cells)

    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(30.0, 20.0),
        px_per_mm=5.0,  # 3 cols * 10mm * 5 = 150? no, 30mm * 5 = 150px, 3 cols = 50px each
        x_param="speed", x_min=100, x_max=300, x_steps=3,
        y_param="power", y_min=10, y_max=50, y_steps=2,
    )
    assert len(swatches) == 6
    # Swatch at (0, 0): pure BGR (255, 0, 0) = blue. Hex #0000FF
    top_left = next(s for s in swatches if s.row == 0 and s.col == 0)
    assert top_left.hex == "#0000ff"
    # x_value at col 0 should be x_min
    assert top_left.x_value == 100
    assert top_left.y_value == 10


def test_sample_grid_sigma_is_zero_for_uniform_cell():
    img = _make_warped_grid([[(100, 100, 100)]])
    swatches = sample_grid(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(10.0, 10.0),
        px_per_mm=5.0,
        x_param="speed", x_min=100, x_max=100, x_steps=1,
        y_param=None,
    )
    assert swatches[0].sigma < 0.5


def test_sample_gradient_returns_n_swatches_along_axis():
    # Single-row gradient: 10 uniform cells along x
    cells = [[(i * 25, 0, 0) for i in range(10)]]
    img = _make_warped_grid(cells)

    swatches = sample_gradient(
        img,
        grid_origin_mm=(0.0, 0.0),
        grid_size_mm=(100.0, 5.0),
        px_per_mm=5.0,  # 100mm * 5 = 500px, 10 cells = 50px each
        x_param="speed", x_min=100, x_max=1000, n_samples=10,
    )
    assert len(swatches) == 10
    # Value at index 0 is x_min, at index 9 is x_max
    assert swatches[0].x_value == 100
    assert swatches[-1].x_value == 1000
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_capture_sampling.py -v`
Expected: fail (module missing).

- [ ] **Step 3: Implement sampling**

Create `src/xcs_gen_web/capture_sampling.py`:

```python
"""Sample colors from a warped burn-space image.

All input images are expected in OpenCV's BGR uint8 convention, the output
of warp_to_burn_space. Sampling uses the central 60% of each cell to avoid
edge halo and inter-cell gaps.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

_CENTRAL_REGION_FRACTION = 0.6


@dataclass
class Swatch:
    """One sampled cell/position."""
    row: int
    col: int
    x_value: float
    y_value: float | None
    hex: str
    sigma: float


def _bgr_to_lab(bgr_pixels: np.ndarray) -> np.ndarray:
    """Convert (N, 3) BGR uint8 pixels to (N, 3) float Lab."""
    import cv2

    reshaped = bgr_pixels.reshape(-1, 1, 3).astype(np.uint8)
    lab = cv2.cvtColor(reshaped, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    # OpenCV Lab has L in [0, 255]; rescale to [0, 100] + ab in [-128, 127]
    lab[:, 0] = lab[:, 0] * (100.0 / 255.0)
    lab[:, 1] = lab[:, 1] - 128.0
    lab[:, 2] = lab[:, 2] - 128.0
    return lab


def _sample_rect(
    img: np.ndarray,
    cx_px: float, cy_px: float,
    w_px: float, h_px: float,
) -> tuple[str, float]:
    """Sample the central region of a rect, return (hex, sigma_lab)."""
    half_w = w_px * _CENTRAL_REGION_FRACTION / 2
    half_h = h_px * _CENTRAL_REGION_FRACTION / 2
    x0 = int(round(cx_px - half_w))
    x1 = int(round(cx_px + half_w))
    y0 = int(round(cy_px - half_h))
    y1 = int(round(cy_px + half_h))

    x0 = max(0, x0); y0 = max(0, y0)
    x1 = min(img.shape[1], x1); y1 = min(img.shape[0], y1)
    region = img[y0:y1, x0:x1]
    if region.size == 0:
        return "#000000", 0.0

    pixels = region.reshape(-1, 3)
    median_bgr = np.median(pixels, axis=0).astype(np.uint8)
    # Convert to sRGB hex (BGR → RGB)
    b, g, r = int(median_bgr[0]), int(median_bgr[1]), int(median_bgr[2])
    hex_ = f"#{r:02x}{g:02x}{b:02x}"

    # Sigma: total stdev in Lab across all pixels
    lab = _bgr_to_lab(pixels)
    sigma = float(np.sqrt(np.sum(np.var(lab, axis=0))))

    return hex_, sigma


def _linspace(min_v: float, max_v: float, n: int) -> list[float]:
    if n == 1:
        return [min_v]
    step = (max_v - min_v) / (n - 1)
    return [min_v + i * step for i in range(n)]


def sample_grid(
    warped: np.ndarray,
    *,
    grid_origin_mm: tuple[float, float],
    grid_size_mm: tuple[float, float],
    px_per_mm: float,
    x_param: str, x_min: float, x_max: float, x_steps: int,
    y_param: str | None,
    y_min: float = 0.0, y_max: float = 0.0, y_steps: int = 1,
) -> list[Swatch]:
    """Sample all cells of a rectangular grid test."""
    ox, oy = grid_origin_mm
    gw, gh = grid_size_mm
    cell_w_px = (gw / x_steps) * px_per_mm
    n_y = y_steps if y_param is not None else 1
    cell_h_px = (gh / n_y) * px_per_mm

    x_values = _linspace(x_min, x_max, x_steps)
    y_values = _linspace(y_min, y_max, n_y) if y_param is not None else [None] * n_y

    swatches: list[Swatch] = []
    for yi in range(n_y):
        for xi in range(x_steps):
            cx_px = (ox + (xi + 0.5) * (gw / x_steps)) * px_per_mm
            cy_px = (oy + (yi + 0.5) * (gh / n_y)) * px_per_mm
            hex_, sigma = _sample_rect(warped, cx_px, cy_px, cell_w_px, cell_h_px)
            swatches.append(Swatch(
                row=yi, col=xi,
                x_value=x_values[xi],
                y_value=y_values[yi],
                hex=hex_,
                sigma=sigma,
            ))
    return swatches


def sample_gradient(
    warped: np.ndarray,
    *,
    grid_origin_mm: tuple[float, float],
    grid_size_mm: tuple[float, float],
    px_per_mm: float,
    x_param: str, x_min: float, x_max: float, n_samples: int,
) -> list[Swatch]:
    """Sample a single-stripe gradient test at n_samples evenly spaced positions."""
    ox, oy = grid_origin_mm
    gw, gh = grid_size_mm
    cell_w_px = (gw / n_samples) * px_per_mm
    cell_h_px = gh * px_per_mm

    x_values = _linspace(x_min, x_max, n_samples)
    cy_px = (oy + gh / 2) * px_per_mm

    swatches: list[Swatch] = []
    for i in range(n_samples):
        cx_px = (ox + (i + 0.5) * (gw / n_samples)) * px_per_mm
        hex_, sigma = _sample_rect(warped, cx_px, cy_px, cell_w_px, cell_h_px)
        swatches.append(Swatch(
            row=0, col=i,
            x_value=x_values[i],
            y_value=None,
            hex=hex_,
            sigma=sigma,
        ))
    return swatches
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_capture_sampling.py -v`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/capture_sampling.py tests/test_capture_sampling.py
git commit -m "Add cell + gradient sampling with central-region median + sigma"
```

---

### Task 9: /api/capture/ingest endpoint

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen_web/schemas.py` (response models)
- Create: `tests/test_capture_api.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_capture_api.py`:

```python
"""Tests for the capture ingest endpoint."""

from __future__ import annotations

import io

import numpy as np
import pytest
import segno
from fastapi.testclient import TestClient
from PIL import Image

from xcs_gen_web.app import create_app


@pytest.fixture
def client():
    return TestClient(create_app())


def _synthetic_sheet_png(qr_text: str, grid_colors: list[tuple[int, int, int]]) -> bytes:
    """Build a synthetic PNG: QR top-left + a row of uniform-color cells.

    Layout (in "mm" assuming 10 px/mm):
      - QR: top-left at (0, 0), 120px = 12mm
      - Grid: starts at (135, 0), each cell 30px wide, 50px tall
    """
    canvas = Image.new("RGB", (600, 200), (255, 255, 255))

    # QR block
    qr = segno.make(qr_text, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=10, border=2)
    buf.seek(0)
    qr_img = Image.open(buf).convert("RGB").resize((120, 120))
    canvas.paste(qr_img, (0, 0))

    # Grid cells
    grid_left = 135
    for i, color in enumerate(grid_colors):
        cell = Image.new("RGB", (30, 50), color)
        canvas.paste(cell, (grid_left + i * 30, 70))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


def test_ingest_returns_swatches(client):
    spec = {
        "v": 1, "id": "testid01", "t": "grid",
        "x": {"p": "speed", "min": 100, "max": 1000, "n": 3},
        "grid": {"w": 9.0, "h": 5.0, "rows": 1, "gap": 0.0},
        "b": {"p": 50, "s": 500, "f": 60000, "d": 200, "r": 1, "pw": 200, "l": "red"},
    }
    import json
    qr_text = json.dumps(spec, separators=(",", ":"))
    png = _synthetic_sheet_png(
        qr_text,
        [(255, 0, 0), (0, 255, 0), (0, 0, 255)],  # RGB
    )
    resp = client.post(
        "/api/capture/ingest",
        files={"image": ("sheet.png", png, "image/png")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["test_id"] == "testid01"
    assert len(data["swatches"]) == 3


def test_ingest_fails_gracefully_without_qr(client):
    canvas = Image.new("RGB", (200, 200), (255, 255, 255))
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    resp = client.post(
        "/api/capture/ingest",
        files={"image": ("blank.png", buf.getvalue(), "image/png")},
    )
    assert resp.status_code == 400
    assert "qr" in resp.json()["detail"].lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_capture_api.py -v`
Expected: fail (endpoint doesn't exist).

- [ ] **Step 3: Add response schema**

Append to `src/xcs_gen_web/schemas.py`:

```python
class CaptureSwatch(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None
    hex: str
    sigma: float


class CaptureIngestResponse(BaseModel):
    test_id: str
    kind: Literal["grid", "gradient"]
    swatches: list[CaptureSwatch]
    base_params: BaseParams
    x_param: str
    y_param: str | None
```

- [ ] **Step 4: Implement endpoint**

Modify `src/xcs_gen_web/app.py`. Add imports at the top:

```python
import cv2
import numpy as np
from fastapi import File, UploadFile

from xcs_gen.capture.qr_payload import decode_payload, PayloadError
from .capture_pipeline import DetectionError, detect_qr, warp_to_burn_space
from .capture_sampling import sample_grid, sample_gradient
from .schemas import CaptureIngestResponse, CaptureSwatch
```

Add a new route inside `create_app`:

```python
    @app.post("/api/capture/ingest", response_model=CaptureIngestResponse)
    async def capture_ingest(image: UploadFile = File(...)) -> CaptureIngestResponse:
        raw = await image.read()
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="could not decode image")

        try:
            qr_text, qr_corners = detect_qr(img)
        except DetectionError as e:
            raise HTTPException(status_code=400, detail=f"QR detection failed: {e}")

        try:
            spec = decode_payload(qr_text)
        except PayloadError as e:
            raise HTTPException(status_code=400, detail=f"QR payload invalid: {e}")

        # QR occupies the top-left block at (-qr_size - margin, -qr_size - margin)
        # relative to the grid origin. For warp, we adopt a burn-space frame
        # whose origin = QR top-left and whose grid sits at (qr_size + margin,
        # qr_size + margin).
        from xcs_gen.capture.layout import MARKER_MARGIN_MM

        qr_size_mm = 12.0 if len(qr_text) > 40 else 9.0
        grid_w = spec["grid"]["w"]
        grid_h = spec["grid"]["h"]
        grid_origin_mm = (qr_size_mm + MARKER_MARGIN_MM, qr_size_mm + MARKER_MARGIN_MM)
        burn_size_mm = (grid_origin_mm[0] + grid_w, grid_origin_mm[1] + grid_h)

        warped = warp_to_burn_space(
            img,
            qr_corners_px=qr_corners,
            qr_size_mm=qr_size_mm,
            qr_origin_mm=(0.0, 0.0),
            burn_size_mm=burn_size_mm,
            px_per_mm=10.0,
        )

        x_axis = spec["x"]
        y_axis = spec.get("y")
        if spec.get("t") == "gradient":
            swatches = sample_gradient(
                warped,
                grid_origin_mm=grid_origin_mm,
                grid_size_mm=(grid_w, grid_h),
                px_per_mm=10.0,
                x_param=x_axis["p"], x_min=x_axis["min"], x_max=x_axis["max"],
                n_samples=x_axis["n"],
            )
        else:
            swatches = sample_grid(
                warped,
                grid_origin_mm=grid_origin_mm,
                grid_size_mm=(grid_w, grid_h),
                px_per_mm=10.0,
                x_param=x_axis["p"], x_min=x_axis["min"], x_max=x_axis["max"],
                x_steps=x_axis["n"],
                y_param=(y_axis["p"] if y_axis else None),
                y_min=(y_axis["min"] if y_axis else 0.0),
                y_max=(y_axis["max"] if y_axis else 0.0),
                y_steps=(y_axis["n"] if y_axis else 1),
            )

        b = spec["b"]
        return CaptureIngestResponse(
            test_id=spec["id"],
            kind=spec.get("t", "grid"),
            swatches=[CaptureSwatch(**s.__dict__) for s in swatches],
            base_params={
                "power": b["p"], "speed": b["s"], "frequency": b["f"],
                "density": b["d"], "passes": b["r"], "pulse_width": b["pw"],
                "laser": b["l"],
            },
            x_param=x_axis["p"],
            y_param=(y_axis["p"] if y_axis else None),
        )
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_capture_api.py -v`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py src/xcs_gen_web/schemas.py tests/test_capture_api.py
git commit -m "Add /api/capture/ingest endpoint for photo → swatches"
```

---

### Task 10: Palette store + ΔE2000 query

**Files:**
- Create: `src/xcs_gen_web/palette.py`
- Create: `tests/test_palette.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_palette.py`:

```python
"""Tests for the palette JSON store + ΔE2000 query."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from xcs_gen_web.palette import (
    PaletteEntry,
    append_entries,
    delta_e_2000,
    hex_to_lab,
    load_palette,
    query_by_hex,
    save_palette,
)


def _tmp_path(tmp_path):
    return tmp_path / "palette.json"


def test_save_load_roundtrip(tmp_path):
    path = _tmp_path(tmp_path)
    entries = [
        PaletteEntry(
            id="e1", test_id="t1", source="upload",
            timestamp="2026-04-17T10:00:00Z",
            hex="#ff0000", lab=list(hex_to_lab("#ff0000")),
            params={"power": 50, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
            sigma=1.5, notes="",
        ),
    ]
    save_palette(path, entries)
    loaded = load_palette(path)
    assert len(loaded) == 1
    assert loaded[0].hex == "#ff0000"


def test_append_entries_preserves_existing(tmp_path):
    path = _tmp_path(tmp_path)
    e1 = PaletteEntry(
        id="e1", test_id="t1", source="upload", timestamp="2026-04-17T10:00:00Z",
        hex="#ff0000", lab=list(hex_to_lab("#ff0000")),
        params={"power": 50, "speed": 1000, "frequency": 60000,
                "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
        sigma=1.5, notes="",
    )
    save_palette(path, [e1])
    e2 = PaletteEntry(
        id="e2", test_id="t1", source="upload", timestamp="2026-04-17T10:01:00Z",
        hex="#00ff00", lab=list(hex_to_lab("#00ff00")),
        params={"power": 60, "speed": 1000, "frequency": 60000,
                "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
        sigma=1.5, notes="",
    )
    append_entries(path, [e2])
    loaded = load_palette(path)
    assert len(loaded) == 2
    assert {e.id for e in loaded} == {"e1", "e2"}


def test_delta_e_2000_identical_is_zero():
    lab = hex_to_lab("#c4a87b")
    assert delta_e_2000(lab, lab) < 0.01


def test_delta_e_2000_pure_colors_are_large():
    red = hex_to_lab("#ff0000")
    green = hex_to_lab("#00ff00")
    assert delta_e_2000(red, green) > 50


def test_query_returns_nearest_first(tmp_path):
    path = _tmp_path(tmp_path)
    entries = []
    for i, (hex_, power) in enumerate([
        ("#ff0000", 50), ("#ee0000", 55), ("#00ff00", 70),
    ]):
        entries.append(PaletteEntry(
            id=f"e{i}", test_id="t1", source="upload",
            timestamp="2026-04-17T10:00:00Z",
            hex=hex_, lab=list(hex_to_lab(hex_)),
            params={"power": power, "speed": 1000, "frequency": 60000,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
            sigma=1.5, notes="",
        ))
    save_palette(path, entries)

    results = query_by_hex(path, "#ff0100", limit=3)
    assert len(results) == 3
    # Top match should be #ff0000 or #ee0000 (both very close to #ff0100)
    assert results[0].entry.hex in ("#ff0000", "#ee0000")
    # Green should be last
    assert results[-1].entry.hex == "#00ff00"
    # Results must be sorted ascending by delta_e
    delta_es = [r.delta_e for r in results]
    assert delta_es == sorted(delta_es)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_palette.py -v`
Expected: fail.

- [ ] **Step 3: Implement palette**

Create `src/xcs_gen_web/palette.py`:

```python
"""JSON-file palette store with ΔE2000 color query.

Entries are persisted to a single JSON file (default ~/.xcs-gen/palette.json).
At ingest, hex is converted to Lab once and cached so queries avoid repeated
conversion.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

_SCHEMA_VERSION = 1


@dataclass
class PaletteEntry:
    id: str
    test_id: str
    source: str  # "upload" | "manual"
    timestamp: str
    hex: str
    lab: list[float]
    params: dict[str, Any]
    sigma: float
    notes: str = ""


@dataclass
class QueryResult:
    entry: PaletteEntry
    delta_e: float


def _hex_to_srgb(hex_: str) -> tuple[float, float, float]:
    h = hex_.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def _srgb_to_linear(c: float) -> float:
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def _linear_srgb_to_xyz(r: float, g: float, b: float) -> tuple[float, float, float]:
    # sRGB D65 matrix
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    return x, y, z


def _xyz_to_lab(x: float, y: float, z: float) -> tuple[float, float, float]:
    # D65 reference white
    xn, yn, zn = 0.95047, 1.00000, 1.08883
    x /= xn; y /= yn; z /= zn

    def f(t: float) -> float:
        if t > 0.008856:
            return t ** (1 / 3)
        return 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    L = 116 * fy - 16
    a = 500 * (fx - fy)
    b = 200 * (fy - fz)
    return L, a, b


def hex_to_lab(hex_: str) -> tuple[float, float, float]:
    r, g, b = _hex_to_srgb(hex_)
    lr, lg, lb = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)
    x, y, z = _linear_srgb_to_xyz(lr, lg, lb)
    return _xyz_to_lab(x, y, z)


def delta_e_2000(lab1: tuple[float, float, float], lab2: tuple[float, float, float]) -> float:
    """Compute CIEDE2000 color difference between two Lab triplets.

    Standard CIEDE2000 formula (Sharma et al. 2005).
    """
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2

    avg_L = (L1 + L2) / 2
    C1 = math.sqrt(a1 * a1 + b1 * b1)
    C2 = math.sqrt(a2 * a2 + b2 * b2)
    avg_C = (C1 + C2) / 2

    G = 0.5 * (1 - math.sqrt(avg_C ** 7 / (avg_C ** 7 + 25 ** 7)))
    a1p = (1 + G) * a1
    a2p = (1 + G) * a2

    C1p = math.sqrt(a1p * a1p + b1 * b1)
    C2p = math.sqrt(a2p * a2p + b2 * b2)
    avg_Cp = (C1p + C2p) / 2

    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360

    if abs(h1p - h2p) > 180:
        avg_Hp = (h1p + h2p + 360) / 2
    else:
        avg_Hp = (h1p + h2p) / 2

    T = (1 - 0.17 * math.cos(math.radians(avg_Hp - 30))
         + 0.24 * math.cos(math.radians(2 * avg_Hp))
         + 0.32 * math.cos(math.radians(3 * avg_Hp + 6))
         - 0.20 * math.cos(math.radians(4 * avg_Hp - 63)))

    dhp = h2p - h1p
    if abs(dhp) > 180:
        dhp -= 360 if dhp > 0 else -360

    dLp = L2 - L1
    dCp = C2p - C1p
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))

    SL = 1 + (0.015 * (avg_L - 50) ** 2) / math.sqrt(20 + (avg_L - 50) ** 2)
    SC = 1 + 0.045 * avg_Cp
    SH = 1 + 0.015 * avg_Cp * T

    dTheta = 30 * math.exp(-(((avg_Hp - 275) / 25) ** 2))
    RC = 2 * math.sqrt(avg_Cp ** 7 / (avg_Cp ** 7 + 25 ** 7))
    RT = -RC * math.sin(math.radians(2 * dTheta))

    return math.sqrt(
        (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2
        + RT * (dCp / SC) * (dHp / SH)
    )


def default_palette_path() -> Path:
    return Path.home() / ".xcs-gen" / "palette.json"


def load_palette(path: Path | str) -> list[PaletteEntry]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open() as f:
        data = json.load(f)
    return [PaletteEntry(**entry) for entry in data.get("entries", [])]


def save_palette(path: Path | str, entries: list[PaletteEntry]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    body = {"version": _SCHEMA_VERSION, "entries": [asdict(e) for e in entries]}
    with p.open("w") as f:
        json.dump(body, f, indent=2)


def append_entries(path: Path | str, new_entries: list[PaletteEntry]) -> None:
    existing = load_palette(path)
    save_palette(path, existing + new_entries)


def query_by_hex(path: Path | str, hex_: str, *, limit: int = 5) -> list[QueryResult]:
    target = hex_to_lab(hex_)
    entries = load_palette(path)
    scored = [
        QueryResult(entry=e, delta_e=delta_e_2000(target, tuple(e.lab)))
        for e in entries
    ]
    scored.sort(key=lambda r: r.delta_e)
    return scored[:limit]
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_palette.py -v`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen_web/palette.py tests/test_palette.py
git commit -m "Add JSON palette store with CIEDE2000 query"
```

---

### Task 11: Palette CRUD endpoints

**Files:**
- Modify: `src/xcs_gen_web/app.py`
- Modify: `src/xcs_gen_web/schemas.py`
- Create: `tests/test_palette_api.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_palette_api.py`:

```python
"""Tests for the palette CRUD + query endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("XCS_GEN_PALETTE_PATH", str(tmp_path / "palette.json"))
    return TestClient(create_app())


def _swatch_payload() -> dict:
    return {
        "test_id": "t1",
        "x_param": "speed",
        "y_param": "power",
        "base_params": {
            "power": 50, "speed": 1000, "frequency": 60000,
            "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
        },
        "swatches": [
            {"row": 0, "col": 0, "x_value": 500, "y_value": 10,
             "hex": "#ff0000", "sigma": 1.2},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": 10,
             "hex": "#cc0000", "sigma": 0.8},
        ],
    }


def test_list_empty(client):
    resp = client.get("/api/palette")
    assert resp.status_code == 200
    assert resp.json() == []


def test_ingest_and_list(client):
    resp = client.post("/api/palette/ingest", json=_swatch_payload())
    assert resp.status_code == 200
    ids = resp.json()["added_ids"]
    assert len(ids) == 2

    resp = client.get("/api/palette")
    assert len(resp.json()) == 2


def test_query_returns_nearest(client):
    client.post("/api/palette/ingest", json=_swatch_payload())
    resp = client.get("/api/palette/query", params={"hex": "#ff0100", "limit": 2})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 2
    assert results[0]["entry"]["hex"] in ("#ff0000", "#cc0000")
    assert results[0]["delta_e"] <= results[1]["delta_e"]


def test_delete_by_id(client):
    client.post("/api/palette/ingest", json=_swatch_payload())
    entries = client.get("/api/palette").json()
    first_id = entries[0]["id"]
    resp = client.delete(f"/api/palette/{first_id}")
    assert resp.status_code == 204
    remaining = client.get("/api/palette").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] != first_id


def test_delete_by_test(client):
    client.post("/api/palette/ingest", json=_swatch_payload())
    resp = client.delete("/api/palette/by-test/t1")
    assert resp.status_code == 204
    assert client.get("/api/palette").json() == []


def test_patch_notes(client):
    client.post("/api/palette/ingest", json=_swatch_payload())
    entry_id = client.get("/api/palette").json()[0]["id"]
    resp = client.patch(f"/api/palette/{entry_id}", json={"notes": "favourite teal"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "favourite teal"
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_palette_api.py -v`
Expected: all fail (endpoints missing).

- [ ] **Step 3: Add request/response schemas**

Append to `src/xcs_gen_web/schemas.py`:

```python
class PaletteSwatchInput(BaseModel):
    row: int
    col: int
    x_value: float
    y_value: float | None
    hex: str
    sigma: float


class PaletteIngestRequest(BaseModel):
    test_id: str
    x_param: str
    y_param: str | None
    base_params: BaseParams
    swatches: list[PaletteSwatchInput]


class PaletteIngestResponse(BaseModel):
    added_ids: list[str]


class PaletteEntryResponse(BaseModel):
    id: str
    test_id: str
    source: str
    timestamp: str
    hex: str
    lab: list[float]
    params: dict
    sigma: float
    notes: str


class PaletteQueryResult(BaseModel):
    entry: PaletteEntryResponse
    delta_e: float


class PaletteEntryPatch(BaseModel):
    notes: str
```

- [ ] **Step 4: Implement endpoints**

Modify `src/xcs_gen_web/app.py`. Add imports:

```python
import os
import uuid
from datetime import datetime, timezone

from .palette import (
    PaletteEntry,
    append_entries,
    default_palette_path,
    hex_to_lab,
    load_palette,
    query_by_hex,
    save_palette,
)
from .schemas import (
    PaletteEntryPatch,
    PaletteEntryResponse,
    PaletteIngestRequest,
    PaletteIngestResponse,
    PaletteQueryResult,
)
```

Add a helper near the top of `app.py` (outside `create_app`):

```python
def _palette_path():
    return os.environ.get("XCS_GEN_PALETTE_PATH") or default_palette_path()
```

Inside `create_app`, add these routes:

```python
    @app.get("/api/palette", response_model=list[PaletteEntryResponse])
    def palette_list():
        return [PaletteEntryResponse(**e.__dict__) for e in load_palette(_palette_path())]

    @app.post("/api/palette/ingest", response_model=PaletteIngestResponse)
    def palette_ingest(req: PaletteIngestRequest):
        now = datetime.now(timezone.utc).isoformat()
        params_dict = req.base_params.model_dump()
        entries = []
        for sw in req.swatches:
            params = dict(params_dict)
            # Set the swept param(s) on this particular swatch.
            params[req.x_param] = sw.x_value
            if req.y_param and sw.y_value is not None:
                params[req.y_param] = sw.y_value
            lab = list(hex_to_lab(sw.hex))
            entries.append(PaletteEntry(
                id=uuid.uuid4().hex,
                test_id=req.test_id,
                source="upload",
                timestamp=now,
                hex=sw.hex,
                lab=lab,
                params=params,
                sigma=sw.sigma,
                notes="",
            ))
        append_entries(_palette_path(), entries)
        return PaletteIngestResponse(added_ids=[e.id for e in entries])

    @app.get("/api/palette/query", response_model=list[PaletteQueryResult])
    def palette_query(hex: str, limit: int = 5):
        results = query_by_hex(_palette_path(), hex, limit=limit)
        return [
            PaletteQueryResult(
                entry=PaletteEntryResponse(**r.entry.__dict__),
                delta_e=r.delta_e,
            )
            for r in results
        ]

    @app.delete("/api/palette/{entry_id}", status_code=204)
    def palette_delete(entry_id: str):
        path = _palette_path()
        entries = load_palette(path)
        remaining = [e for e in entries if e.id != entry_id]
        if len(remaining) == len(entries):
            raise HTTPException(status_code=404, detail="entry not found")
        save_palette(path, remaining)

    @app.delete("/api/palette/by-test/{test_id}", status_code=204)
    def palette_delete_by_test(test_id: str):
        path = _palette_path()
        entries = load_palette(path)
        remaining = [e for e in entries if e.test_id != test_id]
        save_palette(path, remaining)

    @app.patch("/api/palette/{entry_id}", response_model=PaletteEntryResponse)
    def palette_patch(entry_id: str, patch: PaletteEntryPatch):
        path = _palette_path()
        entries = load_palette(path)
        for e in entries:
            if e.id == entry_id:
                e.notes = patch.notes
                save_palette(path, entries)
                return PaletteEntryResponse(**e.__dict__)
        raise HTTPException(status_code=404, detail="entry not found")
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_palette_api.py -v`
Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen_web/app.py src/xcs_gen_web/schemas.py tests/test_palette_api.py
git commit -m "Add palette CRUD and query endpoints"
```

---

### Task 12: Palette UI — tab + upload + review + save

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`
- Create: `web/src/components/PalettePage.tsx`
- Create: `web/src/palette-api.ts`
- Modify: `web/src/types.ts`

- [ ] **Step 1: Extend TS types**

Append to `web/src/types.ts`:

```typescript
export interface CaptureSwatch {
  row: number;
  col: number;
  x_value: number;
  y_value: number | null;
  hex: string;
  sigma: number;
}

export interface CaptureIngestResponse {
  test_id: string;
  kind: "grid" | "gradient";
  swatches: CaptureSwatch[];
  base_params: BaseParams;
  x_param: string;
  y_param: string | null;
}

export interface PaletteEntry {
  id: string;
  test_id: string;
  source: string;
  timestamp: string;
  hex: string;
  lab: number[];
  params: { [k: string]: string | number };
  sigma: number;
  notes: string;
}

export interface PaletteQueryResult {
  entry: PaletteEntry;
  delta_e: number;
}
```

- [ ] **Step 2: Create API helper**

Create `web/src/palette-api.ts`:

```typescript
import type {
  CaptureIngestResponse,
  PaletteEntry,
  PaletteQueryResult,
} from "./types";

export async function captureIngest(file: File): Promise<CaptureIngestResponse> {
  const fd = new FormData();
  fd.append("image", file);
  const r = await fetch("/api/capture/ingest", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json()).detail ?? "upload failed");
  return r.json();
}

export async function paletteList(): Promise<PaletteEntry[]> {
  const r = await fetch("/api/palette");
  if (!r.ok) throw new Error("failed to list palette");
  return r.json();
}

export async function paletteIngest(body: {
  test_id: string;
  x_param: string;
  y_param: string | null;
  base_params: any;
  swatches: { row: number; col: number; x_value: number;
              y_value: number | null; hex: string; sigma: number; }[];
}): Promise<{ added_ids: string[] }> {
  const r = await fetch("/api/palette/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "ingest failed");
  return r.json();
}

export async function paletteQuery(hex: string, limit = 5): Promise<PaletteQueryResult[]> {
  const r = await fetch(`/api/palette/query?hex=${encodeURIComponent(hex)}&limit=${limit}`);
  if (!r.ok) throw new Error("query failed");
  return r.json();
}

export async function paletteDelete(id: string): Promise<void> {
  const r = await fetch(`/api/palette/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("delete failed");
}

export async function paletteDeleteByTest(testId: string): Promise<void> {
  const r = await fetch(`/api/palette/by-test/${testId}`, { method: "DELETE" });
  if (!r.ok) throw new Error("delete failed");
}
```

- [ ] **Step 3: Create PalettePage component (upload + review flow)**

Create `web/src/components/PalettePage.tsx`:

```tsx
import { useState } from "react";
import { captureIngest, paletteIngest } from "../palette-api";
import type { CaptureIngestResponse, CaptureSwatch } from "../types";

const SIGMA_WARN = 10;

export function PalettePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [response, setResponse] = useState<CaptureIngestResponse | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [saveResult, setSaveResult] = useState<string | undefined>();

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setSaveResult(undefined);
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const r = await captureIngest(file);
      setResponse(r);
      const initial: Record<string, boolean> = {};
      r.swatches.forEach((s, i) => {
        initial[`${i}`] = s.sigma < SIGMA_WARN;
      });
      setSelected(initial);
    } catch (err) {
      setError((err as Error).message);
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    if (!response) return;
    const swatchesToSave = response.swatches.filter((_, i) => selected[`${i}`]);
    try {
      const r = await paletteIngest({
        test_id: response.test_id,
        x_param: response.x_param,
        y_param: response.y_param,
        base_params: response.base_params,
        swatches: swatchesToSave,
      });
      setSaveResult(`Saved ${r.added_ids.length} swatches.`);
      setResponse(null);
      setSelected({});
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
      <h2 style={{ marginTop: 0 }}>Upload burned test photo</h2>

      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: "inline-block", padding: "8px 16px",
          background: "#336", color: "white", borderRadius: 4,
          cursor: "pointer",
        }}>
          {loading ? "Processing..." : "Select photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={loading}
            onChange={onUpload}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {error && <div style={{ color: "#a02840", marginBottom: 12 }}>{error}</div>}
      {saveResult && <div style={{ color: "#206030", marginBottom: 12 }}>{saveResult}</div>}

      {response && (
        <div>
          <div style={{ marginBottom: 8 }}>
            <strong>Detected:</strong> test {response.test_id} ({response.kind}),
            varying {response.x_param}
            {response.y_param ? ` × ${response.y_param}` : ""}
            , {response.swatches.length} cells
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
            gap: 6, marginBottom: 16,
          }}>
            {response.swatches.map((s, i) => (
              <SwatchCard
                key={i}
                swatch={s}
                selected={!!selected[`${i}`]}
                onToggle={() => setSelected(prev => ({ ...prev, [`${i}`]: !prev[`${i}`] }))}
              />
            ))}
          </div>
          <button onClick={onSave} style={{
            padding: "8px 16px", background: "#336", color: "white",
            border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer",
          }}>
            Save {Object.values(selected).filter(Boolean).length} swatches
          </button>
        </div>
      )}
    </div>
  );
}

function SwatchCard({ swatch, selected, onToggle }: {
  swatch: CaptureSwatch;
  selected: boolean;
  onToggle: () => void;
}) {
  const noisy = swatch.sigma >= SIGMA_WARN;
  return (
    <div
      onClick={onToggle}
      style={{
        border: selected ? "2px solid #336" : "1px solid #ccc",
        borderRadius: 4, padding: 4, cursor: "pointer",
        opacity: selected ? 1 : 0.5,
      }}
    >
      <div style={{ background: swatch.hex, height: 40, borderRadius: 2 }} />
      <div style={{ fontSize: 10, marginTop: 4, fontFamily: "monospace" }}>
        {swatch.hex}
      </div>
      <div style={{ fontSize: 10, color: "#666" }}>
        {noisy && <span style={{ color: "#a05000" }}>⚠ </span>}
        σ={swatch.sigma.toFixed(1)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire Palette tab into App**

Modify `web/src/App.tsx`:
- Change `type Tab = "tests" | "svg" | "layers";` to `type Tab = "tests" | "svg" | "layers" | "palette";`
- Add PalettePage import: `import { PalettePage } from "./components/PalettePage";`
- Add the render case after the `layers` block:

```tsx
      ) : tab === "palette" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <PalettePage />
        </div>
      ) : (
```

Update the TopBar title ternary to include palette:

```tsx
title={
  tab === "tests" ? project.name
  : tab === "svg" ? "SVG stack"
  : tab === "layers" ? "SVG layers"
  : "Palette"
}
```

Set `showGenerate={tab === "tests"}` already hides Generate on other tabs — no change needed there.

Modify `web/src/components/TopBar.tsx` — update `type Tab = ...` and add another `TabButton`:

```tsx
<TabButton active={tab === "palette"} onClick={() => onTabChange("palette")}>Palette</TabButton>
```

- [ ] **Step 5: Build + smoke test**

Run: `cd web && npm run build`
Expected: clean build.

Run backend: `xcs-gen serve --no-browser &`
Open the app, switch to Palette tab — confirm "Select photo" button appears.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/components/TopBar.tsx web/src/components/PalettePage.tsx web/src/palette-api.ts web/src/types.ts
git commit -m "Add Palette tab with upload + review + save flow"
```

---

### Task 13: Palette UI — query by hex + browse

**Files:**
- Modify: `web/src/components/PalettePage.tsx`

- [ ] **Step 1: Add query + browse sub-views**

Modify `web/src/components/PalettePage.tsx`. At the top, extend imports:

```tsx
import { useEffect, useState } from "react";
import {
  captureIngest, paletteIngest, paletteList, paletteQuery,
  paletteDelete, paletteDeleteByTest,
} from "../palette-api";
import type {
  CaptureIngestResponse, CaptureSwatch, PaletteEntry, PaletteQueryResult,
} from "../types";
```

Refactor the `PalettePage` body to have 3 sub-views via an internal view state:

```tsx
type View = "upload" | "query" | "browse";

export function PalettePage() {
  const [view, setView] = useState<View>("upload");
  return (
    <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <SubTab active={view === "upload"} onClick={() => setView("upload")}>Upload</SubTab>
        <SubTab active={view === "query"} onClick={() => setView("query")}>Query</SubTab>
        <SubTab active={view === "browse"} onClick={() => setView("browse")}>Browse</SubTab>
      </div>
      {view === "upload" && <UploadView />}
      {view === "query" && <QueryView />}
      {view === "browse" && <BrowseView />}
    </div>
  );
}

function SubTab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px",
      border: "1px solid " + (active ? "#336" : "#ddd"),
      background: active ? "#e8ecf3" : "white",
      color: active ? "#336" : "#555",
      borderRadius: 4, fontWeight: active ? 600 : 400, cursor: "pointer",
    }}>
      {children}
    </button>
  );
}
```

Move the existing upload + review code into a new component `UploadView` (the body of the old PalettePage, minus the outer wrapper div).

Add `QueryView`:

```tsx
function QueryView() {
  const [hex, setHex] = useState("#c4a87b");
  const [results, setResults] = useState<PaletteQueryResult[]>([]);
  const [error, setError] = useState<string | undefined>();

  async function onQuery() {
    setError(undefined);
    try {
      const r = await paletteQuery(hex, 5);
      setResults(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Find closest-matching params</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          style={{ width: 48, height: 36 }}
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          style={{ width: 120, padding: 6, fontFamily: "monospace" }}
        />
        <button onClick={onQuery} style={{
          padding: "8px 16px", background: "#336", color: "white",
          border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer",
        }}>
          Find closest
        </button>
      </div>
      {error && <div style={{ color: "#a02840" }}>{error}</div>}
      <div>
        {results.map((r) => (
          <ResultRow key={r.entry.id} result={r} />
        ))}
      </div>
    </div>
  );
}

function ResultRow({ result }: { result: PaletteQueryResult }) {
  const p = result.entry.params;
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "center", padding: "8px 0",
      borderBottom: "1px solid #eee",
    }}>
      <div style={{
        width: 48, height: 48, background: result.entry.hex, borderRadius: 4,
      }} />
      <div style={{ fontFamily: "monospace" }}>{result.entry.hex}</div>
      <div>ΔE = {result.delta_e.toFixed(2)}</div>
      <div style={{ fontSize: 12, color: "#555" }}>
        P={p.power}% S={p.speed} F={p.frequency} D={p.density} ×{p.passes} PW={p.pulse_width} {p.laser}
      </div>
    </div>
  );
}
```

Add `BrowseView`:

```tsx
function BrowseView() {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);

  async function refresh() {
    setEntries(await paletteList());
  }
  useEffect(() => { refresh(); }, []);

  async function onDelete(id: string) {
    await paletteDelete(id);
    refresh();
  }
  async function onDeleteTest(testId: string) {
    await paletteDeleteByTest(testId);
    refresh();
  }

  // Group by test_id for the bulk-delete affordance
  const byTest: Record<string, PaletteEntry[]> = {};
  entries.forEach((e) => {
    (byTest[e.test_id] = byTest[e.test_id] ?? []).push(e);
  });

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Palette ({entries.length} entries)</h2>
      {Object.entries(byTest).map(([testId, group]) => (
        <div key={testId} style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h3 style={{ margin: 0 }}>Test {testId}</h3>
            <button
              onClick={() => onDeleteTest(testId)}
              style={{ fontSize: 12, color: "#a02840" }}
            >
              Delete all ({group.length})
            </button>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
            gap: 6, marginTop: 8,
          }}>
            {group.map((e) => (
              <div key={e.id}
                   title={`${e.hex}\n${Object.entries(e.params).map(([k,v]) => `${k}=${v}`).join('\n')}`}
                   style={{ border: "1px solid #ddd", padding: 4, borderRadius: 4 }}>
                <div style={{ background: e.hex, height: 40, borderRadius: 2 }} />
                <div style={{ fontSize: 10, fontFamily: "monospace" }}>{e.hex}</div>
                <button onClick={() => onDelete(e.id)} style={{
                  fontSize: 10, color: "#a02840", padding: 0, background: "none",
                  border: "none", cursor: "pointer",
                }}>
                  delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build + smoke test**

Run: `cd web && npm run build`
Expected: clean build.

With backend running, switch to Palette → Query: pick a color, click "Find closest" — empty list renders OK when palette is empty. Upload a photo to populate, then re-query and see results. Switch to Browse and see the uploaded swatches grouped by test.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PalettePage.tsx
git commit -m "Add palette query + browse sub-views"
```

---

## Post-implementation

- [ ] Final full-suite run

Run: `pytest tests/ -x -q && cd web && npm run build`
Expected: all tests green, frontend builds clean.

- [ ] End-to-end manual verification

1. Generate a test with registration=compact
2. Burn it
3. Upload photo via Palette → Upload
4. Save all non-noisy swatches
5. Query by a hex from one of the swatches — confirm ΔE≈0 match at top
6. Browse tab shows the new test group
7. Delete the test group; confirm palette returns to empty

- [ ] Open a PR summarizing the feature + linking to the spec

---

## Spec coverage check

- Section 1 (Marker layout): Tasks 3, 4 ✓
- Section 2 (QR payload): Task 2 ✓
- Section 3 (Pipeline): Tasks 7, 8, 9 ✓
- Section 4 (Palette storage + query): Tasks 10, 11 ✓
- Section 5 (Web UI flow): Tasks 5, 6, 12, 13 ✓
- Section 6 (Scope + deferred): handled by exclusion — thick-cross fiducial, SVG color-mapper, non-linear gradient fitting, material tagging, multi-test-per-photo, mobile polish all out of v1 ✓
- Pre-implementation validation: Validation Gate between Tasks 7 and 8 ✓
