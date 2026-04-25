"""Tests for palette CRUD + query HTTP endpoints."""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo


@pytest.fixture
def client(fresh_db):
    return TestClient(create_app())


@pytest.fixture
def mid(fresh_db):
    """A material id valid for the fresh_db."""
    return m_repo.create(name="Stainless")["id"]


def _seed_entries(mid: int, test_id: int = 1) -> list[int]:
    return pal_repo.insert_bulk([
        dict(test_id=test_id, material_id=mid, x_value=500, y_value=10,
             hex="#ff0000", sigma=1.2, source="averaged", source_result_id=None,
             params={"power": 10, "speed": 500}),
        dict(test_id=test_id, material_id=mid, x_value=1000, y_value=10,
             hex="#cc0000", sigma=0.8, source="averaged", source_result_id=None,
             params={"power": 10, "speed": 1000}),
    ])


def test_list_empty(client, fresh_db):
    resp = client.get("/api/palette")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_returns_entries(client, mid):
    _seed_entries(mid)
    entries = client.get("/api/palette").json()
    assert len(entries) == 2
    assert all(e["material_id"] == mid for e in entries)


def test_query_returns_nearest(client, mid):
    _seed_entries(mid)
    resp = client.get("/api/palette/query", params={"hex": "#ff0100", "limit": 2})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 2
    assert results[0]["entry"]["hex"] in ("#ff0000", "#cc0000")
    assert results[0]["delta_e"] <= results[1]["delta_e"]


def test_delete_by_id(client, mid):
    ids = _seed_entries(mid)
    first_id = ids[0]
    resp = client.delete(f"/api/palette/{first_id}")
    assert resp.status_code == 204
    remaining = client.get("/api/palette").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] != first_id


def test_delete_by_id_404_when_missing(client, fresh_db):
    resp = client.delete("/api/palette/99999")
    assert resp.status_code == 404


def test_delete_by_test(client, mid):
    _seed_entries(mid, test_id=42)
    resp = client.delete("/api/palette/by-test/42")
    assert resp.status_code == 204
    assert client.get("/api/palette").json() == []


def test_delete_by_test_missing_is_noop(client, fresh_db):
    """Deleting a non-existent test_id should succeed (idempotent)."""
    resp = client.delete("/api/palette/by-test/99999")
    assert resp.status_code == 204


def test_patch_notes(client, mid):
    ids = _seed_entries(mid)
    entry_id = ids[0]
    resp = client.patch(f"/api/palette/{entry_id}", json={"notes": "favourite teal"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "favourite teal"
    # And the persisted copy also has it
    persisted = next(e for e in client.get("/api/palette").json() if e["id"] == entry_id)
    assert persisted["notes"] == "favourite teal"


def test_patch_404_when_missing(client, fresh_db):
    resp = client.patch("/api/palette/99999", json={"notes": "x"})
    assert resp.status_code == 404


def test_list_filters_by_material_id(client, fresh_db):
    m1 = m_repo.create(name="Stainless")["id"]
    m2 = m_repo.create(name="Brass")["id"]
    pal_repo.insert_bulk([dict(test_id=1, material_id=m1, x_value=0, y_value=None,
                               hex="#ff0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    pal_repo.insert_bulk([dict(test_id=2, material_id=m2, x_value=0, y_value=None,
                               hex="#cc0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    # No filter: 2 entries
    all_ = client.get("/api/palette").json()
    assert len(all_) == 2
    # With filter: 1 entry from stainless only
    stainless = client.get("/api/palette", params={"material_id": m1}).json()
    assert len(stainless) == 1
    assert stainless[0]["material_id"] == m1


def test_query_filters_by_material_id(client, fresh_db):
    m1 = m_repo.create(name="Stainless")["id"]
    m2 = m_repo.create(name="Brass")["id"]
    pal_repo.insert_bulk([dict(test_id=1, material_id=m1, x_value=0, y_value=None,
                               hex="#ff0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    pal_repo.insert_bulk([dict(test_id=1, material_id=m2, x_value=0, y_value=None,
                               hex="#ef0000", sigma=1.0, source="averaged",
                               source_result_id=None, params={})])
    results = client.get(
        "/api/palette/query",
        params={"hex": "#ff0000", "limit": 5, "material_id": m2},
    ).json()
    assert len(results) == 1
    assert results[0]["entry"]["material_id"] == m2


def test_create_manual_success(client, mid):
    body = {
        "material_id": mid,
        "hex": "#abcdef",
        "params": {"power": 50, "speed": 1000, "laser": "red"},
        "notes": "first manual",
    }
    resp = client.post("/api/palette/manual", json=body)
    assert resp.status_code == 201
    e = resp.json()
    assert e["source"] == "manual"
    assert e["test_id"] is None
    assert e["favorited"] is False
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", e["hex"])


def test_create_manual_invalid_hex(client, mid):
    resp = client.post("/api/palette/manual", json={
        "material_id": mid, "hex": "blue", "params": {}, "notes": "",
    })
    assert resp.status_code == 422


def test_create_manual_missing_material(client, fresh_db):
    resp = client.post("/api/palette/manual", json={
        "hex": "#abcdef", "params": {}, "notes": "",
    })
    assert resp.status_code == 422
