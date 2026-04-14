"""Tests for the FastAPI generate endpoint."""

import json

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


@pytest.fixture
def client():
    return TestClient(create_app())


def _project_payload() -> dict:
    return {
        "name": "Test",
        "grid_gap_mm": 1.0,
        "tests": [
            {
                "test": {
                    "id": "t1",
                    "name": "Speed",
                    "x_param": "speed",
                    "x_min": 500,
                    "x_max": 2000,
                    "x_steps": 10,
                    "rows": 1,
                    "width_mm": 30.0,
                    "height_mm": 5.0,
                    "gap_mm": 0.0,
                    "base_params": {
                        "power": 14.6, "speed": 1000, "frequency": 125,
                        "density": 5000, "passes": 1, "pulse_width": 200,
                        "laser": "red",
                    },
                },
                "row": 0, "col": 0, "col_span": 1,
            }
        ],
    }


def test_generate_returns_xcs_file(client):
    resp = client.post("/api/generate", json=_project_payload())
    assert resp.status_code == 200
    assert "attachment" in resp.headers.get("content-disposition", "")
    # Body is valid JSON (XCS format is JSON)
    data = json.loads(resp.content)
    assert "canvas" in data
    assert "device" in data


def test_generate_filename_from_project_name(client):
    payload = _project_payload()
    payload["name"] = "my_project"
    resp = client.post("/api/generate", json=payload)
    assert "my_project.xcs" in resp.headers.get("content-disposition", "")


def test_generate_rejects_invalid_payload(client):
    payload = _project_payload()
    # Force invalid range
    payload["tests"][0]["test"]["x_min"] = 500
    payload["tests"][0]["test"]["x_max"] = 500
    resp = client.post("/api/generate", json=payload)
    assert resp.status_code == 422  # Pydantic validation error


def test_generate_rejects_overlapping_placements(client):
    payload = _project_payload()
    # Duplicate the same placement at same row/col
    payload["tests"].append(payload["tests"][0].copy())
    resp = client.post("/api/generate", json=payload)
    assert resp.status_code == 400
    assert "overlap" in resp.json()["detail"].lower()


def test_health_endpoint(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
