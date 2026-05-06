"""Calibration-ceremony API route tests."""

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


def test_get_calibration_returns_defaults_for_new_material():
    client = TestClient(create_app())
    mid = _create_material(client)
    resp = client.get(f"/api/materials/{mid}/calibration")
    assert resp.status_code == 200
    body = resp.json()
    assert body["wb_supported"] is True
    assert body["clean_pass_params"] is None
    assert body["calibration_patches"] is None


def test_patch_calibration_persists():
    client = TestClient(create_app())
    mid = _create_material(client)
    payload = {
        "clean_pass_params": {
            "power": 30, "speed": 800, "frequency": 60, "density": 1000,
            "passes": 2, "pulse_width": 200, "laser": "red",
        },
        "calibration_patches": [
            {"label": "light",
             "params": {"power": 8, "speed": 1500, "frequency": 30, "density": 800,
                        "passes": 1, "pulse_width": 120, "laser": "red"},
             "canonical_rgb": None},
            {"label": "mid",
             "params": {"power": 18, "speed": 1000, "frequency": 80, "density": 1000,
                        "passes": 1, "pulse_width": 160, "laser": "red"},
             "canonical_rgb": None},
        ],
    }
    resp = client.patch(f"/api/materials/{mid}/calibration", json=payload)
    assert resp.status_code == 200, resp.text
    again = client.get(f"/api/materials/{mid}/calibration").json()
    assert again["clean_pass_params"]["power"] == 30
    assert len(again["calibration_patches"]) == 2
