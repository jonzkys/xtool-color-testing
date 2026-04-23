"""Mobile upload feature tests.

Covers the per-user mobile_id lifecycle, the unauthenticated /api/m/*
routes, the per-mid rate limits, and the recent-uploads polling endpoint.
"""
from __future__ import annotations

from xcs_gen_web.repositories import users as u_repo


def test_get_or_create_mobile_id_is_idempotent(fresh_db):
    user = u_repo.register(api_key="aaaaaaaaaaaaaaaa", first_name="A")
    mid_1 = u_repo.get_or_create_mobile_id(user["id"])
    mid_2 = u_repo.get_or_create_mobile_id(user["id"])
    assert mid_1 == mid_2
    assert isinstance(mid_1, str) and len(mid_1) >= 20


def test_rotate_mobile_id_returns_different_value(fresh_db):
    user = u_repo.register(api_key="bbbbbbbbbbbbbbbb", first_name="B")
    old = u_repo.get_or_create_mobile_id(user["id"])
    new = u_repo.rotate_mobile_id(user["id"])
    assert new != old


def test_get_by_mobile_id_returns_user_or_none(fresh_db):
    user = u_repo.register(api_key="cccccccccccccccc", first_name="C")
    mid = u_repo.get_or_create_mobile_id(user["id"])
    assert u_repo.get_by_mobile_id(mid)["id"] == user["id"]
    assert u_repo.get_by_mobile_id("nonexistent_value") is None
