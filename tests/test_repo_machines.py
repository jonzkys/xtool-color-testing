"""Repository changes for machine_id — persistence, filtering, immutability."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import palette as pal_repo
from xcs_gen_web.repositories import presets as p_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


BASE_PARAMS = {
    "power": 50, "speed": 1000, "frequency": 45_000,
    "density": 100, "passes": 1, "pulse_width": 200, "laser": "red",
}
SPEC = {"x_param": "power", "x_min": 10, "x_max": 90, "x_steps": 5,
        "rows": 1, "width_mm": 50, "height_mm": 50, "gap_mm": 1,
        "base_params": BASE_PARAMS}


def test_test_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    assert t["machine_id"] == "F1Ultra"
    assert t_repo.get(t["id"])["machine_id"] == "F1Ultra"


def test_test_machine_id_defaults_to_f2(fresh_db):
    """Backwards-compat: callers that omit machine_id get the default."""
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC)
    assert t["machine_id"] == "F2Ultra"


def test_test_machine_id_immutable(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    with pytest.raises(t_repo.MachineImmutableError):
        t_repo.update(t["id"], machine_id="F2Ultra")


def test_list_tests_filters_by_machine(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    f1 = t_repo.create(name="f1", material_id=mid, spec=SPEC, machine_id="F1Ultra")
    f2 = t_repo.create(name="f2", material_id=mid, spec=SPEC, machine_id="F2Ultra")
    only_f1 = t_repo.list_all(machine_id="F1Ultra")
    only_f2 = t_repo.list_all(machine_id="F2Ultra")
    assert {t["id"] for t in only_f1} == {f1["id"]}
    assert {t["id"] for t in only_f2} == {f2["id"]}


def test_preset_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p = p_repo.create(material_id=mid, name="default", color=None,
                      base_params=BASE_PARAMS, machine_id="F1Ultra")
    assert p["machine_id"] == "F1Ultra"
    assert p_repo.get(p["id"])["machine_id"] == "F1Ultra"


def test_preset_machine_id_immutable(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    p = p_repo.create(material_id=mid, name="d", color=None,
                      base_params=BASE_PARAMS, machine_id="F1Ultra")
    with pytest.raises(p_repo.MachineImmutableError):
        p_repo.update(p["id"], machine_id="F2Ultra")


def test_palette_persists_machine_id(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    entry = {
        "test_id": None, "material_id": mid,
        "hex": "#aa00bb", "params": {}, "sigma": 0.0, "source": "manual",
        "machine_id": "F1Ultra",
    }
    [pid] = pal_repo.insert_bulk([entry])
    rows = pal_repo.list_all(machine_id="F1Ultra")
    assert any(r["id"] == pid for r in rows)
    assert all(r["machine_id"] == "F1Ultra" for r in rows)


def test_palette_machine_must_match_test(fresh_db):
    mid = m_repo.create(name="Stainless")["id"]
    t = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F2Ultra")
    bad = {
        "test_id": t["id"], "material_id": mid,
        "hex": "#ff0000", "params": {}, "sigma": 0.0, "source": "averaged",
        "machine_id": "F1Ultra",     # mismatch
    }
    with pytest.raises(pal_repo.MachineMismatchError):
        pal_repo.insert_bulk([bad])


def test_legacy_off_list_density_passes_through_repo(fresh_db):
    """Existing rows with off-list density values still load — validation
    only runs at the API boundary, not on read."""
    mid = m_repo.create(name="Stainless")["id"]
    spec = {**SPEC, "base_params": {**BASE_PARAMS, "density": 150}}
    t = t_repo.create(name="legacy", material_id=mid, spec=spec, machine_id="F2Ultra")
    assert t["spec"]["base_params"]["density"] == 150


def test_palette_ingest_inherits_test_machine(fresh_db, monkeypatch, tmp_path):
    """Swatches ingested into the palette inherit the test's machine_id."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))

    def _fake_cap(*, image_bytes, test_id, spec):
        return cap.CaptureResult(
            swatches=[
                {"row": 0, "col": 0, "x_value": 10, "y_value": None,
                 "hex": "#ff0000", "lab": [50.0, 60.0, 40.0], "sigma": 0.5},
            ],
            warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
        )

    monkeypatch.setattr(cap, "run_capture", _fake_cap)
    client = TestClient(create_app())

    mid = m_repo.create(name="Stainless")["id"]
    tid = t_repo.create(name="t", material_id=mid, spec=SPEC, machine_id="F1Ultra")["id"]

    # Upload a result so there's a swatch to ingest.
    rid = client.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    ).json()["id"]

    # Ingest via the API handler.
    resp = client.post(
        f"/api/tests/{tid}/ingest-to-palette",
        json={"swatch_indices": [0], "mode": "single_result", "result_id": rid},
    )
    assert resp.status_code == 200

    # The resulting palette entry must carry F1Ultra, not the default F2Ultra.
    entries = pal_repo.list_all(machine_id="F1Ultra")
    assert any(e["test_id"] == tid for e in entries), (
        "Expected a palette entry for the F1Ultra test after ingest"
    )
    f1_entry = next(e for e in entries if e["test_id"] == tid)
    assert f1_entry["machine_id"] == "F1Ultra"
