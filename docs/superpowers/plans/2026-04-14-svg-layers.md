# SVG → Per-Layer Laser Parameters (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SVG ingestion to xcs-gen. Each unique fill color and each unique stroke color in the source SVG becomes a separately-parameterized layer in the output `.xcs`, with per-layer `ProcessingParams` and a render mode (fill engrave / vector engrave / vector cut). Ship as `generate_from_svg()` library function plus `xcs-gen svg detect|generate` CLI subcommand.

**Architecture:** `svgelements` parses the SVG and bakes all transforms and CSS inheritance into absolute coordinates. A normalized shape list is bucketed by fill color and stroke color. Each (shape, layer) pair becomes one XCS display element (native `PATH` / `CIRCLE` / `LINE` / `RECT`) carrying its layer's `ProcessingParams` and processing type. Params come from explicit per-color config, with an auto-ramp fallback that sorts detected colors by luminance / hue / appearance order and interpolates one parameter across them.

**Tech Stack:** Python 3.10+, `svgelements` (new pure-Python dep), Pillow (already present), dataclasses, pytest.

**Spec reference:** `docs/superpowers/specs/2026-04-14-svg-layers-design.md`

---

## Task Order Summary

1. Add `svgelements` dependency; verify library behaviour on a known SVG
2. Empirically verify XCS `PATH` / `CIRCLE` positioning convention (the `graphicX` / `graphicY` question)
3. Add `Path` and `Circle` dataclasses to `model.py`
4. Implement `_build_path_display` in `builder.py`
5. Implement `_build_circle_display` in `builder.py`
6. Extend `build_xcs()` to iterate the new lists
7. SVG parser — extract normalized shapes with baked transforms and resolved styles
8. Colour detection — `detect_svg_colors()`
9. Layer grouping + auto-ramp param assignment
10. `generate_from_svg()` end-to-end generator
11. CLI `svg detect` subcommand
12. CLI `svg generate` subcommand (including `--color` and `--ramp-*` parsing)
13. Integration test with `samples/Pikachu.svg` and manual XCS Studio verification

---

### Task 1: Add `svgelements` dependency

**Files:**
- Modify: `pyproject.toml:11`
- Create: `tests/test_svg_library.py`

- [ ] **Step 1: Add the dependency**

Edit `pyproject.toml` line 11:

```toml
dependencies = ["Pillow>=10.0", "fastapi>=0.110", "uvicorn[standard]>=0.27", "svgelements>=1.9"]
```

- [ ] **Step 2: Install it**

Run: `pip install -e .`
Expected: installs `svgelements` and its transitive deps without errors.

- [ ] **Step 3: Write a sanity test to verify the library behaves as we expect**

Create `tests/test_svg_library.py`:

```python
"""Sanity checks on the svgelements library so we understand its behaviour
before building on top of it."""

from svgelements import SVG, Path, Rect, Circle


INLINE_SVG = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <g transform="translate(10, 20)">
    <rect x="0" y="0" width="30" height="40" fill="#ff0000" />
    <circle cx="50" cy="50" r="10" fill="#00ff00" stroke="#0000ff" stroke-width="2" />
    <path d="M 0,0 L 50,50 Z" fill="#ffd73e" />
  </g>
</svg>
"""


def test_svgelements_parses_inline():
    svg = SVG.parse(source=_as_file(INLINE_SVG))
    elements = list(svg.elements())
    # At least the SVG root, the <g>, and three shapes.
    assert any(isinstance(e, Rect) for e in elements)
    assert any(isinstance(e, Circle) for e in elements)
    assert any(isinstance(e, Path) for e in elements)


def test_svgelements_bakes_transforms():
    svg = SVG.parse(source=_as_file(INLINE_SVG))
    for el in svg.elements():
        if isinstance(el, Rect):
            # The rect was translated by (10, 20). svgelements exposes an
            # absolute transform via el.transform — the bbox should reflect it.
            bbox = el.bbox()
            assert bbox is not None
            x0, y0, x1, y1 = bbox
            assert abs(x0 - 10) < 0.01
            assert abs(y0 - 20) < 0.01
            assert abs(x1 - 40) < 0.01  # 10 + 30
            assert abs(y1 - 60) < 0.01  # 20 + 40
            return
    raise AssertionError("No rect found")


def test_svgelements_resolves_style():
    svg = SVG.parse(source=_as_file(INLINE_SVG))
    for el in svg.elements():
        if isinstance(el, Rect):
            assert str(el.fill).lower() in ("#ff0000", "red")
            return
    raise AssertionError("No rect found")


def _as_file(content: str):
    import io
    return io.StringIO(content)
```

- [ ] **Step 4: Run the test**

Run: `pytest tests/test_svg_library.py -v`
Expected: three tests PASS. If any test fails, pause — the rest of the plan depends on these three behaviours holding. Adjust our usage to the real library API (e.g. if `el.bbox()` has a different signature) before continuing.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml tests/test_svg_library.py
git commit -m "Add svgelements dependency and library sanity tests"
```

---

### Task 2: Verify XCS `PATH` positioning convention

XCS's `PATH` display carries `x`/`y`/`width`/`height` (bounding box in bed-mm), `dPath` (SVG path string in some internal coordinate space), and `graphicX`/`graphicY` (an offset of unknown meaning from the `shape.xcs` sample). Before building on top of this, generate a minimal test file and verify it opens in XCS Studio at the expected position.

**Files:**
- Create: `tests/manual_path_probe.py` (temporary — deleted at the end of this task)

- [ ] **Step 1: Write the probe script**

Create `tests/manual_path_probe.py`:

```python
"""One-off script to generate a minimal XCS file with a single PATH element.
Run, open in XCS Studio, verify the shape lands where expected, then delete.
"""

import json
import time
import uuid


def _uuid() -> str:
    return str(uuid.uuid4())


def build(dpath: str, x: float, y: float, width: float, height: float,
          graphic_x: float, graphic_y: float, output: str) -> None:
    display_id = _uuid()
    canvas_id = _uuid()
    layer_color = "#ff0000"
    now_ms = int(time.time() * 1000)

    display = {
        "id": display_id,
        "name": None,
        "type": "PATH",
        "x": x, "y": y,
        "angle": 0,
        "scale": {"x": 1, "y": 1},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": x, "offsetY": y,
        "lockRatio": False,
        "isClosePath": True,
        "isCompoundPath": False,
        "zOrder": 1,
        "groupTags": [],
        "groupTag": _uuid(),
        "layerTag": layer_color,
        "layerColor": layer_color,
        "visible": True,
        "originColor": "#000000",
        "enableTransform": True,
        "visibleState": True,
        "lockState": False,
        "resourceOrigin": "",
        "customData": {},
        "rootComponentId": "",
        "minCanvasVersion": "0.0.0",
        "alpha": 1,
        "fill": {"paintType": "color", "visible": False, "color": 0, "alpha": 1},
        "stroke": {"paintType": "color", "visible": True, "color": 0, "alpha": 1,
                   "width": 1, "cap": "butt", "join": "miter", "miterLimit": 4,
                   "alignment": 0.5},
        "effects": [],
        "width": width, "height": height,
        "isFill": True,
        "lineColor": 0,
        "fillColor": "#000000",
        "dPath": dpath,
        "graphicX": graphic_x,
        "graphicY": graphic_y,
        "fillRule": "evenodd",
        "points": [],
    }

    params = {
        "processingLightSource": "red",
        "power": 50.0, "speed": 1000, "repeat": 1,
        "pulseWidth": 200, "mopaFrequency": 65,
    }
    processing = {
        "VECTOR_ENGRAVING": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {**params, "enableKerf": False, "kerfDistance": 0},
            },
        },
    }

    out = {
        "canvasId": canvas_id,
        "canvas": [{
            "id": canvas_id,
            "title": "{panel}1",
            "layerData": {layer_color: {"name": "RED", "order": 1, "visible": True}},
            "groupData": {},
            "displays": [display],
            "extendInfo": {
                "version": "2.15.108", "minCanvasVersion": "0.0.0",
                "displayProcessConfigMap": {},
                "rulerPluginData": {"rulerGuide": []},
                "type": "2d",
                "gridOptions": {"color": "normal", "isShow": True},
            },
        }],
        "extId": "GS004-CLASS-4",
        "extName": "F2 Ultra",
        "device": {
            "id": "GS004-CLASS-4",
            "power": [60, 40],
            "data": {
                "dataType": "Map",
                "value": [[canvas_id, {
                    "mode": "LASER_PLANE",
                    "data": {"LASER_PLANE": {
                        "material": 0, "lightSourceMode": "blue", "thickness": None,
                        "isProcessByLayer": False, "pathPlanning": "auto",
                        "fillPlanning": "separate", "dreedyTsp": False,
                        "avoidSmokeModal": False, "scanDirection": "topToBottom",
                        "enableOddEvenKerf": True, "xcsUsed": [],
                    }},
                    "displays": {"dataType": "Map", "value": [
                        [display_id, {
                            "isFill": True, "type": "PATH",
                            "processingType": "VECTOR_ENGRAVING",
                            "data": processing,
                            "processIgnore": False, "isWhiteModel": True,
                        }],
                    ]},
                }]],
            },
            "materialList": [], "materialTypeList": [], "customProjectData": {},
        },
        "version": "1.6.6",
        "created": now_ms, "modify": now_ms,
        "ua": "xcs-gen-probe/0.1",
        "meta": [],
        "cover": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIHWNgAAIABQABNjN9GQAAAABJRUeErkJggg==",
        "minRequiredVersion": "2.6.0", "appMinRequiredVersion": "",
        "webMinRequiredVersion": "",
        "projectTraceID": _uuid(),
    }
    with open(output, "w") as f:
        json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    # Experiment A: dPath in bed-mm coords, graphicX/Y = 0
    build(
        dpath="M 50,50 L 80,50 L 80,80 L 50,80 Z",
        x=50, y=50, width=30, height=30,
        graphic_x=0, graphic_y=0,
        output="/tmp/probe_A.xcs",
    )
    # Experiment B: dPath in large source coords, graphicX/Y = negative offset
    build(
        dpath="M 1000,1000 L 1300,1000 L 1300,1300 L 1000,1300 Z",
        x=50, y=50, width=30, height=30,
        graphic_x=-950, graphic_y=-950,
        output="/tmp/probe_B.xcs",
    )
    print("Wrote /tmp/probe_A.xcs and /tmp/probe_B.xcs")
```

- [ ] **Step 2: Run the probe**

Run: `python tests/manual_path_probe.py`
Expected: writes `/tmp/probe_A.xcs` and `/tmp/probe_B.xcs`.

- [ ] **Step 3: Open both files in XCS Studio**

Open `/tmp/probe_A.xcs`. Confirm whether the rectangle appears at (50,50) with size 30×30mm. Then open `/tmp/probe_B.xcs` and confirm the same.

- If **A works** → the convention is: `dPath` in bed-mm coordinates, `graphicX`=`graphicY`=0. Record this.
- If **B works** → the convention is: `dPath` in an internal coordinate space, `graphicX`/`graphicY` offsets to the display's `x`/`y`. Record this.
- If **both work** → XCS accepts either. Prefer A (simpler).
- If **neither works** → iterate. Try `graphic_x=-x, graphic_y=-y`. Try dPath with lowercase (relative) commands. Try moving the dPath to start at `(x, y)` exactly.

Record the working convention at the top of `src/xcs_gen/builder.py` as a comment (to be added in Task 4).

- [ ] **Step 4: Delete the probe script**

```bash
rm tests/manual_path_probe.py
```

- [ ] **Step 5: Commit the finding**

Edit `docs/superpowers/specs/2026-04-14-svg-layers-design.md` — update the "Builder Changes" section's note about `graphicX`/`graphicY` with the empirical answer. Then:

```bash
git add docs/superpowers/specs/2026-04-14-svg-layers-design.md
git commit -m "Record empirical XCS PATH positioning convention"
```

---

### Task 3: `Path` and `Circle` dataclasses

**Files:**
- Modify: `src/xcs_gen/model.py:1-82`
- Test: `tests/test_svg_model.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_svg_model.py`:

```python
"""Tests for the SVG-related data model additions."""

from xcs_gen.model import Circle, Path, ProcessingParams, XCSProject


def test_path_defaults():
    p = Path(d="M 0,0 L 10,10 Z", x=0, y=0, width=10, height=10, is_close_path=True)
    assert p.is_compound_path is False
    assert p.fill_rule == "evenodd"
    assert p.processing_type == "COLOR_FILL_ENGRAVE"
    assert p.is_fill is True
    assert p.layer_color == ""
    assert isinstance(p.params, ProcessingParams)
    assert p.id  # uuid populated


def test_circle_defaults():
    c = Circle(x=5, y=5, width=20, height=20)
    assert c.processing_type == "VECTOR_ENGRAVING"
    assert c.is_fill is True
    assert c.layer_color == ""
    assert isinstance(c.params, ProcessingParams)
    assert c.id


def test_xcsproject_has_paths_and_circles_lists():
    proj = XCSProject()
    assert proj.paths == []
    assert proj.circles == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_model.py -v`
Expected: `ImportError` on `Path` and `Circle` — that's fine, we're about to add them.

- [ ] **Step 3: Add the dataclasses and extend `XCSProject`**

Edit `src/xcs_gen/model.py`. Add at the top of the imports:

```python
from typing import Literal
```

After the existing `Line` dataclass (around line 57), insert:

```python
@dataclass
class Path:
    """An SVG path display element."""

    d: str  # absolute-coord SVG path d string
    x: float  # bounding box top-left in bed mm
    y: float
    width: float
    height: float
    is_close_path: bool
    is_compound_path: bool = False
    fill_rule: Literal["evenodd", "nonzero"] = "evenodd"
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "COLOR_FILL_ENGRAVE"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""


@dataclass
class Circle:
    """A circle display element."""

    x: float  # bounding box top-left (not center), bed mm
    y: float
    width: float  # diameter
    height: float
    params: ProcessingParams = field(default_factory=ProcessingParams)
    processing_type: str = "VECTOR_ENGRAVING"
    is_fill: bool = True
    id: str = field(default_factory=_uuid)
    layer_color: str = ""
```

Then extend `XCSProject` (around line 74) by adding two new fields after `elements`:

```python
@dataclass
class XCSProject:
    """Top-level XCS file model."""

    device: Device = field(default_factory=Device)
    elements: list[Rect] = field(default_factory=list)
    paths: list["Path"] = field(default_factory=list)
    circles: list["Circle"] = field(default_factory=list)
    extra_displays: list[dict[str, Any]] = field(default_factory=list)
    extra_device_entries: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    canvas_id: str = field(default_factory=_uuid)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_svg_model.py -v`
Expected: three PASS.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `pytest -v`
Expected: all existing tests still pass plus the new three.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/model.py tests/test_svg_model.py
git commit -m "Add Path and Circle dataclasses to model"
```

---

### Task 4: `_build_path_display` in `builder.py`

This emits the XCS JSON display dict for a `Path`. Field set is copied from `samples/shape.xcs`.

**Files:**
- Modify: `src/xcs_gen/builder.py:86-150` (insert after `build_line_display`)
- Test: `tests/test_svg_builder.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_svg_builder.py`:

```python
"""Tests for the SVG-related builder additions."""

from xcs_gen.builder import _build_path_display, _build_circle_display
from xcs_gen.model import Circle, Path


def test_build_path_display_core_fields():
    p = Path(
        d="M 0,0 L 10,10 Z",
        x=5.0, y=7.5, width=10.0, height=10.0,
        is_close_path=True,
        is_compound_path=False,
        fill_rule="evenodd",
        layer_color="#ff0000",
    )
    disp = _build_path_display(p)
    assert disp["type"] == "PATH"
    assert disp["dPath"] == "M 0,0 L 10,10 Z"
    assert disp["x"] == 5.0
    assert disp["y"] == 7.5
    assert disp["width"] == 10.0
    assert disp["height"] == 10.0
    assert disp["isClosePath"] is True
    assert disp["isCompoundPath"] is False
    assert disp["fillRule"] == "evenodd"
    assert disp["layerColor"] == "#ff0000"
    assert disp["layerTag"] == "#ff0000"
    assert disp["offsetX"] == 5.0
    assert disp["offsetY"] == 7.5
    assert disp["points"] == []
    # graphicX/Y exist — exact semantics filled in via Task 2's empirical finding.
    assert "graphicX" in disp
    assert "graphicY" in disp


def test_build_circle_display_core_fields():
    c = Circle(x=5.0, y=5.0, width=20.0, height=20.0, layer_color="#00ff00")
    disp = _build_circle_display(c)
    assert disp["type"] == "CIRCLE"
    assert disp["x"] == 5.0
    assert disp["y"] == 5.0
    assert disp["width"] == 20.0
    assert disp["height"] == 20.0
    assert disp["layerColor"] == "#00ff00"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_svg_builder.py -v`
Expected: `ImportError` on `_build_path_display` and `_build_circle_display`.

- [ ] **Step 3: Implement both builders**

Edit `src/xcs_gen/builder.py`. Add to imports at the top:

```python
from .model import (
    ANNOTATION_LAYER_COLOR,
    GRADIENT_LAYER_COLOR,
    Circle,
    Line,
    Path,
    ProcessingParams,
    Rect,
    XCSProject,
    _uuid,
)
```

After the `build_line_display` function (around line 150), insert:

```python
def _build_path_display(path: Path) -> dict[str, Any]:
    """Build a display entry for an SVG path element.

    PATH positioning convention (empirically verified — see Task 2 in the
    SVG layers plan): dPath coordinates are in bed-mm, graphicX = graphicY = 0.
    If the empirical finding differs, update this comment AND the dPath /
    graphicX / graphicY lines below accordingly.
    """
    return {
        "id": path.id,
        "name": None,
        "type": "PATH",
        "x": path.x,
        "y": path.y,
        "angle": 0,
        "scale": {"x": 1, "y": 1},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": path.x,
        "offsetY": path.y,
        "lockRatio": False,
        "isClosePath": path.is_close_path,
        "isCompoundPath": path.is_compound_path,
        "zOrder": 1,
        "groupTags": [],
        "groupTag": _uuid(),
        "layerTag": path.layer_color,
        "layerColor": path.layer_color,
        "visible": True,
        "originColor": "#000000",
        "enableTransform": True,
        "visibleState": True,
        "lockState": False,
        "resourceOrigin": "",
        "customData": {},
        "rootComponentId": "",
        "minCanvasVersion": "0.0.0",
        "alpha": 1,
        "fill": {
            "paintType": "color",
            "visible": False,
            "color": 0,
            "alpha": 1,
        },
        "stroke": {
            "paintType": "color",
            "visible": True,
            "color": 0,
            "alpha": 1,
            "width": 1,
            "cap": "butt",
            "join": "miter",
            "miterLimit": 4,
            "alignment": 0.5,
        },
        "effects": [],
        "width": path.width,
        "height": path.height,
        "isFill": path.is_fill,
        "lineColor": 0,
        "fillColor": "#000000",
        "dPath": path.d,
        "graphicX": 0.0,
        "graphicY": 0.0,
        "fillRule": path.fill_rule,
        "points": [],
    }


def _build_circle_display(circle: Circle) -> dict[str, Any]:
    """Build a display entry for a circle element."""
    return {
        "id": circle.id,
        "name": None,
        "type": "CIRCLE",
        "x": circle.x,
        "y": circle.y,
        "angle": 0,
        "scale": {"x": 1, "y": 1},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": circle.x,
        "offsetY": circle.y,
        "lockRatio": False,
        "isClosePath": True,
        "zOrder": 1,
        "groupTags": [],
        "groupTag": _uuid(),
        "layerTag": circle.layer_color,
        "layerColor": circle.layer_color,
        "visible": True,
        "originColor": "#000000",
        "enableTransform": True,
        "visibleState": True,
        "lockState": False,
        "resourceOrigin": "",
        "customData": {},
        "rootComponentId": "",
        "minCanvasVersion": "0.0.0",
        "alpha": 1,
        "fill": {
            "paintType": "color",
            "visible": False,
            "color": 0,
            "alpha": 1,
        },
        "stroke": {
            "paintType": "color",
            "visible": True,
            "color": 0,
            "alpha": 1,
            "width": 1,
            "cap": "butt",
            "join": "miter",
            "miterLimit": 4,
            "alignment": 0.5,
        },
        "effects": [],
        "width": circle.width,
        "height": circle.height,
        "isFill": circle.is_fill,
        "lineColor": 0,
        "fillColor": "#000000",
    }
```

If Task 2's empirical finding was that `dPath` needs to be in an internal coordinate space with `graphicX`/`graphicY` as offsets, edit the `dPath`/`graphicX`/`graphicY` lines above AND the comment accordingly — this is the one place where Task 2's answer shapes the implementation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_svg_builder.py -v`
Expected: two PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/builder.py tests/test_svg_builder.py
git commit -m "Add _build_path_display and _build_circle_display"
```

---

### Task 5: Extend `build_xcs` to iterate `paths` and `circles`

**Files:**
- Modify: `src/xcs_gen/builder.py:298-427`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_svg_builder.py`:

```python
import json

from xcs_gen.builder import build_xcs, write_xcs
from xcs_gen.model import ProcessingParams, XCSProject


def test_build_xcs_includes_paths_and_circles():
    proj = XCSProject()
    proj.paths.append(Path(
        d="M 0,0 L 10,10 Z", x=0, y=0, width=10, height=10,
        is_close_path=True, layer_color="#ff0000",
    ))
    proj.circles.append(Circle(
        x=20, y=20, width=15, height=15, layer_color="#00ff00",
    ))

    out = build_xcs(proj)
    displays = out["canvas"][0]["displays"]
    types = [d["type"] for d in displays]
    assert "PATH" in types
    assert "CIRCLE" in types

    # Both layers registered
    layer_data = out["canvas"][0]["layerData"]
    assert "#ff0000" in layer_data
    assert "#00ff00" in layer_data

    # Processing entries for both shapes
    dev_entries = out["device"]["data"]["value"][0][1]["displays"]["value"]
    entry_types = [entry[1]["type"] for entry in dev_entries]
    assert "PATH" in entry_types
    assert "CIRCLE" in entry_types


def test_build_xcs_paths_with_separate_params():
    """Two paths with same layer color but different params both survive."""
    proj = XCSProject()
    proj.paths.append(Path(
        d="M 0,0 L 10,0 L 10,10 L 0,10 Z", x=0, y=0, width=10, height=10,
        is_close_path=True, layer_color="#000000",
        params=ProcessingParams(power=20),
    ))
    proj.paths.append(Path(
        d="M 0,0 L 5,5 Z", x=0, y=0, width=5, height=5,
        is_close_path=True, layer_color="#000000",
        params=ProcessingParams(power=80),
    ))

    out = build_xcs(proj)
    dev_entries = out["device"]["data"]["value"][0][1]["displays"]["value"]
    powers = [
        entry[1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["power"]
        for entry in dev_entries if entry[1]["type"] == "PATH"
    ]
    assert 20 in powers
    assert 80 in powers
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_builder.py -v`
Expected: the two new tests fail — paths and circles are silently dropped.

- [ ] **Step 3: Extend `build_xcs()` to iterate paths and circles**

Edit `src/xcs_gen/builder.py`. Inside `build_xcs`, find the block that seeds `layer_data` from `project.elements` (around line 312), and extend it to also seed from `paths` and `circles`:

```python
    # Seed layer colors from all element sources.
    seen_colors: set[str] = set()

    def _add_layer(color: str) -> None:
        nonlocal order
        if color and color not in seen_colors:
            seen_colors.add(color)
            layer_data[color] = {
                "name": color.upper(),
                "order": order,
                "visible": True,
            }
            order += 1

    for elem in project.elements:
        if not elem.layer_color:
            elem.layer_color = GRADIENT_LAYER_COLOR
        _add_layer(elem.layer_color)
    for p in project.paths:
        _add_layer(p.layer_color)
    for c in project.circles:
        _add_layer(c.layer_color)
    for disp in project.extra_displays:
        _add_layer(disp.get("layerColor", ""))
```

Then extend the `displays` assembly:

```python
    # Build displays: rects + paths + circles + extras
    displays: list[dict[str, Any]] = []
    for elem in project.elements:
        displays.append(_build_rect_display(elem))
    for p in project.paths:
        displays.append(_build_path_display(p))
    for c in project.circles:
        displays.append(_build_circle_display(c))
    displays.extend(project.extra_displays)
```

And extend the `display_entries` assembly:

```python
    # Build device display processing map: rects + paths + circles + extras
    display_entries: list[list[Any]] = []
    for elem in project.elements:
        display_entries.append([
            elem.id,
            {
                "isFill": elem.is_fill,
                "type": "RECT",
                "processingType": elem.processing_type,
                "data": _build_processing_data(elem.params),
                "processIgnore": False,
                "isWhiteModel": True,
            },
        ])
    for p in project.paths:
        display_entries.append([
            p.id,
            {
                "isFill": p.is_fill,
                "type": "PATH",
                "processingType": p.processing_type,
                "data": _build_processing_data(p.params),
                "processIgnore": False,
                "isWhiteModel": True,
            },
        ])
    for c in project.circles:
        display_entries.append([
            c.id,
            {
                "isFill": c.is_fill,
                "type": "CIRCLE",
                "processingType": c.processing_type,
                "data": _build_processing_data(c.params),
                "processIgnore": False,
                "isWhiteModel": True,
            },
        ])
    for entry_id, entry_data in project.extra_device_entries:
        display_entries.append([entry_id, entry_data])
```

- [ ] **Step 4: Run the full suite**

Run: `pytest -v`
Expected: all existing tests still pass, both new tests in `test_svg_builder.py` pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/builder.py tests/test_svg_builder.py
git commit -m "Extend build_xcs to iterate paths and circles"
```

---

### Task 6: SVG parser — normalized shape extraction

Produce a list of `ParsedShape` records from an SVG path, with transforms baked in, effective fill/stroke resolved, and a scaled/offset `d` string for each shape.

**Files:**
- Create: `src/xcs_gen/svg_source.py`
- Create: `tests/test_svg_source.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_svg_source.py`:

```python
"""Tests for svg_source parsing."""

import io
import tempfile

from xcs_gen.svg_source import ParsedShape, parse_svg


def _write(content: str) -> str:
    path = tempfile.mktemp(suffix=".svg")
    with open(path, "w") as f:
        f.write(content)
    return path


INLINE_BASIC = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="10" y="20" width="30" height="40" fill="#ff0000"/>
  <circle cx="50" cy="50" r="10" fill="none" stroke="#00ff00" stroke-width="1"/>
  <path d="M 0,0 L 20,20 Z" fill="#0000ff"/>
</svg>
"""


INLINE_TRANSFORMED = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <g transform="translate(50, 0)">
    <rect x="0" y="0" width="20" height="20" fill="#ffd73e"/>
  </g>
</svg>
"""


def test_parse_svg_basic_shape_count():
    path = _write(INLINE_BASIC)
    result = parse_svg(path, total_width=100.0, total_height=None)
    # rect + circle + path = 3 shapes
    assert len(result.shapes) == 3


def test_parse_svg_fill_and_stroke_resolved():
    path = _write(INLINE_BASIC)
    result = parse_svg(path, total_width=100.0, total_height=None)

    by_kind = {s.kind: s for s in result.shapes}
    assert by_kind["rect"].fill == "#ff0000"
    assert by_kind["rect"].stroke is None  # no stroke attribute

    assert by_kind["circle"].fill is None  # fill="none"
    assert by_kind["circle"].stroke == "#00ff00"

    assert by_kind["path"].fill == "#0000ff"


def test_parse_svg_transform_baked_into_bbox():
    path = _write(INLINE_TRANSFORMED)
    # SVG is 100x100 in doc units, asking for 100mm output → scale 1:1
    result = parse_svg(path, total_width=100.0, total_height=None)
    shape = result.shapes[0]
    # The rect was translated by (50, 0) in doc space, should end up around x=50.
    # Plus the default start_x offset of 0 (we pass 0 here via total_width only).
    assert shape.bbox_x_mm >= 50 - 0.01
    assert shape.bbox_x_mm < 51
    assert shape.bbox_width_mm >= 19.9
    assert shape.bbox_width_mm <= 20.1


def test_parse_svg_lowercase_hex_normalization():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="#FFD73E"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=10.0, total_height=None)
    assert result.shapes[0].fill == "#ffd73e"


def test_parse_svg_named_color_expanded():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="red"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=10.0, total_height=None)
    assert result.shapes[0].fill == "#ff0000"


def test_parse_svg_none_and_transparent_become_none():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="none" stroke="transparent"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=10.0, total_height=None)
    assert result.shapes[0].fill is None
    assert result.shapes[0].stroke is None


def test_parse_svg_aspect_preserved_when_only_width():
    # 200x100 viewBox, ask for 100mm wide → 50mm tall
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200mm" height="100mm">
  <rect x="0" y="0" width="200" height="100" fill="#000000"/>
</svg>
"""
    path = _write(content)
    result = parse_svg(path, total_width=100.0, total_height=None)
    assert abs(result.output_width_mm - 100.0) < 0.01
    assert abs(result.output_height_mm - 50.0) < 0.01
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_source.py -v`
Expected: `ImportError` on `parse_svg`.

- [ ] **Step 3: Implement the parser**

Create `src/xcs_gen/svg_source.py`:

```python
"""SVG parsing for the svg-to-laser pipeline.

Reads an SVG via svgelements (which bakes transforms and resolves styles),
converts shapes to normalized ParsedShape records carrying absolute-coord
SVG path strings in bed-mm coordinates.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Literal

from svgelements import (
    SVG,
    Circle as SVGCircle,
    Ellipse as SVGEllipse,
    Line as SVGLine,
    Path as SVGPath,
    Polygon as SVGPolygon,
    Polyline as SVGPolyline,
    Rect as SVGRect,
    Shape as SVGShape,
)


ShapeKind = Literal["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"]


@dataclass
class ParsedShape:
    """A single SVG shape normalized into bed-mm coordinates."""

    kind: ShapeKind
    d: str                        # SVG path d string in bed-mm coords
    bbox_x_mm: float
    bbox_y_mm: float
    bbox_width_mm: float
    bbox_height_mm: float
    fill: str | None              # lowercase "#rrggbb" or None
    stroke: str | None
    fill_rule: Literal["evenodd", "nonzero"] = "evenodd"
    is_close_path: bool = True
    # For native CIRCLE emission we also keep the circle's derived props:
    circle_cx_mm: float | None = None
    circle_cy_mm: float | None = None
    circle_r_mm: float | None = None


@dataclass
class ParseResult:
    """Result of parsing an SVG file."""

    shapes: list[ParsedShape] = field(default_factory=list)
    output_width_mm: float = 0.0
    output_height_mm: float = 0.0
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (kind, id)


def parse_svg(
    svg_path: str,
    *,
    total_width: float,
    total_height: float | None,
    start_x: float = 0.0,
    start_y: float = 0.0,
) -> ParseResult:
    """Parse an SVG into a list of ParsedShape records.

    Args:
        svg_path: filesystem path to the .svg file.
        total_width: output width in bed-mm. The SVG is uniformly scaled.
        total_height: output height in bed-mm. If None, aspect ratio is preserved.
        start_x: bed-mm x offset applied to every shape.
        start_y: bed-mm y offset applied to every shape.

    Returns:
        ParseResult with normalized shapes and skipped-element log.
    """
    svg = SVG.parse(source=svg_path)
    src_w = float(svg.width) if svg.width else None
    src_h = float(svg.height) if svg.height else None
    if not src_w or not src_h:
        # Fall back to viewBox bounds if width/height missing.
        vb = getattr(svg, "viewbox", None)
        if vb is not None:
            src_w = float(vb.width)
            src_h = float(vb.height)
    if not src_w or not src_h:
        raise ValueError(
            f"SVG {svg_path}: cannot determine source dimensions "
            "(no width/height or viewBox)."
        )

    scale_x = total_width / src_w
    if total_height is None:
        scale_y = scale_x
        out_h = src_h * scale_y
    else:
        scale_y = total_height / src_h
        out_h = total_height

    result = ParseResult(output_width_mm=total_width, output_height_mm=out_h)

    for element in svg.elements():
        if not isinstance(element, SVGShape):
            continue
        shape = _normalize_shape(
            element,
            scale_x=scale_x, scale_y=scale_y,
            start_x=start_x, start_y=start_y,
            result=result,
        )
        if shape is not None:
            result.shapes.append(shape)

    return result


_UNSUPPORTED_LOGGED: set[str] = set()


def _normalize_shape(
    element: SVGShape,
    *,
    scale_x: float,
    scale_y: float,
    start_x: float,
    start_y: float,
    result: ParseResult,
) -> ParsedShape | None:
    """Convert one svgelements Shape to a ParsedShape, or return None if skipped."""
    kind = _shape_kind(element)
    if kind is None:
        tag = type(element).__name__
        el_id = getattr(element, "id", "") or ""
        if tag not in _UNSUPPORTED_LOGGED:
            print(f"[svg_source] skipping unsupported element <{tag}> (id={el_id!r})",
                  file=sys.stderr)
            _UNSUPPORTED_LOGGED.add(tag)
        result.skipped.append((tag, el_id))
        return None

    # svgelements composes transforms into the shape; convert to absolute SVGPath.
    try:
        path = SVGPath(element)  # accepts any Shape subclass
    except Exception as exc:
        el_id = getattr(element, "id", "") or ""
        print(f"[svg_source] failed to normalize element id={el_id!r}: {exc}",
              file=sys.stderr)
        result.skipped.append((type(element).__name__, el_id))
        return None

    # Apply mm-scale and bed-origin offset to every segment endpoint.
    path = _scale_and_offset(path, scale_x, scale_y, start_x, start_y)

    bbox = path.bbox()
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    bbox_w = x1 - x0
    bbox_h = y1 - y0
    if bbox_w <= 0 or bbox_h <= 0:
        return None

    d_str = path.d()
    if not d_str:
        return None

    fill = _normalize_color(getattr(element, "fill", None))
    stroke = _normalize_color(getattr(element, "stroke", None))
    fill_rule = _fill_rule(element)
    is_close = _is_close_path(path)

    ps = ParsedShape(
        kind=kind,
        d=d_str,
        bbox_x_mm=x0,
        bbox_y_mm=y0,
        bbox_width_mm=bbox_w,
        bbox_height_mm=bbox_h,
        fill=fill,
        stroke=stroke,
        fill_rule=fill_rule,
        is_close_path=is_close,
    )
    if kind == "circle" and isinstance(element, SVGCircle):
        ps.circle_cx_mm = (x0 + x1) / 2
        ps.circle_cy_mm = (y0 + y1) / 2
        ps.circle_r_mm = bbox_w / 2
    return ps


def _shape_kind(element: SVGShape) -> ShapeKind | None:
    if isinstance(element, SVGPath):
        return "path"
    if isinstance(element, SVGRect):
        return "rect"
    if isinstance(element, SVGCircle):
        return "circle"
    if isinstance(element, SVGEllipse):
        return "ellipse"
    if isinstance(element, SVGLine):
        return "line"
    if isinstance(element, SVGPolygon):
        return "polygon"
    if isinstance(element, SVGPolyline):
        return "polyline"
    return None


def _scale_and_offset(
    path: SVGPath, scale_x: float, scale_y: float, offset_x: float, offset_y: float
) -> SVGPath:
    """Apply uniform scale + offset to every point in a path. Returns new SVGPath."""
    # svgelements transforms API: .transform works via affine matrix; simplest is
    # to apply a transform string and re-parse.
    transform = f"matrix({scale_x} 0 0 {scale_y} {offset_x} {offset_y})"
    new_path = SVGPath(path)
    new_path *= transform  # svgelements supports matrix post-multiply via *= transform
    return new_path


def _normalize_color(color) -> str | None:
    if color is None:
        return None
    s = str(color).strip().lower()
    if s in ("", "none", "transparent"):
        return None
    # svgelements returns "#rrggbb" for most inputs; handle short hex.
    if s.startswith("#") and len(s) == 4:
        s = "#" + "".join(c * 2 for c in s[1:])
    if not (s.startswith("#") and len(s) == 7):
        return None
    return s


def _fill_rule(element: SVGShape) -> Literal["evenodd", "nonzero"]:
    rule = getattr(element, "fill_rule", None)
    if rule is None:
        return "evenodd"
    r = str(rule).lower()
    return "nonzero" if r == "nonzero" else "evenodd"


def _is_close_path(path: SVGPath) -> bool:
    # Check for a 'Z' / 'z' close-path command in the d-string.
    d = path.d() or ""
    return d.strip().endswith(("z", "Z"))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_svg_source.py -v`
Expected: all 7 tests pass. If any fail, inspect the `svgelements` API — the specific operations we rely on are `.elements()`, `SVGPath(element)`, `path.bbox()`, `path.d()`, `*= "matrix(...)"`. Consult the library source if necessary (`python -c "import svgelements; print(svgelements.__file__)"`).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/svg_source.py tests/test_svg_source.py
git commit -m "Add SVG parser with normalized bed-mm shapes"
```

---

### Task 7: `detect_svg_colors()` helper

**Files:**
- Modify: `src/xcs_gen/svg_source.py` (append)
- Modify: `tests/test_svg_source.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_svg_source.py`:

```python
from xcs_gen.svg_source import DetectedColor, detect_svg_colors


def test_detect_colors_basic():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="#ff0000"/>
  <rect x="5" y="0" width="5" height="5" fill="#ff0000"/>
  <circle cx="5" cy="5" r="2" fill="none" stroke="#00ff00"/>
</svg>
"""
    path = _write(content)
    colors = detect_svg_colors(path)
    by_hex = {c.hex: c for c in colors}
    assert by_hex["#ff0000"].source == "fill"
    assert by_hex["#ff0000"].shape_count == 2
    assert by_hex["#00ff00"].source == "stroke"
    assert by_hex["#00ff00"].shape_count == 1


def test_detect_colors_both_fill_and_stroke():
    content = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm" height="10mm">
  <rect x="0" y="0" width="5" height="5" fill="#000000" stroke="#000000"/>
</svg>
"""
    path = _write(content)
    colors = detect_svg_colors(path)
    assert len(colors) == 1
    assert colors[0].hex == "#000000"
    assert colors[0].source == "both"
    assert colors[0].shape_count == 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_source.py -v`
Expected: `ImportError` on `detect_svg_colors`.

- [ ] **Step 3: Implement `detect_svg_colors`**

Append to `src/xcs_gen/svg_source.py`:

```python
@dataclass
class DetectedColor:
    """A colour detected in the SVG, with the role it plays."""

    hex: str                                       # lowercase "#rrggbb"
    source: Literal["fill", "stroke", "both"]
    shape_count: int


def detect_svg_colors(svg_path: str) -> list[DetectedColor]:
    """Return every unique fill/stroke colour used by shapes in the SVG."""
    # Minimal parse (scale/offset don't matter for colour detection).
    result = parse_svg(svg_path, total_width=100.0, total_height=None)

    fill_counts: dict[str, int] = {}
    stroke_counts: dict[str, int] = {}
    for shape in result.shapes:
        if shape.fill:
            fill_counts[shape.fill] = fill_counts.get(shape.fill, 0) + 1
        if shape.stroke:
            stroke_counts[shape.stroke] = stroke_counts.get(shape.stroke, 0) + 1

    out: list[DetectedColor] = []
    for hex_color in sorted(set(fill_counts) | set(stroke_counts)):
        in_fill = hex_color in fill_counts
        in_stroke = hex_color in stroke_counts
        if in_fill and in_stroke:
            source: Literal["fill", "stroke", "both"] = "both"
            count = max(fill_counts[hex_color], stroke_counts[hex_color])
        elif in_fill:
            source = "fill"
            count = fill_counts[hex_color]
        else:
            source = "stroke"
            count = stroke_counts[hex_color]
        out.append(DetectedColor(hex=hex_color, source=source, shape_count=count))
    return out
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_svg_source.py -v`
Expected: all tests pass (including the new two).

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/svg_source.py tests/test_svg_source.py
git commit -m "Add detect_svg_colors helper"
```

---

### Task 8: Layer config and auto-ramp

**Files:**
- Modify: `src/xcs_gen/svg_source.py` (append)
- Create: `tests/test_svg_layers.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_svg_layers.py`:

```python
"""Tests for LayerConfig / AutoRamp / resolve_layer_params."""

from xcs_gen.model import ProcessingParams
from xcs_gen.svg_source import (
    AutoRamp,
    LayerAssignment,
    LayerConfig,
    resolve_layer_params,
)


def _base() -> ProcessingParams:
    return ProcessingParams(power=50, speed=1000)


def test_resolve_uses_explicit_layer_config():
    explicit = {
        "#ff0000": LayerConfig(
            params=ProcessingParams(power=77, speed=500),
            render_mode="vector_cut",
        ),
    }
    assignment = resolve_layer_params(
        detected_colors=["#ff0000"],
        layer_config=explicit,
        auto_ramp=None,
        base_params=_base(),
    )
    assert assignment["#ff0000"].params.power == 77
    assert assignment["#ff0000"].render_mode == "vector_cut"


def test_resolve_auto_ramp_luminance_sort():
    # Black darker than white → black gets max_value, white gets min_value.
    ramp = AutoRamp(
        param="power", min_value=20, max_value=80,
        sort_by="luminance", default_render_mode="fill_engrave",
    )
    assignment = resolve_layer_params(
        detected_colors=["#ffffff", "#000000"],
        layer_config=None,
        auto_ramp=ramp,
        base_params=_base(),
    )
    assert assignment["#000000"].params.power == 80
    assert assignment["#ffffff"].params.power == 20


def test_resolve_auto_ramp_order_of_appearance():
    ramp = AutoRamp(
        param="speed", min_value=500, max_value=2000,
        sort_by="order_of_appearance", default_render_mode="fill_engrave",
    )
    assignment = resolve_layer_params(
        detected_colors=["#111111", "#222222", "#333333"],
        layer_config=None,
        auto_ramp=ramp,
        base_params=_base(),
    )
    # First→min, last→max, middle linearly interpolated.
    assert assignment["#111111"].params.speed == 500
    assert assignment["#222222"].params.speed == 1250
    assert assignment["#333333"].params.speed == 2000


def test_resolve_explicit_wins_over_ramp():
    explicit = {
        "#000000": LayerConfig(
            params=ProcessingParams(power=99),
            render_mode="vector_cut",
        ),
    }
    ramp = AutoRamp(
        param="power", min_value=20, max_value=80,
        sort_by="luminance", default_render_mode="fill_engrave",
    )
    assignment = resolve_layer_params(
        detected_colors=["#000000", "#ffffff"],
        layer_config=explicit,
        auto_ramp=ramp,
        base_params=_base(),
    )
    # Black is explicit — power=99, render=cut. White uses ramp.
    assert assignment["#000000"].params.power == 99
    assert assignment["#000000"].render_mode == "vector_cut"
    # Ramp runs only on #ffffff (the sole remaining colour) → gets min_value.
    assert assignment["#ffffff"].params.power == 20


def test_resolve_raises_when_no_config_covers_color():
    import pytest
    with pytest.raises(ValueError, match="#ff0000"):
        resolve_layer_params(
            detected_colors=["#ff0000", "#00ff00"],
            layer_config=None,
            auto_ramp=None,
            base_params=_base(),
        )


def test_layer_assignment_carries_processing_type():
    """The render_mode → XCS processingType mapping is surfaced on the assignment."""
    explicit = {
        "#000000": LayerConfig(
            params=ProcessingParams(), render_mode="vector_cut",
        ),
    }
    assignment = resolve_layer_params(
        detected_colors=["#000000"],
        layer_config=explicit,
        auto_ramp=None,
        base_params=_base(),
    )
    assert assignment["#000000"].processing_type == "VECTOR_CUTTING"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_layers.py -v`
Expected: `ImportError` on the new names.

- [ ] **Step 3: Implement `LayerConfig` / `AutoRamp` / `LayerAssignment` / `resolve_layer_params`**

Append to `src/xcs_gen/svg_source.py`:

```python
from .model import ProcessingParams

RenderMode = Literal["fill_engrave", "vector_engrave", "vector_cut"]

_RENDER_MODE_TO_PROCESSING: dict[str, str] = {
    "fill_engrave": "COLOR_FILL_ENGRAVE",
    "vector_engrave": "VECTOR_ENGRAVING",
    "vector_cut": "VECTOR_CUTTING",
}


@dataclass
class LayerConfig:
    """Explicit params for a single colour layer."""

    params: ProcessingParams
    render_mode: RenderMode = "fill_engrave"


@dataclass
class AutoRamp:
    """Automatic parameter ramp across detected colours."""

    param: str                                         # e.g. "power", "speed"
    min_value: float                                   # assigned to first in sort
    max_value: float                                   # assigned to last in sort
    sort_by: Literal["luminance", "hue", "order_of_appearance"] = "luminance"
    default_render_mode: RenderMode = "fill_engrave"


@dataclass
class LayerAssignment:
    """Resolved per-colour params + render mode, ready to emit."""

    params: ProcessingParams
    render_mode: RenderMode
    processing_type: str


def resolve_layer_params(
    *,
    detected_colors: list[str],
    layer_config: dict[str, LayerConfig] | None,
    auto_ramp: AutoRamp | None,
    base_params: ProcessingParams,
) -> dict[str, LayerAssignment]:
    """Produce one LayerAssignment per detected colour.

    Resolution order:
      1. explicit layer_config entry
      2. auto_ramp (applied only to colours not in layer_config)
      3. ValueError if neither covers a colour.
    """
    layer_config = layer_config or {}
    out: dict[str, LayerAssignment] = {}

    # 1. Apply explicit entries.
    for color, cfg in layer_config.items():
        out[color] = LayerAssignment(
            params=cfg.params,
            render_mode=cfg.render_mode,
            processing_type=_RENDER_MODE_TO_PROCESSING[cfg.render_mode],
        )

    # 2. Apply auto-ramp to remaining colours in the order they were detected.
    remaining = [c for c in detected_colors if c not in out]
    if remaining:
        if auto_ramp is None:
            raise ValueError(
                f"No layer_config or auto_ramp covers colours: {remaining}. "
                "Provide layer_config entries or pass an AutoRamp."
            )
        ordered = _sort_for_ramp(remaining, auto_ramp.sort_by)
        values = _linspace(auto_ramp.min_value, auto_ramp.max_value, len(ordered))
        for color, value in zip(ordered, values):
            params = _copy_params(base_params)
            _set_ramp_param(params, auto_ramp.param, value)
            out[color] = LayerAssignment(
                params=params,
                render_mode=auto_ramp.default_render_mode,
                processing_type=_RENDER_MODE_TO_PROCESSING[auto_ramp.default_render_mode],
            )
        if len(ordered) == 1:
            print(
                "[svg_source] auto-ramp applied to only one colour; "
                f"assigning min_value ({auto_ramp.min_value}).",
                file=sys.stderr,
            )

    return out


def _sort_for_ramp(
    colors: list[str],
    mode: Literal["luminance", "hue", "order_of_appearance"],
) -> list[str]:
    if mode == "order_of_appearance":
        return list(colors)
    if mode == "luminance":
        # Sort descending by luminance so that darkest ends up last (→ max_value).
        return sorted(colors, key=_luminance, reverse=True)
    if mode == "hue":
        return sorted(colors, key=_hue)
    return list(colors)


def _luminance(hex_color: str) -> float:
    r, g, b = _hex_to_rgb(hex_color)
    return 0.299 * r + 0.587 * g + 0.114 * b


def _hue(hex_color: str) -> float:
    r, g, b = (c / 255 for c in _hex_to_rgb(hex_color))
    mx = max(r, g, b)
    mn = min(r, g, b)
    d = mx - mn
    if d == 0:
        return 0.0
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = ((b - r) / d) + 2
    else:
        h = ((r - g) / d) + 4
    return h * 60


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    return (
        int(hex_color[1:3], 16),
        int(hex_color[3:5], 16),
        int(hex_color[5:7], 16),
    )


def _linspace(a: float, b: float, n: int) -> list[float]:
    if n <= 1:
        return [a]
    step = (b - a) / (n - 1)
    return [a + step * i for i in range(n)]


def _copy_params(p: ProcessingParams) -> ProcessingParams:
    return ProcessingParams(
        speed=p.speed, power=p.power, repeat=p.repeat, density=p.density,
        pulse_width=p.pulse_width, mopa_frequency=p.mopa_frequency, dpi=p.dpi,
        dot_duration=p.dot_duration,
        processing_light_source=p.processing_light_source,
        scan_angle=p.scan_angle, angle_type=p.angle_type, cross_angle=p.cross_angle,
    )


_RAMP_FIELD_MAP = {
    "speed": ("speed", True),
    "power": ("power", False),
    "frequency": ("mopa_frequency", True),
    "mopa_frequency": ("mopa_frequency", True),
    "density": ("density", True),
    "passes": ("repeat", True),
    "repeat": ("repeat", True),
    "pulse_width": ("pulse_width", True),
    "dpi": ("dpi", True),
}


def _set_ramp_param(params: ProcessingParams, name: str, value: float) -> None:
    if name not in _RAMP_FIELD_MAP:
        raise ValueError(f"Unknown ramp param {name!r}. "
                         f"Valid: {sorted(_RAMP_FIELD_MAP)}")
    field_name, is_int = _RAMP_FIELD_MAP[name]
    setattr(params, field_name, int(round(value)) if is_int else value)
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_svg_layers.py -v`
Expected: all six tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/svg_source.py tests/test_svg_layers.py
git commit -m "Add LayerConfig/AutoRamp/resolve_layer_params"
```

---

### Task 9: `generate_from_svg()` end-to-end

**Files:**
- Modify: `src/xcs_gen/generators.py` (append)
- Create: `tests/test_svg_generator.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_svg_generator.py`:

```python
"""Tests for generate_from_svg."""

import tempfile

from xcs_gen.builder import build_xcs
from xcs_gen.generators import generate_from_svg
from xcs_gen.model import ProcessingParams
from xcs_gen.svg_source import AutoRamp, LayerConfig


def _write(content: str) -> str:
    path = tempfile.mktemp(suffix=".svg")
    with open(path, "w") as f:
        f.write(content)
    return path


TWO_COLOR = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="0" y="0" width="50" height="50" fill="#000000"/>
  <rect x="50" y="50" width="50" height="50" fill="#ffffff"/>
</svg>
"""


FILL_AND_STROKE = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="0" y="0" width="50" height="50" fill="#ff0000" stroke="#000000" stroke-width="1"/>
</svg>
"""


def test_generate_from_svg_element_count():
    path = _write(TWO_COLOR)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80,
            sort_by="luminance",
        ),
    )
    # Two fills, no strokes → two paths.
    assert len(project.paths) == 2


def test_generate_from_svg_fill_and_stroke_double_emission():
    path = _write(FILL_AND_STROKE)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        layer_config={
            "#ff0000": LayerConfig(params=ProcessingParams(power=40)),
            "#000000": LayerConfig(
                params=ProcessingParams(power=90), render_mode="vector_cut",
            ),
        },
    )
    # One shape, one fill, one stroke → two emitted paths.
    assert len(project.paths) == 2
    fill_path = next(p for p in project.paths if p.layer_color == "#ff0000")
    stroke_path = next(p for p in project.paths if p.layer_color == "#000000")
    assert fill_path.processing_type == "COLOR_FILL_ENGRAVE"
    assert stroke_path.processing_type == "VECTOR_CUTTING"
    assert fill_path.params.power == 40
    assert stroke_path.params.power == 90


def test_generate_from_svg_power_ramp_by_luminance():
    path = _write(TWO_COLOR)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80, sort_by="luminance",
        ),
    )
    black_path = next(p for p in project.paths if p.layer_color == "#000000")
    white_path = next(p for p in project.paths if p.layer_color == "#ffffff")
    assert black_path.params.power == 80
    assert white_path.params.power == 20


def test_generate_from_svg_roundtrips_through_builder():
    path = _write(TWO_COLOR)
    project = generate_from_svg(
        svg_path=path,
        total_width=100.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80, sort_by="luminance",
        ),
    )
    out = build_xcs(project)
    types = [d["type"] for d in out["canvas"][0]["displays"]]
    assert types.count("PATH") == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_generator.py -v`
Expected: `ImportError` on `generate_from_svg`.

- [ ] **Step 3: Implement the generator**

Edit `src/xcs_gen/generators.py`. Add to the top-level imports:

```python
from .model import (
    ANNOTATION_LAYER_COLOR,
    GRADIENT_LAYER_COLOR,
    Circle,
    Line,
    Path,
    ProcessingParams,
    Rect,
    XCSProject,
)
```

At the bottom of the file, append:

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
    """Generate an XCSProject from an SVG with per-colour parameters.

    Each unique fill or stroke colour becomes a layer. For each shape:
    - If it has a fill colour, one Path is emitted with that layer's params
      and processing type.
    - If it has a stroke colour, a second Path is emitted with that layer's
      params and processing type.

    Args:
        svg_path: filesystem path to the SVG file.
        layer_config: optional dict of hex-colour → LayerConfig (explicit params
            + render mode).
        auto_ramp: optional AutoRamp; used for colours absent from layer_config.
        total_width: output width in bed-mm.
        total_height: output height in bed-mm. None preserves aspect ratio.
        start_x, start_y: bed-mm offset applied to all shapes.
        base_params: baseline ProcessingParams for auto-ramp defaults.

    Returns:
        XCSProject populated with Path elements ready for build_xcs().
    """
    from .svg_source import detect_svg_colors, parse_svg, resolve_layer_params

    if base_params is None:
        base_params = ProcessingParams()

    # Parse once for shapes, then collect detected colour list in appearance order.
    parse_result = parse_svg(
        svg_path,
        total_width=total_width,
        total_height=total_height,
        start_x=start_x,
        start_y=start_y,
    )
    if not parse_result.shapes:
        raise ValueError(f"No supported shapes found in {svg_path}.")

    detected_in_order: list[str] = []
    seen: set[str] = set()
    for shape in parse_result.shapes:
        for color in (shape.fill, shape.stroke):
            if color and color not in seen:
                seen.add(color)
                detected_in_order.append(color)

    if not detected_in_order:
        raise ValueError(
            f"No colours detected in {svg_path} (all shapes have fill='none' "
            "and stroke='none')."
        )

    assignment = resolve_layer_params(
        detected_colors=detected_in_order,
        layer_config=layer_config,
        auto_ramp=auto_ramp,
        base_params=base_params,
    )

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


def _layers_for(shape) -> list[tuple[str, bool]]:
    """Return (colour, is_fill_layer) tuples this shape contributes to."""
    out: list[tuple[str, bool]] = []
    if shape.fill:
        out.append((shape.fill, True))
    if shape.stroke:
        out.append((shape.stroke, False))
    return out
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_svg_generator.py -v`
Expected: four PASS.

- [ ] **Step 5: Run the full suite**

Run: `pytest -v`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add src/xcs_gen/generators.py tests/test_svg_generator.py
git commit -m "Add generate_from_svg end-to-end generator"
```

---

### Task 10: CLI `svg detect` subcommand

**Files:**
- Modify: `src/xcs_gen/cli.py:108-180` (add subparser, add dispatch branch)
- Create: `tests/test_svg_cli.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_svg_cli.py`:

```python
"""Tests for the svg CLI subcommands."""

import io
import sys
import tempfile

import pytest

from xcs_gen.cli import main


TWO_COLOR = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <rect x="0" y="0" width="50" height="50" fill="#000000"/>
  <rect x="50" y="50" width="50" height="50" fill="#ffffff"/>
</svg>
"""


def _write_svg(content: str) -> str:
    path = tempfile.mktemp(suffix=".svg")
    with open(path, "w") as f:
        f.write(content)
    return path


def test_svg_detect_prints_colors(capsys):
    svg_path = _write_svg(TWO_COLOR)
    main(["svg", "detect", svg_path])
    out = capsys.readouterr().out
    assert "#000000" in out
    assert "#ffffff" in out
    assert "fill" in out
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_svg_cli.py -v`
Expected: argparse rejects the `svg` subcommand (fails with a system exit / "invalid choice" error).

- [ ] **Step 3: Wire in the `svg` subparser and the `detect` handler**

Edit `src/xcs_gen/cli.py`. After the `serve` subparser block (around line 108), insert:

```python
    # --- svg command ---
    svg_p = sub.add_parser("svg", help="SVG → per-layer laser parameters")
    svg_sub = svg_p.add_subparsers(dest="svg_command", required=True)

    # svg detect
    svg_det_p = svg_sub.add_parser("detect", help="List colours detected in an SVG")
    svg_det_p.add_argument("input", help="Path to input SVG file")
```

Then in the dispatch block (just before the existing `if args.command == "image":` branch — add a new branch above the existing ones):

```python
    if args.command == "svg":
        if args.svg_command == "detect":
            _svg_detect(args)
            return
        # svg generate branch added in Task 11
```

Add the helper function near the bottom of the file, above the `if __name__ == "__main__":` line:

```python
def _svg_detect(args) -> None:
    from .svg_source import detect_svg_colors

    colors = detect_svg_colors(args.input)
    if not colors:
        print("No colours detected (SVG may be empty or use only unsupported elements).")
        return

    # Simple table output.
    col_hex = max(len("colour"), max(len(c.hex) for c in colors))
    col_src = max(len("source"), max(len(c.source) for c in colors))
    col_cnt = max(len("shapes"), max(len(str(c.shape_count)) for c in colors))
    fmt = f"  {{:<{col_hex}}}  {{:<{col_src}}}  {{:>{col_cnt}}}"

    print(fmt.format("colour", "source", "shapes"))
    print(fmt.format("-" * col_hex, "-" * col_src, "-" * col_cnt))
    for c in colors:
        print(fmt.format(c.hex, c.source, c.shape_count))
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_svg_cli.py -v`
Expected: one PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xcs_gen/cli.py tests/test_svg_cli.py
git commit -m "Add xcs-gen svg detect CLI subcommand"
```

---

### Task 11: CLI `svg generate` subcommand

Adds the `svg generate` subcommand with `--ramp-*` flags and repeatable `--color` flags.

**Files:**
- Modify: `src/xcs_gen/cli.py` (extend `svg` subparser, add `_svg_generate`)
- Modify: `tests/test_svg_cli.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_svg_cli.py`:

```python
import json
import os


def test_svg_generate_with_auto_ramp(tmp_path):
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")

    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--ramp-param", "power",
        "--ramp-min", "20", "--ramp-max", "80",
    ])

    assert os.path.exists(out_path)
    with open(out_path) as f:
        data = json.load(f)
    displays = data["canvas"][0]["displays"]
    path_types = [d["type"] for d in displays]
    assert path_types.count("PATH") == 2


def test_svg_generate_with_explicit_color(tmp_path):
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")

    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--color", "#000000:vector_cut:500,80,65,100,2,200",
        "--ramp-param", "power",
        "--ramp-min", "20", "--ramp-max", "80",
    ])

    with open(out_path) as f:
        data = json.load(f)

    # #000000 is explicit with processing=VECTOR_CUTTING, power=80, speed=500.
    dev_entries = data["device"]["data"]["value"][0][1]["displays"]["value"]
    cuts = [e for e in dev_entries if e[1]["processingType"] == "VECTOR_CUTTING"]
    assert len(cuts) == 1
    cut_params = cuts[0][1]["data"]["VECTOR_CUTTING"]["parameter"]["customize"]
    assert cut_params["speed"] == 500
    assert cut_params["power"] == 80


def test_svg_generate_color_syntax_blank_fields(tmp_path):
    """Blank fields in --color inherit from --base-* defaults."""
    svg_path = _write_svg(TWO_COLOR)
    out_path = str(tmp_path / "out.xcs")

    main([
        "svg", "generate", svg_path,
        "-o", out_path,
        "--width", "50",
        "--power", "42",
        "--color", "#000000:fill_engrave:,,,,,",  # blanks everywhere
        "--ramp-param", "speed",
        "--ramp-min", "500", "--ramp-max", "2000",
    ])

    with open(out_path) as f:
        data = json.load(f)

    dev_entries = data["device"]["data"]["value"][0][1]["displays"]["value"]
    # #000000 is explicit; its power should come from --power default (42).
    black_entry = next(
        e for e in dev_entries
        if e[1]["data"]["COLOR_FILL_ENGRAVE"]["parameter"]["customize"]["power"] == 42
    )
    assert black_entry is not None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_svg_cli.py -v`
Expected: the three new tests fail — `svg_command == "generate"` is unhandled.

- [ ] **Step 3: Add the `generate` subparser**

Edit `src/xcs_gen/cli.py`. Inside the `svg_sub = svg_p.add_subparsers(...)` block (added in Task 10), add the generate subparser right after `svg_det_p`:

```python
    # svg generate
    svg_gen_p = svg_sub.add_parser("generate", help="Convert an SVG to an .xcs file")
    svg_gen_p.add_argument("input", help="Path to input SVG file")
    svg_gen_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")
    svg_gen_p.add_argument("--width", type=float, default=100.0,
                           help="Output width in mm (default: 100)")
    svg_gen_p.add_argument("--height", type=float, default=None,
                           help="Output height in mm (default: preserve aspect ratio)")
    svg_gen_p.add_argument("--start-x", type=float, default=10.0,
                           help="X origin on the bed in mm (default: 10)")
    svg_gen_p.add_argument("--start-y", type=float, default=10.0,
                           help="Y origin on the bed in mm (default: 10)")

    # Auto-ramp flags
    svg_gen_p.add_argument("--ramp-param", default=None,
                           help="Parameter to auto-ramp across detected colours")
    svg_gen_p.add_argument("--ramp-min", type=float, default=None,
                           help="Ramp min (assigned to first colour in sort)")
    svg_gen_p.add_argument("--ramp-max", type=float, default=None,
                           help="Ramp max (assigned to last colour in sort)")
    svg_gen_p.add_argument("--ramp-sort", default="luminance",
                           choices=["luminance", "hue", "order_of_appearance"],
                           help="Sort mode for auto-ramp (default: luminance)")
    svg_gen_p.add_argument("--ramp-mode", default="fill_engrave",
                           choices=["fill_engrave", "vector_engrave", "vector_cut"],
                           help="Render mode for auto-ramp (default: fill_engrave)")

    # Explicit per-colour overrides (repeatable)
    svg_gen_p.add_argument("--color", action="append", default=[], dest="color_overrides",
                           help="Per-colour override: '<hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>'. Blank fields inherit from --base-* flags.")

    # Shared base-params flags (same as image/generate)
    svg_gen_p.add_argument("--power", type=float, default=50.0, help="Laser power %% (default: 50)")
    svg_gen_p.add_argument("--speed", type=int, default=1000, help="Speed mm/s (default: 1000)")
    svg_gen_p.add_argument("--frequency", type=int, default=65, help="MOPA frequency Hz (default: 65)")
    svg_gen_p.add_argument("--density", type=int, default=100, help="Lines per cm (default: 100)")
    svg_gen_p.add_argument("--passes", type=int, default=1, help="Number of passes (default: 1)")
    svg_gen_p.add_argument("--pulse-width", type=int, default=200, help="Pulse width ns (default: 200)")
    svg_gen_p.add_argument("--laser", default="red", choices=["red", "blue"],
                           help="Laser source (default: red)")
```

In the `svg` dispatch branch, extend it:

```python
    if args.command == "svg":
        if args.svg_command == "detect":
            _svg_detect(args)
            return
        if args.svg_command == "generate":
            _svg_generate(args)
            return
```

- [ ] **Step 4: Implement `_svg_generate` and the `--color` parser**

Append to `src/xcs_gen/cli.py` (above `if __name__ == "__main__":`):

```python
def _svg_generate(args) -> None:
    from .builder import write_xcs
    from .generators import generate_from_svg
    from .model import ProcessingParams
    from .svg_source import AutoRamp, LayerConfig

    base_params = ProcessingParams(
        power=args.power, speed=args.speed,
        mopa_frequency=args.frequency, density=args.density,
        repeat=args.passes, pulse_width=args.pulse_width,
        processing_light_source=args.laser,
    )

    # Parse --color overrides
    layer_config: dict[str, LayerConfig] = {}
    for override in args.color_overrides:
        color, cfg = _parse_color_override(override, base_params)
        layer_config[color] = cfg

    # Build AutoRamp if any ramp flags were given
    auto_ramp = None
    if args.ramp_param is not None:
        if args.ramp_min is None or args.ramp_max is None:
            raise SystemExit("--ramp-param requires --ramp-min and --ramp-max.")
        auto_ramp = AutoRamp(
            param=args.ramp_param,
            min_value=args.ramp_min,
            max_value=args.ramp_max,
            sort_by=args.ramp_sort,
            default_render_mode=args.ramp_mode,
        )

    project = generate_from_svg(
        svg_path=args.input,
        layer_config=layer_config or None,
        auto_ramp=auto_ramp,
        total_width=args.width,
        total_height=args.height,
        start_x=args.start_x,
        start_y=args.start_y,
        base_params=base_params,
    )

    write_xcs(project, args.output)

    print(f"Generated {len(project.paths)} path displays from {args.input}")
    print(f"  Written to: {args.output}")


def _parse_color_override(override: str, base: "ProcessingParams"):
    """Parse '<hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>'.

    Blank fields inherit from base. Mode defaults to 'fill_engrave' if blank.
    """
    from .model import ProcessingParams
    from .svg_source import LayerConfig

    try:
        hex_part, mode_part, rest = override.split(":", 2)
    except ValueError:
        raise SystemExit(
            f"Invalid --color value {override!r}. "
            "Expected '<hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>'."
        )

    color = hex_part.strip().lower()
    if not (color.startswith("#") and len(color) == 7):
        raise SystemExit(f"Invalid hex colour in --color: {hex_part!r}")

    mode = mode_part.strip() or "fill_engrave"
    if mode not in ("fill_engrave", "vector_engrave", "vector_cut"):
        raise SystemExit(
            f"Invalid mode in --color: {mode!r}. "
            "Must be fill_engrave | vector_engrave | vector_cut."
        )

    fields = rest.split(",")
    if len(fields) != 6:
        raise SystemExit(
            f"Invalid --color fields {rest!r}. Expected 6 comma-separated numbers."
        )

    def _num(value: str, default, cast):
        value = value.strip()
        return default if value == "" else cast(value)

    speed = _num(fields[0], base.speed, lambda s: int(round(float(s))))
    power = _num(fields[1], base.power, float)
    frequency = _num(fields[2], base.mopa_frequency, int)
    density = _num(fields[3], base.density, int)
    passes = _num(fields[4], base.repeat, int)
    pulse_width = _num(fields[5], base.pulse_width, int)

    params = ProcessingParams(
        speed=speed, power=power, mopa_frequency=frequency,
        density=density, repeat=passes, pulse_width=pulse_width,
        processing_light_source=base.processing_light_source,
    )
    return color, LayerConfig(params=params, render_mode=mode)
```

- [ ] **Step 5: Run the tests**

Run: `pytest tests/test_svg_cli.py -v`
Expected: all 4 tests in this file pass.

- [ ] **Step 6: Run the full suite**

Run: `pytest -v`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen/cli.py tests/test_svg_cli.py
git commit -m "Add xcs-gen svg generate CLI subcommand"
```

---

### Task 12: Integration test with `samples/Pikachu.svg`

**Files:**
- Modify: `tests/test_svg_generator.py` (append)

- [ ] **Step 1: Write the integration test**

Append to `tests/test_svg_generator.py`:

```python
from pathlib import Path as _Path

from xcs_gen.svg_source import AutoRamp, detect_svg_colors


SAMPLE_PIKACHU = _Path(__file__).parent.parent / "samples" / "Pikachu.svg"


def test_pikachu_colors_detected():
    if not SAMPLE_PIKACHU.exists():
        import pytest
        pytest.skip("samples/Pikachu.svg missing")
    colors = detect_svg_colors(str(SAMPLE_PIKACHU))
    hex_set = {c.hex for c in colors}
    # Pikachu has at least black outlines and yellow body.
    assert "#000000" in hex_set
    assert "#ffd73e" in hex_set


def test_pikachu_round_trip(tmp_path):
    if not SAMPLE_PIKACHU.exists():
        import pytest
        pytest.skip("samples/Pikachu.svg missing")

    from xcs_gen.builder import write_xcs

    project = generate_from_svg(
        svg_path=str(SAMPLE_PIKACHU),
        total_width=80.0,
        auto_ramp=AutoRamp(
            param="power", min_value=20, max_value=80, sort_by="luminance",
        ),
    )
    # Every path has a non-empty d and a layer_color.
    for p in project.paths:
        assert p.d
        assert p.layer_color.startswith("#")
        assert p.width >= 0
        assert p.height >= 0

    # Round-trip through builder and write.
    out = tmp_path / "pikachu.xcs"
    write_xcs(project, str(out))
    import json as _json
    with open(out) as f:
        data = _json.load(f)
    display_types = [d["type"] for d in data["canvas"][0]["displays"]]
    assert display_types.count("PATH") == len(project.paths)
```

- [ ] **Step 2: Run the test**

Run: `pytest tests/test_svg_generator.py -v`
Expected: the two new tests pass (or skip if Pikachu.svg isn't present in the worktree).

- [ ] **Step 3: Manually verify the generated file opens in XCS Studio**

```bash
python -c "
from xcs_gen.generators import generate_from_svg
from xcs_gen.svg_source import AutoRamp
from xcs_gen.builder import write_xcs
project = generate_from_svg(
    svg_path='samples/Pikachu.svg',
    total_width=80.0,
    auto_ramp=AutoRamp(param='power', min_value=20, max_value=80, sort_by='luminance'),
)
write_xcs(project, '/tmp/pikachu_manual.xcs')
print(f'paths={len(project.paths)}')
"
```

Open `/tmp/pikachu_manual.xcs` in XCS Studio. Verify:
- Pikachu renders recognisably (shape and composition correct).
- Layers panel shows distinct colours with their assigned power values (lightest → 20, darkest → 80).
- Nothing is clipped off the bed (the offset `start_x=10, start_y=10` should keep it inside working area).

If the shape is positioned wrong, revisit Task 2's finding — the `graphicX`/`graphicY` convention in `_build_path_display` needs adjustment. Edit `src/xcs_gen/builder.py` accordingly and re-run this probe.

- [ ] **Step 4: Commit the integration test**

```bash
git add tests/test_svg_generator.py
git commit -m "Add integration tests against samples/Pikachu.svg"
```

---

## Self-Review Checklist

**Spec coverage**

- Goal & scope → Tasks 6–11 deliver the library + CLI.
- Pipeline (Parser → Layer grouping → Param assignment → Emitter) → Tasks 6, 7, 8, 9 respectively.
- Library API (`generate_from_svg`, `LayerConfig`, `AutoRamp`, `detect_svg_colors`) → Tasks 7, 8, 9.
- Data model additions (`Path`, `Circle`) → Task 3.
- Parser details (transforms, style resolution, shape conversion, unsupported logging, viewport scaling) → Task 6.
- Builder changes (`_build_path_display`, `_build_circle_display`, extended `build_xcs`) → Tasks 4, 5.
- CLI (detect + generate) → Tasks 10, 11.
- Error handling (unsupported features logged, ValueError with message, no-config failure) → Tasks 6, 8, 9.
- Testing → per-task unit tests; Task 12 integration.
- Dependencies (`svgelements`) → Task 1.
- Files-touched list matches spec.
- `graphicX`/`graphicY` empirical question → Task 2 resolves before Task 4 depends on it.

**Placeholder scan**

Every step has concrete code, an exact command, or an exact file/line reference. No "TBD" / "add error handling" / "write tests for the above" strings. Task 2's manual XCS Studio step is inherently human-driven but specifies the exact decision criteria.

**Type consistency**

- `Path` / `Circle` dataclasses defined in Task 3 are consumed unchanged in Tasks 4, 5, 9.
- `ParsedShape` / `ParseResult` in Task 6 are consumed in Tasks 7, 9.
- `LayerConfig` / `AutoRamp` / `LayerAssignment` in Task 8 are consumed in Tasks 9, 11.
- `_RENDER_MODE_TO_PROCESSING` mapping in Task 8 is single source of truth for `"fill_engrave" → "COLOR_FILL_ENGRAVE"` etc.
- `--color` syntax in Task 11 matches the spec's format.
- Auto-ramp direction: Task 8's `_sort_for_ramp` sorts luminance descending, so first-in-list (lightest) gets `min_value` and last-in-list (darkest) gets `max_value` — matches the spec's image-to-laser convention.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-14-svg-layers.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
