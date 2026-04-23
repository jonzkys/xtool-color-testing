"""Tests for the security helpers (rate limiters, log truncation)."""
from __future__ import annotations

import asyncio

from xcs_gen_web.security import MobileUploadRateLimiter, truncate_mid


def _run(coro):
    return asyncio.run(coro)


def test_mobile_rate_limiter_allows_under_hour_cap():
    lim = MobileUploadRateLimiter(per_hour=3, per_day=10)
    for _ in range(3):
        assert _run(lim.check("mid_x")) is None
    # 4th hit in the hour returns a retry-after.
    retry = _run(lim.check("mid_x"))
    assert retry is not None and retry > 0


def test_mobile_rate_limiter_separates_buckets_by_mid():
    lim = MobileUploadRateLimiter(per_hour=2, per_day=10)
    _run(lim.check("a"))
    _run(lim.check("a"))
    # "a" is now full this hour; "b" is unaffected.
    assert _run(lim.check("a")) is not None
    assert _run(lim.check("b")) is None


def test_mobile_rate_limiter_day_cap_independent_from_hour():
    lim = MobileUploadRateLimiter(per_hour=999, per_day=2)
    _run(lim.check("a"))
    _run(lim.check("a"))
    # 3rd hit hits the day cap even though hour is fine.
    assert _run(lim.check("a")) is not None


def test_truncate_mid_keeps_only_last_4_chars():
    assert truncate_mid("abcd1234") == "***1234"
    assert truncate_mid("xy") == "***xy"
    assert truncate_mid("") == "***"
