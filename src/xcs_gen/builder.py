"""Build XCS JSON from the data model."""

from __future__ import annotations

import json
import time
from typing import Any

from .model import LAYER_COLORS, ProcessingParams, Rect, XCSProject, _uuid

# Minimal 1x1 transparent PNG for the cover thumbnail.
# XCS Studio expects a cover field but doesn't validate it strictly.
_BLANK_COVER = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lE"
    "QVQIHWNgAAIABQABNjN9GQAAAABJRUeErkJggg=="
)


def _color_for_index(i: int) -> str:
    """Generate a unique hex color for layer index i."""
    if i < len(LAYER_COLORS):
        return LAYER_COLORS[i]
    # Generate deterministic colors beyond the preset list
    r = (i * 47 + 30) % 256
    g = (i * 97 + 60) % 256
    b = (i * 157 + 90) % 256
    return f"#{r:02x}{g:02x}{b:02x}"


def _build_display(elem: Rect) -> dict[str, Any]:
    """Build a display (geometry) entry for a single element."""
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
        "width": elem.width,
        "height": elem.height,
        "isFill": elem.is_fill,
        "lineColor": 0,
        "fillColor": "#000000",
        "radius": 0,
        "maxRadius": min(elem.width, elem.height) / 2,
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
                    "bitmapScanMode": "zMode",
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
                    "bitmapScanMode": "zMode",
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
                    "bitmapScanMode": "zMode",
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


def build_xcs(project: XCSProject) -> dict[str, Any]:
    """Build the complete XCS JSON structure from a project model."""
    now_ms = int(time.time() * 1000)

    # Assign layer colors to elements
    for i, elem in enumerate(project.elements):
        if not elem.layer_color:
            elem.layer_color = _color_for_index(i)

    # Build layer data
    layer_data = {}
    for i, elem in enumerate(project.elements):
        layer_data[elem.layer_color] = {
            "name": elem.layer_color.upper(),
            "order": i + 1,
            "visible": True,
        }

    # Build displays
    displays = [_build_display(elem) for elem in project.elements]

    # Build device display processing map
    display_entries = []
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
                                    "material": 0,
                                    "lightSourceMode": "blue",
                                    "thickness": None,
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
