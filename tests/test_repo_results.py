from __future__ import annotations

from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import results as repo
from xcs_gen_web.repositories import tests as t_repo


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on"},
}


def _setup(fresh_db):
    mid = m_repo.create(name="SS")["id"]
    t = t_repo.create(name="T", material_id=mid, spec=SPEC)
    return t["id"]


def _swatch(x_value: float, hex_: str, sigma: float = 1.0) -> dict:
    return {"row": 0, "col": 0, "x_value": x_value,
            "y_value": None, "hex": hex_, "lab": [0, 0, 0], "sigma": sigma}


def test_insert_result_and_list(fresh_db):
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png",
        image_sha256="abc", swatches=[_swatch(500, "#ff0000")],
    )
    assert r["test_id"] == tid and r["excluded"] is False
    listed = repo.list_by_test(tid)
    assert [x["id"] for x in listed] == [r["id"]]


def test_exclude_toggle(fresh_db):
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png",
        image_sha256="abc", swatches=[_swatch(500, "#ff0000")],
    )
    repo.set_excluded(r["id"], True)
    assert repo.get(r["id"])["excluded"] is True


def test_averaged_swatches_one_result(fresh_db):
    tid = _setup(fresh_db)
    repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[_swatch(500, "#ff0000"), _swatch(600, "#00ff00")],
    )
    avg = repo.averaged_swatches(tid)
    assert len(avg) == 2
    assert avg[0]["sample_count"] == 1
    assert avg[0]["hex"].lower() == "#ff0000"


def test_averaged_swatches_two_results_lab_mean(fresh_db):
    tid = _setup(fresh_db)
    repo.create(
        test_id=tid, image_path="/tmp/a.png", image_sha256="a",
        swatches=[_swatch(500, "#800000")],
    )
    repo.create(
        test_id=tid, image_path="/tmp/b.png", image_sha256="b",
        swatches=[_swatch(500, "#400000")],
    )
    avg = repo.averaged_swatches(tid)
    assert len(avg) == 1
    assert avg[0]["sample_count"] == 2
    # Rough sanity: the averaged L should be between the two inputs' L
    assert 10 < avg[0]["lab"][0] < 40


def test_averaged_swatches_ignores_excluded(fresh_db):
    tid = _setup(fresh_db)
    r1 = repo.create(test_id=tid, image_path="/tmp/a.png", image_sha256="a",
                     swatches=[_swatch(500, "#ff0000")])
    r2 = repo.create(test_id=tid, image_path="/tmp/b.png", image_sha256="b",
                     swatches=[_swatch(500, "#00ff00")])
    repo.set_excluded(r2["id"], True)
    avg = repo.averaged_swatches(tid)
    assert avg[0]["hex"].lower() == "#ff0000"
    assert avg[0]["sample_count"] == 1


def test_create_persists_missing_markers(fresh_db):
    """create() should serialise missing_markers into missing_markers_json
    and round-trip through get()."""
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[_swatch(500, "#ff0000")],
        missing_markers=[1, 3],
    )
    assert r["missing_markers"] == [1, 3]
    fetched = repo.get(r["id"])
    assert fetched["missing_markers"] == [1, 3]


def test_create_default_missing_markers_is_empty(fresh_db):
    """When missing_markers is not passed, the row should round-trip as []."""
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[_swatch(500, "#ff0000")],
    )
    assert r["missing_markers"] == []


def test_replace_capture_overwrites_swatches_and_missing_markers(fresh_db):
    """replace_capture should atomically swap both fields and leave the
    rest of the row (image_path, sha, owner) untouched."""
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[_swatch(500, "#ff0000")],
        missing_markers=[1],
    )
    new_swatches = [_swatch(600, "#00ff00", sigma=0.5)]
    refreshed = repo.replace_capture(
        r["id"], swatches=new_swatches, missing_markers=[],
    )
    assert refreshed is not None
    assert refreshed["swatches"] == new_swatches
    assert refreshed["missing_markers"] == []
    assert refreshed["image_path"] == "/tmp/x.png"  # untouched
    assert refreshed["image_sha256"] == "abc"        # untouched


def test_replace_capture_wrong_owner_returns_none(fresh_db):
    """replace_capture must owner-scope its UPDATE — a wrong-owner call
    returns None and leaves the original row untouched. This pins the
    most security-sensitive line in the function."""
    tid = _setup(fresh_db)
    r = repo.create(
        test_id=tid, image_path="/tmp/x.png", image_sha256="abc",
        swatches=[_swatch(500, "#ff0000")],
        owner_id=1,  # explicit
        missing_markers=[1],
    )

    refreshed = repo.replace_capture(
        r["id"],
        swatches=[_swatch(999, "#000000")],
        missing_markers=[2, 3],
        owner_id=2,  # different owner
    )
    assert refreshed is None

    # Original row must be untouched.
    original = repo.get(r["id"], owner_id=1)
    assert original is not None
    assert original["missing_markers"] == [1]
    assert original["swatches"][0]["x_value"] == 500
