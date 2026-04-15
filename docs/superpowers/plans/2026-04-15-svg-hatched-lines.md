# SVG Hatched Lines (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth render mode, `hatched`, to the existing `xcs-gen svg` pipeline. Each hatched layer fills its shapes with explicit `LINE` segments clipped by shapely, supporting multi-pass cross-hatching and per-pass linear ramps (including a rampable spacing). Config via YAML file (primary UX) plus a compact `--hatch` CLI flag for one-pass experiments.

**Architecture:** The v1 parser / color detection / layer grouping are unchanged. A new `hatch.py` module computes clipped segments per shape using `shapely.Polygon.intersection`. `LayerConfig` gains a `hatch_passes: list[HatchPass]` field and `RenderMode` gains `"hatched"`. `generate_from_svg` dispatches: `hatched` shapes go to the hatch generator (producing many `Line` elements appended to `extra_displays` + `extra_device_entries`); non-hatched shapes keep their v1 Path emitter path. A new `svg_config.py` loads YAML into the same `LayerConfig` dataclasses the CLI produces.

**Tech Stack:** Python 3.10+, `shapely>=2` (new dep), `pyyaml` (new dep), existing `svgelements` / Pillow / dataclasses / pytest.

**Spec reference:** `docs/superpowers/specs/2026-04-15-svg-hatched-lines-design.md`

---

## Task Order Summary

1. Add `shapely` + `pyyaml` deps; shapely sanity test covering polygon-line intersection
2. Extend `model.Line` with optional `params` and `processing_type`
3. `svg_source.py`: add `HatchRamp`, `HatchPass`; extend `RenderMode` and `LayerConfig`; extend `_RENDER_MODE_TO_PROCESSING`; add hatched-related resolver validation
4. New `src/xcs_gen/hatch.py` module — `svg_d_to_polygon()`
5. `hatch.py` — `generate_hatch_segments()` with uniform params (no ramps)
6. `hatch.py` — `HatchRamp` per-segment parameter interpolation
7. `hatch.py` — rampable spacing
8. Wire hatched dispatch into `generate_from_svg`; reject `hatched` on stroke layers
9. New `src/xcs_gen/svg_config.py` — YAML config loader
10. CLI: `--hatch` flag (repeatable, one pass each)
11. CLI: `--config`, `--max-segments`, `--min-spacing` flags
12. Pikachu hatched integration test + manual XCS Studio verify

---

### Task 1: Add `shapely` and `pyyaml` dependencies

**Files:**
- Modify: `pyproject.toml`
- Create: `tests/test_hatch_library.py`

- [ ] **Step 1: Add dependencies**

Edit `pyproject.toml`. The `dependencies` line currently reads:

```toml
dependencies = ["Pillow>=10.0", "fastapi>=0.110", "uvicorn[standard]>=0.27", "svgelements>=1.9"]
```

Replace with:

```toml
dependencies = ["Pillow>=10.0", "fastapi>=0.110", "uvicorn[standard]>=0.27", "svgelements>=1.9", "shapely>=2.0", "pyyaml>=6.0"]
```

- [ ] **Step 2: Install**

Run: `pip install -e .`
Expected: installs `shapely` and `pyyaml` (plus any transitive deps) without errors.

- [ ] **Step 3: Write sanity tests for the shapely APIs we'll rely on**

Create `tests/test_hatch_library.py`:

```python
"""Sanity checks on shapely APIs we'll use in hatch.py, pinned before building on them."""

from shapely.geometry import LineString, Polygon, MultiLineString
from shapely import make_valid


def test_polygon_line_intersection_simple():
    """A single horizontal line crossing a square returns one LineString segment."""
    square = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    line = LineString([(-1, 5), (11, 5)])
    result = square.intersection(line)
    assert isinstance(result, LineString)
    coords = list(result.coords)
    assert coords[0] == (0.0, 5.0)
    assert coords[-1] == (10.0, 5.0)


def test_polygon_line_intersection_with_hole():
    """A line crossing a donut (polygon with a hole) returns a MultiLineString of 2 segments."""
    outer = [(0, 0), (10, 0), (10, 10), (0, 10)]
    inner = [(3, 3), (3, 7), (7, 7), (7, 3)]
    donut = Polygon(outer, holes=[inner])
    line = LineString([(-1, 5), (11, 5)])
    result = donut.intersection(line)
    assert isinstance(result, MultiLineString)
    segments = list(result.geoms)
    assert len(segments) == 2
    lengths = sorted(s.length for s in segments)
    assert abs(lengths[0] - 3.0) < 1e-6
    assert abs(lengths[1] - 3.0) < 1e-6


def test_make_valid_repairs_self_intersecting():
    """shapely.make_valid repairs a self-intersecting polygon into a valid geometry."""
    bowtie = Polygon([(0, 0), (10, 10), (10, 0), (0, 10)])  # self-intersecting
    fixed = make_valid(bowtie)
    assert fixed.is_valid


def test_yaml_roundtrip():
    """pyyaml loads a nested dict round-trip."""
    import yaml
    data = {"layers": {"#ff0000": {"render_mode": "hatched", "hatch_passes": [{"angle": 0, "spacing": 0.4}]}}}
    s = yaml.safe_dump(data)
    loaded = yaml.safe_load(s)
    assert loaded == data
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_hatch_library.py -v`
Expected: 4 PASS. If any fails, the shapely/pyyaml API differs from what we assume — stop and report (the rest of the plan depends on these).

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml tests/test_hatch_library.py
git commit -m "Add shapely and pyyaml deps with sanity tests"
```

---

### Task 2: Extend `model.Line` with optional params and processing_type

The v1 `Line` dataclass is currently used only for axis-tick annotations, where the caller builds the device entry separately with annotation params. For hatched output we need each segment to carry its own `ProcessingParams`, so the generator can call `build_device_entry` with per-segment values. We add two optional fields so existing call sites stay unchanged.

**Files:**
- Modify: `src/xcs_gen/model.py`
- Test: `tests/test_svg_model.py` (append)

- [ ] **Step 1: Append the failing tests**

Append to `tests/test_svg_model.py`:

```python
def test_line_defaults_unchanged():
    from xcs_gen.model import Line
    line = Line(x=0, y=0, length=10)
    # Existing defaults still work — no params, no processing_type fuss.
    assert line.params is None
    assert line.processing_type == "VECTOR_ENGRAVING"
    assert line.angle == 0.0


def test_line_accepts_params_and_processing_type():
    from xcs_gen.model import Line, ProcessingParams
    p = ProcessingParams(power=42, speed=500)
    line = Line(x=0, y=0, length=10, params=p, processing_type="VECTOR_CUTTING")
    assert line.params.power == 42
    assert line.processing_type == "VECTOR_CUTTING"
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pytest tests/test_svg_model.py -v`
Expected: both new tests fail with AttributeError on `line.params` / `line.processing_type`.

- [ ] **Step 3: Extend `Line`**

Edit `src/xcs_gen/model.py`. Replace the existing `Line` dataclass (around line 47-56):

```python
@dataclass
class Line:
    """A line display element."""

    x: float
    y: float
    length: float
    angle: float = 0.0  # 0 = horizontal, 90 = vertical
    layer_color: str = ""
    id: str = field(default_factory=_uuid)
```

with:

```python
@dataclass
class Line:
    """A line display element.

    When a line carries its own `params` / `processing_type`, those are used
    verbatim by the caller when building device entries (typical for hatched
    output). When `params is None`, the caller supplies params externally (as
    annotation ticks do with fixed annotation params).
    """

    x: float
    y: float
    length: float
    angle: float = 0.0  # 0 = horizontal, 90 = vertical
    layer_color: str = ""
    id: str = field(default_factory=_uuid)
    params: ProcessingParams | None = None
    processing_type: str = "VECTOR_ENGRAVING"
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pytest tests/test_svg_model.py -v`
Expected: all model tests PASS. Then run the full suite: `pytest -v` — all existing tests (including gradient / annotation / image) still pass (80 existing + 2 new ≈ 82 total).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/model.py tests/test_svg_model.py
git commit -m "Add optional params and processing_type to model.Line"
```

---

### Task 3: Extend `svg_source.py` with `HatchRamp`, `HatchPass`, and hatched-mode validation

**Files:**
- Modify: `src/xcs_gen/svg_source.py`
- Test: `tests/test_svg_layers.py` (append)

- [ ] **Step 1: Append the failing tests**

Append to `tests/test_svg_layers.py`:

```python
import pytest

from xcs_gen.svg_source import HatchPass, HatchRamp


def test_hatchpass_and_hatchramp_defaults():
    r = HatchRamp(param="power", axis="perp", min_value=20, max_value=80)
    assert r.param == "power"
    assert r.axis == "perp"
    assert r.min_value == 20
    assert r.max_value == 80

    p = HatchPass()
    assert p.angle == 0.0
    assert p.spacing == 0.5
    assert p.base_params is None
    assert p.ramps == []


def test_layerconfig_accepts_hatch_passes():
    from xcs_gen.model import ProcessingParams
    from xcs_gen.svg_source import LayerConfig
    cfg = LayerConfig(
        params=ProcessingParams(),
        render_mode="hatched",
        hatch_passes=[HatchPass(angle=0, spacing=0.4)],
    )
    assert cfg.render_mode == "hatched"
    assert len(cfg.hatch_passes) == 1


def test_resolve_rejects_hatched_with_no_passes():
    from xcs_gen.model import ProcessingParams
    from xcs_gen.svg_source import LayerConfig, resolve_layer_params
    with pytest.raises(ValueError, match="hatched"):
        resolve_layer_params(
            detected_colors=["#ffd73e"],
            layer_config={
                "#ffd73e": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="hatched",
                    hatch_passes=[],
                ),
            },
            auto_ramp=None,
            base_params=ProcessingParams(),
        )


def test_resolve_rejects_non_hatched_with_passes():
    from xcs_gen.model import ProcessingParams
    from xcs_gen.svg_source import LayerConfig, resolve_layer_params
    with pytest.raises(ValueError, match="hatch_passes"):
        resolve_layer_params(
            detected_colors=["#ffd73e"],
            layer_config={
                "#ffd73e": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="fill_engrave",
                    hatch_passes=[HatchPass(angle=0, spacing=0.4)],
                ),
            },
            auto_ramp=None,
            base_params=ProcessingParams(),
        )


def test_resolve_rejects_invalid_ramp_param():
    from xcs_gen.model import ProcessingParams
    from xcs_gen.svg_source import LayerConfig, resolve_layer_params
    with pytest.raises(ValueError, match="bogus"):
        resolve_layer_params(
            detected_colors=["#ffd73e"],
            layer_config={
                "#ffd73e": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="hatched",
                    hatch_passes=[HatchPass(
                        angle=0, spacing=0.4,
                        ramps=[HatchRamp(param="bogus", axis="perp", min_value=0, max_value=1)],
                    )],
                ),
            },
            auto_ramp=None,
            base_params=ProcessingParams(),
        )


def test_resolve_hatched_assignment_processing_type():
    from xcs_gen.model import ProcessingParams
    from xcs_gen.svg_source import LayerConfig, resolve_layer_params
    result = resolve_layer_params(
        detected_colors=["#ffd73e"],
        layer_config={
            "#ffd73e": LayerConfig(
                params=ProcessingParams(),
                render_mode="hatched",
                hatch_passes=[HatchPass(angle=0, spacing=0.4)],
            ),
        },
        auto_ramp=None,
        base_params=ProcessingParams(),
    )
    # Hatched segments go out as VECTOR_ENGRAVING LINE displays.
    assert result["#ffd73e"].processing_type == "VECTOR_ENGRAVING"
    assert result["#ffd73e"].render_mode == "hatched"
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pytest tests/test_svg_layers.py -v`
Expected: the new tests fail with ImportError on `HatchPass` / `HatchRamp`, or the render-mode literal rejects `"hatched"`.

- [ ] **Step 3: Update `RenderMode`, add `_RENDER_MODE_TO_PROCESSING` entry, add dataclasses, extend `LayerConfig`**

Edit `src/xcs_gen/svg_source.py`. Change the `RenderMode` literal and the mapping. Find:

```python
RenderMode = Literal["fill_engrave", "vector_engrave", "vector_cut"]

_RENDER_MODE_TO_PROCESSING: dict[str, str] = {
    "fill_engrave": "COLOR_FILL_ENGRAVE",
    "vector_engrave": "VECTOR_ENGRAVING",
    "vector_cut": "VECTOR_CUTTING",
}
```

Replace with:

```python
RenderMode = Literal["fill_engrave", "vector_engrave", "vector_cut", "hatched"]

_RENDER_MODE_TO_PROCESSING: dict[str, str] = {
    "fill_engrave": "COLOR_FILL_ENGRAVE",
    "vector_engrave": "VECTOR_ENGRAVING",
    "vector_cut": "VECTOR_CUTTING",
    "hatched": "VECTOR_ENGRAVING",  # applied per-segment LINE display
}


RampAxis = Literal["perp", "parallel", "x", "y"]


@dataclass
class HatchRamp:
    """Linearly interpolate one ProcessingParams field (or 'spacing') across the shape.

    The `axis` determines which dimension of the shape drives the interpolation:
      perp     — perpendicular to the hatch angle (classic top-to-bottom fade for 0°)
      parallel — along the hatch angle (segments along a line vary)
      x, y     — shape bbox axes, regardless of hatch angle
    """

    param: str          # "power", "speed", "frequency", "density", "passes",
                        # "pulse_width", or "spacing"
    axis: RampAxis
    min_value: float
    max_value: float


@dataclass
class HatchPass:
    """One sweep of parallel hatch lines through the shape."""

    angle: float = 0.0                              # degrees, 0 = horizontal
    spacing: float = 0.5                            # mm between adjacent lines
    base_params: ProcessingParams | None = None     # None → LayerConfig.params
    ramps: list[HatchRamp] = field(default_factory=list)
```

Then update `LayerConfig`. Find:

```python
@dataclass
class LayerConfig:
    """Explicit params for a single colour layer."""

    params: ProcessingParams
    render_mode: RenderMode = "fill_engrave"
```

Replace with:

```python
@dataclass
class LayerConfig:
    """Explicit params for a single colour layer.

    When `render_mode == "hatched"`, `hatch_passes` must be non-empty and each
    pass describes a sweep of parallel hatch lines. Non-hatched render modes
    must have an empty `hatch_passes` list (validated by the resolver).
    """

    params: ProcessingParams
    render_mode: RenderMode = "fill_engrave"
    hatch_passes: list[HatchPass] = field(default_factory=list)
```

- [ ] **Step 4: Add resolver validation**

Still in `src/xcs_gen/svg_source.py`, find `resolve_layer_params`. Inside the function, after the line `layer_config = layer_config or {}` and BEFORE `out: dict[str, LayerAssignment] = {}`, insert:

```python
    _validate_layer_configs(layer_config)
```

Then, near the bottom of the file (near the other helpers like `_sort_for_ramp`), add:

```python
_VALID_RAMP_PARAMS = set(_RAMP_FIELD_MAP) | {"spacing"}


def _validate_layer_configs(layer_config: dict[str, LayerConfig]) -> None:
    """Validate render-mode-specific invariants on all explicit LayerConfigs."""
    for color, cfg in layer_config.items():
        if cfg.render_mode == "hatched":
            if not cfg.hatch_passes:
                raise ValueError(
                    f"layer {color!r} has render_mode='hatched' but no hatch_passes"
                )
            for i, hp in enumerate(cfg.hatch_passes):
                for r in hp.ramps:
                    if r.param not in _VALID_RAMP_PARAMS:
                        raise ValueError(
                            f"layer {color!r} pass {i}: unknown ramp param "
                            f"{r.param!r}. Valid: {sorted(_VALID_RAMP_PARAMS)}"
                        )
        else:
            if cfg.hatch_passes:
                raise ValueError(
                    f"layer {color!r} has hatch_passes but render_mode="
                    f"{cfg.render_mode!r} (expected 'hatched')"
                )
```

- [ ] **Step 5: Run the tests**

Run: `pytest tests/test_svg_layers.py -v`
Expected: all previous tests plus the 6 new ones PASS.

Then full suite: `pytest -v`
Expected: still green.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/svg_source.py tests/test_svg_layers.py
git commit -m "Add HatchRamp/HatchPass + hatched render mode validation"
```

---

### Task 4: `hatch.py` — `svg_d_to_polygon()`

Convert an SVG path `d` string (in bed-mm) into a shapely `Polygon` or `MultiPolygon`, handling compound paths (subpaths split on `M`) and `fillRule`.

**Files:**
- Create: `src/xcs_gen/hatch.py`
- Create: `tests/test_hatch.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_hatch.py`:

```python
"""Tests for the hatch module: polygon construction and segment generation."""

import pytest
from shapely.geometry import MultiPolygon, Polygon

from xcs_gen.hatch import svg_d_to_polygon


def test_svg_d_to_polygon_simple_square():
    poly = svg_d_to_polygon("M 0,0 L 10,0 L 10,10 L 0,10 Z", fill_rule="evenodd")
    assert isinstance(poly, Polygon)
    assert abs(poly.area - 100) < 1e-6


def test_svg_d_to_polygon_compound_with_hole_evenodd():
    # Outer 20x20 square, inner 5x5 hole centered at (10,10).
    d = (
        "M 0,0 L 20,0 L 20,20 L 0,20 Z "
        "M 7.5,7.5 L 12.5,7.5 L 12.5,12.5 L 7.5,12.5 Z"
    )
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert isinstance(poly, Polygon)
    # Area = 400 (outer) - 25 (inner) = 375.
    assert abs(poly.area - 375) < 1e-6
    assert len(poly.interiors) == 1


def test_svg_d_to_polygon_two_disjoint_shapes_is_multipolygon():
    # Two separate 10x10 squares.
    d = (
        "M 0,0 L 10,0 L 10,10 L 0,10 Z "
        "M 20,0 L 30,0 L 30,10 L 20,10 Z"
    )
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert isinstance(poly, MultiPolygon)
    assert abs(poly.area - 200) < 1e-6


def test_svg_d_to_polygon_self_intersecting_is_repaired():
    # A bowtie — self-intersecting quad.
    d = "M 0,0 L 10,10 L 10,0 L 0,10 Z"
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    assert poly.is_valid
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_hatch.py -v`
Expected: ImportError on `svg_d_to_polygon`.

- [ ] **Step 3: Create `hatch.py` with `svg_d_to_polygon`**

Create `src/xcs_gen/hatch.py`:

```python
"""Polygon construction and hatch-segment generation for the hatched render mode.

Depends on shapely for polygon ops. Consumes the same SVG path d-strings (in
bed-mm) that the v1 parser emits.
"""

from __future__ import annotations

import re
from typing import Literal

from shapely import make_valid
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon
from shapely.ops import unary_union
from svgelements import Path as SVGPath


FillRule = Literal["evenodd", "nonzero"]


def svg_d_to_polygon(d: str, *, fill_rule: FillRule = "evenodd") -> Polygon | MultiPolygon:
    """Convert an SVG path d-string to a shapely Polygon (or MultiPolygon).

    Subpaths split on 'M'/'m' commands. Curve commands (C, Q, A) are flattened
    by svgelements' built-in sampling before each ring is handed to shapely.

    Fill rule:
      - evenodd: nested subpaths alternate between exterior/hole based on nesting.
      - nonzero: winding direction decides. We approximate by treating every ring
        as an exterior, then unioning — adequate for typical laser artwork.
    """
    path = SVGPath(d)
    rings = _path_to_rings(path)
    if not rings:
        return Polygon()

    if fill_rule == "nonzero":
        # Union every subpath as its own polygon; holes produced by winding are
        # conservatively ignored. Good enough for laser artwork.
        polys = [Polygon(ring) for ring in rings if len(ring) >= 3]
        return _repair(unary_union(polys))

    # evenodd: walk rings, every one that's strictly inside an odd number of
    # others becomes a hole.
    simple_polys = [Polygon(ring) for ring in rings if len(ring) >= 3]
    if not simple_polys:
        return Polygon()

    # Sort by area descending so containment checks are stable.
    indexed = sorted(enumerate(simple_polys), key=lambda pair: pair[1].area, reverse=True)
    depth: dict[int, int] = {idx: 0 for idx, _ in indexed}
    for i, (a_idx, a) in enumerate(indexed):
        for b_idx, b in indexed[:i]:
            if depth[b_idx] is None:
                continue
            if b.contains(a):
                depth[a_idx] = depth[b_idx] + 1

    # Group rings by their containing exterior (nearest even-depth ancestor).
    exteriors: list[tuple[list[tuple[float, float]], list[list[tuple[float, float]]]]] = []
    exterior_indices: list[int] = []
    for idx, poly in indexed:
        if depth[idx] % 2 == 0:
            exteriors.append((list(poly.exterior.coords), []))
            exterior_indices.append(idx)

    for idx, poly in indexed:
        if depth[idx] % 2 == 1:
            # Assign to the innermost even-depth parent.
            best = None
            best_depth = -1
            for ex_idx, (shell_coords, _holes) in zip(exterior_indices, exteriors):
                if depth[ex_idx] > best_depth and Polygon(shell_coords).contains(poly):
                    best = ex_idx
                    best_depth = depth[ex_idx]
            if best is not None:
                exteriors[exterior_indices.index(best)][1].append(list(poly.exterior.coords))

    built = [Polygon(shell, holes=holes) for shell, holes in exteriors]
    if len(built) == 1:
        result = built[0]
    else:
        result = MultiPolygon(built)

    return _repair(result)


def _path_to_rings(path: SVGPath) -> list[list[tuple[float, float]]]:
    """Flatten an SVGPath into a list of rings (closed coordinate loops).

    Each 'M' command starts a new ring. svgelements' .as_points() samples any
    curved segments at an internal default error tolerance.
    """
    d = path.d() or ""
    segments = _split_on_moveto(d)
    rings: list[list[tuple[float, float]]] = []
    for seg_d in segments:
        try:
            seg_path = SVGPath(seg_d)
        except Exception:
            continue
        pts = [(float(p[0]), float(p[1])) for p in seg_path.as_points()]
        if len(pts) >= 3:
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            rings.append(pts)
    return rings


_MOVE_RE = re.compile(r"([Mm])")


def _split_on_moveto(d: str) -> list[str]:
    """Split a path d-string into subpaths, each starting with an M/m command."""
    if not d.strip():
        return []
    tokens = _MOVE_RE.split(d)
    # _MOVE_RE.split returns ['', 'M', 'body', 'M', 'body', ...]
    segments: list[str] = []
    i = 1
    while i < len(tokens):
        segments.append(tokens[i] + tokens[i + 1])
        i += 2
    return segments


def _repair(geom):
    """Run make_valid on the result. If it returns a GeometryCollection, extract polygons."""
    g = make_valid(geom)
    if g.geom_type == "Polygon" or g.geom_type == "MultiPolygon":
        return g
    # Filter to polygon parts only.
    polys = [sub for sub in getattr(g, "geoms", []) if sub.geom_type in ("Polygon", "MultiPolygon")]
    if not polys:
        return Polygon()
    if len(polys) == 1:
        return polys[0]
    return unary_union(polys)
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pytest tests/test_hatch.py -v`
Expected: 4 PASS.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/hatch.py tests/test_hatch.py
git commit -m "Add svg_d_to_polygon with compound-path and fillRule support"
```

---

### Task 5: `hatch.py` — `generate_hatch_segments` with uniform params (no ramps)

Produce a list of `Line` instances by intersecting horizontal scan lines with a shapely polygon, then rotating back to the hatch angle. Uniform params per segment (ramps added next task).

**Files:**
- Modify: `src/xcs_gen/hatch.py` (append)
- Modify: `tests/test_hatch.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_hatch.py`:

```python
from xcs_gen.model import Line, ProcessingParams
from xcs_gen.svg_source import HatchPass
from xcs_gen.hatch import generate_hatch_segments


def _square_polygon():
    return svg_d_to_polygon("M 0,0 L 10,0 L 10,10 L 0,10 Z", fill_rule="evenodd")


def test_hatch_segments_horizontal_square_count():
    poly = _square_polygon()
    hp = HatchPass(angle=0.0, spacing=1.0)
    base = ProcessingParams(power=50)
    segs = generate_hatch_segments(poly, hp, layer_color="#ff0000", fallback_params=base)
    # 10mm tall, spacing 1mm → lines at y=0.5, 1.5, ..., 9.5 → 10 segments.
    assert len(segs) == 10
    for s in segs:
        assert isinstance(s, Line)
        assert s.layer_color == "#ff0000"
        assert s.params is not None
        assert s.params.power == 50
        assert s.processing_type == "VECTOR_ENGRAVING"
        assert abs(s.length - 10.0) < 1e-6
        assert abs(s.angle - 0.0) < 1e-6


def test_hatch_segments_vertical_square():
    poly = _square_polygon()
    hp = HatchPass(angle=90.0, spacing=1.0)
    base = ProcessingParams()
    segs = generate_hatch_segments(poly, hp, layer_color="#00ff00", fallback_params=base)
    assert len(segs) == 10
    for s in segs:
        assert abs(s.length - 10.0) < 1e-6
        assert abs(s.angle - 90.0) < 1e-6


def test_hatch_segments_donut_produces_two_per_line():
    d = "M 0,0 L 20,0 L 20,20 L 0,20 Z M 7.5,7.5 L 12.5,7.5 L 12.5,12.5 L 7.5,12.5 Z"
    poly = svg_d_to_polygon(d, fill_rule="evenodd")
    hp = HatchPass(angle=0.0, spacing=1.0)
    segs = generate_hatch_segments(poly, hp, layer_color="#0000ff", fallback_params=ProcessingParams())
    # Lines crossing the hole (y in 7.5..12.5) split into 2 segments; lines
    # outside are single segments. Expect more segments than 20 (the line count).
    assert len(segs) > 20


def test_hatch_segments_empty_when_shape_too_small():
    poly = svg_d_to_polygon("M 0,0 L 0.1,0 L 0.1,0.1 L 0,0.1 Z", fill_rule="evenodd")
    hp = HatchPass(angle=0.0, spacing=1.0)
    segs = generate_hatch_segments(poly, hp, layer_color="#aaaaaa", fallback_params=ProcessingParams())
    assert segs == []


def test_hatch_segments_uses_pass_base_params_when_set():
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        base_params=ProcessingParams(power=99),
    )
    fallback = ProcessingParams(power=10)
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=fallback)
    assert all(s.params.power == 99 for s in segs)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_hatch.py -v`
Expected: the 5 new tests fail (ImportError on `generate_hatch_segments`).

- [ ] **Step 3: Implement `generate_hatch_segments`**

Append to `src/xcs_gen/hatch.py`:

```python
import math
from dataclasses import replace

from .model import Line, ProcessingParams


def generate_hatch_segments(
    polygon: Polygon | MultiPolygon,
    hatch_pass,  # HatchPass
    *,
    layer_color: str,
    fallback_params: ProcessingParams,
) -> list[Line]:
    """Produce clipped Line segments for one pass through one polygon.

    Each segment is one Line instance, carrying the per-segment params and
    processing_type='VECTOR_ENGRAVING'. The caller appends these to
    XCSProject.extra_displays and extra_device_entries.
    """
    if polygon.is_empty:
        return []

    base = hatch_pass.base_params or fallback_params
    angle = hatch_pass.angle
    spacing = hatch_pass.spacing
    if spacing <= 0:
        return []

    # Rotate polygon so the hatch lines become horizontal.
    rotated = _rotate_polygon(polygon, -angle)
    if rotated.is_empty:
        return []
    minx, miny, maxx, maxy = rotated.bounds
    if maxx - minx < spacing or maxy - miny < spacing:
        # Shape smaller than one hatch spacing in either direction → no lines.
        return []

    # Walk y from bottom to top in the rotated frame.
    y = miny + spacing / 2.0
    lines: list[Line] = []
    while y < maxy:
        scan = LineString([(minx - 1.0, y), (maxx + 1.0, y)])
        clipped = rotated.intersection(scan)
        for seg in _iter_linestrings(clipped):
            line = _segment_to_line(
                seg, angle=angle, layer_color=layer_color, params=_copy_params(base),
            )
            if line is not None:
                lines.append(line)
        y += spacing

    return lines


def _rotate_polygon(polygon: Polygon | MultiPolygon, angle_deg: float):
    from shapely.affinity import rotate
    return rotate(polygon, angle_deg, origin=(0, 0), use_radians=False)


def _iter_linestrings(geom):
    """Yield LineString parts from whatever shapely.intersection returned."""
    if geom.is_empty:
        return
    if isinstance(geom, LineString):
        yield geom
        return
    if isinstance(geom, MultiLineString):
        yield from geom.geoms
        return
    # GeometryCollection: extract LineString parts only.
    for sub in getattr(geom, "geoms", []):
        if isinstance(sub, LineString):
            yield sub


def _segment_to_line(
    seg: LineString,
    *,
    angle: float,
    layer_color: str,
    params: ProcessingParams,
) -> Line | None:
    coords = list(seg.coords)
    if len(coords) < 2:
        return None
    # Segment is in the rotated frame (horizontal). Length is the x-extent.
    x0_rot, y_rot = coords[0]
    x1_rot, _ = coords[-1]
    length = abs(x1_rot - x0_rot)
    if length <= 0:
        return None

    # Rotate the start point back to original bed-mm frame.
    rad = math.radians(angle)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    start_x = cos_a * x0_rot - sin_a * y_rot
    start_y = sin_a * x0_rot + cos_a * y_rot

    return Line(
        x=start_x, y=start_y, length=length, angle=angle,
        layer_color=layer_color,
        params=params,
        processing_type="VECTOR_ENGRAVING",
    )


def _copy_params(p: ProcessingParams) -> ProcessingParams:
    return replace(p)
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_hatch.py -v`
Expected: all tests PASS.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/hatch.py tests/test_hatch.py
git commit -m "Add generate_hatch_segments with uniform per-pass params"
```

---

### Task 6: `hatch.py` — per-segment parameter ramps

Apply `HatchRamp` entries to each segment: project the midpoint onto the ramp axis, normalize within the polygon's extent on that axis, linearly interpolate min→max, write the result into the segment's params.

**Files:**
- Modify: `src/xcs_gen/hatch.py`
- Modify: `tests/test_hatch.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_hatch.py`:

```python
from xcs_gen.svg_source import HatchRamp


def test_hatch_ramp_power_perp_axis():
    """Power ramps from 30 at bottom to 70 at top (axis=perp for angle=0)."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        ramps=[HatchRamp(param="power", axis="perp", min_value=30, max_value=70)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=ProcessingParams())
    assert len(segs) == 10
    powers = [s.params.power for s in segs]
    # Monotonically increasing from near-30 to near-70.
    assert abs(powers[0] - 32.0) < 0.5   # first midpoint at y=0.5 in a 10-tall bbox → ~32
    assert abs(powers[-1] - 68.0) < 0.5  # last midpoint at y=9.5 → ~68
    for i in range(1, len(powers)):
        assert powers[i] > powers[i - 1]


def test_hatch_ramp_power_y_axis_ignores_angle():
    """axis='y' projects the midpoint onto the bbox y, regardless of hatch angle."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=45.0, spacing=1.0,
        ramps=[HatchRamp(param="power", axis="y", min_value=10, max_value=90)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=ProcessingParams())
    assert len(segs) > 0
    # Segment midpoints with smaller world-space y get smaller power.
    sorted_segs = sorted(segs, key=lambda s: s.y + (math.sin(math.radians(s.angle)) * s.length / 2))
    powers_low_to_high = [s.params.power for s in sorted_segs]
    assert powers_low_to_high[0] < powers_low_to_high[-1]


def test_hatch_ramp_int_field_rounded():
    """Ramp on an int field (e.g. speed) produces rounded int values."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        ramps=[HatchRamp(param="speed", axis="perp", min_value=500, max_value=1500)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ff0000", fallback_params=ProcessingParams())
    for s in segs:
        assert isinstance(s.params.speed, int)


import math  # noqa: E402 — used in test_hatch_ramp_power_y_axis_ignores_angle
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_hatch.py -v`
Expected: the new tests fail (ramps aren't applied yet — power stays at fallback).

- [ ] **Step 3: Apply ramps inside `generate_hatch_segments`**

Edit `src/xcs_gen/hatch.py`. Replace the body of `generate_hatch_segments` (after the existing setup that creates `base`, `angle`, `spacing`, `rotated`, `minx/miny/maxx/maxy`) with:

Find the existing `while y < maxy:` loop. Replace it with:

```python
    # Precompute world-space bbox for ramps that use x/y axes.
    world_minx, world_miny, world_maxx, world_maxy = polygon.bounds
    # For perp/parallel, we work in the rotated frame (perp = y in rotated coords).

    y = miny + spacing / 2.0
    lines: list[Line] = []
    while y < maxy:
        scan = LineString([(minx - 1.0, y), (maxx + 1.0, y)])
        clipped = rotated.intersection(scan)
        for seg in _iter_linestrings(clipped):
            mid_rot = seg.interpolate(0.5, normalized=True)
            mid_rot_xy = (mid_rot.x, mid_rot.y)
            # World-space midpoint (rotate back) for x/y ramps.
            rad = math.radians(angle)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            mid_world = (
                cos_a * mid_rot_xy[0] - sin_a * mid_rot_xy[1],
                sin_a * mid_rot_xy[0] + cos_a * mid_rot_xy[1],
            )

            params = _copy_params(base)
            for ramp in hatch_pass.ramps:
                if ramp.param == "spacing":
                    continue  # handled by spacing walk (Task 7); ignored here.
                pos = _ramp_position(
                    ramp=ramp,
                    mid_rot=mid_rot_xy, mid_world=mid_world,
                    rot_bounds=(minx, miny, maxx, maxy),
                    world_bounds=(world_minx, world_miny, world_maxx, world_maxy),
                )
                value = ramp.min_value + pos * (ramp.max_value - ramp.min_value)
                _set_param_on(params, ramp.param, value)

            line = _segment_to_line(
                seg, angle=angle, layer_color=layer_color, params=params,
            )
            if line is not None:
                lines.append(line)
        y += spacing

    return lines
```

Then append these new helpers at the end of `hatch.py`:

```python
def _ramp_position(
    *,
    ramp,  # HatchRamp
    mid_rot: tuple[float, float],
    mid_world: tuple[float, float],
    rot_bounds: tuple[float, float, float, float],
    world_bounds: tuple[float, float, float, float],
) -> float:
    """Return a 0..1 position for the midpoint along the ramp's axis."""
    if ramp.axis == "perp":
        # Perpendicular to hatch direction == y in rotated frame.
        lo, hi = rot_bounds[1], rot_bounds[3]
        v = mid_rot[1]
    elif ramp.axis == "parallel":
        lo, hi = rot_bounds[0], rot_bounds[2]
        v = mid_rot[0]
    elif ramp.axis == "x":
        lo, hi = world_bounds[0], world_bounds[2]
        v = mid_world[0]
    elif ramp.axis == "y":
        lo, hi = world_bounds[1], world_bounds[3]
        v = mid_world[1]
    else:
        return 0.0
    span = hi - lo
    if span <= 0:
        return 0.0
    t = (v - lo) / span
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return t


_INT_PARAM_FIELDS = {"speed", "density", "passes", "pulse_width"}


def _set_param_on(params: ProcessingParams, name: str, value: float) -> None:
    """Write a ramped value into a ProcessingParams field. 'passes' maps to 'repeat'."""
    attr = "repeat" if name == "passes" else name
    if name == "frequency":
        attr = "mopa_frequency"
    is_int = name in _INT_PARAM_FIELDS
    setattr(params, attr, int(round(value)) if is_int else value)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_hatch.py -v`
Expected: all new tests PASS.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/hatch.py tests/test_hatch.py
git commit -m "Add per-segment HatchRamp parameter interpolation"
```

---

### Task 7: `hatch.py` — rampable spacing

When a `HatchRamp(param="spacing", ...)` is present, the line-placement walk uses the interpolated spacing at each step instead of `hatch_pass.spacing`.

**Files:**
- Modify: `src/xcs_gen/hatch.py`
- Modify: `tests/test_hatch.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_hatch.py`:

```python
def test_hatch_spacing_ramp_produces_variable_spacing():
    """With spacing ramping 1.0 -> 0.2 along perp, more lines pack near the 'max' end."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,  # spacing field is a fallback when no spacing-ramp
        ramps=[HatchRamp(param="spacing", axis="perp", min_value=1.0, max_value=0.2)],
    )
    segs = generate_hatch_segments(poly, hp, layer_color="#ffd73e", fallback_params=ProcessingParams())
    # Without a spacing ramp: 10 segments. With ramp: should be strictly more.
    assert len(segs) > 10
    # Verify line density is higher near y=10 (the 'max_value' end).
    ys = sorted(s.y for s in segs)
    mid = len(ys) // 2
    upper_half_count = sum(1 for y in ys if y > ys[mid])
    lower_half_count = sum(1 for y in ys if y <= ys[mid])
    # Lines closer together near the top → half-by-count both sides, but the
    # upper half (small spacing) spans less y distance.
    upper_y_span = ys[-1] - ys[mid]
    lower_y_span = ys[mid] - ys[0]
    assert upper_y_span < lower_y_span


def test_hatch_spacing_ramp_clamped_to_min():
    """A spacing ramp that would go to zero is clamped at min_spacing."""
    poly = _square_polygon()
    hp = HatchPass(
        angle=0.0, spacing=1.0,
        ramps=[HatchRamp(param="spacing", axis="perp", min_value=1.0, max_value=0.001)],
    )
    segs = generate_hatch_segments(
        poly, hp, layer_color="#ffd73e",
        fallback_params=ProcessingParams(),
    )
    # With min_spacing default 0.01, the ramp clamps and we get finite segments.
    # Without clamping, this would hang in an infinite loop.
    assert len(segs) > 0
    assert len(segs) < 10000  # sanity upper bound
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_hatch.py -v`
Expected: tests fail (or hang, so be prepared to Ctrl-C if local). If you're worried about hangs, run with `--timeout 10` to fail fast.

- [ ] **Step 3: Implement spacing ramps**

Edit `src/xcs_gen/hatch.py`. Find `generate_hatch_segments`. Before the `while y < maxy:` loop, find the spacing-ramp (if any):

Replace the start-y / walk-setup:

```python
    y = miny + spacing / 2.0
    lines: list[Line] = []
    while y < maxy:
```

with:

```python
    spacing_ramp = next(
        (r for r in hatch_pass.ramps if r.param == "spacing"), None
    )

    y = miny
    lines: list[Line] = []
    min_spacing = 0.01  # floor to prevent hangs; matches CLI --min-spacing default
    while y < maxy:
        step = spacing
        if spacing_ramp is not None:
            # Compute spacing at the current y in the rotated frame.
            pos = _ramp_position(
                ramp=spacing_ramp,
                mid_rot=(minx + (maxx - minx) / 2, y),
                mid_world=(0, 0),  # unused for perp/parallel axes
                rot_bounds=(minx, miny, maxx, maxy),
                world_bounds=(world_minx, world_miny, world_maxx, world_maxy),
            )
            step = spacing_ramp.min_value + pos * (spacing_ramp.max_value - spacing_ramp.min_value)
            if step < min_spacing:
                step = min_spacing
        # Center the line within its step band so placement is symmetric.
        y_center = y + step / 2
        if y_center >= maxy:
            break
```

Then change the rest of the loop body:

```python
        scan = LineString([(minx - 1.0, y_center), (maxx + 1.0, y_center)])
        clipped = rotated.intersection(scan)
        for seg in _iter_linestrings(clipped):
            mid_rot = seg.interpolate(0.5, normalized=True)
            mid_rot_xy = (mid_rot.x, mid_rot.y)
            rad = math.radians(angle)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            mid_world = (
                cos_a * mid_rot_xy[0] - sin_a * mid_rot_xy[1],
                sin_a * mid_rot_xy[0] + cos_a * mid_rot_xy[1],
            )

            params = _copy_params(base)
            for ramp in hatch_pass.ramps:
                if ramp.param == "spacing":
                    continue
                pos = _ramp_position(
                    ramp=ramp,
                    mid_rot=mid_rot_xy, mid_world=mid_world,
                    rot_bounds=(minx, miny, maxx, maxy),
                    world_bounds=(world_minx, world_miny, world_maxx, world_maxy),
                )
                value = ramp.min_value + pos * (ramp.max_value - ramp.min_value)
                _set_param_on(params, ramp.param, value)

            line = _segment_to_line(
                seg, angle=angle, layer_color=layer_color, params=params,
            )
            if line is not None:
                lines.append(line)
        y += step

    return lines
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_hatch.py -v --timeout 10`
Expected: all PASS within the 10-second timeout.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/hatch.py tests/test_hatch.py
git commit -m "Add rampable spacing with min-spacing floor"
```

---

### Task 8: Wire hatched dispatch into `generate_from_svg`

For each shape, if its assigned render mode is `hatched`, route through the hatch generator and append Lines to `extra_displays`/`extra_device_entries`. Otherwise keep the v1 Path emission. Reject `hatched` on stroke layers with a clear `ValueError`.

**Files:**
- Modify: `src/xcs_gen/generators.py`
- Modify: `tests/test_svg_generator.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_svg_generator.py`:

```python
def test_generate_from_svg_hatched_layer_emits_lines(tmp_path):
    """A hatched layer emits Lines into extra_displays/extra_device_entries."""
    path = _write(TWO_COLOR)
    from xcs_gen.svg_source import HatchPass
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        layer_config={
            "#000000": LayerConfig(
                params=ProcessingParams(),
                render_mode="hatched",
                hatch_passes=[HatchPass(angle=0, spacing=1.0)],
            ),
            "#ffffff": LayerConfig(
                params=ProcessingParams(),
                render_mode="fill_engrave",
            ),
        },
    )
    # The black half gets hatched; should produce many LINE displays.
    line_displays = [d for d in project.extra_displays if d.get("type") == "LINE"]
    assert len(line_displays) > 0
    # There should be matching device entries by id.
    line_ids = {d["id"] for d in line_displays}
    entry_ids = {eid for eid, _ in project.extra_device_entries}
    assert line_ids.issubset(entry_ids)


def test_generate_from_svg_rejects_hatched_on_stroke_layer():
    """A color that only appears as a stroke cannot have render_mode='hatched'."""
    import pytest
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10">
  <rect x="0" y="0" width="5" height="5" fill="none" stroke="#ff0000"/>
</svg>
"""
    path = _write(content)
    from xcs_gen.svg_source import HatchPass
    with pytest.raises(ValueError, match="stroke"):
        generate_from_svg(
            svg_path=path,
            total_width=100.0,
            layer_config={
                "#ff0000": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="hatched",
                    hatch_passes=[HatchPass(angle=0, spacing=1.0)],
                ),
            },
        )
```

Where `TWO_COLOR` in `tests/test_svg_generator.py` is already defined as a helper — verify that black and white are the two fill colors. If the existing `TWO_COLOR` is not suitable, the first test's setup can write a fresh inline SVG instead.

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_svg_generator.py -v`
Expected: both new tests fail (no LINE displays produced; ValueError not raised).

- [ ] **Step 3: Dispatch hatched shapes in `generate_from_svg`**

Edit `src/xcs_gen/generators.py`. Find `generate_from_svg`. Replace the existing final loop (that appends `Path` entries for each shape per layer) with a dispatching version. Find:

```python
    project = XCSProject()
    for shape in parse_result.shapes:
        for color, is_fill_layer in _layers_for(shape):
            layer = assignment[color]
            project.paths.append(Path(
                d=shape.d,
                x=shape.bbox_x_mm,
                y=shape.bbox_y_mm,
                width=shape.bbox_width_mm,
                height=shape.bbox_height_mm,
                is_close_path=shape.is_close_path,
                fill_rule=shape.fill_rule,
                params=layer.params,
                processing_type=layer.processing_type,
                is_fill=is_fill_layer,
                layer_color=color,
            ))

    return project
```

Replace with:

```python
    from .hatch import generate_hatch_segments, svg_d_to_polygon
    from .builder import build_device_entry, build_line_display

    project = XCSProject()
    for shape in parse_result.shapes:
        for color, is_fill_layer in _layers_for(shape):
            layer = assignment[color]
            if layer.render_mode == "hatched":
                if not is_fill_layer:
                    raise ValueError(
                        f"layer {color!r} has render_mode='hatched' but this "
                        "shape uses the color as a stroke. Hatched fills only "
                        "make sense on fill layers; use 'vector_engrave' or "
                        "'vector_cut' for stroke layers."
                    )
                cfg = layer_config_for(layer_config, color) if layer_config else None
                polygon = svg_d_to_polygon(shape.d, fill_rule=shape.fill_rule)
                passes = (cfg.hatch_passes if cfg else [])
                for hp in passes:
                    segments = generate_hatch_segments(
                        polygon, hp,
                        layer_color=color,
                        fallback_params=layer.params,
                    )
                    for seg in segments:
                        project.extra_displays.append(build_line_display(seg))
                        project.extra_device_entries.append(
                            build_device_entry(
                                seg.id, "LINE",
                                seg.processing_type,
                                seg.params or layer.params,
                            )
                        )
            else:
                project.paths.append(Path(
                    d=shape.d,
                    x=shape.bbox_x_mm,
                    y=shape.bbox_y_mm,
                    width=shape.bbox_width_mm,
                    height=shape.bbox_height_mm,
                    is_close_path=shape.is_close_path,
                    fill_rule=shape.fill_rule,
                    params=layer.params,
                    processing_type=layer.processing_type,
                    is_fill=is_fill_layer,
                    layer_color=color,
                ))

    return project


def layer_config_for(layer_config, color: str):
    """Helper: safe lookup of a LayerConfig by color (or None)."""
    if layer_config is None:
        return None
    return layer_config.get(color)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_svg_generator.py -v`
Expected: both new tests PASS, previous tests still pass.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/generators.py tests/test_svg_generator.py
git commit -m "Dispatch hatched shapes through hatch generator; reject on stroke"
```

---

### Task 9: `svg_config.py` — YAML config loader

Parse the YAML structure described in the spec into `LayerConfig` / `HatchPass` / `HatchRamp` / `AutoRamp` dataclasses. Return a `(layer_config, auto_ramp, defaults)` triple.

**Files:**
- Create: `src/xcs_gen/svg_config.py`
- Create: `tests/test_svg_config.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_svg_config.py`:

```python
"""Tests for the YAML config loader."""

import tempfile

import pytest
import yaml

from xcs_gen.model import ProcessingParams
from xcs_gen.svg_config import LoadedConfig, load_svg_config
from xcs_gen.svg_source import HatchPass, HatchRamp, LayerConfig


def _write_yaml(data) -> str:
    path = tempfile.mktemp(suffix=".yaml")
    with open(path, "w") as f:
        yaml.safe_dump(data, f)
    return path


def test_load_svg_config_simple_non_hatched():
    cfg_path = _write_yaml({
        "defaults": {"power": 60, "speed": 800},
        "layers": {
            "#000000": {"render_mode": "vector_cut", "speed": 500, "power": 80},
        },
    })
    result = load_svg_config(cfg_path)
    assert isinstance(result, LoadedConfig)
    assert result.defaults.power == 60
    assert result.defaults.speed == 800
    black = result.layer_config["#000000"]
    assert black.render_mode == "vector_cut"
    assert black.params.speed == 500
    assert black.params.power == 80
    assert black.hatch_passes == []


def test_load_svg_config_hatched_with_multi_pass_ramps():
    cfg_path = _write_yaml({
        "layers": {
            "#ffd73e": {
                "render_mode": "hatched",
                "hatch_passes": [
                    {
                        "angle": 0,
                        "spacing": 0.4,
                        "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}],
                    },
                    {
                        "angle": 90,
                        "spacing": 0.4,
                        "power": 55,
                        "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}],
                    },
                ],
            },
        },
    })
    result = load_svg_config(cfg_path)
    yellow = result.layer_config["#ffd73e"]
    assert yellow.render_mode == "hatched"
    assert len(yellow.hatch_passes) == 2
    p0 = yellow.hatch_passes[0]
    assert p0.angle == 0
    assert p0.spacing == 0.4
    assert len(p0.ramps) == 1
    assert p0.ramps[0].param == "power"
    assert p0.ramps[0].axis == "perp"
    assert p0.ramps[0].min_value == 30
    assert p0.ramps[0].max_value == 70
    # Second pass has a per-pass override for power.
    p1 = yellow.hatch_passes[1]
    assert p1.base_params is not None
    assert p1.base_params.power == 55


def test_load_svg_config_with_auto_ramp():
    cfg_path = _write_yaml({
        "auto_ramp": {
            "param": "power", "min": 20, "max": 80,
            "sort_by": "luminance", "default_render_mode": "fill_engrave",
        },
    })
    result = load_svg_config(cfg_path)
    assert result.auto_ramp is not None
    assert result.auto_ramp.param == "power"
    assert result.auto_ramp.min_value == 20
    assert result.auto_ramp.max_value == 80
    assert result.auto_ramp.sort_by == "luminance"


def test_load_svg_config_rejects_bad_render_mode():
    cfg_path = _write_yaml({
        "layers": {"#000000": {"render_mode": "lightsaber"}},
    })
    with pytest.raises(ValueError, match="render_mode"):
        load_svg_config(cfg_path)


def test_load_svg_config_rejects_bad_axis():
    cfg_path = _write_yaml({
        "layers": {
            "#000000": {
                "render_mode": "hatched",
                "hatch_passes": [
                    {"angle": 0, "spacing": 0.4,
                     "ramps": [{"param": "power", "axis": "sideways", "min": 0, "max": 1}]},
                ],
            },
        },
    })
    with pytest.raises(ValueError, match="axis"):
        load_svg_config(cfg_path)


def test_load_svg_config_normalizes_hex_case():
    cfg_path = _write_yaml({
        "layers": {"#FFD73E": {"render_mode": "fill_engrave"}},
    })
    result = load_svg_config(cfg_path)
    assert "#ffd73e" in result.layer_config
    assert "#FFD73E" not in result.layer_config
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_svg_config.py -v`
Expected: ImportError on `svg_config`.

- [ ] **Step 3: Implement `svg_config.py`**

Create `src/xcs_gen/svg_config.py`:

```python
"""YAML config loader for the svg generate CLI.

Compiles a YAML file into LayerConfig / HatchPass / HatchRamp / AutoRamp
dataclasses — the exact same shape the Python API accepts.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import yaml

from .model import ProcessingParams
from .svg_source import (
    AutoRamp,
    HatchPass,
    HatchRamp,
    LayerConfig,
    RampAxis,
    RenderMode,
)


_PARAM_FIELDS = {
    "speed", "power", "frequency", "density", "passes",
    "pulse_width", "laser", "dpi",
}
_VALID_RENDER_MODES = {"fill_engrave", "vector_engrave", "vector_cut", "hatched"}
_VALID_AXES = {"perp", "parallel", "x", "y"}
_VALID_SORT_BY = {"luminance", "hue", "order_of_appearance"}


@dataclass
class LoadedConfig:
    """Result of parsing a YAML svg config file."""

    defaults: ProcessingParams = field(default_factory=ProcessingParams)
    layer_config: dict[str, LayerConfig] = field(default_factory=dict)
    auto_ramp: AutoRamp | None = None


def load_svg_config(path: str) -> LoadedConfig:
    """Load and validate a YAML config file."""
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"config {path!r}: top-level must be a mapping")

    defaults = _params_from_flat(raw.get("defaults") or {}, base=ProcessingParams())

    layer_config: dict[str, LayerConfig] = {}
    for color, entry in (raw.get("layers") or {}).items():
        key = color.lower() if isinstance(color, str) else color
        layer_config[key] = _build_layer_config(key, entry, defaults)

    auto_ramp = None
    ar = raw.get("auto_ramp")
    if ar is not None:
        auto_ramp = _build_auto_ramp(ar)

    return LoadedConfig(defaults=defaults, layer_config=layer_config, auto_ramp=auto_ramp)


def _params_from_flat(data: dict, *, base: ProcessingParams) -> ProcessingParams:
    """Merge a flat ProcessingParams-like dict onto a base."""
    params = replace(base)
    for key, value in data.items():
        if key == "laser":
            params.processing_light_source = str(value)
            continue
        if key == "frequency":
            params.mopa_frequency = int(value)
            continue
        if key == "passes":
            params.repeat = int(value)
            continue
        if key not in _PARAM_FIELDS and key not in ("render_mode", "hatch_passes"):
            continue
        if not hasattr(params, key):
            continue
        current = getattr(params, key)
        setattr(params, key, type(current)(value))
    return params


def _build_layer_config(color: str, entry: dict, defaults: ProcessingParams) -> LayerConfig:
    if not isinstance(entry, dict):
        raise ValueError(f"layer {color!r}: must be a mapping")
    render_mode = entry.get("render_mode", "fill_engrave")
    if render_mode not in _VALID_RENDER_MODES:
        raise ValueError(
            f"layer {color!r}: invalid render_mode {render_mode!r}. "
            f"Valid: {sorted(_VALID_RENDER_MODES)}"
        )
    params = _params_from_flat(entry, base=defaults)
    hatch_passes: list[HatchPass] = []
    for i, hp in enumerate(entry.get("hatch_passes") or []):
        hatch_passes.append(_build_hatch_pass(color, i, hp, defaults))
    return LayerConfig(
        params=params,
        render_mode=render_mode,  # type: ignore[arg-type]
        hatch_passes=hatch_passes,
    )


def _build_hatch_pass(color: str, index: int, entry: dict, defaults: ProcessingParams) -> HatchPass:
    if not isinstance(entry, dict):
        raise ValueError(f"layer {color!r} pass {index}: must be a mapping")
    angle = float(entry.get("angle", 0.0))
    spacing = float(entry.get("spacing", 0.5))

    per_pass_overrides = {k: v for k, v in entry.items() if k in _PARAM_FIELDS}
    base_params = None
    if per_pass_overrides:
        base_params = _params_from_flat(per_pass_overrides, base=defaults)

    ramps: list[HatchRamp] = []
    for j, rentry in enumerate(entry.get("ramps") or []):
        ramps.append(_build_hatch_ramp(color, index, j, rentry))

    return HatchPass(angle=angle, spacing=spacing, base_params=base_params, ramps=ramps)


def _build_hatch_ramp(color: str, pass_idx: int, ramp_idx: int, entry: dict) -> HatchRamp:
    if not isinstance(entry, dict):
        raise ValueError(
            f"layer {color!r} pass {pass_idx} ramp {ramp_idx}: must be a mapping"
        )
    param = entry.get("param")
    axis = entry.get("axis")
    if axis not in _VALID_AXES:
        raise ValueError(
            f"layer {color!r} pass {pass_idx} ramp {ramp_idx}: "
            f"invalid axis {axis!r}. Valid: {sorted(_VALID_AXES)}"
        )
    min_value = float(entry.get("min", 0.0))
    max_value = float(entry.get("max", 0.0))
    return HatchRamp(
        param=str(param),
        axis=axis,  # type: ignore[arg-type]
        min_value=min_value,
        max_value=max_value,
    )


def _build_auto_ramp(entry: dict) -> AutoRamp:
    sort_by = entry.get("sort_by", "luminance")
    if sort_by not in _VALID_SORT_BY:
        raise ValueError(
            f"auto_ramp.sort_by {sort_by!r} invalid. Valid: {sorted(_VALID_SORT_BY)}"
        )
    default_render_mode = entry.get("default_render_mode", "fill_engrave")
    if default_render_mode not in _VALID_RENDER_MODES:
        raise ValueError(
            f"auto_ramp.default_render_mode {default_render_mode!r} invalid."
        )
    return AutoRamp(
        param=str(entry.get("param")),
        min_value=float(entry.get("min", 0.0)),
        max_value=float(entry.get("max", 0.0)),
        sort_by=sort_by,  # type: ignore[arg-type]
        default_render_mode=default_render_mode,  # type: ignore[arg-type]
    )
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_svg_config.py -v`
Expected: all PASS.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/svg_config.py tests/test_svg_config.py
git commit -m "Add svg_config YAML loader producing LayerConfig dataclasses"
```

---

### Task 10: CLI `--hatch` flag

Repeatable flag. Each `--hatch` value describes one pass. Multiple `--hatch` flags with the same color compose into a multi-pass layer. Parsed into `LayerConfig(render_mode="hatched", hatch_passes=[...])`.

**Files:**
- Modify: `src/xcs_gen/cli.py`
- Modify: `tests/test_svg_cli.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_svg_cli.py`:

```python
def test_svg_generate_single_hatch_flag(tmp_path):
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")
    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--hatch", "#000000:angle=0,spacing=1.0:power=perp:30:70",
        "--color", "#ffffff:fill_engrave:1000,30,65,100,1,200",
    ])
    with open(out_path) as f:
        data = json.load(f)
    displays = data["canvas"][0]["displays"]
    types = [d["type"] for d in displays]
    # Hatched layer produces many LINE displays.
    assert types.count("LINE") > 0


def test_svg_generate_multi_pass_cross_hatch(tmp_path):
    """Two --hatch flags with the same color compose into cross-hatching."""
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")
    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--hatch", "#000000:angle=0,spacing=1.0:power=perp:30:70",
        "--hatch", "#000000:angle=90,spacing=1.0:power=perp:30:70",
        "--color", "#ffffff:fill_engrave:1000,30,65,100,1,200",
    ])
    with open(out_path) as f:
        data = json.load(f)
    displays = data["canvas"][0]["displays"]
    lines = [d for d in displays if d["type"] == "LINE"]
    # Two passes on the black half → roughly 2× the line count of a single pass.
    # Just assert it's substantial.
    assert len(lines) > 10
    # At least one line at angle=0 and one at angle=90.
    angles = {round(d["angle"], 1) for d in lines}
    assert 0.0 in angles
    assert 90.0 in angles
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_svg_cli.py -v`
Expected: new tests fail (argparse rejects `--hatch`).

- [ ] **Step 3: Add `--hatch` argparse argument**

Edit `src/xcs_gen/cli.py`. Find the `svg_gen_p` subparser definitions. After the block that adds `--color` (around the existing explicit-per-color section), add:

```python
    svg_gen_p.add_argument(
        "--hatch", action="append", default=[], dest="hatch_overrides",
        help=(
            "Per-colour hatched pass: '<hex>:<key=val,key=val,...>:<ramp>:<ramp>...'. "
            "Pass-level keys: angle, spacing, power, speed, frequency, density, "
            "passes, pulse_width. Each ramp is '<param>=<axis>:<min>:<max>'. "
            "Repeat the flag with the same colour for multi-pass cross-hatching."
        ),
    )
```

- [ ] **Step 4: Implement `_parse_hatch_override`**

Still in `src/xcs_gen/cli.py`, append this helper near `_parse_color_override`:

```python
def _parse_hatch_override(override: str, base):
    """Parse a --hatch flag value into (color, HatchPass).

    Format: '<hex>:<key=val,key=val,...>:<ramp>:<ramp>...'
    Each ramp is '<param>=<axis>:<min>:<max>'.
    """
    from .model import ProcessingParams
    from .svg_source import HatchPass, HatchRamp

    try:
        hex_part, pass_kv_part, *ramp_parts = override.split(":")
    except ValueError:
        raise SystemExit(
            f"Invalid --hatch value {override!r}. "
            "Expected '<hex>:<key=val,...>:<ramp1>:<ramp2>...'"
        )

    color = hex_part.strip().lower()
    if not (color.startswith("#") and len(color) == 7):
        raise SystemExit(f"Invalid hex colour in --hatch: {hex_part!r}")

    angle = 0.0
    spacing = 0.5
    param_overrides: dict[str, object] = {}
    for kv in pass_kv_part.split(","):
        kv = kv.strip()
        if not kv:
            continue
        if "=" not in kv:
            raise SystemExit(f"Invalid --hatch pass key '{kv}' in {override!r}")
        k, v = kv.split("=", 1)
        if k == "angle":
            angle = float(v)
        elif k == "spacing":
            spacing = float(v)
        else:
            param_overrides[k] = v

    ramps: list[HatchRamp] = []
    for ramp in ramp_parts:
        # '<param>=<axis>:<min>:<max>' — but because we already split on ':',
        # a ramp is actually received as three separate strings in ramp_parts:
        # e.g. "power=perp", "30", "70"
        # So we reassemble by grouping triples.
        pass  # handled below

    # Re-group ramps from ramp_parts into triples.
    if len(ramp_parts) % 3 != 0:
        raise SystemExit(
            f"Invalid --hatch {override!r}: ramp sections must be "
            "'<param>=<axis>:<min>:<max>' (three colons per ramp)."
        )
    for i in range(0, len(ramp_parts), 3):
        head = ramp_parts[i]
        if "=" not in head:
            raise SystemExit(f"Invalid ramp head {head!r} in --hatch {override!r}")
        param, axis = head.split("=", 1)
        try:
            min_v = float(ramp_parts[i + 1])
            max_v = float(ramp_parts[i + 2])
        except ValueError:
            raise SystemExit(f"Invalid ramp min/max in --hatch {override!r}")
        if axis not in ("perp", "parallel", "x", "y"):
            raise SystemExit(
                f"Invalid ramp axis {axis!r} in --hatch {override!r}. "
                "Must be perp | parallel | x | y."
            )
        ramps.append(HatchRamp(
            param=param.strip(), axis=axis,  # type: ignore[arg-type]
            min_value=min_v, max_value=max_v,
        ))

    base_params = None
    if param_overrides:
        from .svg_config import _params_from_flat
        base_params = _params_from_flat(param_overrides, base=base)

    return color, HatchPass(angle=angle, spacing=spacing, base_params=base_params, ramps=ramps)
```

- [ ] **Step 5: Integrate `--hatch` into `_svg_generate`**

Find `_svg_generate` in `cli.py`. After the block that builds `layer_config` from `--color` overrides and BEFORE the `auto_ramp` block, insert:

```python
    # Fold in --hatch passes (may share a color across multiple flags → multi-pass).
    hatch_layers: dict[str, list] = {}
    for override in getattr(args, "hatch_overrides", []):
        color, hp = _parse_hatch_override(override, base_params)
        hatch_layers.setdefault(color, []).append(hp)
    for color, passes in hatch_layers.items():
        from .svg_source import LayerConfig
        existing = layer_config.get(color)
        params = existing.params if existing else ProcessingParams(
            power=base_params.power, speed=base_params.speed,
            mopa_frequency=base_params.mopa_frequency,
            density=base_params.density, repeat=base_params.repeat,
            pulse_width=base_params.pulse_width,
            processing_light_source=base_params.processing_light_source,
        )
        layer_config[color] = LayerConfig(
            params=params,
            render_mode="hatched",
            hatch_passes=passes,
        )
```

- [ ] **Step 6: Run tests**

Run: `pytest tests/test_svg_cli.py -v`
Expected: both new tests PASS. Existing CLI tests still pass.

Full suite: `pytest -v`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen/cli.py tests/test_svg_cli.py
git commit -m "Add --hatch CLI flag with multi-pass compose"
```

---

### Task 11: CLI `--config`, `--max-segments`, `--min-spacing`

**Files:**
- Modify: `src/xcs_gen/cli.py`
- Modify: `src/xcs_gen/generators.py` (segment cap enforcement)
- Modify: `tests/test_svg_cli.py` (append)
- Modify: `tests/test_svg_generator.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_svg_cli.py`:

```python
def test_svg_generate_config_file(tmp_path):
    import yaml
    cfg = tmp_path / "layers.yaml"
    cfg.write_text(yaml.safe_dump({
        "layers": {
            "#000000": {
                "render_mode": "hatched",
                "hatch_passes": [
                    {"angle": 0, "spacing": 1.0,
                     "ramps": [{"param": "power", "axis": "perp", "min": 30, "max": 70}]},
                ],
            },
            "#ffffff": {"render_mode": "fill_engrave", "power": 30},
        },
    }))

    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")
    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--config", str(cfg),
    ])
    with open(out_path) as f:
        data = json.load(f)
    types = [d["type"] for d in data["canvas"][0]["displays"]]
    assert types.count("LINE") > 0
    assert types.count("PATH") > 0


def test_svg_generate_config_overridden_by_cli(tmp_path):
    """--color / --hatch override the YAML entry for that color."""
    import yaml
    cfg = tmp_path / "layers.yaml"
    cfg.write_text(yaml.safe_dump({
        "layers": {
            "#000000": {"render_mode": "fill_engrave", "power": 10},
            "#ffffff": {"render_mode": "fill_engrave", "power": 10},
        },
    }))
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")
    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--config", str(cfg),
        "--color", "#000000:vector_cut:500,99,65,100,1,200",
    ])
    with open(out_path) as f:
        data = json.load(f)
    dev_entries = data["device"]["data"]["value"][0][1]["displays"]["value"]
    cuts = [e for e in dev_entries if e[1]["processingType"] == "VECTOR_CUTTING"]
    assert len(cuts) == 1
    assert cuts[0][1]["data"]["VECTOR_CUTTING"]["parameter"]["customize"]["power"] == 99
```

Append to `tests/test_svg_generator.py`:

```python
def test_generate_from_svg_max_segments_enforced(tmp_path):
    """When max_segments is set low, hatched shapes refuse to generate."""
    import pytest
    path = _write(TWO_COLOR)
    from xcs_gen.svg_source import HatchPass
    with pytest.raises(ValueError, match="max_segments"):
        generate_from_svg(
            svg_path=path,
            total_width=100.0,
            layer_config={
                "#000000": LayerConfig(
                    params=ProcessingParams(),
                    render_mode="hatched",
                    hatch_passes=[HatchPass(angle=0, spacing=0.1)],  # 500 lines
                ),
                "#ffffff": LayerConfig(
                    params=ProcessingParams(), render_mode="fill_engrave",
                ),
            },
            max_segments=50,
        )
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_svg_cli.py tests/test_svg_generator.py -v`
Expected: new tests fail.

- [ ] **Step 3: Add `max_segments` parameter to `generate_from_svg`**

Edit `src/xcs_gen/generators.py`. Find the `generate_from_svg` signature:

```python
def generate_from_svg(
    *,
    svg_path: str,
    layer_config: "dict[str, object] | None" = None,
    auto_ramp: "object | None" = None,
    total_width: float = 100.0,
    total_height: float | None = None,
    start_x: float = 10.0,
    start_y: float = 10.0,
    base_params: ProcessingParams | None = None,
) -> XCSProject:
```

Add `max_segments: int = 50000` at the end:

```python
def generate_from_svg(
    *,
    svg_path: str,
    layer_config: "dict[str, object] | None" = None,
    auto_ramp: "object | None" = None,
    total_width: float = 100.0,
    total_height: float | None = None,
    start_x: float = 10.0,
    start_y: float = 10.0,
    base_params: ProcessingParams | None = None,
    max_segments: int = 50000,
) -> XCSProject:
```

Inside the hatched loop (the block added in Task 8), find the inner `for seg in segments:` loop and wrap the per-segment work with a running counter. Before the outermost shape loop, add:

```python
    segment_count = 0
    per_color_counts: dict[str, int] = {}
```

Replace the existing `for seg in segments:` loop with:

```python
                    for seg in segments:
                        segment_count += 1
                        per_color_counts[color] = per_color_counts.get(color, 0) + 1
                        if segment_count > max_segments:
                            worst = max(per_color_counts, key=per_color_counts.get)
                            raise ValueError(
                                f"hatched output exceeded max_segments={max_segments} "
                                f"(color {worst!r} contributes {per_color_counts[worst]}). "
                                "Increase spacing, reduce passes, or raise --max-segments."
                            )
                        project.extra_displays.append(build_line_display(seg))
                        project.extra_device_entries.append(
                            build_device_entry(
                                seg.id, "LINE",
                                seg.processing_type,
                                seg.params or layer.params,
                            )
                        )
```

- [ ] **Step 4: Add `--config`, `--max-segments`, `--min-spacing` to CLI**

Edit `src/xcs_gen/cli.py`. In the `svg_gen_p` subparser, add:

```python
    svg_gen_p.add_argument("--config", default=None,
                           help="Path to a YAML config file describing layers.")
    svg_gen_p.add_argument("--max-segments", type=int, default=50000,
                           help="Hard cap on hatched segments (default: 50000)")
    svg_gen_p.add_argument("--min-spacing", type=float, default=0.01,
                           help="Minimum hatch line spacing in mm (default: 0.01)")
```

In `_svg_generate`, integrate YAML config. Near the top of the function, after `base_params` is built, add:

```python
    # Load YAML config if provided. CLI overrides win later.
    yaml_layer_config: dict = {}
    yaml_auto_ramp = None
    if args.config:
        from .svg_config import load_svg_config
        loaded = load_svg_config(args.config)
        # Merge loaded.defaults onto base_params (CLI flags win over YAML defaults).
        # args.power etc already initialised via argparse defaults 50.0 etc, so only
        # replace fields the user did NOT explicitly set. For simplicity, we treat
        # YAML defaults as lower precedence than CLI defaults: we keep `base_params`
        # as-is (user's CLI flags) and let YAML only fill in layers/auto_ramp.
        yaml_layer_config = loaded.layer_config
        yaml_auto_ramp = loaded.auto_ramp
    # Seed layer_config with YAML; will be overridden by --color/--hatch below.
    layer_config = dict(yaml_layer_config)
```

Find the existing block `layer_config: dict[str, LayerConfig] = {}` that initialises from `--color` overrides, and change its initialisation to preserve the seed:

```python
    # (from above) layer_config starts as YAML layers, if any.
    for override in args.color_overrides:
        color, cfg = _parse_color_override(override, base_params)
        layer_config[color] = cfg
```

Then the existing hatch-overrides block remains unchanged.

Then in the `auto_ramp` setup block, merge YAML auto_ramp as fallback when CLI `--ramp-param` wasn't supplied:

```python
    auto_ramp = None
    if args.ramp_param is not None:
        if args.ramp_min is None or args.ramp_max is None:
            raise SystemExit("--ramp-param requires --ramp-min and --ramp-max.")
        auto_ramp = AutoRamp(
            param=args.ramp_param, min_value=args.ramp_min, max_value=args.ramp_max,
            sort_by=args.ramp_sort, default_render_mode=args.ramp_mode,
        )
    elif yaml_auto_ramp is not None:
        auto_ramp = yaml_auto_ramp
```

Finally pass `max_segments` through to the generator. Find the `generate_from_svg(...)` call and add `max_segments=args.max_segments`. Also pass `min_spacing` via a module-level constant:

```python
    # min_spacing is enforced inside hatch.py; surface the arg as a module-level
    # default via a setter at the top of _svg_generate.
    from . import hatch as _hatch
    _hatch.MIN_SPACING_DEFAULT = args.min_spacing
```

- [ ] **Step 5: Let hatch.py honour the runtime min-spacing**

Edit `src/xcs_gen/hatch.py`. Replace the hardcoded `min_spacing = 0.01` inside `generate_hatch_segments` with:

```python
    min_spacing = MIN_SPACING_DEFAULT
```

And near the top of the module, add:

```python
MIN_SPACING_DEFAULT = 0.01
```

- [ ] **Step 6: Run tests**

Run: `pytest -v`
Expected: all PASS (including new ones).

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen/cli.py src/xcs_gen/generators.py src/xcs_gen/hatch.py \
        tests/test_svg_cli.py tests/test_svg_generator.py
git commit -m "Add --config, --max-segments, --min-spacing CLI flags"
```

---

### Task 12: Pikachu hatched integration test + manual XCS Studio verify

**Files:**
- Modify: `tests/test_svg_generator.py` (append)

- [ ] **Step 1: Append integration test**

Append to `tests/test_svg_generator.py`:

```python
def test_pikachu_hatched_yellow_round_trip(tmp_path):
    """Pikachu with a hatched yellow layer generates cleanly and passes build_xcs."""
    if not SAMPLE_PIKACHU.exists():
        import pytest
        pytest.skip("samples/Pikachu.svg missing")

    from xcs_gen.builder import write_xcs
    from xcs_gen.svg_source import HatchPass, HatchRamp

    project = generate_from_svg(
        svg_path=str(SAMPLE_PIKACHU),
        total_width=80.0,
        layer_config={
            "#ffd73e": LayerConfig(
                params=ProcessingParams(),
                render_mode="hatched",
                hatch_passes=[
                    HatchPass(
                        angle=0, spacing=1.0,
                        ramps=[HatchRamp(param="power", axis="perp", min_value=30, max_value=70)],
                    ),
                ],
            ),
            "#000000": LayerConfig(
                params=ProcessingParams(speed=500, power=80),
                render_mode="vector_engrave",
            ),
        },
        max_segments=100000,
    )

    # Yellow produces LINEs, black produces a PATH per shape.
    line_count = sum(1 for d in project.extra_displays if d.get("type") == "LINE")
    path_count = len(project.paths)
    assert line_count > 0
    assert path_count > 0

    # Each LINE has a matching device entry.
    line_ids = {d["id"] for d in project.extra_displays if d.get("type") == "LINE"}
    entry_ids = {eid for eid, _ in project.extra_device_entries}
    assert line_ids.issubset(entry_ids)

    # Round-trip through builder + json.
    out = tmp_path / "pikachu_hatched.xcs"
    write_xcs(project, str(out))
    import json as _json
    with open(out) as f:
        data = _json.load(f)
    display_types = [d["type"] for d in data["canvas"][0]["displays"]]
    assert display_types.count("LINE") == line_count
    assert display_types.count("PATH") == path_count
```

- [ ] **Step 2: Run the integration test**

Run: `pytest tests/test_svg_generator.py::test_pikachu_hatched_yellow_round_trip -v`
Expected: PASS, or SKIP if Pikachu.svg is missing.

- [ ] **Step 3: Generate a file for manual XCS Studio verification**

Run:

```bash
python -c "
from xcs_gen.generators import generate_from_svg
from xcs_gen.svg_source import LayerConfig, HatchPass, HatchRamp
from xcs_gen.model import ProcessingParams
from xcs_gen.builder import write_xcs
project = generate_from_svg(
    svg_path='samples/Pikachu.svg',
    total_width=80.0,
    layer_config={
        '#ffd73e': LayerConfig(
            params=ProcessingParams(),
            render_mode='hatched',
            hatch_passes=[
                HatchPass(
                    angle=0, spacing=0.5,
                    ramps=[HatchRamp(param='power', axis='perp', min_value=30, max_value=70)],
                ),
                HatchPass(
                    angle=90, spacing=0.5,
                    ramps=[HatchRamp(param='power', axis='perp', min_value=30, max_value=70)],
                ),
            ],
        ),
        '#000000': LayerConfig(
            params=ProcessingParams(speed=500, power=80),
            render_mode='vector_engrave',
        ),
    },
    max_segments=200000,
)
write_xcs(project, '/tmp/pikachu_hatched.xcs')
lines = sum(1 for d in project.extra_displays if d.get('type') == 'LINE')
print(f'paths={len(project.paths)} lines={lines}')
"
```

Report the line/path counts and the file size. Then the user opens `/tmp/pikachu_hatched.xcs` in XCS Studio and visually verifies: Pikachu's yellow body shows cross-hatched lines with power fading top-to-bottom, and black outlines are still present as vector-engrave paths.

If positioning is wrong, recheck the Task 8 dispatch code — each line's `(x, y)` should already be in bed-mm coordinates (since the polygon came in bed-mm from the parser). The `build_line_display` Task 2 work uses the same bed-mm convention as PATH.

- [ ] **Step 4: Commit the integration test**

```bash
git add tests/test_svg_generator.py
git commit -m "Add Pikachu hatched integration test"
```

---

## Self-Review Checklist

**Spec coverage:**
- Goal & scope (hatched render mode, multi-pass, ramps, shapely clipping, YAML + CLI) → covered by Tasks 3–11.
- Pipeline → Task 8 for dispatch; Tasks 4–7 for clipping/segment gen.
- Data model (`HatchRamp`, `HatchPass`, extended `LayerConfig`, `Line.params`) → Tasks 2, 3.
- Resolver validation rules (non-empty passes, no passes on non-hatched, invalid ramp param, stroke-layer rejection) → Tasks 3 (first three) and 8 (stroke rejection at generator).
- Hatch pipeline (polygon build → rotate → walk → clip → rotate back → per-segment params → emit) → Tasks 4–7.
- Spacing-ramp semantics → Task 7.
- Output strategy (extra_displays / extra_device_entries via existing helpers) → Task 8.
- Config file (YAML) → Task 9.
- CLI `--hatch` → Task 10.
- CLI `--config`, `--max-segments`, `--min-spacing` → Task 11.
- Edge cases (shape too small, self-intersecting, empty intersection) → Tasks 4, 5, 8.
- Tests (hatch module, config module, generator, CLI, Pikachu) → Tasks 4–12.
- Dependencies (shapely, pyyaml) → Task 1.

**Placeholder scan:** No TBD / TODO / "similar to Task N" / "handle edge cases". Each step has concrete code or a concrete command.

**Type consistency:**
- `HatchRamp.param` is a `str` (not a `Literal`) to support the `"spacing"` pseudo-param alongside `ProcessingParams` fields. Same shape in `load_svg_config` and `_parse_hatch_override`.
- `RampAxis` is `Literal["perp", "parallel", "x", "y"]` — used consistently across `HatchRamp`, YAML validation (`_VALID_AXES`), CLI validation (`_parse_hatch_override`), and `_ramp_position`.
- `RenderMode` extended to include `"hatched"` everywhere — `svg_source.py`, CLI `--ramp-mode` choices left unchanged (auto-ramp can't target hatched since hatched requires passes).
- Line carries optional `params` and fixed `processing_type`; `build_line_display` uses `line.x/y/length/angle/layer_color` (no change); callers pass `line.params` and `line.processing_type` to `build_device_entry`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-svg-hatched-lines.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
