"""Build XCS bytes from a Test row."""

from __future__ import annotations

import re
from typing import Any

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._\- ]")


def _safe_project_name(name: str, *, fallback: str) -> str:
    """Map arbitrary test names to something Project.name accepts."""
    cleaned = _SAFE_NAME_RE.sub("_", name).strip() or fallback
    return cleaned


def bytes_for_test(*, test_id: int, name: str, material_id: int,
                   spec: dict[str, Any]) -> bytes:
    # Build a throwaway Project with exactly one placement so the existing
    # converter machinery keeps working. When the frontend project wrapper
    # is removed we'll fold this into a cleaner single-test path.
    from .. import converter
    from ..schemas import Project

    project_name = _safe_project_name(name, fallback=f"test-{test_id}")
    placement = {
        "row": 0, "col": 0, "col_span": 1,
        "test": {
            "id": str(test_id), "name": project_name, "material_id": str(material_id), **spec,
        },
    }
    project = {
        "name": project_name,
        "grid_gap_mm": 0,
        "focus_mm": 1.5,
        "tests": [placement],
    }
    return converter.project_to_xcs_bytes(Project.model_validate(project))
