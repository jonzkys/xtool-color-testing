"""GET /api/machines — full registry payload + /api/health enrichment."""

from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app


def _client(fresh_db) -> TestClient:
    return TestClient(create_app())


def test_health_returns_available_machines(fresh_db):
    r = _client(fresh_db).get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert "available_machines" in body
    assert {"F2Ultra", "F1Ultra"} <= set(body["available_machines"])


def test_machines_endpoint_shape(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    assert r.status_code == 200
    body = r.json()
    assert "machines" in body and "profiles" in body
    ids = {m["id"] for m in body["machines"]}
    assert {"F1Ultra", "F2Ultra"} <= ids
    assert "STANDARD" in body["profiles"]
    assert "COLOR_ENGRAVE" in body["profiles"]


def test_machines_endpoint_includes_image_url(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    f1 = next(m for m in body["machines"] if m["id"] == "F1Ultra")
    assert f1["image"].startswith("/static/machines/")
    assert f1["image"].endswith(".png")


def test_machines_endpoint_lasers_have_spot_dimensions(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    f2 = next(m for m in body["machines"] if m["id"] == "F2Ultra")
    fiber = next(l for l in f2["lasers"] if l["kind"] == "fiber")
    assert fiber["wattage"] == 60
    assert fiber["spot_mm"] == [0.03, 0.03]


def test_machines_endpoint_modes_carry_profile(fresh_db):
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    f2 = next(m for m in body["machines"] if m["id"] == "F2Ultra")
    color = next(m for m in f2["modes"] if m["id"] == "color_engrave")
    assert color["profile"] == "COLOR_ENGRAVE"


def test_profiles_payload_matches_registry(fresh_db):
    """Spot-check the profile payload survives JSON round-trip."""
    r = _client(fresh_db).get("/api/machines")
    body = r.json()
    standard = body["profiles"]["STANDARD"]
    assert standard["pulse_width"]["kind"] == "not_applicable"
    assert standard["density"]["kind"] == "stepped"
    assert 200 in standard["density"]["values"]
    assert standard["frequency"] == {"kind": "range", "min": 30, "max": 60}
