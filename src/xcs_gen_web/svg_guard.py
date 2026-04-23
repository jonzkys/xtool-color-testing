"""Cheap pre-parse checks that reject pathological SVGs before any
expensive work (svgelements parse, shapely union/difference, hatch
generation) runs.

The existing global 20 MB body-size cap + per-field 10 MB ``max_length``
keep memory bounded, but a 2 MB SVG can still carry ~100k shapes and
make shapely grind for seconds per request. This module adds a regex
pass that counts shape tags directly, so we can fail fast with 413 on
obviously-too-complex input.
"""

from __future__ import annotations

import re

# Counts occurrences of SVG primitive start-tags. Deliberately liberal —
# misses <use>, <g>, <foreignObject>; they don't add shapes individually.
# A trailing character class prevents matching substrings inside longer
# tag names (e.g., "pathway" inside a made-up tag).
_SHAPE_TAG_RE = re.compile(
    r"<(?:path|rect|circle|ellipse|line|polyline|polygon)[\s/>]",
    re.IGNORECASE,
)

# Ceiling applies to every SVG endpoint. Chosen because:
#   - Normal hand-authored SVGs fit well under 5k shapes.
#   - vtracer output for a typical photo lands at 1-3k layers.
#   - Shapely union/difference time grows superlinearly past 10k shapes,
#     which is where a single request starts to block the event loop
#     noticeably.
MAX_SVG_SHAPES = 5000


def count_shapes(svg_content: str) -> int:
    """Estimate shape count via regex — no XML parse. O(len(svg_content))."""
    return len(_SHAPE_TAG_RE.findall(svg_content))


def assert_shape_count(svg_content: str, *, limit: int = MAX_SVG_SHAPES) -> None:
    """Raise ValueError if the SVG has more primitive shapes than ``limit``.

    Endpoint wrappers convert ValueError into HTTP 400. Keep the message
    machine-stable so the frontend can surface a targeted "SVG too
    complex" hint rather than a generic failure.
    """
    count = count_shapes(svg_content)
    if count > limit:
        raise ValueError(
            f"SVG has {count} shapes, exceeds limit of {limit}. "
            "Simplify the SVG (merge paths, reduce vtracer detail) and retry."
        )
