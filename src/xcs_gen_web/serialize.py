"""Shared serialisation: turn an ``XCSProject`` into download bytes.

Two output formats:

- ``"xcs"`` — the legacy flat-JSON ``.xcs`` (``xcs_gen.builder.build_xcs``).
- ``"xs"``  — the xcs-workspace-v2 ZIP bundle
  (``xcs_gen.xcs_v2.build_xs_bytes``).

Every endpoint that hands the browser a project file routes through
:func:`project_to_bytes` so format selection lives in one place and the
two paths can't drift. ``"xs"`` is the default per the product decision;
``"xcs"`` stays selectable.
"""

from __future__ import annotations

import json
from typing import Literal

from xcs_gen.builder import build_xcs
from xcs_gen.model import XCSProject
from xcs_gen.xcs_v2 import build_xs_bytes

OutputFormat = Literal["xcs", "xs"]

DEFAULT_FORMAT: OutputFormat = "xs"


def project_to_bytes(
    project: XCSProject, fmt: OutputFormat = DEFAULT_FORMAT
) -> tuple[bytes, str, str]:
    """Serialise ``project`` to ``(body_bytes, media_type, extension)``.

    Args:
        project: the model to serialise.
        fmt: ``"xcs"`` (legacy flat JSON) or ``"xs"`` (v2 ZIP bundle).

    Raises:
        ValueError: on an unknown format string.
    """
    if fmt == "xcs":
        body = json.dumps(build_xcs(project), separators=(",", ":")).encode("utf-8")
        return body, "application/json", "xcs"
    if fmt == "xs":
        return build_xs_bytes(project), "application/zip", "xs"
    raise ValueError(f"unknown output format {fmt!r} (expected 'xcs' or 'xs')")
