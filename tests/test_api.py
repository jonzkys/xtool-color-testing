"""Tests for the FastAPI endpoints."""

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


@pytest.fixture
def client():
    return TestClient(create_app())


def test_health_endpoint(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
