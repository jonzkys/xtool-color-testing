"""Orchestrate and write an xcs-workspace-v2 (`.xs`) ZIP bundle.

Deterministic where it can be: ids reuse the model's own (display ids, canvas
id, device id derive from ``device.ext_id``); profile/patch/binding ids are
content-hashes; only the timestamps and a fresh ``projectId`` vary per write.
All members are DEFLATE-compressed; directory entries are emitted as
zero-length members to match the real bundles (member order is free per spec).
"""

from __future__ import annotations

import io
import json
import time
import zipfile
from dataclasses import dataclass
from typing import Any

from ..model import GRADIENT_LAYER_COLOR, ProcessingParams, XCSProject, _uuid
from .devices import build_device
from .displays import build_displays
from .profiles import ProfileStore, values_from_entry
from .resources import ResourceStore
from .vectors import VectorStore


@dataclass
class ElementSpec:
    """One display's binding inputs, in display order.

    ``values`` is normally ``None`` — the profile is then synthesized from
    ``params`` via the legacy builder. When a caller has already resolved the
    exact customize block (extra device entries), ``values`` holds it verbatim
    and ``params`` is unused for that element.
    """

    display_id: str
    processing_type: str
    params: ProcessingParams
    is_fill: bool
    values: dict[str, Any] | None = None

# Studio version strings observed in the real bundles (groundtruth.md §1/§5).
_APP_VERSION = "1.7.24"
_CANVAS_VERSION = "2.16.1"
_MIN_REQUIRED_VERSION = "2.6.0"
_STUDIO_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) xToolStudio/1.7.24 Chrome/136.0.7103.49 "
    "Electron/36.2.0 Safari/537.36"
)


def _collect_elements(project: XCSProject) -> list[ElementSpec]:
    """One ``ElementSpec`` per display, in display order.

    Order matches ``displays.build_displays`` (rects, paths, circles, bitmaps,
    then extras) so bindings line up with displays.

    Extra displays (gradient/image/forge generators, hatch lines, axis labels,
    …) carry their REAL processing in ``project.extra_device_entries`` — a
    ``(display_id, entry)`` list where ``entry["data"]`` is the full
    ``_build_processing_data(params)`` map and ``entry["processingType"]`` names
    the active op. We resolve each extra display against that entry so its
    profile binds the caller's actual params (incl. relief depth) rather than a
    hardcoded VECTOR_ENGRAVING default. An extra display with no matching entry
    falls back to a vector-engrave binding so it still resolves.
    """
    out: list[ElementSpec] = []
    for elem in project.elements:
        out.append(ElementSpec(elem.id, elem.processing_type, elem.params, elem.is_fill))
    for p in project.paths:
        out.append(ElementSpec(p.id, p.processing_type, p.params, p.is_fill))
    for c in project.circles:
        out.append(ElementSpec(c.id, c.processing_type, c.params, c.is_fill))
    for b in project.bitmaps:
        out.append(ElementSpec(b.id, b.processing_type, b.params, True))

    entry_map = {disp_id: entry for disp_id, entry in project.extra_device_entries}
    for disp in project.extra_displays:
        disp_id = disp.get("id") or _uuid()
        entry = entry_map.get(disp_id)
        if entry is not None:
            processing_type = entry.get("processingType", "VECTOR_ENGRAVING")
            values = values_from_entry(processing_type, entry.get("data", {}))
            is_fill = bool(entry.get("isFill", disp.get("isFill", False)))
            out.append(
                ElementSpec(disp_id, processing_type, ProcessingParams(), is_fill, values)
            )
        else:
            out.append(
                ElementSpec(
                    disp_id,
                    "VECTOR_ENGRAVING",
                    ProcessingParams(),
                    bool(disp.get("isFill", False)),
                )
            )
    return out


def _layer_data(displays: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build ``layerData`` keyed by lowercase hex, one entry per layer color."""
    layer_data: dict[str, dict[str, Any]] = {}
    order = 1
    for disp in displays:
        color = disp.get("layerColor") or ""
        if color and color not in layer_data:
            layer_data[color] = {
                "name": color.upper(),
                "order": order,
                "visible": True,
            }
            order += 1
    return layer_data


def _project_json(project: XCSProject, *, device_id: str, now_ms: int) -> dict[str, Any]:
    project_id = _uuid()
    return {
        "__v2__": True,
        "version": "2.0.0",
        "schemaMeta": {
            "schemaVersion": "2",
            "format": "directory",
            "migratedFrom": "v1",
            "migratedAt": now_ms,
        },
        "projectId": project_id,
        "projectTraceID": project_id,
        "projectName": "xcs-gen",
        "activeCanvasId": project.canvas_id,
        "activeDeviceId": device_id,
        "versionInfo": {
            "source": "web",
            "appVersion": _APP_VERSION,
            "savedAt": now_ms,
            "ua": _STUDIO_UA,
            "minRequiredVersion": _MIN_REQUIRED_VERSION,
            "appMinRequiredVersion": "",
            "webMinRequiredVersion": "",
        },
        "created": now_ms,
        "modify": now_ms,
        "modules": {
            "canvases": [project.canvas_id],
            "devices": [device_id],
        },
        "cover": "resources/project-cover.png",
        "customProjectData": {"projectTraceID": project_id},
    }


def _canvas_json(project: XCSProject, displays: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": project.canvas_id,
        "title": "{panel}1",
        "hidden": False,
        "layerData": _layer_data(displays),
        "groupData": {},
        "extendInfo": {
            "version": _CANVAS_VERSION,
            "minCanvasVersion": "0.0.0",
            "displayProcessConfigMap": {},
            "rulerPluginData": {"rulerGuide": []},
            "type": "2d",
        },
        "chunkLayout": {
            "displayCount": len(displays),
            "chunkCount": 1,
            "chunkIndexes": [0],
        },
    }


def build_bundle(project: XCSProject) -> dict[str, bytes]:
    """Build the full set of ZIP members (member name -> raw bytes)."""
    # Default any missing rect layer color so layerData stays consistent with
    # the legacy builder's behaviour.
    for elem in project.elements:
        if not elem.layer_color:
            elem.layer_color = GRADIENT_LAYER_COLOR

    now_ms = int(time.time() * 1000)
    device_id = f"{project.device.ext_id}-1"
    cid = project.canvas_id

    vectors = VectorStore()
    resources = ResourceStore()
    profiles = ProfileStore()

    displays = build_displays(project, vectors, resources)
    elements = _collect_elements(project)
    device = build_device(
        canvas_id=cid,
        device=project.device,
        thickness_mm=project.thickness_mm,
        elements=elements,
        profiles=profiles,
    )

    members: dict[str, bytes] = {}
    members[".format"] = b"v2"
    members["meta/persistence-meta.json"] = json.dumps(
        {"schemaVersion": "2.0.0", "protocol": "xcs-workspace-v2"},
        separators=(",", ":"),
    ).encode("utf-8")
    members["project.json"] = json.dumps(
        _project_json(project, device_id=device_id, now_ms=now_ms),
        separators=(",", ":"),
    ).encode("utf-8")
    members["profiles.json"] = json.dumps(
        profiles.as_json(), separators=(",", ":")
    ).encode("utf-8")
    members[f"devices/device-{device_id}.json"] = json.dumps(
        device, separators=(",", ":")
    ).encode("utf-8")
    members[f"canvases/{cid}.json"] = json.dumps(
        _canvas_json(project, displays), separators=(",", ":")
    ).encode("utf-8")
    members[f"canvases/{cid}/displays-0.json"] = json.dumps(
        {"canvasId": cid, "chunkIndex": 0, "displays": displays},
        separators=(",", ":"),
    ).encode("utf-8")

    members.update(vectors.members())
    members.update(resources.members())
    return members


# Directory members emitted as explicit zero-length entries (matching the real
# bundles, which carry zero-length dir entries).
_DIR_ENTRIES_BASE = ["canvases/", "devices/", "resources/"]
_DIR_ENTRIES_VECTORS = ["vectors/", "vectors/svg/"]


def _write_members(zf: zipfile.ZipFile, members: dict[str, bytes]) -> None:
    """Write directory entries + members into an open ZIP, matching the real
    bundles' zero-length dir entries. Shared by disk + in-memory writers so
    both produce identical archives."""
    has_vectors = any(name.startswith("vectors/") for name in members)
    dir_entries = list(_DIR_ENTRIES_BASE)
    if has_vectors:
        dir_entries.extend(_DIR_ENTRIES_VECTORS)

    for d in dir_entries:
        zi = zipfile.ZipInfo(d)
        zi.external_attr = 0o40755 << 16  # directory bit
        zf.writestr(zi, b"")
    for name, data in members.items():
        zf.writestr(name, data)


def build_xs_bytes(project: XCSProject) -> bytes:
    """Build a ``.xs`` (xcs-workspace-v2) ZIP bundle as raw bytes in memory.

    Same archive `write_xs` writes to disk — both share `_write_members`."""
    members = build_bundle(project)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        _write_members(zf, members)
    return buf.getvalue()


def write_xs(project: XCSProject, path: str) -> None:
    """Build and write a ``.xs`` (xcs-workspace-v2) ZIP bundle to ``path``."""
    members = build_bundle(project)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        _write_members(zf, members)
