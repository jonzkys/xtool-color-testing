"""Pin the Sentry ``before_send`` filter behaviour.

The hook scrubs sensitive headers + request bodies and drops events
from silenced paths (``/api/health`` etc.). Without this filter
running, a future API key or upload payload could leak into the
Sentry UI, and routine load-balancer polls would clog the issue
queue.
"""

from __future__ import annotations

from xcs_gen_web.sentry import _before_send


def test_before_send_drops_health_path():
    event = {"request": {"url": "https://api.example.com/api/health"}}
    assert _before_send(event, {}) is None


def test_before_send_drops_health_path_with_query():
    event = {"request": {"url": "https://api.example.com/api/health?ts=1"}}
    assert _before_send(event, {}) is None


def test_before_send_passes_normal_paths():
    event = {"request": {"url": "https://api.example.com/api/svg-layers"}}
    out = _before_send(event, {})
    assert out is event


def test_before_send_strips_request_body():
    event = {
        "request": {
            "url": "https://api.example.com/api/svg-layers",
            "data": "<huge svg payload>",
        },
    }
    out = _before_send(event, {})
    assert out is not None
    assert out["request"]["data"] == "<stripped>"


def test_before_send_strips_secret_headers():
    event = {
        "request": {
            "url": "https://api.example.com/api/me",
            "headers": {
                "Authorization": "Bearer secret",
                "Cookie": "session=abcdef",
                "X-User-Id": "fsp9KYfD7zRUL507",
                "User-Agent": "test/1.0",
            },
        },
    }
    out = _before_send(event, {})
    assert out is not None
    h = out["request"]["headers"]
    assert h["Authorization"] == "<stripped>"
    assert h["Cookie"] == "<stripped>"
    assert h["X-User-Id"] == "<stripped>"
    # Non-secret headers pass through.
    assert h["User-Agent"] == "test/1.0"
