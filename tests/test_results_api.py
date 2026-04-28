from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from xcs_gen_web.app import create_app
from xcs_gen_web.repositories import materials as m_repo
from xcs_gen_web.repositories import tests as t_repo
from xcs_gen_web.services import capture as cap


SPEC = {
    "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": 3,
    "rows": 1, "width_mm": 30, "height_mm": 10, "gap_mm": 0.5,
    "cell_shape": "rect", "square_cells": True, "angle_mode": "fixed",
    "unidirectional": False,
    "base_params": {"power": 50, "speed": 1000, "frequency": 60,
                    "density": 200, "passes": 1, "pulse_width": 200, "laser": "red"},
    "registration": {"mode": "on"},
}


def _fake_capture(*, image_bytes, test_id, spec):
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": None,
             "hex": "#00ff00", "lab": [0, 0, 0], "sigma": 1.2},
        ],
        warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
    )


def test_upload_happy_path(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    r = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert len(body["swatches"]) == 2

    # status + lock promoted
    t = c.get(f"/api/tests/{tid}").json()
    assert t["status"] == "tested"
    assert t["locked"] is True


def test_averaged_swatches_endpoint(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    r = c.get(f"/api/tests/{tid}/swatches")
    assert r.status_code == 200
    rows = r.json()
    assert {rr["hex"] for rr in rows} == {"#ff0000", "#00ff00"}


def test_auto_upload_routes_photo_to_test_via_qr(fresh_db, monkeypatch, tmp_path):
    """POST /api/results/upload reads the QR to find the test id, then
    persists the result against that test — no tid in the URL."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    monkeypatch.setattr(cap, "detect_test_id", lambda _: (tid, 0))

    r = c.post(
        "/api/results/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["test_id"] == tid
    assert len(body["swatches"]) == 2
    # test should get promoted to tested just like the scoped endpoint
    t = c.get(f"/api/tests/{tid}").json()
    assert t["status"] == "tested"


def test_auto_upload_404_when_qr_matches_unknown_test(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "detect_test_id", lambda _: (9999, 0))
    c = TestClient(create_app())
    r = c.post(
        "/api/results/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 404
    assert "9999" in r.json()["detail"]


def test_preflight_returns_test_info_and_existing_count(fresh_db, monkeypatch, tmp_path):
    """Preflight decodes the QR only (no persistence) so the modal can
    warn before re-processing a test that already has uploads."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="Speed sweep", material_id=mid, spec=SPEC)["id"]
    monkeypatch.setattr(cap, "detect_test_id", lambda _: (tid, 0))

    # No uploads yet.
    r = c.post(
        "/api/results/preflight",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "test_id": tid, "test_name": "Speed sweep",
        "existing_result_count": 0,
    }

    # After one upload, preflight reports the prior result count.
    c.post("/api/results/upload",
           files={"image": ("phone.jpg", b"fake", "image/jpeg")})
    r2 = c.post(
        "/api/results/preflight",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r2.json()["existing_result_count"] == 1

    # Preflight does not persist (still only 1 result after 2 preflights).
    assert len(c.get(f"/api/tests/{tid}/results").json()) == 1


def test_auto_upload_400_when_qr_missing(fresh_db, monkeypatch, tmp_path):
    def _no_qr(_):
        raise cap.CaptureError("no valid id-only QR detected")
    monkeypatch.setattr(cap, "detect_test_id", _no_qr)
    c = TestClient(create_app())
    r = c.post(
        "/api/results/upload",
        files={"image": ("phone.jpg", b"fake", "image/jpeg")},
    )
    assert r.status_code == 400
    assert "QR" in r.json()["detail"]


def test_patch_excluded_flips_average(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    r = c.post(f"/api/tests/{tid}/results", files={"image": ("x.png", b"fake", "image/png")})
    rid = r.json()["id"]
    c.patch(f"/api/results/{rid}", json={"excluded": True})
    assert c.get(f"/api/tests/{tid}/swatches").json() == []


def test_upload_response_includes_missing_markers(fresh_db, monkeypatch, tmp_path):
    """The upload route should expose missing_markers on the
    ResultResponse — the UI relies on it to render the warning pill."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))

    def _capture_with_missing_marker(*, image_bytes, test_id, spec):
        return cap.CaptureResult(
            swatches=[
                {"row": 0, "col": 0, "x_value": 500, "y_value": None,
                 "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            ],
            warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
            missing_markers=[1],
        )
    monkeypatch.setattr(cap, "run_capture", _capture_with_missing_marker)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    r = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "missing_markers" in body
    assert body["missing_markers"] == [1]


def test_upload_response_missing_markers_defaults_to_empty(
    fresh_db, monkeypatch, tmp_path,
):
    """When run_capture returns a CaptureResult without missing markers,
    the API exposes the empty list — not absent, not None."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    r = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert r.status_code == 201, r.text
    assert r.json()["missing_markers"] == []


def test_reingest_happy_path(fresh_db, monkeypatch, tmp_path):
    """POST /api/results/{rid}/reingest re-runs capture against the
    saved photo and returns a ResultResponse with fresh swatches +
    missing_markers."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert upload.status_code == 201, upload.text
    rid = upload.json()["id"]

    # Swap to a different fake_capture so we can confirm the swatches
    # were actually replaced rather than left untouched.
    def _new_capture(*, image_bytes, test_id, spec):
        return cap.CaptureResult(
            swatches=[
                {"row": 0, "col": 0, "x_value": 999, "y_value": None,
                 "hex": "#0000ff", "lab": [0, 0, 0], "sigma": 0.5},
            ],
            warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
            missing_markers=[2],
        )
    monkeypatch.setattr(cap, "run_capture", _new_capture)

    r = c.post(f"/api/results/{rid}/reingest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == rid
    assert len(body["swatches"]) == 1
    assert body["swatches"][0]["x_value"] == 999
    assert body["swatches"][0]["hex"] == "#0000ff"
    assert body["missing_markers"] == [2]


def test_reingest_returns_410_when_image_missing(fresh_db, monkeypatch, tmp_path):
    """If the saved photo is gone (FS deleted, S3 404), reingest should
    return 410 Gone with a clear message — not 500."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]

    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]

    # Force images.read to fail as if the file was deleted from disk.
    from xcs_gen_web import images
    monkeypatch.setattr(images, "read",
                        lambda _: (_ for _ in ()).throw(FileNotFoundError()))

    r = c.post(f"/api/results/{rid}/reingest")
    assert r.status_code == 410, r.text
    assert "no longer available" in r.json()["detail"].lower()


def test_reingest_returns_404_for_unknown_rid(fresh_db, monkeypatch, tmp_path):
    """Unknown rid (or wrong owner) returns 404, not 500."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    c = TestClient(create_app())
    r = c.post("/api/results/9999/reingest")
    assert r.status_code == 404


# ── Warped-image cache ──────────────────────────────────────────────────


def _setup_for_warped_cache(monkeypatch, tmp_path) -> tuple[TestClient, int, list[int]]:
    """Stand up a fresh DB + uploaded result with a counting capture
    stub. Returns ``(client, rid, call_count_ref)`` where the counter
    increments on every ``run_capture`` invocation."""
    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    counter = [0]

    def _counting_capture(*, image_bytes, test_id, spec):
        counter[0] += 1
        return cap.CaptureResult(
            swatches=[
                {"row": 0, "col": 0, "x_value": 500, "y_value": None,
                 "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            ],
            warped_image_bgr=np.zeros((10, 10, 3), dtype=np.uint8),
        )
    monkeypatch.setattr(cap, "run_capture", _counting_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    assert upload.status_code == 201, upload.text
    rid = upload.json()["id"]
    # Reset after upload — _persist_upload runs capture once, that's
    # not part of the cache assertions.
    counter[0] = 0
    return c, rid, counter


def test_warped_image_cached_after_first_call(fresh_db, monkeypatch, tmp_path):
    c, rid, counter = _setup_for_warped_cache(monkeypatch, tmp_path)
    # First fetch runs capture + saves the sidecar.
    assert c.get(f"/api/results/{rid}/warped-image").status_code == 200
    assert counter[0] == 1
    # Second fetch streams the cache — no capture run.
    assert c.get(f"/api/results/{rid}/warped-image").status_code == 200
    assert counter[0] == 1


def test_debug_endpoints_share_one_capture(fresh_db, monkeypatch, tmp_path):
    """Opening the debug modal fires warped-image + warped-with-grid +
    row strips. The 5-10 s slow path was a capture-pipeline run per
    request — with the cache, only the first request runs capture.
    We assert the counter, not the row-strip HTTP status (the strip
    rendering on a 10×10 stub image is unrelated to caching)."""
    c, rid, counter = _setup_for_warped_cache(monkeypatch, tmp_path)
    assert c.get(f"/api/results/{rid}/warped-image").status_code == 200
    assert c.get(f"/api/results/{rid}/debug/warped-with-grid").status_code == 200
    # Hit row/0 too — even if rendering fails downstream, the cache
    # path must not have invoked run_capture.
    c.get(f"/api/results/{rid}/debug/row/0")
    assert counter[0] == 1


def test_reingest_invalidates_warped_cache(fresh_db, monkeypatch, tmp_path):
    """Reingest must drop the cached warped image; the next debug
    fetch should re-run capture (the spec / detection code may have
    changed)."""
    c, rid, counter = _setup_for_warped_cache(monkeypatch, tmp_path)
    # Warm the cache.
    c.get(f"/api/results/{rid}/warped-image")
    assert counter[0] == 1
    # Reingest re-runs capture (counter += 1) and nulls warped_image_path.
    assert c.post(f"/api/results/{rid}/reingest").status_code == 200
    assert counter[0] == 2
    # Next warped fetch sees the null and re-runs.
    assert c.get(f"/api/results/{rid}/warped-image").status_code == 200
    assert counter[0] == 3
    # And then the cache is warm again.
    c.get(f"/api/results/{rid}/warped-image")
    assert counter[0] == 3


def test_delete_invalidates_warped_cache(fresh_db, monkeypatch, tmp_path):
    """Deleting a result removes the cached warped sidecar so it can't
    leak into a future result that happens to take the same id."""
    c, rid, _ = _setup_for_warped_cache(monkeypatch, tmp_path)
    c.get(f"/api/results/{rid}/warped-image")  # warm cache
    # Locate the sidecar on disk; it must exist before delete.
    sidecars = list(tmp_path.rglob("*-warped.png"))
    assert len(sidecars) == 1, f"expected 1 warped sidecar, got {sidecars}"
    # Hold the response in a local — the DELETE has a side effect we
    # rely on. ``assert c.delete(...).status_code == 204`` would skip
    # the call under ``python -O`` (asserts are stripped), so the
    # subsequent sidecar check would race against an undeleted row.
    resp = c.delete(f"/api/results/{rid}")
    assert resp.status_code == 204
    # Sidecar is gone after delete.
    assert list(tmp_path.rglob("*-warped.png")) == []


def test_swatch_preview_with_alternate_aggregator(fresh_db, monkeypatch, tmp_path):
    """The preview endpoint re-runs aggregation with a different method
    and returns the result without writing to DB. The original
    swatches_json on the row stays unchanged."""
    import numpy as np
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    original_swatches = upload.json()["swatches"]

    # Mock decode + warp + detect for the preview path: aggregate_warped
    # is what the endpoint calls, so we monkeypatch THAT to return a
    # known list.
    from xcs_gen_web.services import capture
    monkeypatch.setattr(capture, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(capture, "detect_fiducials",
                        lambda _: (1, 0, {0: (0.0, 0.0), 4: (0.0, 10.0),
                                          5: (10.0, 10.0), 6: (10.0, 0.0),
                                          1: (30.0, 0.0), 2: (0.0, 30.0),
                                          3: (30.0, 30.0)}))
    monkeypatch.setattr(capture, "warp_to_burn_space",
                        lambda *a, **kw: np.full((100, 100, 3), 200, dtype=np.uint8))

    r = c.get(f"/api/results/{rid}/swatches/preview?aggregator=mean")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aggregator"] == "mean"
    assert isinstance(body["swatches"], list)

    # Confirm the row was NOT modified.
    list_after = c.get(f"/api/tests/{tid}/results").json()
    refreshed = next(x for x in list_after if x["id"] == rid)
    assert refreshed["swatches"] == original_swatches


def test_swatch_preview_unknown_aggregator_returns_400(fresh_db, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    r = c.get(f"/api/results/{rid}/swatches/preview?aggregator=not_real")
    assert r.status_code == 400
    assert "unknown aggregator" in r.json()["detail"].lower()


def test_swatch_preview_missing_aggregator_returns_422(fresh_db, monkeypatch, tmp_path):
    """The aggregator query param is required; absence is a 422 from FastAPI."""
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture)
    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    r = c.get(f"/api/results/{rid}/swatches/preview")
    assert r.status_code == 422


def _fake_capture_large(*, image_bytes, test_id, spec):
    """Like _fake_capture but returns a 200x200 warped image so inspect_cell
    has enough pixels to crop a valid cell region."""
    return cap.CaptureResult(
        swatches=[
            {"row": 0, "col": 0, "x_value": 500, "y_value": None,
             "hex": "#ff0000", "lab": [0, 0, 0], "sigma": 1.0},
            {"row": 0, "col": 1, "x_value": 1000, "y_value": None,
             "hex": "#00ff00", "lab": [0, 0, 0], "sigma": 1.2},
        ],
        warped_image_bgr=np.full((200, 200, 3), 100, dtype=np.uint8),
    )


def test_inspect_cell_returns_image_and_aggregator_results(fresh_db, monkeypatch, tmp_path):
    """Inspect endpoint returns the cell crop as base64 PNG and runs all
    5 aggregators on the cell, returning their hex outputs."""
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture_large)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]

    r = c.get(f"/api/results/{rid}/inspect/0/0")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["row"] == 0 and body["col"] == 0
    assert "cell_image_b64" in body and len(body["cell_image_b64"]) > 0
    assert "sampling_region" in body
    assert set(body["aggregator_results"].keys()) == {
        "median", "mean", "saturation_median", "trimmed_mean", "kmeans_dominant",
    }
    for hex_value in body["aggregator_results"].values():
        assert hex_value.startswith("#") and len(hex_value) == 7


def test_inspect_cell_out_of_bounds_returns_400(fresh_db, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture_large)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    tid = t_repo.create(name="T", material_id=mid, spec=SPEC)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    # SPEC has x_steps=3, y_steps=None, rows=1 → grid is 1×3. Col 99 is OOB.
    r = c.get(f"/api/results/{rid}/inspect/0/99")
    assert r.status_code == 400
    assert "out of bounds" in r.json()["detail"].lower()


def test_inspect_cell_wrapped_1d_accepts_non_row_zero(fresh_db, monkeypatch, tmp_path):
    """Wrapped 1D tests have y_param=None but multiple physical rows.
    The bounds check used to fail on any non-row-0 click because it
    used y_steps=1 as the row limit. Real bound is rows_total."""
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture_large)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    wrapped_spec = {
        **SPEC,
        "x_steps": 12,
        "rows": 4,
        "width_mm": 18,
        "height_mm": 6,
        "y_param": None,
    }
    tid = t_repo.create(name="W", material_id=mid, spec=wrapped_spec)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    # row 1 (second physical row) MUST be accepted — there are 4 rows.
    r = c.get(f"/api/results/{rid}/inspect/1/0")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["row"] == 1
    # And row 4 (>= rows_total) MUST be rejected.
    r = c.get(f"/api/results/{rid}/inspect/4/0")
    assert r.status_code == 400
    assert "out of bounds" in r.json()["detail"].lower()
    # And col >= per_row (12/4=3) MUST be rejected.
    r = c.get(f"/api/results/{rid}/inspect/0/3")
    assert r.status_code == 400


def test_inspect_cell_wrapped_1d_uses_per_row_cell_width(fresh_db, monkeypatch, tmp_path):
    """Wrapped-1D tests (rows>1, y_param=None) divide x_steps across
    `per_row` cells per physical row. inspect_cell must compute
    cell_w_mm = grid_w / per_row, NOT grid_w / x_steps — otherwise the
    cropped region is too narrow and the sample box collapses to a few
    pixels."""
    import numpy as np
    from fastapi.testclient import TestClient
    from xcs_gen_web.app import create_app
    from xcs_gen_web.services import capture as cap

    monkeypatch.setenv("XCS_GEN_IMAGES_DIR", str(tmp_path))
    monkeypatch.setattr(cap, "run_capture", _fake_capture_large)

    c = TestClient(create_app())
    mid = m_repo.create(name="SS")["id"]
    # 12-step sweep wrapped onto 4 rows × 3 cells per row, each 6mm wide.
    # If the bug returns, cell_w_mm would compute as grid_w/12 = 1.5mm,
    # and the sample box would be only a few pixels wide.
    wrapped_spec = {
        **SPEC,
        "x_steps": 12,
        "rows": 4,
        "width_mm": 18,
        "height_mm": 6,
        "y_param": None,
    }
    tid = t_repo.create(name="W", material_id=mid, spec=wrapped_spec)["id"]
    upload = c.post(
        f"/api/tests/{tid}/results",
        files={"image": ("x.png", b"fake", "image/png")},
    )
    rid = upload.json()["id"]
    r = c.get(f"/api/results/{rid}/inspect/0/0")
    assert r.status_code == 200, r.text
    body = r.json()
    region = body["sampling_region"]
    # Per-row cell width = 18mm / 3 = 6mm = 60 px @ px_per_mm=10.
    # Sample box half-width = 60 * 0.3 / 2 = 9 px → full sample box >= 12 px.
    # If the bug returns, half_w_px would be ~2 px (cell_w_mm collapsed).
    assert region["half_w_px"] >= 5.0, (
        f"sample box too narrow ({region['half_w_px']}); "
        f"wrapped-1D cell width should use per_row, not x_steps"
    )
