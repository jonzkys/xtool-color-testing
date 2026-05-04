"""Pixel Art converter — turn a list of mm-space cell rects into an XCSProject.

The browser pipeline does everything image-related (decode, sample, k-means,
auto-match); this module's job is to group the cell rectangles by colour and
emit one ``Path`` model element per enabled layer (compound path, one
subpath per cell). One path-per-layer keeps the .xcs well under XCS's 750-
display element budget no matter how detailed the image — a 100×100 grid
becomes K paths, not 10,000 rects.

Spec: docs/superpowers/specs/2026-05-03-pixel-art-design.md
"""

from __future__ import annotations

import json

from xcs_gen.builder import build_xcs
from xcs_gen.model import Path, XCSProject

from .converter import _to_processing_params
from .schemas import PixelArtRectSpec, PixelArtRequest


def build_pixel_art_project(req: PixelArtRequest) -> XCSProject:
    """Group request rects by colour, emit one ``Path`` per enabled layer.

    Each rect becomes one closed subpath ``M{x},{y} h{w} v{h} h-{w} z`` in
    the layer's compound path. fill-rule=evenodd handles the
    (non-overlapping) cell tiling without orientation magic.

    Disabled layers' rects are dropped (skip-engrave — the cells become
    blank space in the output, letting the material colour show through).

    Raises:
        ValueError: when no enabled rects survive (request had only
            disabled layers, or all rects referenced colours that don't
            map to an enabled layer).
    """
    enabled = {layer.color: layer for layer in req.layers if layer.enabled}
    by_color: dict[str, list[PixelArtRectSpec]] = {}
    for r in req.rects:
        if r.color in enabled:
            by_color.setdefault(r.color, []).append(r)

    project = XCSProject()
    for color, rects in by_color.items():
        layer = enabled[color]
        d_parts: list[str] = []
        min_x = min_y = float("inf")
        max_x = max_y = float("-inf")
        for r in rects:
            x = req.start_x + r.x
            y = req.start_y + r.y
            d_parts.append(f"M{x:g},{y:g} h{r.width:g} v{r.height:g} h-{r.width:g} z")
            if x < min_x:
                min_x = x
            if y < min_y:
                min_y = y
            if x + r.width > max_x:
                max_x = x + r.width
            if y + r.height > max_y:
                max_y = y + r.height
        project.paths.append(Path(
            d=" ".join(d_parts),
            x=min_x,
            y=min_y,
            width=max_x - min_x,
            height=max_y - min_y,
            is_close_path=True,
            is_compound_path=len(rects) > 1,
            fill_rule="evenodd",
            params=_to_processing_params(layer.base_params),
            processing_type="COLOR_FILL_ENGRAVE",
            layer_color=color,
        ))

    if not project.paths:
        raise ValueError("No enabled rects — enable at least one colour.")
    return project


def pixel_art_to_xcs_bytes(req: PixelArtRequest) -> bytes:
    """Build the project, serialise via build_xcs, JSON-dump to bytes."""
    project = build_pixel_art_project(req)
    payload = build_xcs(project)
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def pixel_art_to_svg(req: PixelArtRequest) -> str:
    """Serialise the request's enabled rects to a standalone SVG document.

    Mirrors the .xcs structure: one ``<path>`` per enabled colour, with
    each cell as a closed rectangular subpath. The fill colour is the
    rect's *layer* colour (the centroid hex from quantisation), not the
    matched palette entry's colour — the SVG is intended as a faithful
    preview of the pixelation, with laser params living in the .xcs
    companion."""
    enabled = {layer.color for layer in req.layers if layer.enabled}
    by_color: dict[str, list[PixelArtRectSpec]] = {}
    for r in req.rects:
        if r.color in enabled:
            by_color.setdefault(r.color, []).append(r)

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {req.width_mm} {req.height_mm}" '
        f'width="{req.width_mm}mm" height="{req.height_mm}mm">'
    ]
    for color, rects in by_color.items():
        d = " ".join(
            f"M{r.x:g},{r.y:g} h{r.width:g} v{r.height:g} h-{r.width:g} z"
            for r in rects
        )
        parts.append(f'<path d="{d}" fill="{color}" fill-rule="evenodd"/>')
    parts.append("</svg>")
    return "".join(parts)
