"""Text rendering for XCS files using extracted font data."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .model import _uuid

# Load the embedded font data (extracted from XCS Studio's Bigshot One)
_FONT_DATA_PATH = Path(__file__).parent / "font_data.json"
_font_cache: dict | None = None


def _get_font() -> dict:
    global _font_cache
    if _font_cache is None:
        with open(_FONT_DATA_PATH) as f:
            _font_cache = json.load(f)
    return _font_cache


def make_text_display(
    text: str,
    x: float,
    y: float,
    font_size: float = 4.0,
    layer_color: str = "#00befe",
) -> dict[str, Any]:
    """Build a TEXT display element for an XCS canvas.

    Args:
        text: The string to render.
        x: X position in mm (left edge of first character).
        y: Y position in mm (top edge of tallest character).
        font_size: Font size in points (72 points = 1 scale unit).
        layer_color: Layer color tag.

    Returns:
        A display dict ready to insert into canvas.displays.
    """
    font = _get_font()
    glyph_data = font["glyphData"]
    font_info = font["fontInfo"]
    scale = font_size / 72.0

    # Resolve glyph info for each character
    char_glyphs = []
    for ch in text:
        g = glyph_data.get(ch)
        if g is None:
            # Fall back to space for unknown characters
            g = glyph_data.get(" ", {"advanceWidth": 4.9, "dPath": "", "bbox": {"minX": None, "minY": None, "maxX": None, "maxY": None}})
        char_glyphs.append((ch, g))

    # Compute base = max(maxY) across all glyphs in this string
    max_ys = [g["bbox"]["maxY"] for _, g in char_glyphs if g["bbox"].get("maxY") is not None]
    min_ys = [g["bbox"]["minY"] for _, g in char_glyphs if g["bbox"].get("minY") is not None]
    base = max(max_ys) if max_ys else font_info["ascent"]
    bottom = min(min_ys) if min_ys else 0

    # First character's minX for offset calculation
    first_minX = char_glyphs[0][1]["bbox"].get("minX") or 0

    # Build charJSONs and compute cumulative advance
    char_jsons = []
    cum_advance = 0.0
    group_tag = _uuid()

    for ch, g in char_glyphs:
        bbox = g["bbox"]
        minX = bbox.get("minX") or 0
        minY = bbox.get("minY") or 0
        maxX = bbox.get("maxX") or 0
        maxY = bbox.get("maxY") or 0

        char_x = x + (cum_advance + minX - first_minX) * scale
        char_y = y + (base - maxY) * scale

        char_w = (maxX - minX) if maxX and minX is not None else 0
        char_h = (maxY - minY) if maxY and minY is not None else 0

        graphic_x = x + (cum_advance) * scale - first_minX * scale
        graphic_y = y + base * scale

        char_id = _uuid()

        if g.get("dPath"):
            char_json = {
                "id": char_id,
                "name": None,
                "type": "PATH",
                "x": char_x,
                "y": char_y,
                "angle": 0,
                "scale": {"x": scale, "y": scale},
                "skew": {"x": 0, "y": 0},
                "pivot": {"x": 0, "y": 0},
                "localSkew": {"x": 0, "y": 0},
                "offsetX": graphic_x,
                "offsetY": graphic_y,
                "lockRatio": True,
                "isClosePath": True,
                "zOrder": 0,
                "groupTags": [],
                "groupTag": group_tag,
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
                "stroke": {
                    "paintType": "color", "visible": True, "color": 0, "alpha": 1,
                    "width": 1, "cap": "butt", "join": "miter", "miterLimit": 4, "alignment": 0.5,
                },
                "effects": [],
                "width": char_w,
                "height": char_h,
                "isFill": True,
                "lineColor": 16421416,
                "fillColor": "#f9932b",
                "points": [],
                "dPath": g["dPath"],
                "fillRule": "nonzero",
                "graphicX": graphic_x,
                "graphicY": graphic_y,
                "isCompoundPath": False,
            }
            char_jsons.append(char_json)

        cum_advance += g.get("advanceWidth", 0)

    # Total text dimensions
    total_width = (cum_advance - first_minX) * scale
    # Add last char's trailing width
    last_g = char_glyphs[-1][1]
    last_maxX = last_g["bbox"].get("maxX") or 0
    last_advW = last_g.get("advanceWidth", 0)
    total_width = (cum_advance - last_advW + last_maxX - first_minX) * scale

    total_height = (base - bottom) * scale

    text_id = _uuid()
    offset_x = x - first_minX * scale
    offset_y = y + base * scale

    display = {
        "id": text_id,
        "name": None,
        "type": "TEXT",
        "x": x,
        "y": y,
        "angle": 0,
        "scale": {"x": scale, "y": scale},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": offset_x,
        "offsetY": offset_y,
        "lockRatio": True,
        "isClosePath": True,
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
        "stroke": {
            "paintType": "color", "visible": True, "color": 0, "alpha": 1,
            "width": 1, "cap": "butt", "join": "miter", "miterLimit": 4, "alignment": 0.5,
        },
        "effects": [],
        "width": total_width,
        "height": total_height,
        "isFill": True,
        "lineColor": 16421416,
        "fillColor": "#f9932b",
        "text": text,
        "resolution": 1,
        "style": {
            "fontSize": font_size,
            "fontFamily": font["fontFamily"],
            "fontSubfamily": font["fontSubfamily"],
            "fontSource": font["fontSource"],
            "letterSpacing": 0,
            "leading": 0,
            "align": "center",
            "curveX": 56,
            "curveY": 0,
            "isUppercase": False,
            "isWeld": False,
            "direction": "auto",
            "writingMode": "horizontal-tb",
            "textOrientation": "mixed",
        },
        "fontData": {
            "fontInfo": font_info,
            "glyphData": {ch: glyph_data[ch] for ch in set(text) if ch in glyph_data},
        },
        "charJSONs": char_jsons,
        "fillRule": "nonzero",
    }

    return display


def text_width(text: str, font_size: float = 4.0) -> float:
    """Calculate the rendered width of a text string in mm."""
    font = _get_font()
    glyph_data = font["glyphData"]
    scale = font_size / 72.0

    total_advance = 0.0
    first_minX = None
    last_maxX = 0.0
    last_advW = 0.0

    for ch in text:
        g = glyph_data.get(ch, glyph_data.get(" "))
        bbox = g.get("bbox", {})
        minX = bbox.get("minX") or 0

        if first_minX is None:
            first_minX = minX

        last_maxX = bbox.get("maxX") or 0
        last_advW = g.get("advanceWidth", 0)
        total_advance += last_advW

    if first_minX is None:
        first_minX = 0

    return (total_advance - last_advW + last_maxX - first_minX) * scale


def text_height(font_size: float = 4.0) -> float:
    """Approximate text height in mm for the embedded font."""
    font = _get_font()
    fi = font["fontInfo"]
    scale = font_size / 72.0
    return (fi["ascent"] - fi["descent"]) * scale
