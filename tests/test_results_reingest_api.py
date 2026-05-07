"""Reingest endpoint tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def test_reingest_route_returns_404_for_missing_result(fresh_db):
    client = TestClient(create_app())
    resp = client.post("/api/results/9999/reingest")
    assert resp.status_code == 404
