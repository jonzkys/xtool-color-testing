"""QR payload codec for registration blocks.

Payloads are compact JSON objects. Two modes:
- inline: full spec embedded (self-describing sheet)
- id_only: just {"v": 1, "id": "..."} — requires local lookup to decode
"""

from __future__ import annotations

import json
from typing import Any

_SCHEMA_VERSION = 1


class PayloadError(ValueError):
    """Raised when a QR payload cannot be decoded or has an unknown version."""


def encode_inline(spec: dict[str, Any]) -> str:
    """Encode a full test spec into a compact JSON string.

    `spec` must contain at minimum: id, t, x, grid, b. `y` optional.
    Keys are kept short (already-abbreviated by the caller); this function
    only adds the version tag and serializes with minimal whitespace.
    """
    if "id" not in spec:
        raise PayloadError("spec missing required field: id")
    payload = {"v": _SCHEMA_VERSION, **spec}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def encode_id_only(test_id: str) -> str:
    """Encode just the schema version + ID."""
    if not test_id:
        raise PayloadError("test_id must be non-empty")
    return json.dumps({"v": _SCHEMA_VERSION, "id": test_id}, separators=(",", ":"))


def decode_payload(s: str) -> dict[str, Any]:
    """Decode a payload string, validating schema version.

    Raises PayloadError on bad JSON or unknown schema version.
    """
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise PayloadError(f"invalid JSON: {e}")
    if not isinstance(data, dict):
        raise PayloadError("payload must be a JSON object")
    v = data.get("v")
    if v != _SCHEMA_VERSION:
        raise PayloadError(f"unsupported schema version: {v!r}")
    if "id" not in data:
        raise PayloadError("missing required field: id")
    return data
