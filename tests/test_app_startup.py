from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def test_health_ok_after_fresh_migration(fresh_db):
    client = TestClient(create_app())
    assert client.get("/api/health").json() == {"status": "ok", "mode": "standalone"}
    assert client.get("/api/materials").json() == []
