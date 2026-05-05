"""Sweep-ingest service + route coverage.

Sister to ``tests/test_palette_api.py``'s "Batch validate" block —
exercises ``services/ingest.compute_ingest_buckets`` directly for
bucket math, then walks the full ``POST /api/tests/{tid}/ingest``
endpoint for the sweep-only persist semantics.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import results as r_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import ingest as ingest_service


_SWEEP_SPEC = {
    "x_param": "speed", "x_min": 100, "x_max": 1000, "x_steps": 2,
    "rows": 1, "width_mm": 20, "height_mm": 8, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": False, "angle_mode": "fixed",
    "unidirectional": False, "cells_per_row": 2,
    "base_params": {
        "power": 50, "speed": 500, "frequency": 60,
        "density": 200, "passes": 1, "pulse_width": 200,
        "laser": "red",
    },
    "registration": {"mode": "on"},
}


@pytest.fixture
def client(fresh_db):
    return TestClient(create_app())


@pytest.fixture
def mid(fresh_db):
    return m_repo.create(name="Stainless")["id"]


def _seed_sweep_with_results(
    mid: int,
    *,
    measured_labs_per_cell: list[list[list[float]]],
    spec: dict | None = None,
) -> int:
    """Create a sweep test with ``measured_labs_per_cell[cell_index]``
    contributing one swatch per result (i.e. ``len(...[0])`` results,
    each carrying every cell). The swatches' ``x_value`` walks 100,
    1000 across the two cells so per-cell params come out distinct.
    """
    spec = spec or _SWEEP_SPEC
    tid = t_repo.create(
        name="S", material_id=mid, spec=spec, kind="sweep",
    )["id"]
    n_cells = len(measured_labs_per_cell)
    n_results = len(measured_labs_per_cell[0]) if n_cells > 0 else 0
    for run_i in range(n_results):
        swatches = []
        for cell_i in range(n_cells):
            lab = measured_labs_per_cell[cell_i][run_i]
            swatches.append({
                "row": 0, "col": cell_i,
                "x_value": 100 + cell_i * 900,
                "y_value": None,
                "hex": "#888888",
                "lab": lab,
                "sigma": 0.5,
            })
        r_repo.create(
            test_id=tid,
            image_path=f"/dev/null/{run_i}",
            image_sha256=("x" * 63) + str(run_i),
            swatches=swatches,
        )
    return tid


# ───── Service: compute_ingest_buckets ─────────────────────────────────


def test_service_buckets_stable_when_runs_cluster_tight():
    """Two runs that agree to within the gate land in ``stable`` with
    a tiny stability_de."""
    swatches_per_result = [
        [{"row": 0, "col": 0, "x_value": 0, "y_value": None,
          "lab": [40.0, 5.0, -10.0]}],
        [{"row": 0, "col": 0, "x_value": 0, "y_value": None,
          "lab": [40.5, 5.0, -10.0]}],
    ]
    out = ingest_service.compute_ingest_buckets(
        swatches_per_result=swatches_per_result,
        spec={"cells_per_row": 1, "rows": 1, "x_steps": 1},
        max_sigma_de=3.0,
    )
    assert len(out["stable"]) == 1
    assert len(out["unstable"]) == 0
    cell = out["stable"][0]
    assert cell["cell_index"] == 0
    assert cell["row"] == 0 and cell["col"] == 0
    assert cell["run_count"] == 2
    assert cell["n_inputs"] == 2
    # Burn-mean ≈ (40.25, 5, -10); each kept run is ~0.25 from it.
    assert cell["stability_de"] < 1.0


def test_service_buckets_unstable_when_runs_drift():
    """Two runs separated by 20 ΔE land in ``unstable`` regardless of
    the tight individual cluster within each run."""
    swatches_per_result = [
        [{"row": 0, "col": 0, "x_value": 0, "y_value": None,
          "lab": [40.0, 5.0, -10.0]}],
        [{"row": 0, "col": 0, "x_value": 0, "y_value": None,
          "lab": [60.0, 5.0, -10.0]}],
    ]
    out = ingest_service.compute_ingest_buckets(
        swatches_per_result=swatches_per_result,
        spec={"cells_per_row": 1, "rows": 1, "x_steps": 1},
        max_sigma_de=3.0,
    )
    assert len(out["stable"]) == 0
    assert len(out["unstable"]) == 1
    cell = out["unstable"][0]
    assert cell["stability_de"] >= 3.0


def test_service_skips_single_run_cells():
    """A cell measured in only one result can't produce a σ value;
    skip it as ``insufficient_runs``."""
    swatches_per_result = [
        [{"row": 0, "col": 0, "x_value": 0, "y_value": None,
          "lab": [40.0, 5.0, -10.0]}],
    ]
    out = ingest_service.compute_ingest_buckets(
        swatches_per_result=swatches_per_result,
        spec={"cells_per_row": 1, "rows": 1, "x_steps": 1},
        max_sigma_de=3.0,
    )
    assert out["stable"] == []
    assert out["unstable"] == []
    assert len(out["skipped"]) == 1
    skipped = out["skipped"][0]
    assert skipped["reason"] == "insufficient_runs"
    assert skipped["run_count"] == 1


def test_service_only_enumerates_measured_cells():
    """Spec says rows=1, x_steps=4 → 4 cells, but the swatches only
    visit (0,0) and (0,2). Only those two should appear in any
    bucket; (0,1) and (0,3) are absent — we don't synthesise empty
    cells just to mark them ``no_measurements``."""
    swatches_per_result = [
        [{"row": 0, "col": 0, "x_value": 1, "y_value": None,
          "lab": [40.0, 5.0, -10.0]},
         {"row": 0, "col": 2, "x_value": 3, "y_value": None,
          "lab": [50.0, -2.0, 8.0]}],
        [{"row": 0, "col": 0, "x_value": 1, "y_value": None,
          "lab": [40.5, 5.0, -10.0]},
         {"row": 0, "col": 2, "x_value": 3, "y_value": None,
          "lab": [50.5, -2.0, 8.0]}],
    ]
    out = ingest_service.compute_ingest_buckets(
        swatches_per_result=swatches_per_result,
        spec={"cells_per_row": 4, "rows": 1, "x_steps": 4},
        max_sigma_de=3.0,
    )
    indices = sorted(c["cell_index"] for c in out["stable"])
    assert indices == [0, 2]
    assert out["unstable"] == []
    assert out["skipped"] == []


# ───── Route: POST /api/tests/{tid}/ingest ─────────────────────────────


def test_ingest_404_when_test_missing(client, fresh_db):
    r = client.post("/api/tests/99999/ingest", json={"max_sigma_de": 3})
    assert r.status_code == 404


def test_ingest_400_when_test_is_not_sweep_kind(client, mid):
    """Validation tests have authored expected colours and a
    different ingest path; the route must refuse them."""
    val_spec = {
        **_SWEEP_SPEC, "cells_per_row": 1, "x_steps": 1,
    }
    tid = t_repo.create(
        name="V", material_id=mid, spec=val_spec, kind="validation",
    )["id"]
    r = client.post(f"/api/tests/{tid}/ingest", json={"max_sigma_de": 3})
    assert r.status_code == 400
    assert "sweep" in r.json()["detail"].lower()


def test_ingest_dry_run_doesnt_persist(client, mid):
    """``dry_run=true`` returns the bucketing without writing anything
    — palette table stays untouched."""
    tid = _seed_sweep_with_results(
        mid,
        measured_labs_per_cell=[
            # cell 0 — tight cluster, stable
            [[40.0, 5.0, -10.0], [40.5, 5.0, -10.0]],
            # cell 1 — far apart, unstable
            [[20.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
        ],
    )
    palette_before = client.get("/api/palette").json()
    r = client.post(
        f"/api/tests/{tid}/ingest",
        json={"max_sigma_de": 3, "dry_run": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert body["dry_run"] is True
    assert body["result_count"] == 2
    assert len(body["stable"]) == 1
    assert len(body["unstable"]) == 1
    stable = body["stable"][0]
    assert stable["cell_index"] == 0
    assert stable["persisted"] is False
    assert stable["new_entry_id"] is None
    palette_after = client.get("/api/palette").json()
    assert len(palette_after) == len(palette_before)


def test_ingest_persists_creates_validated_entry(client, mid):
    """Stable cells produce brand-new validated palette entries
    keyed on ``(test_id, cell_index)``. Re-runs upsert rather than
    duplicate."""
    tid = _seed_sweep_with_results(
        mid,
        measured_labs_per_cell=[
            [[40.0, 5.0, -10.0], [40.5, 5.0, -10.0]],
        ],
    )
    r = client.post(
        f"/api/tests/{tid}/ingest", json={"max_sigma_de": 3},
    )
    body = r.json()
    assert body["dry_run"] is False
    assert len(body["stable"]) == 1
    stable = body["stable"][0]
    assert stable["persisted"] is True
    new_id = stable["new_entry_id"]
    assert new_id is not None

    palette = client.get("/api/palette").json()
    new_entry = next(e for e in palette if e["id"] == new_id)
    assert new_entry["is_validated"] is True
    assert new_entry["validated_test_id"] == tid
    assert new_entry["validated_cell_index"] == 0
    assert new_entry["source"] == "averaged"
    # New entry's lab is the burn-mean (≈ 40.25, 5, -10).
    assert abs(new_entry["lab"][0] - 40.25) < 0.5
    # Per-cell params come from the spec axes + base — speed should
    # match the swatch's x_value (100 for cell 0).
    params = new_entry["params"]
    assert params["speed"] == 100
    # base_params come along for the ride so the recipe is complete.
    assert params["power"] == 50

    # Re-running ingest must upsert, not duplicate. Idempotent on
    # ``(test_id, cell_index)``.
    r2 = client.post(
        f"/api/tests/{tid}/ingest", json={"max_sigma_de": 3},
    )
    assert r2.json()["stable"][0]["new_entry_id"] == new_id
    palette2 = client.get("/api/palette").json()
    assert len([
        e for e in palette2
        if e.get("validated_test_id") == tid
        and e.get("validated_cell_index") == 0
    ]) == 1


def test_ingest_unstable_cells_arent_persisted_by_default(client, mid):
    """Unstable cells are surfaced in the preview but not written
    unless the user explicitly accepts via overrides."""
    tid = _seed_sweep_with_results(
        mid,
        measured_labs_per_cell=[
            [[20.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
        ],
    )
    r = client.post(
        f"/api/tests/{tid}/ingest", json={"max_sigma_de": 3},
    )
    body = r.json()
    assert len(body["unstable"]) == 1
    unstable = body["unstable"][0]
    assert unstable["persisted"] is False
    assert unstable["new_entry_id"] is None
    palette = client.get("/api/palette").json()
    assert all(e.get("validated_test_id") != tid for e in palette)


def test_ingest_overrides_let_user_force_unstable_cells(client, mid):
    """``overrides=[{cell_index, accept: true}]`` against an unstable
    cell forces persistence — the user is the final say."""
    tid = _seed_sweep_with_results(
        mid,
        measured_labs_per_cell=[
            [[20.0, 5.0, -10.0], [60.0, 5.0, -10.0]],
        ],
    )
    r = client.post(
        f"/api/tests/{tid}/ingest",
        json={
            "max_sigma_de": 3,
            "overrides": [{"cell_index": 0, "accept": True}],
        },
    )
    body = r.json()
    unstable = body["unstable"][0]
    assert unstable["persisted"] is True
    assert unstable["new_entry_id"] is not None
    palette = client.get("/api/palette").json()
    new_entry = next(
        e for e in palette if e["id"] == unstable["new_entry_id"]
    )
    assert new_entry["validated_test_id"] == tid
    assert new_entry["validated_cell_index"] == 0


def test_ingest_overrides_let_user_skip_stable_cells(client, mid):
    """``overrides=[{cell_index, accept: false}]`` against a stable
    cell skips it on save even though it's in the stable bucket."""
    tid = _seed_sweep_with_results(
        mid,
        measured_labs_per_cell=[
            [[40.0, 5.0, -10.0], [40.5, 5.0, -10.0]],
        ],
    )
    r = client.post(
        f"/api/tests/{tid}/ingest",
        json={
            "max_sigma_de": 3,
            "overrides": [{"cell_index": 0, "accept": False}],
        },
    )
    body = r.json()
    stable = body["stable"][0]
    assert stable["persisted"] is False
    assert stable["new_entry_id"] is None
    palette = client.get("/api/palette").json()
    assert all(e.get("validated_test_id") != tid for e in palette)


def test_ingest_filters_by_result_ids(client, mid):
    """Only the result_ids the user picked contribute to the bucket
    math. Drop one of the two seeded results → only one run remains
    → cell goes to ``skipped`` with ``insufficient_runs``."""
    tid = _seed_sweep_with_results(
        mid,
        measured_labs_per_cell=[
            [[40.0, 5.0, -10.0], [40.5, 5.0, -10.0]],
        ],
    )
    # Pull the result list to learn the ids the route assigned.
    results = client.get(f"/api/tests/{tid}/results").json()
    assert len(results) == 2
    only_one = [results[0]["id"]]
    r = client.post(
        f"/api/tests/{tid}/ingest",
        json={"max_sigma_de": 3, "result_ids": only_one, "dry_run": True},
    )
    body = r.json()
    assert body["result_count"] == 1
    assert body["stable"] == []
    assert body["unstable"] == []
    assert len(body["skipped"]) == 1
    assert body["skipped"][0]["reason"] == "insufficient_runs"
