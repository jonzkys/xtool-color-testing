"""Endpoint tests for /api/text-registration-defaults/*.

Round-trip through the FastAPI test client so we exercise the
schema validation, owner scoping, and the resolver's source-tag.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo


_PARAMS = {
    "speed": 400,
    "power": 14.0,
    "density": 2566,
    "repeat": 1,
    "pulse_width": 80,
    "mopa_frequency": 90,
    "processing_light_source": "red",
}


def _alt(seed: int) -> dict:
    """Distinct param payload so equality checks don't pass by accident."""
    return {**_PARAMS, "speed": 400 + seed * 50, "power": 14.0 + seed}


def _setup(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="Anodised aluminium")["id"]
    return c, mid


def test_resolve_returns_fallback_when_nothing_set(fresh_db):
    c, _mid = _setup(fresh_db)
    r = c.get("/api/text-registration-defaults/resolve?machine_id=F2Ultra")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "fallback"
    # Built-in constants from xcs_gen.generators._DEFAULT_ANNOTATION_PARAMS.
    assert body["speed"] == 400
    assert body["power"] == 14.0


def test_machine_put_get_round_trip(fresh_db):
    c, _mid = _setup(fresh_db)
    r = c.put(
        "/api/text-registration-defaults/machine/F2Ultra",
        json=_alt(1),
    )
    assert r.status_code == 200, r.text
    assert r.json()["speed"] == 450

    r = c.get("/api/text-registration-defaults/machine/F2Ultra")
    assert r.status_code == 200
    assert r.json()["speed"] == 450


def test_machine_default_used_when_no_material_override(fresh_db):
    c, mid = _setup(fresh_db)
    c.put("/api/text-registration-defaults/machine/F2Ultra", json=_alt(2))
    r = c.get(
        f"/api/text-registration-defaults/resolve?machine_id=F2Ultra"
        f"&material_id={mid}",
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "machine"
    assert body["speed"] == 500


def test_material_override_wins(fresh_db):
    c, mid = _setup(fresh_db)
    c.put("/api/text-registration-defaults/machine/F2Ultra", json=_alt(2))
    c.put(
        f"/api/text-registration-defaults/material/{mid}/F2Ultra",
        json=_alt(5),
    )
    r = c.get(
        f"/api/text-registration-defaults/resolve?machine_id=F2Ultra"
        f"&material_id={mid}",
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "material"
    assert body["speed"] == 650


def test_material_list_returns_per_machine_rows(fresh_db):
    c, mid = _setup(fresh_db)
    c.put(
        f"/api/text-registration-defaults/material/{mid}/F2Ultra",
        json=_alt(1),
    )
    c.put(
        f"/api/text-registration-defaults/material/{mid}/F1Ultra",
        json=_alt(3),
    )
    r = c.get(f"/api/text-registration-defaults/material/{mid}")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2
    machines = {row["machine_id"] for row in rows}
    assert machines == {"F2Ultra", "F1Ultra"}


def test_material_list_404_for_unknown_material(fresh_db):
    c, _mid = _setup(fresh_db)
    r = c.get("/api/text-registration-defaults/material/999")
    assert r.status_code == 404


def test_material_put_404_for_unknown_material(fresh_db):
    c, _mid = _setup(fresh_db)
    r = c.put(
        "/api/text-registration-defaults/material/999/F2Ultra",
        json=_PARAMS,
    )
    assert r.status_code == 404


def test_machine_delete(fresh_db):
    c, _mid = _setup(fresh_db)
    c.put("/api/text-registration-defaults/machine/F2Ultra", json=_PARAMS)
    r = c.delete("/api/text-registration-defaults/machine/F2Ultra")
    assert r.status_code == 204
    r = c.get("/api/text-registration-defaults/machine/F2Ultra")
    assert r.status_code == 200
    assert r.json() is None


def test_material_delete(fresh_db):
    c, mid = _setup(fresh_db)
    c.put(
        f"/api/text-registration-defaults/material/{mid}/F2Ultra",
        json=_PARAMS,
    )
    r = c.delete(
        f"/api/text-registration-defaults/material/{mid}/F2Ultra",
    )
    assert r.status_code == 204
    r = c.get(f"/api/text-registration-defaults/material/{mid}")
    assert r.status_code == 200
    assert r.json() == []


def test_invalid_payload_422(fresh_db):
    """Schema rejects power > 100 / negative speeds / etc."""
    c, _mid = _setup(fresh_db)
    bad = {**_PARAMS, "power": 250.0}
    r = c.put("/api/text-registration-defaults/machine/F2Ultra", json=bad)
    assert r.status_code == 422
