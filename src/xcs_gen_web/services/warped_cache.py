"""Cached access to the rectified (warped) burn-space image.

The debug-result modal opens 1× warped+grid + 1× row-count + N× row
strips, and the parent ResultDetail modal also pulls the warped hero.
Each used to re-run the full capture pipeline (decode → ArUco → QR →
homography → perspective warp → swatch sample), giving a 5-10 s
cumulative wait on a 5-row test.

Caching is per-result, keyed by ``results.warped_image_path``. The
first read computes + saves a PNG sidecar via the storage abstraction
and persists the returned path. Subsequent reads decode the PNG once
(an order of magnitude cheaper than the capture pipeline). Reingest
+ delete invalidate the cache.

Public surface:

* :func:`get_warped_bgr` — returns ``(warped_image_bgr, test_record,
  result_record)`` or raises :class:`CacheError` (mapped to HTTP by
  the route layer). On cache miss runs capture and caches the
  warped image transparently.
* :func:`get_warped_png` — same but returns PNG bytes ready to ship
  to the browser; uses the cached sidecar verbatim when present.
* :func:`invalidate` — best-effort delete + DB null-out. Called from
  reingest + result-delete paths.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .. import images
from ..repositories import (
    materials as m_repo,
    results as r_repo,
    tests as t_repo,
)
from . import capture as capture_service

# Sidecar discriminator passed to ``images.save(kind=...)``. Kept short
# (<16 chars per ``_assert_safe_kind``) and matches the column name
# fragment ``warped_image_path`` for grep-ability.
_WARPED_KIND = "warped"
_WARPED_SUFFIX = ".png"


class CacheError(Exception):
    """Raised when the source data is missing/unavailable. Routes map
    this to 410 — same posture as the original ``_capture_or_410``
    helper this code replaces."""


class CaptureError(Exception):
    """Raised when capture itself fails (no QR / wrong test_id /
    decoded). Routes map this to 400."""


def _read_or_none(path: str) -> bytes | None:
    """``images.read`` raises FileNotFoundError on miss; the cache
    treats that as "regenerate". S3's NoSuchKey is normalised to the
    same exception by :class:`storage.S3Storage`, so this branch
    works on both backends."""
    try:
        return images.read(path)
    except FileNotFoundError:
        return None


def _decode_png_to_bgr(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _encode_bgr_to_png(bgr: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(_WARPED_SUFFIX, bgr)
    if not ok:
        raise CaptureError("failed to encode warped image as PNG")
    return bytes(buf)


def _load_pair(rid: int, owner_id: int) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch (result, test) or raise CacheError with a route-friendly
    message. Hides the 404 vs 410 vs missing-test branching from
    callers — they all collapse to "the modal can't render"."""
    r = r_repo.get(rid, owner_id=owner_id)
    if r is None:
        raise CacheError("result not found")
    t = t_repo.get(r["test_id"], owner_id=owner_id)
    if t is None:
        raise CacheError("test not found")
    return r, t


def _compute_and_cache_warped(
    r: dict[str, Any], t: dict[str, Any], *, owner_id: int,
) -> np.ndarray:
    """Run the full capture pipeline, persist the warped sidecar, and
    update ``results.warped_image_path``. Returns the warped BGR
    array. Raises :class:`CacheError` on missing source, or
    :class:`CaptureError` on a capture failure."""
    raw = _read_or_none(r["image_path"])
    if raw is None:
        raise CacheError("source image no longer available")
    material = None
    if t.get("material_id") is not None:
        material = m_repo.get(int(t["material_id"]), owner_id=owner_id)
    try:
        cap = capture_service.run_capture(
            image_bytes=raw, test_id=r["test_id"],
            spec=capture_service.effective_spec(t),
            material=material,
        )
    except capture_service.CaptureError as e:
        raise CaptureError(str(e)) from e
    png = _encode_bgr_to_png(cap.warped_image_bgr)
    saved = images.save(
        test_id=r["test_id"], result_id=r["id"],
        data=png, suffix=_WARPED_SUFFIX, kind=_WARPED_KIND,
    )
    r_repo.set_warped_image_path(r["id"], saved["path"], owner_id=owner_id)
    return cap.warped_image_bgr


def get_warped_bgr(
    rid: int, *, owner_id: int,
) -> tuple[np.ndarray, dict[str, Any], dict[str, Any]]:
    """Return ``(warped_bgr, test, result)``. Cached after the first
    successful call; subsequent invocations decode the cached PNG
    instead of re-running capture."""
    r, t = _load_pair(rid, owner_id)
    cached_path = r.get("warped_image_path")
    if cached_path:
        cached = _read_or_none(cached_path)
        if cached is not None:
            bgr = _decode_png_to_bgr(cached)
            if bgr is not None:
                return bgr, t, r
    bgr = _compute_and_cache_warped(r, t, owner_id=owner_id)
    return bgr, t, r


def get_warped_png(rid: int, *, owner_id: int) -> bytes:
    """Return the cached PNG bytes verbatim, or compute + cache then
    return. Avoids the BGR↔PNG round-trip when the cache is warm —
    the warped-image hero endpoint hits this hot path."""
    r, t = _load_pair(rid, owner_id)
    cached_path = r.get("warped_image_path")
    if cached_path:
        cached = _read_or_none(cached_path)
        if cached is not None:
            return cached
    bgr = _compute_and_cache_warped(r, t, owner_id=owner_id)
    return _encode_bgr_to_png(bgr)


def invalidate(rid: int, *, owner_id: int) -> None:
    """Drop the cached sidecar (best-effort) and null the DB pointer.
    Called from reingest + result-delete paths so a stale warped image
    can't survive a source-photo or pipeline change."""
    r = r_repo.get(rid, owner_id=owner_id)
    if r is None:
        return
    cached_path = r.get("warped_image_path")
    if cached_path:
        try:
            images.delete(cached_path)
        except Exception:
            # Best-effort — the row will be nulled regardless, and a
            # leftover sidecar wastes disk but doesn't corrupt anything.
            pass
    r_repo.set_warped_image_path(rid, None, owner_id=owner_id)
