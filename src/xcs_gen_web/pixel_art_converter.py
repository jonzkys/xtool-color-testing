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
            layer_color=layer.display_color or shape.color,
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
    the ``viewBox`` is ``0 0 width_mm height_mm``. The fill is the layer's
    ``display_color`` (the matched palette entry's hex) when matched, else the
    centroid hex — mirroring the .xcs layer colour."""
    enabled = {layer.color: layer for layer in req.layers if layer.enabled}
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {req.width_mm} {req.height_mm}" '
        f'width="{req.width_mm}mm" height="{req.height_mm}mm">'
    ]
    for shape in req.shapes:
        layer = enabled.get(shape.color)
        if layer is None:
            continue
        d = " ".join(
            _loop_to_d([(px, py) for (px, py) in loop])
            for loop in shape.loops
            if loop
        )
        if not d:
            continue
        fill = layer.display_color or shape.color
        parts.append(f'<path d="{d}" fill="{fill}" fill-rule="evenodd"/>')
    parts.append("</svg>")
    return "".join(parts)
