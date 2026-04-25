from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def test_health_ok_after_fresh_migration(fresh_db):
    client = TestClient(create_app())
    health = client.get("/api/health").json()
    assert health["status"] == "ok"
    assert health["mode"] == "standalone"
    assert "available_machines" in health
    assert client.get("/api/materials").json() == []
