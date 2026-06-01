"""Geometry-only display (scene-node) objects for the v2 bundle.

Each display is a PixiJS scene node carrying transform + paint + per-type
geometry, but NO per-display ``data``/params block (that lives in the device
binding layer). We reuse the legacy builder's display builders for the common
fields and per-type geometry, then transform the two reference fields:

- PATH: inline ``dPath`` by default; externalize to ``vectors/svg`` (drop
  inline ``dPath``, add ``vectorRef``) ONLY for ``dPath`` strings that REPEAT
  across the project (occur >= 2x). VERIFIED against the real samples:
  shape.xs (a single PATH) inlines its ``dPath`` and ships NO ``vectors/`` dir
  at all, while Pikachu2 inlines its 840 unique paths and externalizes only
  the 14 duplicates. Inlining the common case keeps shape-like projects
  byte-faithful; externalizing duplicates keeps shared geometry stored once.
- BITMAP: drop ``base64``, add ``resourcePath`` (content-addressed raster).

CIRCLE / RECT / LINE are parametric (no geometry side store; CIRCLE encodes
its size via ``width``/``scale``, NOT a ``radius`` key — matching the real
shape.xs). TEXT, if present via ``extra_displays``, stays editable and is
passed through untouched.

``zOrder`` is assigned per display index so stacking is stable and
deterministic.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from ..builder import (
    _build_circle_display,
    _build_path_display,
    _build_rect_display,
    build_bitmap_display,
)
from ..model import Bitmap, Path, XCSProject
from .resources import ResourceStore
from .vectors import VectorStore


def _dpath_counts(project: XCSProject) -> Counter[str]:
    """Count how often each ``dPath`` string appears across all PATH displays.

    Covers both first-class ``project.paths`` and any PATH ``extra_displays``
    that inline a ``dPath`` — a path is only externalized if its exact geometry
    repeats, regardless of which bucket the duplicates live in.
    """
    counts: Counter[str] = Counter()
    for p in project.paths:
        counts[p.d] += 1
    for disp in project.extra_displays:
        if disp.get("type") == "PATH" and "dPath" in disp:
            counts[disp["dPath"]] += 1
    return counts


def _path_display(
    path: Path, vectors: VectorStore, dpath_counts: Counter[str]
) -> dict[str, Any]:
    disp = _build_path_display(path)
    # Inline unique geometry; externalize only dPaths that repeat (>= 2x).
    if dpath_counts.get(path.d, 0) >= 2:
        d_path = disp.pop("dPath")
        disp["vectorRef"] = vectors.add(d_path)
    return disp


def _bitmap_display(bmp: Bitmap, resources: ResourceStore) -> dict[str, Any]:
    disp = build_bitmap_display(bmp)
    disp.pop("base64", None)
    disp["resourcePath"] = resources.add_png(bmp.png_bytes)
    return disp


def build_displays(
    project: XCSProject,
    vectors: VectorStore,
    resources: ResourceStore,
) -> list[dict[str, Any]]:
    """Build the ordered list of geometry-only display objects for a project.

    Order matches ``writer._collect_elements`` (rects, paths, circles,
    bitmaps, then extras) so device bindings line up with displays.
    """
    dpath_counts = _dpath_counts(project)

    displays: list[dict[str, Any]] = []
    for elem in project.elements:
        displays.append(_build_rect_display(elem))
    for p in project.paths:
        displays.append(_path_display(p, vectors, dpath_counts))
    for c in project.circles:
        displays.append(_build_circle_display(c))
    for b in project.bitmaps:
        displays.append(_bitmap_display(b, resources))
    # extra displays (e.g. TEXT) pass through as-is. A PATH extra that inlines
    # a dPath stays inline unless that exact geometry repeats project-wide, in
    # which case it is externalized too (copy first to avoid mutating caller's
    # dict).
    for disp in project.extra_displays:
        if (
            disp.get("type") == "PATH"
            and "dPath" in disp
            and dpath_counts.get(disp["dPath"], 0) >= 2
        ):
            disp = dict(disp)
            d_path = disp.pop("dPath")
            disp["vectorRef"] = vectors.add(d_path)
        displays.append(disp)

    for idx, disp in enumerate(displays):
        disp["zOrder"] = idx
    return displays
