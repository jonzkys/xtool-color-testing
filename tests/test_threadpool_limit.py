"""Tests for the anyio threadpool sizing applied at app startup.

Starlette runs every ``def`` route handler in the anyio default
threadpool. The library default is 40 threads, which is far too many
for the CPU-heavy capture pipeline on a 2-vCPU box. ``create_app``
caps the pool at 4 (override via ``XCS_GEN_THREADPOOL_SIZE``) inside
its lifespan handler, so the bound is in place before the first
request is served.

The ``current_default_thread_limiter()`` API is event-loop-local, so
these tests exercise it inside an ``anyio.run`` block.
"""

from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import _configure_threadpool, create_app


def _resolve_limit_under_loop() -> int:
    """Call ``_configure_threadpool`` inside an event loop and return
    the resulting ``total_tokens`` value. Mirrors how the lifespan
    handler runs: ``_configure_threadpool`` is invoked from within an
    async context, so the limiter binds to that loop's pool."""

    async def _probe() -> int:
        limit = _configure_threadpool()
        # Confirm the limit was actually applied to the live loop's
        # limiter (not just returned by the helper).
        assert (
            anyio.to_thread.current_default_thread_limiter().total_tokens
            == limit
        )
        return limit

    return anyio.run(_probe)


def test_default_threadpool_size_is_four(monkeypatch):
    """Without the env var set the helper caps the pool at 4."""
    monkeypatch.delenv("XCS_GEN_THREADPOOL_SIZE", raising=False)
    assert _resolve_limit_under_loop() == 4


def test_env_override_resizes_threadpool(monkeypatch):
    """``XCS_GEN_THREADPOOL_SIZE=8`` raises the cap to 8 threads."""
    monkeypatch.setenv("XCS_GEN_THREADPOOL_SIZE", "8")
    assert _resolve_limit_under_loop() == 8


def test_invalid_threadpool_size_clamped_to_one(monkeypatch):
    """A zero or negative override is clamped to a minimum of 1 so the
    pool never gets stuck at zero permits (which would deadlock every
    ``def`` route running in the threadpool)."""
    monkeypatch.setenv("XCS_GEN_THREADPOOL_SIZE", "0")
    assert _resolve_limit_under_loop() == 1


def test_lifespan_applies_threadpool_bound(fresh_db, monkeypatch):
    """End-to-end check: ``TestClient`` triggers the FastAPI lifespan,
    which calls ``_configure_threadpool``. The resolved limit is
    stashed on ``app.state.threadpool_limit`` so the test can verify
    it without re-entering the lifespan's event loop."""
    monkeypatch.setenv("XCS_GEN_THREADPOOL_SIZE", "6")
    app = create_app()
    with TestClient(app) as client:
        client.get("/api/health")
        assert app.state.threadpool_limit == 6
