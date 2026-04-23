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

# Ceiling applies to every SVG endpoint. Original pick was 5 k but real
# user work (high-detail vtracer output from detailed raster art)
# regularly blows past that. 20 k is the current ceiling — still guards
# against abusive / accidental million-shape SVGs, but accommodates the
# legitimate heavy-detail workflow. Shapely work inside the pipeline
# (subtract, hatch) is already bounded by the STRtree spatial-index
# optimisation + per-phase timing report so grossly-slow requests are
# visible in the log before they ever time out.
MAX_SVG_SHAPES = 20_000


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
