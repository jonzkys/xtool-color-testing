"""Unit tests for the in-memory LRU layer of ``warped_cache``.

These exercise the cache primitive (``_mem_cache_get``/``_mem_cache_put``/
``_mem_cache_invalidate`` + the ``XCS_GEN_WARPED_CACHE_SIZE`` knob)
without touching the DB or capture pipeline — the full
``get_warped_bgr`` flow is covered by existing integration tests.
"""

from __future__ import annotations

import threading

import numpy as np
import pytest

from xcs_gen_web.services import warped_cache as wc


def _frame(value: int = 0, size: int = 4) -> np.ndarray:
    """Tiny BGR-shaped ndarray. Real frames are ~800×600×3 but the
    cache treats them as opaque, so size doesn't matter here."""
    return np.full((size, size, 3), value, dtype=np.uint8)


@pytest.fixture(autouse=True)
def _reset_cache():
    wc._reset_for_tests()
    yield
    wc._reset_for_tests()


def test_hit_returns_same_array() -> None:
    f = _frame(7)
    wc._mem_cache_put(1, "img/a.png", f)
    out = wc._mem_cache_get(1, "img/a.png")
    assert out is f
    stats = wc._cache_stats()
    assert stats["hits"] == 1
    assert stats["misses"] == 0
    assert stats["size"] == 1


def test_miss_returns_none() -> None:
    assert wc._mem_cache_get(99, "img/missing.png") is None
    stats = wc._cache_stats()
    assert stats["hits"] == 0
    assert stats["misses"] == 1


def test_lru_eviction_drops_oldest(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XCS_GEN_WARPED_CACHE_SIZE", "3")
    wc._mem_cache_put(1, "a.png", _frame(1))
    wc._mem_cache_put(2, "b.png", _frame(2))
    wc._mem_cache_put(3, "c.png", _frame(3))
    # Touch rid=1 so it becomes most-recently-used.
    assert wc._mem_cache_get(1, "a.png") is not None
    # Inserting rid=4 should evict rid=2 (now the oldest), not rid=1.
    wc._mem_cache_put(4, "d.png", _frame(4))
    assert wc._mem_cache_get(1, "a.png") is not None
    assert wc._mem_cache_get(2, "b.png") is None
    assert wc._mem_cache_get(3, "c.png") is not None
    assert wc._mem_cache_get(4, "d.png") is not None


def test_invalidate_drops_entry() -> None:
    wc._mem_cache_put(1, "a.png", _frame(1))
    wc._mem_cache_put(2, "b.png", _frame(2))
    wc._mem_cache_invalidate(1)
    assert wc._mem_cache_get(1, "a.png") is None
    assert wc._mem_cache_get(2, "b.png") is not None


def test_invalidate_drops_all_paths_for_rid() -> None:
    # Two entries for the same rid under different paths shouldn't
    # happen in normal flow (put drops stale paths), but invalidate
    # must defensively wipe everything keyed by that rid anyway.
    wc._mem_cache_put(1, "a.png", _frame(1))
    # Inject a second path for rid=1 directly, sidestepping put's
    # auto-eviction, to prove invalidate clears regardless of path.
    with wc._MEM_LOCK:
        wc._MEM_CACHE[(1, "a-v2.png")] = _frame(11)
    wc._mem_cache_invalidate(1)
    assert wc._mem_cache_get(1, "a.png") is None
    assert wc._mem_cache_get(1, "a-v2.png") is None


def test_path_change_evicts_old_entry_for_same_rid() -> None:
    """Reingest changes ``warped_image_path``. The next put for that
    rid must drop the stale entry rather than letting two decoded
    frames for the same logical row hang around in cache."""
    wc._mem_cache_put(1, "old.png", _frame(1))
    wc._mem_cache_put(1, "new.png", _frame(2))
    assert wc._mem_cache_get(1, "old.png") is None
    assert wc._mem_cache_get(1, "new.png") is not None
    assert wc._cache_stats()["size"] == 1


def test_default_max_size_used_when_env_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("XCS_GEN_WARPED_CACHE_SIZE", raising=False)
    assert wc._cache_stats()["max_size"] == wc._DEFAULT_MEM_CACHE_SIZE


def test_invalid_env_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XCS_GEN_WARPED_CACHE_SIZE", "not-a-number")
    assert wc._cache_stats()["max_size"] == wc._DEFAULT_MEM_CACHE_SIZE


def test_concurrent_get_put_does_not_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("XCS_GEN_WARPED_CACHE_SIZE", "8")
    errors: list[Exception] = []
    stop = threading.Event()

    def worker(rid: int) -> None:
        try:
            for i in range(200):
                if stop.is_set():
                    return
                path = f"r{rid}-v{i % 4}.png"
                wc._mem_cache_put(rid, path, _frame(rid))
                wc._mem_cache_get(rid, path)
                wc._mem_cache_get(rid, "missing.png")
                if i % 50 == 0:
                    wc._mem_cache_invalidate(rid)
        except Exception as e:  # pragma: no cover - reported via list
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(rid,)) for rid in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    stop.set()
    assert not errors, f"concurrent workers raised: {errors!r}"
    # Bound-by-max_size invariant must hold even under contention.
    assert wc._cache_stats()["size"] <= 8
