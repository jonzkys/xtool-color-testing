"""Tests for the per-process capture concurrency semaphore.

The capture service caps simultaneous full-pipeline runs at
``XCS_GEN_CAPTURE_CONCURRENCY`` (default ``2``) per worker process to
keep ArUco detection + perspective warp from OOM-ing the box when many
uploads arrive at once. These tests verify:

- env var override resizes the semaphore
- default is two permits
- when permits == 1, two concurrent ``run_capture`` calls serialise
"""

from __future__ import annotations

import threading
import time

import numpy as np
import pytest

from xcs_gen_web.services import capture as cap


@pytest.fixture(autouse=True)
def _reset_semaphore():
    """Drop the cached semaphore before and after each test so env-var
    monkeypatches take effect deterministically."""
    cap._reset_capture_semaphore_for_tests()
    yield
    cap._reset_capture_semaphore_for_tests()


def test_default_concurrency_is_two(monkeypatch):
    """Without the env var set, the semaphore exposes two permits."""
    monkeypatch.delenv("XCS_GEN_CAPTURE_CONCURRENCY", raising=False)
    sem = cap._get_capture_semaphore()
    # Drain permits by acquiring without blocking; the count we see
    # equals the configured permit count.
    acquired = 0
    while sem.acquire(blocking=False):
        acquired += 1
    assert acquired == 2
    # Restore for next test.
    for _ in range(acquired):
        sem.release()


def test_env_var_overrides_concurrency(monkeypatch):
    """``XCS_GEN_CAPTURE_CONCURRENCY=3`` produces a 3-permit semaphore."""
    monkeypatch.setenv("XCS_GEN_CAPTURE_CONCURRENCY", "3")
    sem = cap._get_capture_semaphore()
    acquired = 0
    while sem.acquire(blocking=False):
        acquired += 1
    assert acquired == 3
    for _ in range(acquired):
        sem.release()


def test_env_var_clamps_below_one(monkeypatch):
    """A zero or negative env value still produces a usable 1-permit
    semaphore — we never want zero permits (would deadlock all callers)."""
    monkeypatch.setenv("XCS_GEN_CAPTURE_CONCURRENCY", "0")
    sem = cap._get_capture_semaphore()
    assert sem.acquire(blocking=False)
    assert not sem.acquire(blocking=False)
    sem.release()


def test_env_var_invalid_falls_back_to_default(monkeypatch):
    """Garbage in the env var falls back to the default of two permits
    rather than crashing on first capture."""
    monkeypatch.setenv("XCS_GEN_CAPTURE_CONCURRENCY", "not-a-number")
    sem = cap._get_capture_semaphore()
    acquired = 0
    while sem.acquire(blocking=False):
        acquired += 1
    assert acquired == 2
    for _ in range(acquired):
        sem.release()


def test_concurrent_run_capture_serialises_with_one_permit(monkeypatch):
    """With concurrency=1, two simultaneous ``run_capture`` calls must
    serialise: the second call's body shouldn't enter the warp step
    until the first releases the semaphore.

    We stub the pipeline so the heavy work is replaced by a fixed sleep
    inside ``warp_to_burn_space`` (which runs after the semaphore is
    acquired). If serialisation works, total wall time is ≈ 2 * sleep;
    if it doesn't, ≈ 1 * sleep.
    """
    monkeypatch.setenv("XCS_GEN_CAPTURE_CONCURRENCY", "1")
    cap._reset_capture_semaphore_for_tests()

    fake_img = np.zeros((10, 10, 3), dtype=np.uint8)
    warped = np.zeros((50, 50, 3), dtype=np.uint8)

    # Corners for all expected fiducials so missing_markers is [].
    corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }

    SLEEP_S = 0.25
    in_warp = threading.Event()
    overlap_detected = threading.Event()
    active = 0
    active_lock = threading.Lock()

    def fake_warp(*_args, **_kwargs):
        nonlocal active
        with active_lock:
            active += 1
            now_active = active
        # If we ever see two threads inside warp simultaneously, the
        # semaphore failed to serialise.
        if now_active > 1:
            overlap_detected.set()
        in_warp.set()
        time.sleep(SLEEP_S)
        with active_lock:
            active -= 1
        return warped

    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(
        cap, "detect_fiducials_with_recropping",
        lambda _: (42, 0, corners),
    )
    monkeypatch.setattr(cap, "warp_to_burn_space", fake_warp)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 200.0, "x_steps": 4,
        "y_param": None, "rows": 1, "width_mm": 10.0, "height_mm": 10.0,
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }

    results: list[object] = []
    errors: list[BaseException] = []

    def worker():
        try:
            results.append(
                cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec),
            )
        except BaseException as e:  # pragma: no cover — fail loudly
            errors.append(e)

    t0 = time.perf_counter()
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10.0)
    elapsed = time.perf_counter() - t0

    assert not errors, f"run_capture raised: {errors!r}"
    assert len(results) == 2
    assert not overlap_detected.is_set(), (
        "two run_capture calls entered the warp step concurrently — "
        "semaphore failed to serialise"
    )
    # Two serialised SLEEP_S runs should take at least ~1.8 * SLEEP_S.
    # If they ran fully in parallel we'd see ~1.0 * SLEEP_S. Pick a
    # threshold that's comfortably above the parallel case but below
    # the strict-serial case to absorb scheduler jitter.
    assert elapsed >= 1.6 * SLEEP_S, (
        f"expected serialisation under concurrency=1 to take ~2x "
        f"SLEEP ({2 * SLEEP_S:.2f}s); got {elapsed:.2f}s"
    )


def test_concurrent_run_capture_overlaps_with_two_permits(monkeypatch):
    """With the default concurrency=2, two simultaneous ``run_capture``
    calls run in parallel — wall time should be close to a single run,
    not double it. This is the inverse check: when N permits >= N
    callers, the semaphore must NOT serialise."""
    monkeypatch.setenv("XCS_GEN_CAPTURE_CONCURRENCY", "2")
    cap._reset_capture_semaphore_for_tests()

    fake_img = np.zeros((10, 10, 3), dtype=np.uint8)
    warped = np.zeros((50, 50, 3), dtype=np.uint8)
    corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }

    SLEEP_S = 0.25

    def fake_warp(*_args, **_kwargs):
        time.sleep(SLEEP_S)
        return warped

    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(
        cap, "detect_fiducials_with_recropping",
        lambda _: (42, 0, corners),
    )
    monkeypatch.setattr(cap, "warp_to_burn_space", fake_warp)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 200.0, "x_steps": 4,
        "y_param": None, "rows": 1, "width_mm": 10.0, "height_mm": 10.0,
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }

    def worker():
        cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)

    t0 = time.perf_counter()
    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10.0)
    elapsed = time.perf_counter() - t0

    # With 2 permits and 2 callers, we expect close to 1x SLEEP. Allow
    # generous headroom for the rest of the pipeline + thread startup.
    assert elapsed < 1.6 * SLEEP_S, (
        f"expected parallel execution under concurrency=2 to take ~1x "
        f"SLEEP ({SLEEP_S:.2f}s); got {elapsed:.2f}s — semaphore may "
        f"be over-serialising"
    )


def test_detect_test_id_acquires_semaphore(monkeypatch):
    """``detect_test_id`` also counts against the capture concurrency
    budget — it runs the same decode + fiducial detection pipeline."""
    monkeypatch.setenv("XCS_GEN_CAPTURE_CONCURRENCY", "1")
    cap._reset_capture_semaphore_for_tests()

    fake_img = np.zeros((10, 10, 3), dtype=np.uint8)
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)

    SLEEP_S = 0.2
    active = 0
    active_lock = threading.Lock()
    overlap = threading.Event()

    def fake_detect(_img):
        nonlocal active
        with active_lock:
            active += 1
            if active > 1:
                overlap.set()
        time.sleep(SLEEP_S)
        with active_lock:
            active -= 1
        return (42, 0, {})

    monkeypatch.setattr(cap, "detect_fiducials", fake_detect)

    results: list[tuple[int, int]] = []

    def worker():
        results.append(cap.detect_test_id(b"fake"))

    threads = [threading.Thread(target=worker) for _ in range(2)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10.0)
    elapsed = time.perf_counter() - t0

    assert len(results) == 2
    assert not overlap.is_set(), (
        "two detect_test_id calls ran concurrently — semaphore not held"
    )
    assert elapsed >= 1.6 * SLEEP_S, (
        f"detect_test_id should serialise under concurrency=1; "
        f"got {elapsed:.2f}s for {SLEEP_S:.2f}s sleeps"
    )
