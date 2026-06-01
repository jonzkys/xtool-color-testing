"""Parameter-profile store for the v2 bundle.

``profiles.json`` is ``{profiles:{profile_<hex8>:{id, processingType, values}}}``.
A profile's ``values`` is the per-processingType ``customize`` block reused
from the legacy builder (``builder._build_processing_data``) plus a trailing
``processingType`` key — VERIFIED against shape.xs where the VECTOR_ENGRAVING
profile ``values`` equals the legacy customize block with a ``processingType``
appended (the real bundle adds a couple of stock keys like ``defocus`` we
don't model; the structural contract is the same).

Profiles deduplicate on (processingType, values): two elements with the same
op and identical params share one profile. The profile id is derived from a
stable hash of that pair so output is deterministic across runs.

There are two ways a caller feeds values into the store:

1. **Synthesized from ``ProcessingParams``** (``get_or_add``): the legacy
   builder's customize block for the given processingType, used for first-class
   RECT/PATH/CIRCLE/BITMAP elements.
2. **Pre-built verbatim** (``get_or_add_values`` via ``values_from_entry``):
   the caller already resolved the full processing ``data`` map (as carried in
   ``XCSProject.extra_device_entries``) — e.g. gradient/image/forge generators.
   We take that entry's customize block as-is so the bound profile carries the
   caller's REAL laser params, including relief depth keys
   (``sliceNumber/zLayers/zDecline/zAxisMove/processAngle/reliefCleanUp/
   cleanUp*``). Re-synthesizing from ``ProcessingParams`` defaults would drop
   those, which is the bug fixed here.

Relief note: ``ProcessingParams`` does not carry relief depth fields. The
legacy builder's INTAGLIO block hardcodes the z-stepped depth keys
(``sliceNumber/processAngle/zAxisMove/zLayers/zDecline``); we reuse that block
for INTAGLIO and synthesize a RELIEF block from it (adding the ``cleanUp*``
family + ``reliefCleanUp/reverseLayer/scanAngle/angleType``) so a synthesized
RELIEF profile carries the same depth keys the real RELIEF profiles do
(§6/§2b). When the depth actually matters (forge jobs) it arrives pre-built via
``values_from_entry`` and is used verbatim.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ..builder import _build_processing_data
from ..model import ProcessingParams


def _relief_values(intaglio: dict[str, Any], params: ProcessingParams) -> dict[str, Any]:
    """Synthesize RELIEF profile ``values`` from the legacy INTAGLIO block.

    The real RELIEF profile (incise_emboss.xs §6) carries the z-stepped depth
    keys plus the relief clean-up family. We base it on the INTAGLIO customize
    block (which already has ``sliceNumber/processAngle/zAxisMove/zLayers/
    zDecline``) and add the relief-only keys with sensible defaults.
    """
    values = dict(intaglio)
    values.update(
        {
            "scanAngle": params.scan_angle,
            "angleType": params.angle_type,
            "reliefCleanUp": False,
            "cleanUpLayers": 10,
            "cleanUpPower": 35,
            "cleanUpSpeed": params.speed,
            "cleanUpDensity": params.density,
            "cleanUpProcessAngle": values.get("processAngle", 15),
            "cleanUpRepeat": 1,
            "reverseLayer": False,
            "cleanUpPulseWidth": params.pulse_width,
            "cleanUpMopaFrequency": params.mopa_frequency,
        }
    )
    return values


def profile_values(processing_type: str, params: ProcessingParams) -> dict[str, Any]:
    """Build a profile ``values`` block for ``processing_type`` from ``params``.

    Reuses the legacy builder's customize block and appends ``processingType``
    to match the v2 profile shape.
    """
    data = _build_processing_data(params)
    block = data.get(processing_type)
    if block is not None:
        values = dict(block["parameter"]["customize"])
    elif processing_type == "RELIEF":
        # No legacy RELIEF block; synthesize from INTAGLIO.
        values = _relief_values(data["INTAGLIO"]["parameter"]["customize"], params)
    else:
        # Unmodelled op (e.g. BITMAP_ENGRAVING): fall back to vector engrave so
        # the profile still resolves and the element still binds.
        values = dict(data["VECTOR_ENGRAVING"]["parameter"]["customize"])

    values["processingType"] = processing_type
    return values


def values_from_entry(processing_type: str, entry_data: dict[str, Any]) -> dict[str, Any]:
    """Build a profile ``values`` block from a caller-supplied processing map.

    ``entry_data`` is the full ``_build_processing_data(params)`` map carried in
    an ``XCSProject.extra_device_entries`` entry's ``data`` field. We take its
    ``customize`` block for ``processing_type`` verbatim (preserving the
    caller's real params, including any relief depth keys) and append the
    trailing ``processingType`` key to match the v2 profile shape.

    If the map has no block for ``processing_type`` (an op our legacy builder
    doesn't model, or an empty entry), we fall back to a default-synthesized
    block so the display still binds to a resolvable profile.
    """
    block = entry_data.get(processing_type)
    if block is None:
        return profile_values(processing_type, ProcessingParams())
    values = dict(block["parameter"]["customize"])
    values["processingType"] = processing_type
    return values


def _profile_id(processing_type: str, values: dict[str, Any]) -> str:
    """Deterministic ``profile_<hex8>`` id from (processingType, values)."""
    payload = json.dumps(
        [processing_type, values], sort_keys=True, separators=(",", ":")
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"profile_{digest[:8]}"


class ProfileStore:
    """Deduplicates (processingType, values) into ``profile_<hex>`` entries."""

    def __init__(self) -> None:
        self._profiles: dict[str, dict[str, Any]] = {}  # id -> profile object

    def get_or_add(self, processing_type: str, params: ProcessingParams) -> str:
        """Return the profile id for ``(processing_type, params)``, adding it.

        Values are synthesized from ``params`` via the legacy builder.
        """
        values = profile_values(processing_type, params)
        return self.get_or_add_values(processing_type, values)

    def get_or_add_values(self, processing_type: str, values: dict[str, Any]) -> str:
        """Return the profile id for a PRE-BUILT ``values`` block, adding it.

        Used for ``extra_device_entries`` where the caller already resolved the
        exact customize block — we store it verbatim rather than re-deriving.
        """
        pid = _profile_id(processing_type, values)
        if pid not in self._profiles:
            self._profiles[pid] = {
                "id": pid,
                "processingType": processing_type,
                "values": values,
            }
        return pid

    def values_for(self, profile_id: str) -> dict[str, Any]:
        return self._profiles[profile_id]["values"]

    def processing_type_for(self, profile_id: str) -> str:
        return self._profiles[profile_id]["processingType"]

    def as_json(self) -> dict[str, Any]:
        return {"profiles": dict(self._profiles)}
