"""Tests for the materials calibration API."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _create_material(client: TestClient) -> int:
    resp = client.post("/api/materials", json={
        "name": "Stainless Test Plate",
        "shape": "rect",
        "width_mm": 80, "height_mm": 60,
    })
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def test_get_calibration_returns_defaults_for_new_material(fresh_db):
    client = TestClient(create_app())
    mid = _create_material(client)
    resp = client.get(f"/api/materials/{mid}/calibration")
    assert resp.status_code == 200
    body = resp.json()
    assert body["wb_supported"] is True
    assert body["clean_pass_params"] is None


def test_patch_calibration_persists(fresh_db):
    client = TestClient(create_app())
    mid = _create_material(client)
    payload = {
        "clean_pass_params": {
            "power": 30, "speed": 800, "frequency": 60, "density": 1000,
            "passes": 2, "pulse_width": 200, "laser": "red",
        },
    }
    resp = client.patch(f"/api/materials/{mid}/calibration", json=payload)
    assert resp.status_code == 200, resp.text
    again = client.get(f"/api/materials/{mid}/calibration").json()
    assert again["clean_pass_params"]["power"] == 30


def test_patch_can_disable_wb_support(fresh_db):
    client = TestClient(create_app())
    mid = _create_material(client)
    resp = client.patch(f"/api/materials/{mid}/calibration", json={"wb_supported": False})
    assert resp.status_code == 200
    assert resp.json()["wb_supported"] is False
