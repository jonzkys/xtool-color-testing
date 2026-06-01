"""xcs-workspace-v2 (`.xs`) emitter.

The `.xs` format is xTool Studio's directory-style workspace bundle, shipped
as a ZIP. Where the legacy `.xcs` writer (`xcs_gen.builder`) emits a single
flat JSON, the v2 bundle splits the project into:

- a workspace manifest (`project.json`) + `.format`/`meta` markers,
- per-canvas display scene graphs (`canvases/<id>/displays-N.json`),
- a parameter-profile store (`profiles.json`) referenced by
- a device/param-binding layer (`devices/device-<id>.json`),
- two content-addressed side stores: vectors (`vectors/svg/*`, keyed by
  sha256 of the SVG `dPath`) and rasters (`resources/<sha256>.png`).

`write_xs(project, path)` is the public entry point; it mirrors
`xcs_gen.builder.write_xcs` for the v2 container. The per-processingType
parameter blocks are reused from the legacy builder so both writers stay in
lock-step.

Structure verified against the real bundles in /tmp/re-check/*.xs and the
ground-truth spec in /tmp/groundtruth.md.
"""

from __future__ import annotations

from .writer import build_bundle, write_xs

__all__ = ["write_xs", "build_bundle"]
