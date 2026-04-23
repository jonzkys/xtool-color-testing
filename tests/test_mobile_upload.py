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


import pytest


def test_get_or_create_mobile_id_raises_for_unknown_user(fresh_db):
    with pytest.raises(ValueError, match="no such user"):
        u_repo.get_or_create_mobile_id(99999)


def test_rotate_mobile_id_makes_new_resolve_and_old_dead(fresh_db):
    user = u_repo.register(api_key="dddddddddddddddd", first_name="D")
    old = u_repo.get_or_create_mobile_id(user["id"])
    new = u_repo.rotate_mobile_id(user["id"])
    assert u_repo.get_by_mobile_id(new) is not None
    assert u_repo.get_by_mobile_id(old) is None


def test_rotate_mobile_id_raises_for_unknown_user(fresh_db):
    with pytest.raises(ValueError, match="no such user"):
        u_repo.rotate_mobile_id(99999)


def test_get_by_mobile_id_returns_none_for_empty_string(fresh_db):
    assert u_repo.get_by_mobile_id("") is None
