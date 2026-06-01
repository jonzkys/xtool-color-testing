"""Load + validate the extracted machine validation profiles.

The committed dataset lives at ``data/machine_profiles.json`` and is the
source of truth for per-(machine, mode) constraints. ``machines.py`` loads
it at import time. Shape per profile mirrors what /api/machines returns:
``{ field: FieldConstraint }`` where FieldConstraint is one of
range / stepped / not_applicable / enum.
"""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / "data" / "machine_profiles.json"

_VALID_KINDS = {"range", "stepped", "not_applicable", "enum"}


def _validate_constraint(profile_id: str, field_name: str, c: dict) -> None:
    if not isinstance(c, dict):
        raise ValueError(
            f"{profile_id}.{field_name}: constraint must be a dict, got {type(c).__name__!r}"
        )
    kind = c.get("kind")
    if kind not in _VALID_KINDS:
        raise ValueError(
            f"{profile_id}.{field_name}: unknown constraint kind {kind!r}",
        )
    if kind == "range":
        lo, hi = c.get("min"), c.get("max")
        if (lo is None or hi is None
                or not isinstance(lo, (int, float)) or not isinstance(hi, (int, float))
                or lo > hi):
            raise ValueError(
                f"{profile_id}.{field_name}: invalid range {lo!r}..{hi!r}",
            )
    elif kind in ("stepped", "enum"):
        vals = c.get("values")
        if not isinstance(vals, list) or not vals:
            raise ValueError(
                f"{profile_id}.{field_name}: {kind} needs a non-empty values list",
            )


def validate_profiles(profiles: dict[str, dict[str, dict]]) -> None:
    """Raise ValueError if any constraint is malformed."""
    for pid, prof in profiles.items():
        for field_name, c in prof.items():
            _validate_constraint(pid, field_name, c)


def load_profiles(path: Path = DEFAULT_PATH) -> dict[str, dict[str, dict]]:
    """Read + validate the profiles JSON, returning the ``profiles`` dict."""
    raw = json.loads(Path(path).read_text())
    if "profiles" not in raw:
        raise ValueError(f"profiles JSON at {path} is missing the 'profiles' key")
    profiles = raw["profiles"]
    validate_profiles(profiles)
    return profiles
