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


def test_generate_returns_xcs_bytes(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/generate")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.content.startswith(b"{") or b"canvasId" in r.content
    assert "filename=" in r.headers.get("content-disposition", "")


def test_generate_404_for_missing_test(fresh_db):
    c = TestClient(create_app())
    r = c.post("/api/tests/99999/generate")
    assert r.status_code == 404


def test_generate_handles_unsafe_test_name(fresh_db):
    """Name with characters outside the Project.name pattern must not 500."""
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name='"evil\\name"!', material_id=mid, spec=SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/generate")
    assert r.status_code == 200
    cd = r.headers.get("content-disposition", "")
    # No unescaped quotes or backslashes in the header value
    assert '"' not in cd.replace('filename="', "").replace('.xcs"', "")
    assert "\\" not in cd
