"""QR payload codec for registration blocks.

Payload shape (schema v1): {"v": 1, "id": <int>}.
The server resolves the full test spec from the id via the DB; the QR
carries only the test id so we can fit a 4–6 mm marker on small strips.
"""

from __future__ import annotations

import json
from typing import Any

_SCHEMA_VERSION = 1


class PayloadError(ValueError):
    """Raised when a QR payload cannot be decoded or has an unknown version."""


def encode_id(test_id: int) -> str:
    if not isinstance(test_id, int) or isinstance(test_id, bool) or test_id < 1:
        raise PayloadError("test_id must be a positive int")
    return json.dumps({"v": _SCHEMA_VERSION, "id": test_id}, separators=(",", ":"))


def decode_payload(s: str) -> dict[str, Any]:
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise PayloadError(f"invalid JSON: {e}") from e
    if not isinstance(data, dict):
        raise PayloadError("payload must be a JSON object")
    if data.get("v") != _SCHEMA_VERSION:
        raise PayloadError(f"unsupported schema version: {data.get('v')!r}")
    raw_id = data.get("id")
    if raw_id is None:
        raise PayloadError("missing required field: id")
    if isinstance(raw_id, bool):
        raise PayloadError(f"id must be int, got bool: {raw_id!r}")
    if isinstance(raw_id, int):
        data["id"] = raw_id
    elif isinstance(raw_id, str):
        try:
            data["id"] = int(raw_id)
        except ValueError:
            raise PayloadError(f"id string must parse as int, got {raw_id!r}") from None
    else:
        raise PayloadError(f"id must be int or str, got {type(raw_id).__name__}: {raw_id!r}")
    return data
