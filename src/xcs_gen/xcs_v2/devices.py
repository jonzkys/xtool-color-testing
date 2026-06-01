"""Device / parameter-binding layer for the v2 bundle.

The file IS a single device object (groundtruth.md §2, VERIFIED on the
samples — no outer ``devices`` wrapper, no ``schema`` key). Top-level keys:
``id, deviceCode, extId, extName, power, processing, customProjectData``.

``processing`` is keyed by canvasId; each value is ``{id, activeMode, modes}``
with exactly one mode. The mode envelope is
``{ignoredDisplayIds, data, profileRefs, patches, bindings}``:

- ``data``: mode-global settings. LASER_PLANE has ``thickness:null`` /
  ``lightSourceMode:"blue"``; RELIEF_PROCESS has a numeric ``thickness`` /
  ``lightSourceMode:"red"``. ``material`` is 0 here (the material id lives in
  each patch's ``material`` block).
- ``patches``: one ``patch_<hex>`` per available profile; ``overrides`` is the
  full resolved param set (profile ``values``).
- ``bindings``: one per available profile; the binding whose profile is used by
  displays carries the real ``displayIds`` (grouping every display with that
  profile). With our 1:1 element->profile mapping every binding is active.

The two-hop resolution (display id -> binding -> patch.overrides) reconstructs
each element's op + params, matching how xTool Studio reads the bundle.

MODE = RELIEF_PROCESS if any element's processingType is INTAGLIO/RELIEF, else
LASER_PLANE (the two modes our generators target; FILL_PROCESS is an edge case
not produced here).
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING, Any

from ..model import Device
from .profiles import ProfileStore

if TYPE_CHECKING:
    from .writer import ElementSpec

# Material id in the mode-global `data` block. The real v2 samples use 0 here
# (the material id lives in each patch's `material` block instead).
_V2_DATA_MATERIAL = 0

_RELIEF_TYPES = {"INTAGLIO", "RELIEF"}


def _short_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:8]}"


def _mode_for(processing_types: list[str]) -> str:
    if any(pt in _RELIEF_TYPES for pt in processing_types):
        return "RELIEF_PROCESS"
    return "LASER_PLANE"


def _mode_data(mode: str, thickness_mm: float | None) -> dict[str, Any]:
    is_relief = mode == "RELIEF_PROCESS"
    return {
        "material": _V2_DATA_MATERIAL,
        "lightSourceMode": "red" if is_relief else "blue",
        "thickness": thickness_mm if is_relief else None,
        "isProcessByLayer": False,
        "pathPlanning": "auto",
        "fillPlanning": "separate",
        "dreedyTsp": False,
        "avoidSmokeModal": False,
        "scanDirection": "topToBottom",
        "enableOddEvenKerf": True,
        "xcsUsed": [],
    }


def build_device(
    *,
    canvas_id: str,
    device: Device,
    thickness_mm: float | None,
    elements: list["ElementSpec"],
    profiles: ProfileStore,
) -> dict[str, Any]:
    """Build the device descriptor.

    ``elements`` is a list of :class:`~xcs_gen.xcs_v2.writer.ElementSpec` in
    display order. ``profiles`` is shared with the rest of the bundle so the
    same (processingType, values) pairs map to the same profile ids.
    """
    device_id = f"{device.ext_id}-1"
    mode = _mode_for([e.processing_type for e in elements])
    plan_type = "red" if mode == "RELIEF_PROCESS" else "blue"

    # Resolve each display to a profile id; group display ids per profile.
    # Preserve first-seen order of profiles for deterministic emission.
    profile_order: list[str] = []
    profile_to_displays: dict[str, list[str]] = {}
    for spec in elements:
        if spec.values is not None:
            # Pre-resolved customize block (extra device entries): bind verbatim.
            pid = profiles.get_or_add_values(spec.processing_type, spec.values)
        else:
            pid = profiles.get_or_add(spec.processing_type, spec.params)
        if pid not in profile_to_displays:
            profile_order.append(pid)
            profile_to_displays[pid] = []
        profile_to_displays[pid].append(spec.display_id)

    patches: dict[str, dict[str, Any]] = {}
    bindings: list[dict[str, Any]] = []
    profile_refs: list[str] = []

    # The first profile with displays is the active anchor; any profile with no
    # displays becomes a shadow binding pointing at it. (With 1:1
    # element->profile mapping no shadows arise; the anchor logic is kept for
    # forward-compat if extra/empty profiles are ever added.)
    active_anchor: str | None = None

    for pid in profile_order:
        values = profiles.values_for(pid)
        patch_id = _short_id("patch", device_id, pid)
        binding_id = _short_id("binding", device_id, pid)
        display_ids = profile_to_displays[pid]

        profile_refs.append(pid)
        patches[patch_id] = {
            "id": patch_id,
            "profileId": pid,
            "source": "material",
            "material": {
                "materialType": "customize",
                "materialId": 0,
                "paramSource": "customParams",
                "planType": plan_type,
            },
            "overrides": dict(values),
        }
        binding: dict[str, Any] = {
            "bindingId": binding_id,
            "baseProfileId": pid,
            "patchIds": [patch_id],
            "displayIds": display_ids,
            "canvasId": canvas_id,
            "mode": mode,
        }
        if display_ids:
            if active_anchor is None:
                active_anchor = binding_id
        elif active_anchor is not None:
            binding["shadowOf"] = active_anchor
        bindings.append(binding)

    return {
        "id": device_id,
        "deviceCode": device.ext_id,
        "extId": device.ext_id,
        "extName": device.ext_name,
        "power": list(device.power),
        "processing": {
            canvas_id: {
                "id": canvas_id,
                "activeMode": mode,
                "modes": {
                    mode: {
                        "ignoredDisplayIds": [],
                        "data": _mode_data(mode, thickness_mm),
                        "profileRefs": profile_refs,
                        "patches": patches,
                        "bindings": bindings,
                    }
                },
            }
        },
        "customProjectData": {},
    }
