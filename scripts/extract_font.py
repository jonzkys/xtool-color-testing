#!/usr/bin/env python3
"""Extract font data from a TTF into the JSON format used by xcs_gen.

Reads a TTF via fontTools and emits JSON matching the schema consumed by
src/xcs_gen/text.py. Values are scaled by (72 / unitsPerEm) so the
existing text.py math (`scale = font_size / 72.0`) yields millimeters for
any font_size. Outlines are Y-flipped to SVG convention (baseline Y=0,
ascenders negative), matching the original Bigshot One extraction.

The character set mirrors the original Bigshot font_data.json exactly:
space, % - . /, digits 0–9, A–Z, a–z.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

CHARS = " %-./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def extract(
    ttf_path: Path,
    *,
    family_override: str | None = None,
    subfamily_override: str | None = None,
) -> dict:
    font = TTFont(str(ttf_path))
    head = font["head"]
    os2 = font["OS/2"]
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    name_table = font["name"]

    upem = head.unitsPerEm
    scale = 72.0 / upem

    # Use OS/2 typo metrics — they match the convention in the original
    # Bigshot JSON (ascent - descent = lineHeight, no gap baked in).
    typo_ascent = os2.sTypoAscender
    typo_descent = os2.sTypoDescender
    typo_line_gap = os2.sTypoLineGap

    line_height = (typo_ascent - typo_descent + typo_line_gap) * scale

    font_info = {
        "unitsPerEm": upem,
        "lineHeight": line_height,
        "ascent": typo_ascent * scale,
        "descent": typo_descent * scale,
        "capHeight": os2.sCapHeight * scale,
        "xHeight": os2.sxHeight * scale,
        "lineGap": typo_line_gap * scale,
    }

    glyph_data: dict[str, dict] = {}
    missing: list[str] = []

    for ch in CHARS:
        codepoint = ord(ch)
        if codepoint not in cmap:
            missing.append(ch)
            continue
        glyph_name = cmap[codepoint]

        svg_pen = SVGPathPen(glyph_set)
        tpen = TransformPen(svg_pen, (scale, 0, 0, -scale, 0, 0))
        glyph_set[glyph_name].draw(tpen)
        d_path = svg_pen.getCommands()

        bounds_pen = BoundsPen(glyph_set)
        glyph_set[glyph_name].draw(bounds_pen)
        if bounds_pen.bounds is None:
            bbox = {"minX": None, "minY": None, "maxX": None, "maxY": None}
            top_bearing = 0.0
        else:
            x_min, y_min, x_max, y_max = bounds_pen.bounds
            bbox = {
                "minX": x_min * scale,
                "minY": y_min * scale,
                "maxX": x_max * scale,
                "maxY": y_max * scale,
            }
            top_bearing = (typo_ascent - y_max) * scale

        adv_width, left_bearing = hmtx[glyph_name]

        glyph_data[ch] = {
            "dPath": d_path,
            "advanceWidth": adv_width * scale,
            "advanceHeight": line_height,
            "leftBearing": left_bearing * scale,
            "topBearing": top_bearing,
            "bbox": bbox,
        }

    if missing:
        print(
            f"WARNING: {len(missing)} chars missing from {ttf_path.name}: {missing}",
            file=sys.stderr,
        )

    family = family_override or name_table.getBestFamilyName() or "Unknown"
    subfamily = subfamily_override or name_table.getBestSubFamilyName() or "Regular"

    return {
        "fontFamily": family,
        "fontSubfamily": subfamily,
        "fontSource": "build-in",
        "fontInfo": font_info,
        "glyphData": glyph_data,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("ttf", type=Path, help="Source TTF/OTF file")
    ap.add_argument("-o", "--output", type=Path, required=True, help="Destination JSON")
    ap.add_argument("--family", help="Override font family name")
    ap.add_argument("--subfamily", help="Override font subfamily name")
    args = ap.parse_args()

    data = extract(
        args.ttf,
        family_override=args.family,
        subfamily_override=args.subfamily,
    )
    args.output.write_text(json.dumps(data, indent=2))
    print(
        f"Wrote {args.output} — {len(data['glyphData'])} glyphs "
        f"from {data['fontFamily']} {data['fontSubfamily']}"
    )


if __name__ == "__main__":
    main()
