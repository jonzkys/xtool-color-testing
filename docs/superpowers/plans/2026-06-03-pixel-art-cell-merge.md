# Pixel Art Cell-Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge contiguous same-colour pixel-art cells into one clean outline per connected region (with holes), so the export and preview show single shapes instead of a grid of squares.

**Architecture:** A new pure function `cellsToLoops` (frontend, `pixelArtMath.ts`) boundary-traces each colour's cell-mask into closed loops, replacing the dead `greedyRectCover`. The request schema changes from per-cell `rects` to per-colour `shapes` (lists of loops in local mm); the backend converter becomes a thin serialiser that renders one compound `Path` per colour with `fill-rule=evenodd`. The page gets a "Merge cells" toggle (default on) and the preview gets a `[ Fill ] [ Shapes ]` view that strokes the merged outlines, both fed by one shared memo so export/preview/stats can't drift.

**Tech Stack:** TypeScript + React + Vite + vitest (frontend); Python + FastAPI + Pydantic + pytest (backend).

**Spec:** `docs/superpowers/specs/2026-06-03-pixel-art-cell-merge-design.md`

**Conventions (read once):**
- Backend tests: `uv run --active pytest tests/ -q` (the `--active` is mandatory — see `CLAUDE.md`).
- Frontend checks: `cd web && npx tsc --noEmit && npm test`.
- After any `web/src/**` change, the served bundle is stale until `cd web && npm run build`.
- Don't use `--no-verify`. Commit messages end with the `Co-Authored-By` trailer (shown in Task 1).

---

### Task 1: Contour core — `cellsToLoops` + `cellsToSquares`

Replace the dead `greedyRectCover`/`capFit` with the contour tracer. Both new functions return `Map<label, Loop[]>` so the export path is identical whether merging is on.

**Files:**
- Modify: `web/src/components/pixelArtMath.ts`
- Test: `web/src/components/pixelArtMath.test.ts`

- [ ] **Step 1: Rewrite the test file's merge section**

Replace the entire `greedyRectCover` and `capFit` describe blocks (lines 58–118) AND update the import on line 2. The `clampGridToBudget` and `kMeansLab` describe blocks (lines 4–56) stay untouched.

Change line 2 from:
```ts
import { kMeansLab, greedyRectCover, capFit, clampGridToBudget } from "./pixelArtMath";
```
to:
```ts
import { kMeansLab, cellsToLoops, cellsToSquares, clampGridToBudget } from "./pixelArtMath";
```

Then replace everything from line 58 (`describe("greedyRectCover", ...`) to the end of file with:

```ts
// A loop is rotation/winding agnostic — compare as a sorted set of "x,y".
function cornerSet(loop: [number, number][]): string[] {
  return loop.map(([x, y]) => `${x},${y}`).sort();
}

describe("cellsToSquares", () => {
  it("emits one 4-corner loop per non-skip cell, grouped by label", () => {
    // 2x1 grid: [0, 1]
    const m = cellsToSquares([0, 1], 2, 1);
    expect(m.get(0)).toHaveLength(1);
    expect(m.get(1)).toHaveLength(1);
    expect(m.get(0)![0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });

  it("drops skip cells (-1)", () => {
    const m = cellsToSquares([0, -1, 0], 3, 1);
    expect(m.get(0)).toHaveLength(2);
    expect(m.has(-1)).toBe(false);
  });
});

describe("cellsToLoops", () => {
  it("collapses a solid grid to one 4-corner loop", () => {
    const labels = new Array(9).fill(0);
    const loops = cellsToLoops(labels, 3, 3).get(0)!;
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(cornerSet(loops[0])).toEqual(["0,0", "0,3", "3,0", "3,3"]);
  });

  it("collapses a straight strip to 4 corners (colinear merge)", () => {
    // 1 row of 5 cells, all label 0.
    const loops = cellsToLoops(new Array(5).fill(0), 5, 1).get(0)!;
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(cornerSet(loops[0])).toEqual(["0,0", "0,1", "5,0", "5,1"]);
  });

  it("traces an L-shape as one 6-corner loop", () => {
    // 2x2 grid, bottom-right is skip:
    //   0 0
    //   0 -1
    const loops = cellsToLoops([0, 0, 0, -1], 2, 2).get(0)!;
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    expect(cornerSet(loops[0])).toEqual(
      ["0,0", "0,2", "1,1", "1,2", "2,0", "2,1"],
    );
  });

  it("traces a ring (hole) as two loops", () => {
    // 3x3 with the centre skipped → outer loop + hole loop.
    const labels = [0, 0, 0, 0, -1, 0, 0, 0, 0];
    const loops = cellsToLoops(labels, 3, 3).get(0)!;
    expect(loops).toHaveLength(2);
    const sizes = loops.map((l) => l.length).sort();
    expect(sizes).toEqual([4, 4]); // outer square + inner square hole
  });

  it("keeps diagonal-touching cells separate (4-connected)", () => {
    // 2x2 checkerboard; label 0 sits on the diagonal (0,0) & (1,1).
    //   0 1
    //   1 0
    const loops = cellsToLoops([0, 1, 1, 0], 2, 2).get(0)!;
    expect(loops).toHaveLength(2); // NOT merged through the pinch
    for (const l of loops) expect(l).toHaveLength(4);
  });

  it("omits skip cells from the output map", () => {
    const m = cellsToLoops([0, -1, 0], 3, 1);
    expect(m.has(-1)).toBe(false);
    expect(m.get(0)).toHaveLength(2); // two disjoint single cells
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/components/pixelArtMath.test.ts`
Expected: FAIL — `cellsToLoops`/`cellsToSquares` are not exported (and the old `greedyRectCover` import is gone).

- [ ] **Step 3: Edit `pixelArtMath.ts` — remove dead code, add the tracer**

Delete these now-superseded exports entirely: `CoverRect` (interface, ~line 151), `greedyRectCover` (~164–224), `CapFitResult` (~226–232), `capFit` (~239–260). Keep `kMeansLab`, `clampGridToBudget`, `hashCells`, `mulberry32`, `KMeansResult`.

Append the new geometry to the end of the file:

```ts
/** A closed loop of integer cell-grid corner coordinates (`[col, row]`).
 *  Implicitly closed — the last point connects back to the first; no
 *  duplicate closing point is stored. Corner coords range 0..cols / 0..rows. */
export type Loop = Array<[number, number]>;

/** Per-cell square loops — the *un-merged* geometry. One 4-corner loop
 *  per non-skip cell, grouped by label. Same return shape as
 *  ``cellsToLoops`` so the export/preview path is identical whether
 *  merging is on. */
export function cellsToSquares(
  labels: number[],
  cols: number,
  rows: number,
): Map<number, Loop[]> {
  const out = new Map<number, Loop[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const l = labels[r * cols + c];
      if (l < 0) continue;
      const loop: Loop = [
        [c, r],
        [c + 1, r],
        [c + 1, r + 1],
        [c, r + 1],
      ];
      const arr = out.get(l);
      if (arr) arr.push(loop);
      else out.set(l, [loop]);
    }
  }
  return out;
}

/** Boundary-trace the merged outline(s) of every colour label in a cell
 *  grid. For each label present (>= 0): one outer loop per 4-connected
 *  region, plus one loop per hole. Colinear runs are collapsed (a solid
 *  block or straight strip → 4 corners). Skip cells (-1) are empty space
 *  — never traced, and they bound neighbouring labels as edges/holes. */
export function cellsToLoops(
  labels: number[],
  cols: number,
  rows: number,
): Map<number, Loop[]> {
  const present = new Set<number>();
  for (const l of labels) if (l >= 0) present.add(l);
  const out = new Map<number, Loop[]>();
  for (const label of present) {
    out.set(label, traceLabel(labels, cols, rows, label));
  }
  return out;
}

function traceLabel(
  labels: number[],
  cols: number,
  rows: number,
  label: number,
): Loop[] {
  const filled = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && labels[r * cols + c] === label;

  const stride = cols + 1;
  const KEYS = stride * (rows + 1);
  const key = (c: number, r: number): number => r * stride + c;
  const enc = (a: number, b: number): number => a * KEYS + b;
  const toCR = (k: number): [number, number] => [k % stride, Math.floor(k / stride)];

  // Directed boundary edges, clockwise per filled cell (y-down). A shared
  // edge between two filled cells is emitted in both directions and
  // cancels, leaving only the outline.
  const edges = new Set<number>();
  const addEdge = (ac: number, ar: number, bc: number, br: number) => {
    const a = key(ac, ar);
    const b = key(bc, br);
    const rev = enc(b, a);
    if (edges.has(rev)) edges.delete(rev);
    else edges.add(enc(a, b));
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!filled(c, r)) continue;
      addEdge(c, r, c + 1, r); // top  → E
      addEdge(c + 1, r, c + 1, r + 1); // right → S
      addEdge(c + 1, r + 1, c, r + 1); // bottom → W
      addEdge(c, r + 1, c, r); // left  → N
    }
  }

  // Adjacency: fromKey → [toKey, …] over the surviving boundary edges.
  const byFrom = new Map<number, number[]>();
  for (const e of edges) {
    const a = Math.floor(e / KEYS);
    const b = e % KEYS;
    const arr = byFrom.get(a);
    if (arr) arr.push(b);
    else byFrom.set(a, [b]);
  }

  const dirOf = (a: number, b: number): [number, number] => {
    const [ac, ar] = toCR(a);
    const [bc, br] = toCR(b);
    return [bc - ac, br - ar];
  };

  const used = new Set<number>();
  const loops: Loop[] = [];

  for (const start of edges) {
    if (used.has(start)) continue;
    const startCorner = Math.floor(start / KEYS);
    const loop: Loop = [];
    let cur = start;
    while (!used.has(cur)) {
      used.add(cur);
      const a = Math.floor(cur / KEYS);
      const b = cur % KEYS;
      loop.push(toCR(a));
      if (b === startCorner) break; // closed back to the loop start
      const inDir = dirOf(a, b);
      const [bc, br] = toCR(b);
      // Prefer right turn, then straight, left, reverse — keeps regions
      // 4-connected at diagonal pinches (corner-touching cells stay
      // separate). Right turn (CW, y-down) of (dx,dy) is (-dy, dx).
      const order: Array<[number, number]> = [
        [-inDir[1], inDir[0]],
        [inDir[0], inDir[1]],
        [inDir[1], -inDir[0]],
        [-inDir[0], -inDir[1]],
      ];
      const cands = byFrom.get(b) ?? [];
      let next = -1;
      for (const [dx, dy] of order) {
        for (const to of cands) {
          const e = enc(b, to);
          if (used.has(e)) continue;
          const [tc, tr] = toCR(to);
          if (tc - bc === dx && tr - br === dy) {
            next = e;
            break;
          }
        }
        if (next >= 0) break;
      }
      if (next < 0) break;
      cur = next;
    }
    if (loop.length > 0) loops.push(collapseColinear(loop));
  }
  return loops;
}

/** Drop vertices that sit on a straight run (cross-product 0), keeping
 *  only the turning corners. Treats the loop as cyclic. */
function collapseColinear(pts: Loop): Loop {
  const n = pts.length;
  if (n < 3) return pts;
  const res: Loop = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) res.push(b);
  }
  return res;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/pixelArtMath.test.ts`
Expected: PASS (all `cellsToSquares` + `cellsToLoops` cases green).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/pixelArtMath.ts web/src/components/pixelArtMath.test.ts
git commit -m "$(cat <<'EOF'
feat(pixel-art): contour tracer (cellsToLoops); drop dead greedyRectCover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend — `shapes` schema + thin serialiser

Rename the request's per-cell `rects` to per-colour `shapes` (loops), and rewrite the converter to render one compound `Path` per colour from the provided loops.

**Files:**
- Modify: `src/xcs_gen_web/schemas.py:1258-1293`
- Modify: `src/xcs_gen_web/pixel_art_converter.py`
- Test: `tests/test_pixel_art_converter.py`, `tests/test_pixel_art_route.py`

- [ ] **Step 1: Rewrite `tests/test_pixel_art_converter.py`**

Replace the whole file with:

```python
"""Tests for the pixel-art converter (build_pixel_art_project + serialisers)."""

from __future__ import annotations

from xcs_gen.model import Path, XCSProject
from xcs_gen_web.pixel_art_converter import (
    build_pixel_art_project,
    pixel_art_to_svg,
    pixel_art_to_xcs_bytes,
)
from xcs_gen_web.schemas import (
    BaseParams,
    PixelArtLayerSpec,
    PixelArtRequest,
    PixelArtShapeSpec,
)


def _params() -> BaseParams:
    return BaseParams(
        power=50, speed=1000, frequency=65, density=100,
        passes=1, pulse_width=200, laser="red",
    )


# A single 2x2 square loop (one shape, one loop).
def _square(x: float, y: float, s: float, color: str) -> PixelArtShapeSpec:
    return PixelArtShapeSpec(
        color=color,
        loops=[[(x, y), (x + s, y), (x + s, y + s), (x, y + s)]],
    )


def _req(**overrides) -> PixelArtRequest:
    base = dict(
        name="test",
        material_id="mat-1",
        width_mm=10.0,
        height_mm=10.0,
        start_x=10.0,
        start_y=20.0,
        cell_mm=1.0,
        shapes=[_square(0, 0, 2, "#000000")],
        layers=[PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params())],
    )
    base.update(overrides)
    return PixelArtRequest(**base)


def test_single_shape_emits_one_path_element():
    project = build_pixel_art_project(_req())
    assert isinstance(project, XCSProject)
    assert len(project.paths) == 1
    path = project.paths[0]
    assert isinstance(path, Path)
    assert path.processing_type == "COLOR_FILL_ENGRAVE"
    assert path.layer_color == "#000000"
    assert path.width == 2
    assert path.height == 2
    assert path.is_close_path is True
    assert path.is_compound_path is False  # one loop
    assert path.fill_rule == "evenodd"
    assert path.d.count("M") == 1


def test_disabled_layer_is_dropped():
    req = _req(
        shapes=[
            _square(0, 0, 2, "#000000"),  # enabled
            _square(4, 0, 2, "#ffffff"),  # disabled
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=False, base_params=_params()),
        ],
    )
    project = build_pixel_art_project(req)
    assert len(project.paths) == 1
    assert project.paths[0].layer_color == "#000000"


def test_multi_loop_shape_is_compound():
    # One colour, two loops (e.g. a ring + hole, or two regions).
    req = _req(
        shapes=[
            PixelArtShapeSpec(
                color="#000000",
                loops=[
                    [(0, 0), (2, 0), (2, 2), (0, 2)],
                    [(4, 0), (6, 0), (6, 2), (4, 2)],
                ],
            ),
        ],
    )
    path = build_pixel_art_project(req).paths[0]
    assert path.is_compound_path is True
    assert path.d.count("M") == 2


def test_all_disabled_raises():
    import pytest

    req = _req(
        layers=[PixelArtLayerSpec(color="#000000", enabled=False, base_params=_params())],
    )
    with pytest.raises(ValueError, match="No enabled shapes"):
        build_pixel_art_project(req)


def test_start_offset_is_added_to_loop_points():
    req = _req(
        start_x=15.0,
        start_y=25.0,
        shapes=[_square(3.0, 4.0, 1, "#000000")],
    )
    path = build_pixel_art_project(req).paths[0]
    assert path.x == 18.0  # 15 + 3
    assert path.y == 29.0  # 25 + 4
    assert path.width == 1
    assert path.height == 1


def test_two_colours_emit_two_paths():
    req = _req(
        shapes=[
            _square(0, 0, 1, "#000000"),
            _square(2, 0, 1, "#ffffff"),
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=True, base_params=_params()),
        ],
    )
    project = build_pixel_art_project(req)
    assert len(project.paths) == 2
    by_color = {p.layer_color: p for p in project.paths}
    assert by_color["#000000"].d.count("M") == 1
    assert by_color["#ffffff"].d.count("M") == 1


def test_xcs_bytes_round_trip():
    import json

    body, media, ext = pixel_art_to_xcs_bytes(_req(format="xcs"))
    assert (media, ext) == ("application/json", "xcs")
    assert isinstance(body, bytes)
    payload = json.loads(body.decode("utf-8"))
    assert isinstance(payload, dict)
    assert payload


def test_svg_has_correct_viewbox_and_path_count():
    from xml.etree import ElementTree as ET

    req = _req(
        width_mm=20.0,
        height_mm=15.0,
        shapes=[
            PixelArtShapeSpec(
                color="#000000",
                loops=[
                    [(0, 0), (2, 0), (2, 2), (0, 2)],
                    [(4, 0), (6, 0), (6, 2), (4, 2)],
                ],
            ),
        ],
    )
    svg = pixel_art_to_svg(req)
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")
    assert root.attrib["viewBox"] == "0 0 20.0 15.0"
    paths = root.findall(".//{http://www.w3.org/2000/svg}path")
    assert len(paths) == 1  # one colour → one path
    assert paths[0].attrib["fill"] == "#000000"
    assert paths[0].attrib["d"].count("M") == 2  # two loops


def test_svg_omits_disabled_layer_paths():
    from xml.etree import ElementTree as ET

    req = _req(
        shapes=[
            _square(0, 0, 2, "#000000"),
            _square(4, 0, 2, "#ffffff"),
        ],
        layers=[
            PixelArtLayerSpec(color="#000000", enabled=True, base_params=_params()),
            PixelArtLayerSpec(color="#ffffff", enabled=False, base_params=_params()),
        ],
    )
    svg = pixel_art_to_svg(req)
    root = ET.fromstring(svg)
    paths = root.findall(".//{http://www.w3.org/2000/svg}path")
    assert len(paths) == 1
    assert paths[0].attrib["fill"] == "#000000"
```

- [ ] **Step 2: Run the converter tests to verify they fail**

Run: `uv run --active pytest tests/test_pixel_art_converter.py -q`
Expected: FAIL on import — `PixelArtShapeSpec` doesn't exist yet.

- [ ] **Step 3: Edit `schemas.py` — replace `PixelArtRectSpec`, rename `rects`**

Replace the `PixelArtRectSpec` class (lines 1258–1269) with:

```python
class PixelArtShapeSpec(BaseModel):
    """One output colour's merged geometry in mm-space (crop-relative).

    The browser traces contiguous same-colour cells into closed loops
    (outer boundary + holes); the backend renders the loops as one
    compound Path with fill-rule=evenodd.  Each loop is implicitly closed
    (last point → first).  ``color`` references a layer in the request's
    ``layers`` list by hex.  With merging off the browser sends one
    4-point square loop per cell — same shape, same code path."""

    color: str = Field(pattern=_COLOR_PATTERN)
    loops: list[list[tuple[float, float]]] = Field(min_length=1, max_length=70_000)
```

Then in `PixelArtRequest` (lines 1285–1288) replace the `rects` field + its comment with:

```python
    # One shape per enabled colour; each shape is a list of closed loops
    # (outer boundary + holes), points in local mm. The backend emits one
    # compound Path per shape. Bounded by colour count (<= max layers).
    shapes: list[PixelArtShapeSpec] = Field(min_length=1, max_length=64)
```

- [ ] **Step 4: Rewrite `pixel_art_converter.py`**

Replace the whole file with:

```python
"""Pixel Art converter — turn per-colour merged loops into an XCSProject.

The browser pipeline does everything image-related (decode, sample,
k-means, auto-match) AND the geometry (tracing contiguous same-colour
cells into merged loops). This module's job is to emit one ``Path`` model
element per enabled colour (compound path, one subpath per loop). One
path-per-colour keeps the .xcs well under XCS's 750-display-element
budget no matter how detailed the image.

Spec: docs/superpowers/specs/2026-06-03-pixel-art-cell-merge-design.md
"""

from __future__ import annotations

from xcs_gen.model import Path, XCSProject

from .converter import _to_processing_params
from .schemas import PixelArtRequest, PixelArtShapeSpec
from .serialize import project_to_bytes


def _loop_to_d(pts: list[tuple[float, float]]) -> str:
    """One closed subpath: ``M x,y L x,y … z``."""
    head = f"M{pts[0][0]:g},{pts[0][1]:g}"
    rest = " ".join(f"L{x:g},{y:g}" for (x, y) in pts[1:])
    return f"{head} {rest} z" if rest else f"{head} z"


def build_pixel_art_project(req: PixelArtRequest) -> XCSProject:
    """Emit one compound ``Path`` per enabled colour from its loops.

    Shapes whose colour maps to a disabled (or absent) layer are dropped
    — skip-engrave, letting the material colour show through.

    Raises:
        ValueError: when no enabled shapes survive.
    """
    enabled = {layer.color: layer for layer in req.layers if layer.enabled}
    project = XCSProject()
    for shape in req.shapes:
        layer = enabled.get(shape.color)
        if layer is None:
            continue
        d_parts: list[str] = []
        min_x = min_y = float("inf")
        max_x = max_y = float("-inf")
        n_loops = 0
        for loop in shape.loops:
            if not loop:
                continue
            pts = [(req.start_x + px, req.start_y + py) for (px, py) in loop]
            d_parts.append(_loop_to_d(pts))
            n_loops += 1
            for x, y in pts:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
        if not d_parts:
            continue
        project.paths.append(Path(
            d=" ".join(d_parts),
            x=min_x,
            y=min_y,
            width=max_x - min_x,
            height=max_y - min_y,
            is_close_path=True,
            is_compound_path=n_loops > 1,
            fill_rule="evenodd",
            params=_to_processing_params(layer.base_params),
            processing_type="COLOR_FILL_ENGRAVE",
            layer_color=shape.color,
        ))

    if not project.paths:
        raise ValueError("No enabled shapes — enable at least one colour.")
    return project


def pixel_art_to_xcs_bytes(req: PixelArtRequest) -> tuple[bytes, str, str]:
    """Build the project and serialise per ``req.format``.

    Returns ``(body, media_type, extension)`` — ``"xs"`` ZIP bundle by
    default, ``"xcs"`` flat JSON when selected.
    """
    project = build_pixel_art_project(req)
    return project_to_bytes(project, req.format)


def pixel_art_to_svg(req: PixelArtRequest) -> str:
    """Serialise the request's enabled shapes to a standalone SVG.

    Mirrors the .xcs structure: one ``<path>`` per enabled colour, each
    loop a closed subpath. Coordinates are 0-based (no start offset) so
    the ``viewBox`` is ``0 0 width_mm height_mm``. The fill colour is the
    centroid hex (the layer key), not the matched palette entry's colour
    — the SVG is a faithful preview of the pixelation."""
    enabled = {layer.color for layer in req.layers if layer.enabled}
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {req.width_mm} {req.height_mm}" '
        f'width="{req.width_mm}mm" height="{req.height_mm}mm">'
    ]
    for shape in req.shapes:
        if shape.color not in enabled:
            continue
        d = " ".join(
            _loop_to_d([(px, py) for (px, py) in loop])
            for loop in shape.loops
            if loop
        )
        if not d:
            continue
        parts.append(f'<path d="{d}" fill="{shape.color}" fill-rule="evenodd"/>')
    parts.append("</svg>")
    return "".join(parts)
```

- [ ] **Step 5: Update `tests/test_pixel_art_route.py`**

In `_payload` (lines 21–23) replace the `rects` block with:

```python
        "shapes": [
            {
                "color": "#000000",
                "loops": [[[0, 0], [2, 0], [2, 2], [0, 2]]],
            },
        ],
```

And in `test_pixel_art_400_when_all_layers_disabled` (line 72) change the assertion to:

```python
    assert "No enabled shapes" in resp.json()["detail"]
```

- [ ] **Step 6: Run all backend pixel-art tests to verify they pass**

Run: `uv run --active pytest tests/test_pixel_art_converter.py tests/test_pixel_art_route.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/xcs_gen_web/schemas.py src/xcs_gen_web/pixel_art_converter.py tests/test_pixel_art_converter.py tests/test_pixel_art_route.py
git commit -m "$(cat <<'EOF'
feat(pixel-art): backend shapes/loops schema + compound-path serialiser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Frontend types — `rects` → `shapes`

**Files:**
- Modify: `web/src/types.ts:532-548`
- Modify: `web/src/generate.test.ts:101`

- [ ] **Step 1: Edit `types.ts`**

Replace the `PixelArtRectSpec` interface (lines 532–538) with:

```ts
export interface PixelArtShapeSpec {
  /** Centroid hex (layer key, ``#rrggbb``). */
  color: string;
  /** Closed loops (outer boundary + holes), points ``[x, y]`` in local
   *  mm (0-based, crop-relative). Each loop is implicitly closed. */
  loops: [number, number][][];
}
```

Then change line 548 from `rects: PixelArtRectSpec[];` to:

```ts
  shapes: PixelArtShapeSpec[];
```

- [ ] **Step 2: Fix the request fixture in `generate.test.ts`**

Change line 101 from `rects: [],` to `shapes: [],`.

- [ ] **Step 3: Typecheck + run the generate tests**

Run: `cd web && npx tsc --noEmit`
Expected: errors ONLY in `PixelArtPage.tsx` (still imports `PixelArtRectSpec` / builds `rects`) — those are fixed in Task 4. No errors in `types.ts` or `generate.test.ts`.

Run: `cd web && npx vitest run src/generate.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/generate.test.ts
git commit -m "$(cat <<'EOF'
feat(pixel-art): frontend PixelArtShapeSpec type (rects -> shapes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Page — merge state, shared geometry memo, request, stats

Wire the toggle + preview-view state, compute the merged geometry once (shared by request, stats, and the preview overlay), and rebuild the request from loops.

**Files:**
- Modify: `web/src/pages/PixelArtPage.tsx`

- [ ] **Step 1: Update imports**

In the type import block (lines 51–57) remove `PixelArtRectSpec` and add `PixelArtShapeSpec`:

```ts
import type {
  OutputFormat,
  PaletteEntry,
  PixelArtRequest,
  PixelArtShapeSpec,
  PixelArtLayerSpec,
} from "../types";
```

In the `pixelArtMath` import (lines 43–47) add the geometry functions + `Loop` type:

```ts
import {
  kMeansLab,
  clampGridToBudget,
  cellsToLoops,
  cellsToSquares,
  type KMeansResult,
  type Loop,
} from "../components/pixelArtMath";
```

In the `PixelArtCanvas` import (lines 34–38) add the preview-view type:

```ts
import {
  PixelArtCanvas,
  type CroppedRegion,
  type PreviewState,
  type PreviewShapeView,
} from "../components/PixelArtCanvas";
```

- [ ] **Step 2: Add merge + preview-view state**

After the `previewMode` state (line 149–151), add:

```ts
  // Merge contiguous same-colour cells into one outline per region.
  // On by default — strictly cleaner geometry for a fill engrave.
  const [mergeEnabled, setMergeEnabled] = useState(true);
  // Bottom-preview view. "fill" = flat colours (default). "shapes" =
  // flat colours + stroked merged outlines so the merge is visible.
  const [previewView, setPreviewView] = useState<PreviewShapeView>("fill");
```

- [ ] **Step 3: Add the shared geometry memo**

After the `previewState` memo (ends line 386), add:

```ts
  // Shared merged geometry — one source for the export request, the
  // stat readout, and the "Shapes" preview overlay so they can't drift.
  // Loops are in CELL coordinates (0..cols / 0..rows); the request
  // builder scales them to mm and the overlay maps them to the viewBox.
  const exportShapes = useMemo<{
    shapes: { color: string; loops: Loop[] }[];
    shapeCount: number;
    vertexCount: number;
  } | null>(() => {
    if (!pipelineResult) return null;
    const { labels, centroidsHex, cols, rows: pRows } = pipelineResult;
    const enabledColors = new Set(rows.filter((r) => r.enabled).map((r) => r.color));
    const byLabel = mergeEnabled
      ? cellsToLoops(labels, cols, pRows)
      : cellsToSquares(labels, cols, pRows);
    const shapes: { color: string; loops: Loop[] }[] = [];
    let shapeCount = 0;
    let vertexCount = 0;
    for (const [label, loops] of byLabel) {
      const color = centroidsHex[label];
      if (!enabledColors.has(color)) continue;
      shapes.push({ color, loops });
      shapeCount += loops.length;
      for (const lp of loops) vertexCount += lp.length;
    }
    return { shapes, shapeCount, vertexCount };
  }, [pipelineResult, rows, mergeEnabled]);
```

- [ ] **Step 4: Rebuild `buildRequest` from loops**

Replace the `buildRequest` body (lines 470–513) — specifically the rect-building block and the return's `rects` — with a loops-based version. Replace from `// Derive cell size…` through the `return { … }`:

```ts
    // Derive cell size from the ACTUAL grid (may have been clamped down) so the
    // burn stays physically widthMm wide.
    const cellMm = widthMm / pipelineResult.cols;
    if (!exportShapes || exportShapes.shapes.length === 0) return null;
    // Scale the shared cell-space loops into mm. Merge on → contour
    // loops; merge off → one square loop per cell (same code path).
    const shapes: PixelArtShapeSpec[] = exportShapes.shapes.map((s) => ({
      color: s.color,
      loops: s.loops.map((loop) =>
        loop.map(([c, r]) => [c * cellMm, r * cellMm] as [number, number]),
      ),
    }));
    const layers: PixelArtLayerSpec[] = rows.map((row) => ({
      color: row.color,
      enabled: row.enabled,
      base_params: row.baseParams,
      material_id: row.materialId,
      palette_entry_id: row.matchedEntry?.id ?? null,
    }));
    return {
      name: name || "pixel-art",
      material_id: materialId,
      width_mm: widthMm,
      height_mm: heightMm,
      start_x: startX,
      start_y: startY,
      cell_mm: cellMm,
      shapes,
      layers,
    };
```

Then update the `buildRequest` dependency array (line 513) to swap `pipelineResult` work for the memo — change it to:

```ts
  }, [exportShapes, pipelineResult, materialId, name, widthMm, heightMm, startX, startY, rows]);
```

(`cellsAcross` is dropped — it was unused in the old deps; `exportShapes` now carries the geometry.)

- [ ] **Step 5: Pass merge + view props to the children, and feed the stats**

Replace the `<PixelArtCanvas …>` element (lines 722–737) — add three props:

```tsx
              <PixelArtCanvas
                image={image}
                materialWidthMm={widthMm}
                materialHeightMm={heightMm}
                crop={crop}
                onCropChange={setCrop}
                preview={previewState}
                previewMode={previewMode}
                onPreviewModeChange={setPreviewMode}
                previewView={previewView}
                onPreviewViewChange={setPreviewView}
                shapes={exportShapes?.shapes ?? null}
                lockAspect={lockAspect}
                cropEnabled={cropEnabled}
                onCropEnabledChange={setCropEnabled}
                onUpload={() => fileInputRef.current?.click()}
                onReRender={() => setRenderTick((t) => t + 1)}
                canReRender={!!imageData}
              />
```

Replace the `<PixelArtLayerPanel …>` element (lines 752–765) — add two props:

```tsx
              <PixelArtLayerPanel
                rows={rows}
                paletteEntries={paletteEntries}
                library={library}
                onToggle={onToggleLayer}
                onChooseMatch={onChooseMatch}
                onConfirmMerge={onConfirmMerge}
                onRematchAll={onRematchAll}
                onDownloadXcs={onDownloadXcs}
                onDownloadSvg={onDownloadSvg}
                generating={generating}
                outputFormat={outputFormat}
                onOutputFormatChange={setOutputFormat}
                mergeEnabled={mergeEnabled}
                onMergeEnabledChange={setMergeEnabled}
              />
```

Replace the `<PixelArtStats …>` element (lines 708–712) with:

```tsx
              <PixelArtStats
                layerCount={rows.filter((r) => r.enabled).length}
                shapeCount={exportShapes?.shapeCount ?? 0}
                vertexCount={exportShapes?.vertexCount ?? 0}
                cols={pipelineResult?.cols ?? 0}
                rasterRows={pipelineResult?.rows ?? 0}
                merged={mergeEnabled}
              />
```

- [ ] **Step 6: Rewrite the `PixelArtStats` component**

Replace the entire `PixelArtStats` function (lines 782–837) with a props-driven version that takes pre-computed counts:

```tsx
/* Mirrors the svg-layers "Layers (N · M shapes · K verts)" surface as a
 * standalone left-sidebar block. Numbers reflect the *export* — only
 * enabled colours contribute. ``shapeCount`` is the merged loop count
 * (one outline per region + holes); with merge off it's one per cell. */
function PixelArtStats({
  layerCount,
  shapeCount,
  vertexCount,
  cols,
  rasterRows,
  merged,
}: {
  layerCount: number;
  shapeCount: number;
  vertexCount: number;
  cols: number;
  rasterRows: number;
  merged: boolean;
}) {
  const totalGridCells = cols * rasterRows;
  return (
    <Section title="Stats" dense>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums">
        <Stat label="Layers" value={layerCount.toLocaleString()} />
        <Stat
          label="Shapes"
          value={shapeCount.toLocaleString()}
          hint={
            merged
              ? "merged outlines (one per region + holes)"
              : "one square per enabled cell (merge off)"
          }
        />
        <Stat
          label="Vertices"
          value={vertexCount.toLocaleString()}
          hint="total loop corners across enabled colours"
        />
        <Stat
          label="Grid total"
          value={
            totalGridCells > 0
              ? `${cols.toLocaleString()} × ${rasterRows.toLocaleString()} = ${totalGridCells.toLocaleString()}`
              : "—"
          }
          hint="cells across × down"
        />
      </dl>
    </Section>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: errors ONLY in `PixelArtCanvas.tsx` / `PixelArtLayerPanel.tsx` for the not-yet-added props (`previewView`, `shapes`, `mergeEnabled`, `PreviewShapeView`) — fixed in Tasks 5–6. No errors in `PixelArtPage.tsx`.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/PixelArtPage.tsx
git commit -m "$(cat <<'EOF'
feat(pixel-art): merge state + shared loop geometry, loops-based request

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Layer panel — "Merge cells" toggle

**Files:**
- Modify: `web/src/components/PixelArtLayerPanel.tsx`

- [ ] **Step 1: Add the props**

In `PixelArtLayerPanelProps` (after `onOutputFormatChange`, line 72) add:

```ts
  /** Merge contiguous same-colour cells into one outline. */
  mergeEnabled: boolean;
  onMergeEnabledChange: (enabled: boolean) => void;
```

Add them to the destructured params (after `onOutputFormatChange,` line 105):

```ts
  mergeEnabled,
  onMergeEnabledChange,
```

- [ ] **Step 2: Render the toggle in the action row**

Immediately after the Format row's closing `</div>` (line 157, before the download-buttons `<div className="grid grid-cols-2 gap-2">`), insert:

```tsx
        <label
          className="flex items-center gap-2 text-[12px] text-[color:var(--color-ink-muted)] cursor-pointer select-none"
          title="On = each colour region exports as one merged outline. Off = one square per cell."
        >
          <input
            type="checkbox"
            checked={mergeEnabled}
            onChange={(e) => onMergeEnabledChange(e.target.checked)}
            className="accent-[color:var(--color-primary)]"
          />
          <span>Merge cells</span>
        </label>
```

- [ ] **Step 3: Typecheck + run any panel tests**

Run: `cd web && npx tsc --noEmit`
Expected: no errors in `PixelArtLayerPanel.tsx` (Canvas may still error until Task 6).

Run: `cd web && npx vitest run src/components/PixelArtLayerPanel.test.tsx`
Expected: PASS if the file exists (it may need the two new required props in its render harness — if the test renders `<PixelArtLayerPanel>`, add `mergeEnabled={true} onMergeEnabledChange={() => {}}` to that call). If no such test file exists, skip.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PixelArtLayerPanel.tsx
git commit -m "$(cat <<'EOF'
feat(pixel-art): "Merge cells" toggle in the layer panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Canvas — `[ Fill ] [ Shapes ]` view + outline overlay

**Files:**
- Modify: `web/src/components/PixelArtCanvas.tsx`
- Test: `web/src/components/PixelArtCanvas.test.tsx`

- [ ] **Step 1: Add the exported view type + props**

After `PreviewRenderMode` (line 54) add:

```ts
export type PreviewShapeView = "fill" | "shapes";

/** One enabled colour's merged loops, in CELL coordinates (0..cols /
 *  0..rows). Used by the "Shapes" overlay; matches what's exported. */
export interface PreviewShape {
  color: string;
  loops: [number, number][][];
}
```

In `PixelArtCanvasProps` (after `onPreviewModeChange`, line 70) add:

```ts
  /** Bottom-preview view. "fill" = flat colours only. "shapes" = flat
   *  colours + stroked merged outlines. */
  previewView: PreviewShapeView;
  onPreviewViewChange: (view: PreviewShapeView) => void;
  /** Merged geometry for the "shapes" overlay (cell coords). */
  shapes: PreviewShape[] | null;
```

Add them to the destructured params (after `onPreviewModeChange,` line 70 in the function signature, around line 165):

```ts
  previewView,
  onPreviewViewChange,
  shapes,
```

- [ ] **Step 2: Add the `[ Fill ] [ Shapes ]` toggle to the pixelated header**

In the pixelated header's controls `<div className="flex items-center gap-1 normal-case tracking-normal">` (line 724), the existing "show [Representative|Original]" tablist lives there. Immediately before that `show` label (line 725), insert a second tablist:

```tsx
            <div
              role="tablist"
              aria-label="Preview view"
              className="inline-flex rounded-[4px] border border-[color:var(--color-border)] overflow-hidden mr-2"
            >
              <button
                type="button"
                role="tab"
                aria-selected={previewView === "fill"}
                onClick={() => onPreviewViewChange("fill")}
                className={cn(
                  "px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-mono",
                  previewView === "fill"
                    ? "bg-[color:var(--color-primary)] text-white"
                    : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface)]",
                )}
              >
                Fill
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewView === "shapes"}
                onClick={() => onPreviewViewChange("shapes")}
                className={cn(
                  "px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-mono border-l border-[color:var(--color-border)]",
                  previewView === "shapes"
                    ? "bg-[color:var(--color-primary)] text-white"
                    : "text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface)]",
                )}
              >
                Shapes
              </button>
            </div>
```

- [ ] **Step 3: Render the overlay over the preview canvas**

Find the preview `<canvas ref={previewCanvasRef} …>` (lines 773–789). Wrap the canvas + overlay so they stack. Replace the canvas element with:

```tsx
            <div className="relative" style={{ width: bottomDrawW, height: bottomDrawH }}>
              <canvas
                ref={previewCanvasRef}
                width={preview.cols}
                height={preview.rows}
                style={{
                  width: bottomDrawW,
                  height: bottomDrawH,
                  imageRendering: "pixelated",
                  display: "block",
                }}
                role="img"
                aria-label={
                  previewMode === "representative"
                    ? "pixelated preview"
                    : "source means preview"
                }
              />
              {previewView === "shapes" && shapes && (
                <svg
                  aria-label="merged shape outlines"
                  className="absolute inset-0 pointer-events-none"
                  width={bottomDrawW}
                  height={bottomDrawH}
                  viewBox={`0 0 ${preview.cols} ${preview.rows}`}
                  preserveAspectRatio="none"
                >
                  {shapes.map((s, i) => (
                    <path
                      key={i}
                      d={s.loops
                        .map(
                          (loop) =>
                            "M" +
                            loop.map(([c, r]) => `${c},${r}`).join("L") +
                            "Z",
                        )
                        .join(" ")}
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              )}
            </div>
```

- [ ] **Step 4: Add a unit test for the view toggle + overlay**

Append to `web/src/components/PixelArtCanvas.test.tsx` (create the file with this content if it doesn't exist; if it exists, add the `describe` block and reuse its imports/setup):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PixelArtCanvas, type PreviewState, type PreviewShape } from "./PixelArtCanvas";

const preview: PreviewState = {
  cols: 2,
  rows: 1,
  cellCentroidHex: ["#000000", "#000000"],
  pathCount: 1,
  kColors: 1,
  cellMeansHex: ["#000000", "#000000"],
};

const shapes: PreviewShape[] = [
  { color: "#000000", loops: [[[0, 0], [2, 0], [2, 1], [0, 1]]] },
];

function renderCanvas(view: "fill" | "shapes") {
  return render(
    <PixelArtCanvas
      image={null}
      materialWidthMm={10}
      materialHeightMm={10}
      crop={{ x: 0, y: 0, w: 1, h: 1 }}
      onCropChange={() => {}}
      preview={preview}
      previewMode="representative"
      onPreviewModeChange={() => {}}
      previewView={view}
      onPreviewViewChange={() => {}}
      shapes={shapes}
      lockAspect={false}
      cropEnabled={false}
      onCropEnabledChange={() => {}}
    />,
  );
}

describe("PixelArtCanvas shapes view", () => {
  it("hides the outline overlay in fill view", () => {
    renderCanvas("fill");
    expect(screen.queryByLabelText("merged shape outlines")).toBeNull();
  });

  it("renders the outline overlay in shapes view", () => {
    renderCanvas("shapes");
    expect(screen.getByLabelText("merged shape outlines")).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the canvas tests + typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no errors anywhere now).

Run: `cd web && npx vitest run src/components/PixelArtCanvas.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PixelArtCanvas.tsx web/src/components/PixelArtCanvas.test.tsx
git commit -m "$(cat <<'EOF'
feat(pixel-art): Fill/Shapes preview view with merged-outline overlay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full verification — all suites + build

**Files:** none (verification only).

- [ ] **Step 1: Backend suite**

Run: `uv run --active pytest tests/ -q`
Expected: PASS (no regressions).

- [ ] **Step 2: Frontend typecheck + unit tests**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 3: Build the served bundle**

Run: `cd web && npm run build`
Expected: build succeeds (this is what `xcs-gen serve` actually serves — required before any browser check).

- [ ] **Step 4: Commit (only if the build emitted tracked artefacts; otherwise skip)**

```bash
git status --short
# If web/dist or similar tracked files changed:
git add -A && git commit -m "$(cat <<'EOF'
chore(pixel-art): rebuild web bundle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Browser verification + changelog (major, before/after)

Per `CLAUDE.md`: a UI change isn't done until it's been loaded in a real browser and the screenshot read critically.

**Files:**
- Create: `changelog/2026-06-03-pixel-art-cell-merge.md`
- Create: `changelog/images/pixel-art-merge-before.png`, `changelog/images/pixel-art-merge-after.png`

- [ ] **Step 1: Run the server**

Run: `uv run --active xcs-gen serve --host 127.0.0.1 --port 8017`
(Leave running; use a background shell.)

- [ ] **Step 2: Drive the page in Chrome (Chrome DevTools MCP)**

Navigate to `http://127.0.0.1:8017/#/pixel-art`. Upload a photo (a face/portrait works well — large flat skin regions show the merge). Then:
- With **Merge cells ON**, switch the bottom preview to **Shapes** → screenshot. Confirm contiguous regions show as single clean outlines (no internal grid). Save as `changelog/images/pixel-art-merge-after.png`.
- Toggle **Merge cells OFF**, stay in **Shapes** → screenshot. Confirm every cell is its own square (the grid). Save as `changelog/images/pixel-art-merge-before.png`.
- Read both screenshots critically: outlines align to the fill, no stray/missing edges, holes render correctly. Note the Stats readout shape/vertex drop (e.g. "1,240 → 37 shapes").

- [ ] **Step 3: Spot-check a download**

Click `.svg`, open the file, confirm one `<path>` per enabled colour with merged `d` (far fewer `M` than cells). Click `.xs` to confirm no error.

- [ ] **Step 4: Write the changelog entry**

Create `changelog/2026-06-03-pixel-art-cell-merge.md`:

```markdown
---
id: 2026-06-03-pixel-art-cell-merge
date: 2026-06-03
level: major
title: Pixel Art — merged shapes, not a grid of squares
summary: Contiguous same-colour cells now collapse into one clean outline per region.
images:
  - src: pixel-art-merge-after.png
    caption: Merge on — each colour region is a single outline.
  - src: pixel-art-merge-before.png
    caption: Merge off — every cell is its own square.
---

Pixel Art used to ship every cell as its own little square — a solid
patch of one colour became thousands of abutting rectangles, so the
output read as a grid, not a shape. It now traces the boundary of each
contiguous colour region into a **single merged outline** (holes and
all), collapsing straight runs so a long edge is two points, not fifty.

A solid block that was 2,500 squares becomes one shape. The result is a
smaller, faster `.xs`/`.svg`, cleaner vector geometry, and a preview
that finally matches what you meant to engrave.

Flip **Merge cells** in the layer panel (on by default), and use the new
**Fill / Shapes** preview toggle to see the outlines before you
download.
```

Adjust the `cells → shapes` numbers in the prose to match what Step 2 actually showed.

- [ ] **Step 5: Rebuild + verify the changelog renders**

Run: `cd web && npm run build`
Then in Chrome open `http://127.0.0.1:8017/#/changelog` and confirm the entry + both images render. Screenshot and read it.

- [ ] **Step 6: Commit**

```bash
git add changelog/2026-06-03-pixel-art-cell-merge.md changelog/images/pixel-art-merge-before.png changelog/images/pixel-art-merge-after.png
git commit -m "$(cat <<'EOF'
docs(changelog): pixel-art neighbouring-cell merge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Push + open PR

**Files:** none.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/pixel-art-cell-merge`

- [ ] **Step 2: Open a draft PR**

Run:
```bash
gh pr create --draft \
  --title "Pixel Art — merge neighbouring cells into single shapes" \
  --body "$(cat <<'EOF'
Merges contiguous same-colour pixel-art cells into one clean outline per
connected region (with holes via evenodd), replacing the dead
greedyRectCover. Backend `rects` → per-colour `shapes` (loops); the
converter is now a thin serialiser. Adds a "Merge cells" toggle (default
on) and a Fill/Shapes preview view that strokes the merged outlines, plus
a cells → shapes · verts stat.

Spec: docs/superpowers/specs/2026-06-03-pixel-art-cell-merge-design.md
Plan: docs/superpowers/plans/2026-06-03-pixel-art-cell-merge.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Flip to ready when CI is green**

Run: `gh pr ready` (after CI passes).

---

## Self-Review notes (resolved during authoring)

- **Spec coverage:** contour algorithm + 4-connected pinch (Task 1); `evenodd` holes (Tasks 1+2); `rects→shapes` schema with no migration (Tasks 2+3); thin backend serialiser, XCS-offset/SVG-0-based split (Task 2); merge toggle default-on (Tasks 4+5); Fill/Shapes overlay (Tasks 4+6); `cells→shapes·verts` stat (Task 4); merge-off = per-cell squares via same path (Tasks 1+4); delete `greedyRectCover`/`capFit` (Task 1); major changelog + before/after (Task 8). All covered.
- **Type consistency:** `Loop = [number,number][]` (math) ↔ `PixelArtShapeSpec.loops: [number,number][][]` (types.ts) ↔ `PixelArtShapeSpec.loops: list[list[tuple[float,float]]]` (schemas.py) ↔ `PreviewShape.loops` (canvas). `PreviewShapeView` exported from canvas, imported by page. `cellsToLoops`/`cellsToSquares` names consistent across math, page, tests.
- **No DB / no migration** → no alembic version bump (avoids the CI gotcha in `CLAUDE.md`).
