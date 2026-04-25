from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _client():
    return TestClient(create_app())


BASE = {"power": 50, "speed": 1000, "frequency": 60,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}


def test_material_crud(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={"name": "Stainless"})
    assert r.status_code == 201
    mid = r.json()["id"]

    r = c.get("/api/materials")
    assert [m["id"] for m in r.json()] == [mid]

    c.patch(f"/api/materials/{mid}", json={"name": "Stainless 304"})
    assert c.get(f"/api/materials/{mid}").json()["name"] == "Stainless 304"

    c.delete(f"/api/materials/{mid}")
    assert c.get(f"/api/materials/{mid}").status_code == 404


def test_preset_default_promotion(fresh_db):
    c = _client()
    mid = c.post("/api/materials", json={"name": "SS"}).json()["id"]
    p1 = c.post("/api/presets", json={"material_id": mid, "name": "P1", "base_params": BASE}).json()
    p2 = c.post("/api/presets", json={"material_id": mid, "name": "P2", "base_params": BASE}).json()
    assert p1["is_default"] is True and p2["is_default"] is False
    c.post(f"/api/presets/{p2['id']}/set-default")
    assert c.get(f"/api/presets/{p1['id']}").json()["is_default"] is False
    assert c.get(f"/api/presets/{p2['id']}").json()["is_default"] is True


def test_material_delete_blocked_when_preset_exists(fresh_db):
    c = _client()
    mid = c.post("/api/materials", json={"name": "SS"}).json()["id"]
    c.post("/api/presets", json={"material_id": mid, "name": "P1", "base_params": BASE})
    r = c.delete(f"/api/materials/{mid}")
    assert r.status_code == 409
