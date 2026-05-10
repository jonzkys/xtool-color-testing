"""Per-test canonical-anchor picker for WB flat-field correction.

The flat-field path normalises a photo's substrate strips to a single
``canonical_neutral`` RGB. The legacy hardcoded canonical (160, 160, 145)
crushes the brightest captures because gain = canonical / measured drops
below 1.0 and pulls saturated highlights into the upper-mid range.

This module derives the canonical from the test's own observations:
across all stored ``wb_anchor_rgb_json`` payloads for the test's prior
results, plus the current photo's edge / unburned readings, pick the
single RGB with the highest luminance. The brightest photo passes
through with gain ≈ 1.0 (no compression); dimmer photos get lifted
toward it.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

RGB = tuple[float, float, float]

# Pre-feature fallback when no candidate RGB is usable (no prior results
# AND every edge of the current photo failed to read). Matches the
# legacy hardcoded value so behaviour for those edge cases is unchanged.
FALLBACK_CANONICAL: RGB = (160.0, 160.0, 145.0)

_LUMA_R = 0.299
_LUMA_G = 0.587
_LUMA_B = 0.114


def _luma(rgb: RGB) -> float:
    return _LUMA_R * rgb[0] + _LUMA_G * rgb[1] + _LUMA_B * rgb[2]


def _is_valid_rgb(value: object) -> bool:
    """A 3-tuple of finite, non-negative numbers."""
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return False
    for c in value:
        if not isinstance(c, (int, float)):
            return False
        if c != c or c < 0:   # NaN-safe: NaN != NaN
            return False
    return True


def _candidates_from_prior(prior_json: str | None) -> Iterable[RGB]:
    """Parse one stored ``wb_anchor_rgb_json`` value into RGB candidates.

    Flat-field rows store ``[[R,G,B], [R,G,B], [R,G,B], [R,G,B]]`` (one
    per edge); chromaticity rows store a single ``[R, G, B]``. Anything
    that doesn't match either shape is silently skipped — old rows from
    ``wb_mode == "skipped"`` or ``"disabled"`` legitimately leave the
    column NULL.
    """
    if not prior_json:
        return ()
    try:
        parsed = json.loads(prior_json)
    except (TypeError, ValueError):
        return ()
    if _is_valid_rgb(parsed):
        return ((float(parsed[0]), float(parsed[1]), float(parsed[2])),)
    if isinstance(parsed, list) and all(_is_valid_rgb(p) for p in parsed):
        return tuple(
            (float(p[0]), float(p[1]), float(p[2])) for p in parsed
        )
    return ()


def pick_test_canonical(
    *,
    prior_anchors_json: Iterable[str | None],
    candidate_edge_means: dict[str, RGB | None],
    candidate_unburned: RGB | None,
) -> RGB:
    """Pick the brightest valid RGB across all observations of this test.

    ``prior_anchors_json`` is the list of stored ``wb_anchor_rgb_json``
    column values for the test's prior result rows (any may be NULL).
    ``candidate_edge_means`` is the current photo's perimeter strips
    (any side may be ``None`` if unreadable). ``candidate_unburned`` is
    the current photo's unburned-around-markers reading (or ``None``).

    Returns the RGB to use as the per-pixel flat-field canonical. Falls
    back to :data:`FALLBACK_CANONICAL` only when no candidate is usable.
    """
    candidates: list[RGB] = []
    for prior in prior_anchors_json:
        candidates.extend(_candidates_from_prior(prior))
    for side in ("top", "right", "bottom", "left"):
        v = candidate_edge_means.get(side)
        if _is_valid_rgb(v):
            candidates.append((float(v[0]), float(v[1]), float(v[2])))
    if _is_valid_rgb(candidate_unburned):
        candidates.append((
            float(candidate_unburned[0]),
            float(candidate_unburned[1]),
            float(candidate_unburned[2]),
        ))

    if not candidates:
        return FALLBACK_CANONICAL
    return max(candidates, key=_luma)
