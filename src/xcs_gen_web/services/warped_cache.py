"""Cached access to the rectified (warped) burn-space image.

The debug-result modal opens 1× warped+grid + 1× row-count + N× row
strips, and the parent ResultDetail modal also pulls the warped hero.
Each used to re-run the full capture pipeline (decode → ArUco → QR →
homography → perspective warp → swatch sample), giving a 5-10 s
cumulative wait on a 5-row test.

Caching is two-tier, per-result, keyed by
``results.warped_image_path``:

1. **On-disk PNG sidecar** — persisted via the storage abstraction and
   pointed at by ``results.warped_image_path``. Survives restarts and
   is shared across worker processes. First read computes + saves it.
2. **In-memory decoded BGR ndarray** (this module, ``_MEM_CACHE``) —
   a bounded LRU keyed by ``(rid, warped_image_path)``. Skips the PNG
   read + ``cv2.imdecode`` (≈10-30 ms + S3 latency on a warm box) on
   subsequent hits. Per-worker; not shared across processes.

The memory cache is bounded by entry count (default 32, override via
``XCS_GEN_WARPED_CACHE_SIZE``). At ~5 MB per 800×600×3 uint8 frame the
default keeps the working set under ~160 MB per worker — safe on a
4 GiB ECS task. Eviction is LRU; concurrent access is serialised by a
single coarse ``threading.Lock`` (the cached ndarrays are immutable
from this module's perspective so no per-key locking is needed).

Reingest + delete invalidate both tiers.

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

import os
import threading
from collections import OrderedDict
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

# --- in-memory LRU --------------------------------------------------

_DEFAULT_MEM_CACHE_SIZE = 32


def _mem_cache_max_size() -> int:
    """Read the configured max size on every access. Read once at
    module load is also fine, but doing it lazily keeps tests able to
    flip ``XCS_GEN_WARPED_CACHE_SIZE`` via ``monkeypatch.setenv``."""
    raw = os.environ.get("XCS_GEN_WARPED_CACHE_SIZE")
    if raw is None:
        return _DEFAULT_MEM_CACHE_SIZE
    try:
        n = int(raw)
    except ValueError:
        return _DEFAULT_MEM_CACHE_SIZE
    return max(1, n)


# Keyed by (rid, warped_image_path). Storing the path as a version
# token means a reingest that changes the path auto-invalidates the
# previous entry on the next put without an explicit clear.
_MEM_CACHE: "OrderedDict[tuple[int, str], np.ndarray]" = OrderedDict()
_MEM_LOCK = threading.Lock()
_STATS = {"hits": 0, "misses": 0}


def _mem_cache_get(rid: int, path: str) -> np.ndarray | None:
    key = (rid, path)
    with _MEM_LOCK:
        bgr = _MEM_CACHE.get(key)
        if bgr is None:
            _STATS["misses"] += 1
            return None
        # Refresh LRU order.
        _MEM_CACHE.move_to_end(key)
        _STATS["hits"] += 1
        return bgr


def _mem_cache_put(rid: int, path: str, bgr: np.ndarray) -> None:
    key = (rid, path)
    with _MEM_LOCK:
        # Drop any older entry for the same rid under a different path
        # — the new path is by definition fresher (reingest bumps it),
        # so the previous decoded frame is stale.
        stale = [k for k in _MEM_CACHE if k[0] == rid and k != key]
        for k in stale:
            del _MEM_CACHE[k]
        _MEM_CACHE[key] = bgr
        _MEM_CACHE.move_to_end(key)
        # Evict oldest until within bounds.
        max_size = _mem_cache_max_size()
        while len(_MEM_CACHE) > max_size:
            _MEM_CACHE.popitem(last=False)


def _mem_cache_invalidate(rid: int) -> None:
    """Drop every entry for ``rid`` regardless of path."""
    with _MEM_LOCK:
        stale = [k for k in _MEM_CACHE if k[0] == rid]
        for k in stale:
            del _MEM_CACHE[k]


def _cache_stats() -> dict[str, int]:
    """Internal debug helper — not exposed via HTTP. Returns hit/miss
    counters and current/max size of the in-memory LRU. Useful for
    future telemetry or for assertions in tests."""
    with _MEM_LOCK:
        return {
            "hits": _STATS["hits"],
            "misses": _STATS["misses"],
            "size": len(_MEM_CACHE),
            "max_size": _mem_cache_max_size(),
        }


def _reset_for_tests() -> None:
    """Clear cache + stats. Tests call this in a fixture to isolate."""
    with _MEM_LOCK:
        _MEM_CACHE.clear()
        _STATS["hits"] = 0
        _STATS["misses"] = 0


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
) -> tuple[np.ndarray, str]:
    """Run the full capture pipeline, persist the warped sidecar, and
    update ``results.warped_image_path``. Returns ``(bgr, saved_path)``
    so callers can populate the memory cache with the new path token.
    Raises :class:`CacheError` on missing source, or
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
    return cap.warped_image_bgr, saved["path"]


def get_warped_bgr(
    rid: int, *, owner_id: int,
) -> tuple[np.ndarray, dict[str, Any], dict[str, Any]]:
    """Return ``(warped_bgr, test, result)``. Cached after the first
    successful call; subsequent invocations hit the in-memory LRU
    first, then the on-disk PNG sidecar, and only fall through to the
    full capture pipeline if both miss."""
    r, t = _load_pair(rid, owner_id)
    cached_path = r.get("warped_image_path")
    if cached_path:
        mem = _mem_cache_get(rid, cached_path)
        if mem is not None:
            return mem, t, r
        cached = _read_or_none(cached_path)
        if cached is not None:
            bgr = _decode_png_to_bgr(cached)
            if bgr is not None:
                _mem_cache_put(rid, cached_path, bgr)
                return bgr, t, r
    bgr, saved_path = _compute_and_cache_warped(r, t, owner_id=owner_id)
    _mem_cache_put(rid, saved_path, bgr)
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
    bgr, _saved_path = _compute_and_cache_warped(r, t, owner_id=owner_id)
    return _encode_bgr_to_png(bgr)


def invalidate(rid: int, *, owner_id: int) -> None:
    """Drop the cached sidecar (best-effort) and null the DB pointer.
    Called from reingest + result-delete paths so a stale warped image
    can't survive a source-photo or pipeline change."""
    r = r_repo.get(rid, owner_id=owner_id)
    if r is None:
        _mem_cache_invalidate(rid)
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
    _mem_cache_invalidate(rid)
