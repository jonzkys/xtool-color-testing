"""Pixel Art converter — turn a list of mm-space merged rects into an XCSProject.

The browser pipeline does everything image-related (decode, sample, k-means,
auto-match, rect-merge); this module's job is to transcribe the finished
rectangle list into ``Rect`` model elements with the right per-layer
``ProcessingParams``.

Spec: docs/superpowers/specs/2026-05-03-pixel-art-design.md
"""

from __future__ import annotations

import json

from xcs_gen.builder import build_xcs
from xcs_gen.model import Rect, XCSProject

from .converter import _to_processing_params
from .schemas import PixelArtRequest


def build_pixel_art_project(req: PixelArtRequest) -> XCSProject:
    """Transcribe the request's mm-space rects into an XCSProject.

    Disabled layers' rects are dropped (skip-engrave — the cells become
    blank space in the output, letting the material colour show through).

    Raises:
        ValueError: when no enabled rects survive (request had only
            disabled layers, or all rects referenced colours that don't
            map to an enabled layer).
    """
    enabled = {layer.color: layer for layer in req.layers if layer.enabled}
    project = XCSProject()
    for r in req.rects:
        layer = enabled.get(r.color)
        if layer is None:
            continue  # skip-engrave
        project.elements.append(Rect(
            x=req.start_x + r.x,
            y=req.start_y + r.y,
            width=r.width,
            height=r.height,
            params=_to_processing_params(layer.base_params),
            processing_type="COLOR_FILL_ENGRAVE",
            layer_color=r.color,
        ))
    if not project.elements:
        raise ValueError("No enabled rects — enable at least one colour.")
    return project
