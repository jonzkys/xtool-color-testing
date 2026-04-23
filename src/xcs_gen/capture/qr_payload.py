"""QR payload codec for registration blocks.

Payload shape (schema v1):

    {"v": 1, "id": <int>, "r"?: <int>}

``id`` is the test id — the server resolves the full spec via the DB.
``r`` is an optional retest index; absent on burns from before the
retest feature landed, where ingestion defaults it to 0 (the implicit
"first burn"). The QR field is kept short so the marker can still fit
on small test strips.
"""

from __future__ import annotations

import json
from typing import Any

_SCHEMA_VERSION = 1


class PayloadError(ValueError):
    """Raised when a QR payload cannot be decoded or has an unknown version."""


def encode_id(test_id: int, retest_index: int = 0) -> str:
    """Build a QR payload string.

    ``retest_index`` defaults to 0 and is omitted from the payload in
    that case so pre-retest-era QRs keep the same two-key shape — no
    byte cost to a workflow that never hits the Retest button.
    """
    if not isinstance(test_id, int) or isinstance(test_id, bool) or test_id < 1:
        raise PayloadError("test_id must be a positive int")
    if not isinstance(retest_index, int) or isinstance(retest_index, bool) or retest_index < 0:
        raise PayloadError("retest_index must be a non-negative int")
    payload: dict[str, Any] = {"v": _SCHEMA_VERSION, "id": test_id}
    if retest_index > 0:
        payload["r"] = retest_index
    return json.dumps(payload, separators=(",", ":"))


def decode_payload(s: str) -> dict[str, Any]:
    """Parse a QR payload string. Always returns a dict with at least
    ``v``, ``id``, and ``r`` keys — ``r`` defaults to 0 when missing or
    malformed so callers can treat older burns as "retest 0"."""
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

    # Retest index is optional and silently ignored if malformed — an
    # old QR from before the feature has no ``r`` key, and we don't
    # want that to brick an upload.
    raw_r = data.get("r")
    if raw_r is None or isinstance(raw_r, bool):
        data["r"] = 0
    elif isinstance(raw_r, int):
        data["r"] = max(0, raw_r)
    else:
        try:
            data["r"] = max(0, int(raw_r))
        except (TypeError, ValueError):
            data["r"] = 0
    return data
