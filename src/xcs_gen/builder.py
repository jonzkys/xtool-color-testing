"""Build XCS JSON from the data model."""

from __future__ import annotations

import json
import time
from typing import Any

from .model import (
    ANNOTATION_LAYER_COLOR,
    GRADIENT_LAYER_COLOR,
    Bitmap,
    Circle,
    Line,
    Path,
    ProcessingParams,
    Rect,
    XCSProject,
    _uuid,
)

# Minimal 1x1 transparent PNG for the cover thumbnail.
_BLANK_COVER = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lE"
    "QVQIHWNgAAIABQABNjN9GQAAAABJRUeErkJggg=="
)

# XCS Studio internal material IDs. We tag every emitted .xcs as stainless
# steel so the device UI doesn't prompt the user to pick a material after
# import. Reverse-engineered from samples/direction-focus-material.xcs.
_STAINLESS_STEEL_XCS_MATERIAL_ID = 1323  # LASER_PLANE.material
_STAINLESS_STEEL_OFFICIAL_ID = 19543  # per-display customData.from.officialMaterialId


def _build_rect_display(elem: Rect) -> dict[str, Any]:
    """Build a display (geometry) entry for a rectangle element."""
    return {
        "id": elem.id,
        "name": None,
        "type": "RECT",
        "x": elem.x,
        "y": elem.y,
        "angle": 0,
        "scale": {"x": 1, "y": 1},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": elem.x,
        "offsetY": elem.y,
        "lockRatio": False,
        "isClosePath": True,
        "zOrder": 1,
        "groupTags": [],
        "groupTag": _uuid(),
        "layerTag": elem.layer_color,
        "layerColor": elem.layer_color,
        "visible": True,
        "originColor": "#000000",
        "enableTransform": True,
        "visibleState": True,
        "lockState": False,
        "resourceOrigin": "",
        "customData": {
            "from": {"officialMaterialId": _STAINLESS_STEEL_OFFICIAL_ID},
            "tabBreaks": {},
            "startPoint": {},
        },
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
        "width": elem.width,
        "height": elem.height,
        "isFill": elem.is_fill,
        "lineColor": 0,
        "fillColor": "#000000",
        "radius": 0,
        "maxRadius": min(elem.width, elem.height) / 2,
    }


def build_rect_display(elem: Rect) -> dict[str, Any]:
    """Public wrapper around the internal rect display builder."""
    return _build_rect_display(elem)


def build_bitmap_display(bmp: Bitmap) -> dict[str, Any]:
    """Build a display entry for a BITMAP element (PNG embedded as data URL)."""
    import base64

    b64 = base64.b64encode(bmp.png_bytes).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"

    scale_x = bmp.width / bmp.origin_width if bmp.origin_width else 1.0
    scale_y = bmp.height / bmp.origin_height if bmp.origin_height else 1.0
    dpi_x = (bmp.origin_width * 25.4 / bmp.width) if bmp.width else 0
    dpi_y = (bmp.origin_height * 25.4 / bmp.height) if bmp.height else 0

    return {
        "base64": data_url,
        "id": bmp.id,
        "name": None,
        "type": "BITMAP",
        "x": bmp.x,
        "y": bmp.y,
        "angle": 0,
        "scale": {"x": scale_x, "y": scale_y},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": bmp.x,
        "offsetY": bmp.y,
        "lockRatio": True,
        "isClosePath": False,
        "zOrder": 1,
        "groupTags": [],
        "groupTag": _uuid(),
        "layerTag": bmp.layer_color,
        "layerColor": bmp.layer_color,
        "visible": True,
        "originColor": "#000000",
        "enableTransform": True,
        "visibleState": True,
        "lockState": False,
        "resourceOrigin": "",
        "customData": {
            "from": {"officialMaterialId": _STAINLESS_STEEL_OFFICIAL_ID},
            "tabBreaks": {},
            "startPoint": {},
        },
        "rootComponentId": "",
        "minCanvasVersion": "0.0.0",
        "alpha": 1,
        "fill": {"paintType": "color", "visible": False, "color": 0, "alpha": 1},
        "stroke": {
            "paintType": "color", "visible": False, "color": 0, "alpha": 1,
            "width": 1, "cap": "butt", "join": "miter", "miterLimit": 4, "alignment": 0.5,
        },
        "effects": [],
        "width": bmp.width,
        "height": bmp.height,
        "isFill": True,
        "filterList": [],
        "grayValue": [0, 255],
        "sharpness": 50,
        "brightness": 0,
        "contrast": 0,
        "saturation": 0,
        "temperature": 0,
        "tone": 0,
        "colorInverted": False,
        # Colour-invert transparency controls + a stable source id. VERIFIED
        # present on the real png-included.xs BITMAP display (these were missing
        # before, which the BITMAP faithfulness test now guards). The sample's
        # transparent-colour value is the literal "black" (not a hex code);
        # sourceId is a per-display UUID in the sample but emitting "" keeps the
        # output deterministic and Studio re-assigns it on load.
        "colorInvertedFillTransparent": False,
        "colorInvertedTransparentColor": "black",
        "sourceId": "",
        "filterAttrsMap": {
            "emboss": {"strength": 5},
            "halftone": {"radius": 4, "angle": 45},
            "binary": {"threshold": 128},
            "sketch": {"strength": 2},
            "dot": {"angle": 45, "scale": 14},
        },
        "mask": None,
        "originWidth": bmp.origin_width,
        "originHeight": bmp.origin_height,
        "modifyData": {},
        "currentUrl": "",
        "dpi": {"dpiX": dpi_x, "dpiY": dpi_y},
        "isGray": False,
        "originAutoAdjust": None,
        "autoStrength": 0,
        "opacity": 1,
        "filterList_V2": [],
    }


def build_line_display(line: Line) -> dict[str, Any]:
    """Build a display entry for a line element."""
    # LINE uses width=length, height=0.001, angle for rotation.
    # endPoint gives the vector of the line.
    import math

    rad = math.radians(line.angle)
    end_x = line.length * math.cos(rad)
    end_y = line.length * math.sin(rad)

    return {
        "id": line.id,
        "name": None,
        "type": "LINE",
        "x": line.x,
        "y": line.y,
        "angle": line.angle,
        "scale": {"x": 1, "y": 1},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": line.x,
        "offsetY": line.y,
        "lockRatio": False,
        "isClosePath": False,
        "zOrder": 1,
        "groupTags": [],
        "groupTag": _uuid(),
        "layerTag": line.layer_color,
        "layerColor": line.layer_color,
        "visible": True,
        "originColor": "#000000",
        "enableTransform": True,
        "visibleState": True,
        "lockState": False,
        "resourceOrigin": "",
        "customData": {
            "from": {"officialMaterialId": _STAINLESS_STEEL_OFFICIAL_ID},
            "tabBreaks": {},
            "startPoint": {},
        },
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
        "width": line.length,
        "height": 0.001,
        "isFill": True,
        "lineColor": 0,
        "fillColor": "#000000",
        "endPoint": {"x": end_x, "y": end_y},
    }


def _build_path_display(path: Path) -> dict[str, Any]:
    """Build a display entry for an SVG path element.

    PATH positioning convention (empirically verified via XCS Studio probe on
    2026-04-14, see Task 2 of the SVG layers plan): dPath coordinates are
    in bed-mm, graphicX = graphicY = 0. The x/y/width/height bounding box
    must match the dPath's bbox for XCS Studio's selection handles to line
    up with the shape.
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
        "customData": {
            "from": {"officialMaterialId": _STAINLESS_STEEL_OFFICIAL_ID},
            "tabBreaks": {},
            "startPoint": {},
        },
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


_CIRCLE_SCALE_DIVISOR = 5900.0
"""XCS's invariant for CIRCLE: width (in bed-mm) divided by scale.x equals 5900.

Confirmed across every sample in samples/ (circles.xcs, eng-angle.xcs,
shape.xcs): ``width`` carries the actual bed-mm diameter and ``scale`` is
set to ``width / 5900``. An earlier attempt emitted ``width=40`` with
``scale = diameter/40``, which XCS Studio opened but rendered as a
broken/empty shape — it does not draw unless the 5900 invariant holds.
"""


def _build_circle_display(circle: Circle) -> dict[str, Any]:
    """Build a display entry for a circle element."""
    scale_x = circle.width / _CIRCLE_SCALE_DIVISOR
    scale_y = circle.height / _CIRCLE_SCALE_DIVISOR
    return {
        "id": circle.id,
        "name": None,
        "type": "CIRCLE",
        "x": circle.x,
        "y": circle.y,
        "angle": 0,
        "scale": {"x": scale_x, "y": scale_y},
        "skew": {"x": 0, "y": 0},
        "pivot": {"x": 0, "y": 0},
        "localSkew": {"x": 0, "y": 0},
        "offsetX": circle.x,
        "offsetY": circle.y,
        "lockRatio": True,
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
        "customData": {
            "from": {"officialMaterialId": _STAINLESS_STEEL_OFFICIAL_ID},
            "tabBreaks": {},
            "startPoint": {},
        },
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
            "color": 5526616,
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
        "lineColor": 16421416,
        "fillColor": "#f9932b",
    }


def _build_processing_data(p: ProcessingParams) -> dict[str, Any]:
    """Build the full processing data block for all processing types."""
    customize_base = {
        "processingLightSource": p.processing_light_source,
        "power": p.power,
        "speed": p.speed,
        "repeat": p.repeat,
        "pulseWidth": p.pulse_width,
        "mopaFrequency": p.mopa_frequency,
    }
    return {
        "INTAGLIO": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {
                    "bitmapEngraveMode": "normal",
                    "speed": p.speed,
                    "density": p.density,
                    "processingLightSource": p.processing_light_source,
                    "power": p.power,
                    "repeat": p.repeat,
                    "bitmapScanMode": p.bitmap_scan_mode,
                    "sliceNumber": 100,
                    "processAngle": 15,
                    "zAxisMove": False,
                    "zLayers": 1,
                    "zDecline": 0.01,
                    "pulseWidth": p.pulse_width,
                    "mopaFrequency": p.mopa_frequency,
                }
            },
        },
        "VECTOR_ENGRAVING": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {
                    **customize_base,
                    "enableKerf": False,
                    "kerfDistance": 0,
                }
            },
        },
        "FILL_VECTOR_ENGRAVING": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {
                    "bitmapEngraveMode": "normal",
                    "speed": p.speed,
                    "density": p.density,
                    "needGapNumDensity": True,
                    "dotDuration": p.dot_duration,
                    "dpi": p.dpi,
                    "processingLightSource": p.processing_light_source,
                    "power": p.power,
                    "repeat": p.repeat,
                    "bitmapScanMode": p.bitmap_scan_mode,
                    "pulseWidth": p.pulse_width,
                    "mopaFrequency": p.mopa_frequency,
                    "scanAngle": p.scan_angle,
                    "angleType": p.angle_type,
                    "crossAngle": p.cross_angle,
                    "enableDelayPerLine": False,
                    "delayPerLine": 0.3,
                    "outlineTrace": False,
                    "enableKerf": False,
                    "kerfDistance": 0,
                }
            },
        },
        "COLOR_FILL_ENGRAVE": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {
                    "bitmapEngraveMode": "normal",
                    "speed": p.speed,
                    "density": p.density,
                    "dotDuration": p.dot_duration,
                    "dpi": p.dpi,
                    "processingLightSource": p.processing_light_source,
                    "power": p.power,
                    "repeat": p.repeat,
                    "bitmapScanMode": p.bitmap_scan_mode,
                    "pulseWidth": p.pulse_width,
                    "mopaFrequency": p.mopa_frequency,
                    "notResize": True,
                    "scanAngle": p.scan_angle,
                    "angleType": p.angle_type,
                    "crossAngle": p.cross_angle,
                }
            },
        },
        # COLOR_ENGRAVE is the BITMAP-element variant of COLOR_FILL_ENGRAVE
        # (same customize schema; XCS uses a different processingType string
        # for bitmap-backed elements vs rect-backed elements).
        "COLOR_ENGRAVE": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {
                    "bitmapEngraveMode": "normal",
                    "speed": p.speed,
                    "density": p.density,
                    "dotDuration": p.dot_duration,
                    "dpi": p.dpi,
                    "processingLightSource": p.processing_light_source,
                    "power": p.power,
                    "repeat": p.repeat,
                    "bitmapScanMode": p.bitmap_scan_mode,
                    "pulseWidth": p.pulse_width,
                    "mopaFrequency": p.mopa_frequency,
                    "notResize": True,
                    "scanAngle": p.scan_angle,
                    "angleType": p.angle_type,
                    "crossAngle": p.cross_angle,
                }
            },
        },
        "VECTOR_CUTTING": {
            "materialType": "customize",
            "planType": "blue",
            "parameter": {
                "customize": {
                    **customize_base,
                    "cuttingDrop": False,
                    "sinkingMethod": "one",
                    "firstCuttingDropValue": 0.01,
                    "cuttingDropValue": 0.01,
                    "descentIntervalDescent": 1,
                    "descentPerStep": 0.01,
                    "enableKerf": False,
                    "kerfDistance": 0,
                    "enableBreakPoint": False,
                    "breakPointGenMode": "auto",
                    "breakPointSize": 0.5,
                    "breakPointCount": 2,
                    "breakPointMode": "count",
                    "breakPointDistance": 100,
                    "breakPointPower": 0,
                    "wobbleEnable": False,
                    "wobbleDiameter": 0.05,
                    "wobbleSpacing": 0.015,
                }
            },
        },
    }


def build_device_entry(
    display_id: str,
    display_type: str,
    processing_type: str,
    params: ProcessingParams,
    is_fill: bool = True,
) -> tuple[str, dict[str, Any]]:
    """Build a device processing entry for any display element."""
    return (
        display_id,
        {
            "isFill": is_fill,
            "type": display_type,
            "processingType": processing_type,
            "data": _build_processing_data(params),
            "processIgnore": False,
            "isWhiteModel": True,
        },
    )


def build_xcs(project: XCSProject) -> dict[str, Any]:
    """Build the complete XCS JSON structure from a project model."""
    now_ms = int(time.time() * 1000)

    # Collect all layer colors from all sources
    layer_data: dict[str, dict[str, Any]] = {}
    order = 1
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
    for b in project.bitmaps:
        _add_layer(b.layer_color)
    for disp in project.extra_displays:
        _add_layer(disp.get("layerColor", ""))

    # Build displays: rects + paths + circles + bitmaps + extras
    displays: list[dict[str, Any]] = []
    for elem in project.elements:
        displays.append(_build_rect_display(elem))
    for p in project.paths:
        displays.append(_build_path_display(p))
    for c in project.circles:
        displays.append(_build_circle_display(c))
    for b in project.bitmaps:
        displays.append(build_bitmap_display(b))
    displays.extend(project.extra_displays)

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
    for b in project.bitmaps:
        display_entries.append([
            b.id,
            {
                "isFill": True,
                "type": "BITMAP",
                "processingType": b.processing_type,
                "data": _build_processing_data(b.params),
                "processIgnore": False,
                "isWhiteModel": True,
            },
        ])
    for entry_id, entry_data in project.extra_device_entries:
        display_entries.append([entry_id, entry_data])

    return {
        "canvasId": project.canvas_id,
        "canvas": [
            {
                "id": project.canvas_id,
                "title": "{panel}1",
                "layerData": layer_data,
                "groupData": {},
                "displays": displays,
                "extendInfo": {
                    "version": "2.15.108",
                    "minCanvasVersion": "0.0.0",
                    "displayProcessConfigMap": {},
                    "rulerPluginData": {"rulerGuide": []},
                    "type": "2d",
                    "gridOptions": {"color": "normal", "isShow": True},
                },
            }
        ],
        "extId": project.device.ext_id,
        "extName": project.device.ext_name,
        "device": {
            "id": project.device.ext_id,
            "power": project.device.power,
            "data": {
                "dataType": "Map",
                "value": [
                    [
                        project.canvas_id,
                        {
                            "mode": "LASER_PLANE",
                            "data": {
                                "LASER_PLANE": {
                                    # XCS's internal ID for Stainless Steel —
                                    # matches what XCS Studio writes when you
                                    # pick "Stainless Steel" in the material
                                    # dropdown. Hardcoded because this repo
                                    # targets metal tag work exclusively.
                                    "material": _STAINLESS_STEEL_XCS_MATERIAL_ID,
                                    "lightSourceMode": "blue",
                                    "thickness": project.thickness_mm,
                                    "isProcessByLayer": False,
                                    "pathPlanning": "auto",
                                    "fillPlanning": "separate",
                                    "dreedyTsp": False,
                                    "avoidSmokeModal": False,
                                    "scanDirection": "topToBottom",
                                    "enableOddEvenKerf": True,
                                    "xcsUsed": [],
                                }
                            },
                            "displays": {
                                "dataType": "Map",
                                "value": display_entries,
                            },
                        },
                    ]
                ],
            },
            "materialList": [],
            "materialTypeList": [],
            "customProjectData": {},
        },
        "version": "1.6.6",
        "created": now_ms,
        "modify": now_ms,
        "ua": "xcs-gen/0.1.0",
        "meta": [],
        "cover": _BLANK_COVER,
        "minRequiredVersion": "2.6.0",
        "appMinRequiredVersion": "",
        "webMinRequiredVersion": "",
        "projectTraceID": _uuid(),
    }


def write_xcs(project: XCSProject, path: str) -> None:
    """Build and write an XCS file."""
    data = build_xcs(project)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
