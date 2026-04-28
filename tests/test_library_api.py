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


# ── shape + size ────────────────────────────────────────────────────────


def test_material_create_with_circle_shape(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={
        "name": "SS Tag", "shape": "circle", "diameter_mm": 25.0,
    })
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["shape"] == "circle"
    assert body["diameter_mm"] == 25.0
    assert body["width_mm"] is None
    assert body["height_mm"] is None


def test_material_create_with_rect_shape(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={
        "name": "SS Card", "shape": "rect", "width_mm": 50, "height_mm": 30,
    })
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["shape"] == "rect"
    assert body["width_mm"] == 50
    assert body["height_mm"] == 30
    assert body["diameter_mm"] is None


def test_material_create_circle_without_diameter_rejected(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={"name": "SS", "shape": "circle"})
    assert r.status_code == 422


def test_material_create_rect_without_dimensions_rejected(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={"name": "SS", "shape": "rect"})
    assert r.status_code == 422


def test_material_create_orphan_diameter_without_shape_rejected(fresh_db):
    c = _client()
    r = c.post("/api/materials", json={"name": "SS", "diameter_mm": 50})
    assert r.status_code == 422


def test_material_create_no_shape_persists_nulls(fresh_db):
    """Existing flow — name only — keeps shape/sizes null."""
    c = _client()
    r = c.post("/api/materials", json={"name": "SS"})
    assert r.status_code == 201
    body = r.json()
    assert body["shape"] is None
    assert body["diameter_mm"] is None
    assert body["width_mm"] is None
    assert body["height_mm"] is None


def test_material_patch_adds_shape(fresh_db):
    c = _client()
    mid = c.post("/api/materials", json={"name": "SS"}).json()["id"]
    r = c.patch(f"/api/materials/{mid}", json={
        "shape": "rect", "width_mm": 40, "height_mm": 60,
    })
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["shape"] == "rect"
    assert body["width_mm"] == 40
    assert body["height_mm"] == 60


def test_material_patch_clears_shape(fresh_db):
    """Sending shape=null with all dimensions=null clears the metadata."""
    c = _client()
    mid = c.post("/api/materials", json={
        "name": "SS", "shape": "circle", "diameter_mm": 30,
    }).json()["id"]
    r = c.patch(f"/api/materials/{mid}", json={
        "shape": None, "diameter_mm": None,
    })
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["shape"] is None
    assert body["diameter_mm"] is None


def test_material_patch_omits_shape_keeps_existing(fresh_db):
    """Patching only the name must NOT clear an existing shape."""
    c = _client()
    mid = c.post("/api/materials", json={
        "name": "SS", "shape": "circle", "diameter_mm": 30,
    }).json()["id"]
    r = c.patch(f"/api/materials/{mid}", json={"name": "SS New"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "SS New"
    assert body["shape"] == "circle"
    assert body["diameter_mm"] == 30
