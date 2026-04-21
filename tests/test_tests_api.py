from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


BASE = {"power": 50, "speed": 1000, "frequency": 60000,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}

SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 10,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _client_and_material(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    return c, mid


def test_create_and_get(fresh_db):
    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "T1", "material_id": mid, "spec": SPEC, "notes": "",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "created" and body["locked"] is False
    tid = body["id"]
    assert c.get(f"/api/tests/{tid}").json()["name"] == "T1"


def test_list_filters(fresh_db):
    c, mid = _client_and_material(fresh_db)
    c.post("/api/tests", json={"name": "A", "material_id": mid, "spec": SPEC})
    c.post("/api/tests", json={"name": "B", "material_id": mid, "spec": SPEC})
    rows = c.get("/api/tests").json()
    assert {r["name"] for r in rows} == {"A", "B"}


def test_patch_spec_blocked_when_locked(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    r = c.patch(f"/api/tests/{tid}", json={"spec": {**SPEC, "x_steps": 20}})
    assert r.status_code == 409


def test_patch_name_notes_allowed_when_locked(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    t_repo.mark_tested_and_lock(tid)
    r = c.patch(f"/api/tests/{tid}", json={"name": "renamed"})
    assert r.status_code == 200 and r.json()["name"] == "renamed"


def test_soft_delete_removes_from_default_list(fresh_db):
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={"name": "T", "material_id": mid, "spec": SPEC}).json()["id"]
    c.delete(f"/api/tests/{tid}")
    assert c.get("/api/tests").json() == []
    assert c.get(f"/api/tests/{tid}").json()["status"] == "deleted"
