"""Tests for palette CRUD + query HTTP endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("XCS_GEN_PALETTE_PATH", str(tmp_path / "palette.json"))
    return TestClient(create_app())


def _ingest_payload() -> dict:
    return {
        "test_id": "t1",
        "x_param": "speed",
        "y_param": "power",
        "base_params": {
            "power": 50, "speed": 1000, "frequency": 60,
            "density": 200, "passes": 1, "pulse_width": 200, "laser": "red",
        },
        "swatches": [
            {"row": 0, "col": 0, "x_value": 500, "y_value": 10,
             "hex": "#ff0000", "sigma": 1.2},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": 10,
             "hex": "#cc0000", "sigma": 0.8},
        ],
    }


def test_list_empty(client):
    resp = client.get("/api/palette")
    assert resp.status_code == 200
    assert resp.json() == []


def test_ingest_returns_ids_and_persists(client):
    resp = client.post("/api/palette/ingest", json=_ingest_payload())
    assert resp.status_code == 200
    ids = resp.json()["added_ids"]
    assert len(ids) == 2

    entries = client.get("/api/palette").json()
    assert len(entries) == 2
    # Swept x_value should have replaced the base speed on each entry
    speeds = {e["params"]["speed"] for e in entries}
    assert speeds == {500, 1000}
    # y_value should overwrite base power
    powers = {e["params"]["power"] for e in entries}
    assert powers == {10}


def test_query_returns_nearest(client):
    client.post("/api/palette/ingest", json=_ingest_payload())
    resp = client.get("/api/palette/query", params={"hex": "#ff0100", "limit": 2})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 2
    assert results[0]["entry"]["hex"] in ("#ff0000", "#cc0000")
    assert results[0]["delta_e"] <= results[1]["delta_e"]


def test_delete_by_id(client):
    client.post("/api/palette/ingest", json=_ingest_payload())
    entries = client.get("/api/palette").json()
    first_id = entries[0]["id"]
    resp = client.delete(f"/api/palette/{first_id}")
    assert resp.status_code == 204
    remaining = client.get("/api/palette").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] != first_id


def test_delete_by_id_404_when_missing(client):
    resp = client.delete("/api/palette/nonexistent-id")
    assert resp.status_code == 404


def test_delete_by_test(client):
    client.post("/api/palette/ingest", json=_ingest_payload())
    resp = client.delete("/api/palette/by-test/t1")
    assert resp.status_code == 204
    assert client.get("/api/palette").json() == []


def test_delete_by_test_missing_is_noop(client):
    """Deleting a non-existent test_id should succeed (idempotent)."""
    resp = client.delete("/api/palette/by-test/nonexistent")
    assert resp.status_code == 204


def test_patch_notes(client):
    client.post("/api/palette/ingest", json=_ingest_payload())
    entry_id = client.get("/api/palette").json()[0]["id"]
    resp = client.patch(f"/api/palette/{entry_id}", json={"notes": "favourite teal"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "favourite teal"
    # And the persisted copy also has it
    persisted = next(e for e in client.get("/api/palette").json() if e["id"] == entry_id)
    assert persisted["notes"] == "favourite teal"


def test_patch_404_when_missing(client):
    resp = client.patch("/api/palette/nonexistent-id", json={"notes": "x"})
    assert resp.status_code == 404
