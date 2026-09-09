"""Smoke-tests for the validation-cells API surface.

Exercises kind=validation on POST /api/tests + the
PATCH /api/tests/{id}/validation-cells endpoint.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo


BASE = {"power": 50, "speed": 1000, "frequency": 60,
        "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"}

SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 4,
    "rows": 1, "width_mm": 50, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False, "base_params": BASE,
    "registration": {"mode": "on"},
}


def _client_and_material(fresh_db):
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    return c, mid


def _cells(n: int) -> list[dict]:
    return [
        {
            "cell_index": i,
            "palette_entry_id": None,
            "expected_hex": f"#{(i * 0x111111) & 0xFFFFFF:06x}",
            "expected_lab": [50.0 + i, 1.0 * i, -1.0 * i],
            "params": {"speed": 1000 + 100 * i, "power": 50},
        }
        for i in range(n)
    ]


def test_create_test_with_kind_validation(fresh_db):
    """POST /api/tests with kind=validation persists the kind."""
    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "V1", "material_id": mid, "spec": SPEC,
        "kind": "validation",
    })
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["kind"] == "validation"
    assert body["validation_cells"] == []


def test_create_test_default_kind_is_sweep(fresh_db):
    """Existing callers that omit kind keep the legacy sweep behaviour."""
    c, mid = _client_and_material(fresh_db)
    r = c.post("/api/tests", json={
        "name": "S1", "material_id": mid, "spec": SPEC,
    })
    assert r.status_code == 201
    assert r.json()["kind"] == "sweep"


def test_patch_validation_cells_round_trip(fresh_db):
    """PATCH cells, GET test, confirm they round-trip; PATCH again to clear."""
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={
        "name": "V", "material_id": mid, "spec": SPEC, "kind": "validation",
    }).json()["id"]

    # Initial PATCH with two cells.
    r = c.patch(f"/api/tests/{tid}/validation-cells", json={
        "cells": _cells(2),
    })
    assert r.status_code == 200, r.json()
    assert r.json() == {"ok": True, "count": 2}

    got = c.get(f"/api/tests/{tid}").json()
    assert got["kind"] == "validation"
    assert len(got["validation_cells"]) == 2
    cells = sorted(got["validation_cells"], key=lambda c_: c_["cell_index"])
    assert cells[0]["cell_index"] == 0
    assert cells[0]["expected_hex"] == "#000000"
    assert cells[0]["expected_lab"] == [50.0, 0.0, 0.0]
    assert cells[0]["params"] == {"speed": 1000, "power": 50}
    assert cells[1]["cell_index"] == 1
    assert cells[1]["expected_hex"] == "#111111"

    # PATCH again with zero cells — wipes the list.
    r = c.patch(f"/api/tests/{tid}/validation-cells", json={"cells": []})
    assert r.status_code == 200
    assert r.json()["count"] == 0
    assert c.get(f"/api/tests/{tid}").json()["validation_cells"] == []


def test_patch_validation_cells_rejects_sweep_test(fresh_db):
    """PATCH on a kind=sweep test → 409."""
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={
        "name": "S", "material_id": mid, "spec": SPEC,  # default kind=sweep
    }).json()["id"]

    r = c.patch(f"/api/tests/{tid}/validation-cells", json={
        "cells": _cells(1),
    })
    assert r.status_code == 409
    assert "validation" in r.json()["detail"]


def test_patch_validation_cells_rejects_locked_test(fresh_db):
    """Once a result has been ingested, the cell list is frozen too."""
    c, mid = _client_and_material(fresh_db)
    tid = c.post("/api/tests", json={
        "name": "VL", "material_id": mid, "spec": SPEC, "kind": "validation",
    }).json()["id"]
    t_repo.mark_tested_and_lock(tid)

    r = c.patch(f"/api/tests/{tid}/validation-cells", json={
        "cells": _cells(1),
    })
    assert r.status_code == 409
    assert "locked" in r.json()["detail"]


def test_patch_validation_cells_404_on_missing(fresh_db):
    c, _ = _client_and_material(fresh_db)
    r = c.patch("/api/tests/99999/validation-cells", json={"cells": []})
    assert r.status_code == 404


def test_validate_batch_records_the_full_burn_recipe(fresh_db):
    """A palette entry created by validating must carry the WHOLE recipe.

    ``converter.py`` burns a validation cell as
    ``_to_processing_params(test.base_params)`` with the cell's own params
    overlaid on top. The palette entry has to record that same merge —
    otherwise it remembers only the axes the test happened to vary and
    silently forgets everything the test held constant.

    This path used to store the cell's params verbatim, which produced 100
    real entries carrying nothing but ``speed`` and ``frequency``. Auto-match
    then applied them to an SVG layer, every absent field became NaN ->
    ``null`` over JSON, and Generate came back a wall of 422s (see #175).
    """
    from xcs_gen_web.repositories import palette as pal_repo
    from xcs_gen_web.repositories import results as r_repo

    client, mid = _client_and_material(fresh_db)
    tid = t_repo.create(
        name="v", material_id=mid, spec=SPEC, kind="validation",
    )["id"]

    # One cell that varies ONLY speed — power/density/passes/pulse_width are
    # constants held by the test, exactly like the real failing data.
    client.patch(
        f"/api/tests/{tid}/validation-cells",
        json={"cells": [{
            "cell_index": 0,
            "palette_entry_id": None,
            "expected_hex": "#404040",
            "expected_lab": [40.0, 0.0, 0.0],
            "params": {"speed": 1234},
        }]},
    )

    # Two runs agreeing tightly, so the cell buckets as stable and persists.
    for run in range(2):
        r_repo.create(
            test_id=tid,
            image_path=f"/dev/null/{run}",
            image_sha256=("v" * 63) + str(run),
            swatches=[{
                "row": 0, "col": 0, "x_value": 0, "y_value": None,
                "hex": "#404040", "lab": [40.0 + run * 0.1, 0.0, 0.0],
                "sigma": 0.5,
            }],
        )

    resp = client.post(f"/api/tests/{tid}/validate", json={"dry_run": False})
    assert resp.status_code == 200, resp.text
    persisted = [e for e in resp.json()["stable"] if e.get("new_entry_id")]
    assert persisted, f"expected a persisted entry, got {resp.json()}"

    entry = pal_repo.get_by_id(persisted[0]["new_entry_id"])
    params = entry["params"]

    # The cell's own value wins...
    assert params["speed"] == 1234
    # ...and every constant the test held is still present.
    for key in ("power", "frequency", "density", "passes", "pulse_width", "laser"):
        assert params.get(key) is not None, (
            f"{key} missing from the palette entry: {params}"
        )
    assert params["power"] == BASE["power"]
    assert params["pulse_width"] == BASE["pulse_width"]
