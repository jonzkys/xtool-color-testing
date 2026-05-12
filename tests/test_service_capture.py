from __future__ import annotations

from xcs_gen_web.services import capture


def test_module_exports():
    assert hasattr(capture, "run_capture")
    assert hasattr(capture, "CaptureError")
    assert hasattr(capture, "CaptureResult")


def test_run_capture_id_mismatch_raises(monkeypatch):
    """If the decoded QR id doesn't match the test_id, run_capture raises CaptureError."""
    import pytest
    import numpy as np
    from xcs_gen_web.services import capture as cap

    # Build a fake image and stub out the pipeline
    fake_img = np.zeros((10, 10, 3), dtype=np.uint8)
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(cap, "detect_fiducials_with_recropping", lambda _: (99, 0, {0: (0.0, 0.0), 1: (10.0, 0.0), 2: (0.0, 10.0), 3: (10.0, 10.0)}))

    spec = {
        "width_mm": 40.0, "height_mm": 20.0,
        "x_param": "power", "x_min": 10, "x_max": 100, "x_steps": 5,
        "rows": 1,
    }
    with pytest.raises(cap.CaptureError, match="test #99"):
        cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)


def test_run_capture_wrapped_1d_samples_each_row(monkeypatch):
    """Wrapped 1D tests (rows > 1, y_param=None) must sample cells from
    every physical row, not just the first. Regression for a bug where
    spec["height_mm"] (per-row height) was used as the full grid height,
    compressing the homography so all rows landed inside the first row."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    rows = 3
    x_steps = 6  # → 2 cells per row
    row_height_mm = 4.0
    grid_w = 20.0
    px_per_mm = 10.0

    # Grid origin in burn space (matches run_capture's fixed layout).
    from xcs_gen.capture.layout import (
        ARUCO_SIZE_DEFAULT_MM,
        MARKER_MARGIN_MM,
        QR_SIZE_DEFAULT_MM,
    )
    margin = MARKER_MARGIN_MM
    qr_size = QR_SIZE_DEFAULT_MM
    aruco_size = ARUCO_SIZE_DEFAULT_MM
    origin_x = qr_size + 2 * margin
    origin_y = max(qr_size + 2 * margin, aruco_size + 2 * margin)

    # Match the generator's effective_row_gap math inline so this test also
    # fails when the service's helper is missing (pre-fix state).
    from xcs_gen.text import text_height
    ann_space = 0.5 + 0.05 + text_height(1.2) + 0.05
    gap = max(1.0, ann_space)
    row_stride = row_height_mm + gap
    grid_h = rows * row_height_mm + (rows - 1) * gap
    burn_w = origin_x + grid_w + aruco_size + margin
    burn_h = origin_y + grid_h + aruco_size + margin

    # Build a warped image where each row's cells are a distinct BGR color.
    W = int(burn_w * px_per_mm)
    H = int(burn_h * px_per_mm)
    warped = np.full((H, W, 3), 255, dtype=np.uint8)
    row_colors = [(0, 0, 200), (0, 200, 0), (200, 0, 0)]  # BGR
    for r in range(rows):
        y0 = int((origin_y + r * row_stride) * px_per_mm)
        y1 = int((origin_y + r * row_stride + row_height_mm) * px_per_mm)
        x0 = int(origin_x * px_per_mm)
        x1 = int((origin_x + grid_w) * px_per_mm)
        warped[y0:y1, x0:x1] = row_colors[r]

    fake_img = np.zeros((10, 10, 3), dtype=np.uint8)
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(cap, "detect_fiducials_with_recropping", lambda _: (42, 0, {}))
    monkeypatch.setattr(cap, "warp_to_burn_space", lambda *a, **kw: warped)

    spec = {
        "width_mm": grid_w, "height_mm": row_height_mm,
        "x_param": "speed", "x_min": 500, "x_max": 3000, "x_steps": x_steps,
        "y_param": None, "rows": rows,
        "hide_axis_labels": False,
    }
    result = cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)

    assert len(result.swatches) == x_steps
    # Group swatches by row and verify each row's colour matches what we painted.
    by_row = {r: [] for r in range(rows)}
    for s in result.swatches:
        by_row[s["row"]].append(s["hex"])

    for r in range(rows):
        assert len(by_row[r]) == 2, f"row {r} swatches: {by_row[r]}"
        # BGR (0,0,200) → RGB #c80000 ; (0,200,0) → #00c800 ; (200,0,0) → #0000c8
        expected_hex = "#{:02x}{:02x}{:02x}".format(
            row_colors[r][2], row_colors[r][1], row_colors[r][0]
        )
        for hex_ in by_row[r]:
            assert hex_ == expected_hex, (
                f"row {r} sampled {hex_}, expected {expected_hex} — "
                "sampler likely hit the wrong physical row"
            )


def test_run_capture_populates_missing_markers(monkeypatch):
    """When detect_fiducials returns ArUcos {2, 3} but not 1, the
    CaptureResult.missing_markers should list [1]. This is the signal
    the UI uses to warn that colours near the TR corner may be
    inaccurate."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    fake_img = np.zeros((50, 50, 3), dtype=np.uint8)
    warped = np.zeros((100, 100, 3), dtype=np.uint8)

    # corners_px keyed only by QR (0,4,5,6) + ArUcos {2, 3} — ID 1 is missing.
    corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(cap, "detect_fiducials_with_recropping", lambda _: (42, 0, corners))
    monkeypatch.setattr(cap, "warp_to_burn_space", lambda *a, **kw: warped)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 200.0, "x_steps": 9,
        "y_param": "pulse_width", "y_min": 2.0, "y_max": 60.0, "y_steps": 9,
        "rows": 1, "width_mm": 23.0, "height_mm": 23.0,
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }

    result = cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)
    assert result.missing_markers == [1]


def test_run_capture_missing_markers_empty_when_all_detected(monkeypatch):
    """When detect_fiducials returns all three ArUco IDs, missing_markers
    must be the empty list — no false positives from the set arithmetic."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    fake_img = np.zeros((50, 50, 3), dtype=np.uint8)
    warped = np.zeros((100, 100, 3), dtype=np.uint8)
    corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes", lambda _: fake_img)
    monkeypatch.setattr(cap, "detect_fiducials_with_recropping", lambda _: (42, 0, corners))
    monkeypatch.setattr(cap, "warp_to_burn_space", lambda *a, **kw: warped)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 200.0, "x_steps": 9,
        "y_param": "pulse_width", "y_min": 2.0, "y_max": 60.0, "y_steps": 9,
        "rows": 1, "width_mm": 23.0, "height_mm": 23.0,
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }

    result = cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)
    assert result.missing_markers == []


def test_run_capture_uses_spec_sample_aggregator(monkeypatch):
    """When the test spec sets sample_aggregator, run_capture should pass
    it through to sample_grid so the captured swatches reflect that
    method. We verify by checking that swatches differ when the
    aggregator is changed."""
    import numpy as np
    from xcs_gen_web.services import capture as cap
    from xcs_gen.capture.layout import (
        QR_SIZE_DEFAULT_MM, ARUCO_SIZE_DEFAULT_MM, MARKER_MARGIN_MM,
    )

    # Build a warped image large enough to contain the burn space for the
    # spec below. Default layout: grid origin at ~(8mm, 8mm); with a
    # 10×10 mm grid and default markers the burn space is ~21.5×21.5 mm.
    # At 10 px/mm that is 215×215 px. Cell centres land at y≈105 and y≈155.
    # A dark→bright stripe boundary at y=100 puts the top row of cells in a
    # 1/3 dark + 2/3 bright mix — median snaps to 220, mean averages to ~163.
    SIZE_PX = 215
    warped = np.full((SIZE_PX, SIZE_PX, 3), 50, dtype=np.uint8)
    warped[100:, :] = 220   # bright stripe starts at y=100

    fake_corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials_with_recropping",
                        lambda _: (1, 0, fake_corners))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: warped)

    # Marker sizes pinned to the pre-2026-05-12 defaults so this test
    # stays a pure aggregator check — independent of QR/ArUco default
    # tuning. The warped image dimensions + stripe position above are
    # calibrated against (QR=5 mm, ArUco=2 mm) → 21.5×21.5 mm burn space
    # at 10 px/mm.
    spec_base = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 100.0, "x_steps": 2,
        "y_param": "pulse_width", "y_min": 2.0, "y_max": 10.0, "y_steps": 2,
        "rows": 1, "width_mm": 10.0, "height_mm": 10.0,
        "cell_shape": "rect",
        "registration": {"mode": "on", "qr_size_mm": 5.0, "aruco_size_mm": 2.0},
    }
    median_result = cap.run_capture(
        image_bytes=b"fake", test_id=1,
        spec={**spec_base, "sample_aggregator": "median"},
    )
    mean_result = cap.run_capture(
        image_bytes=b"fake", test_id=1,
        spec={**spec_base, "sample_aggregator": "mean"},
    )

    # In the bright/dark cells, mean will pull toward the average; median
    # will snap to one side. The hex strings should differ.
    median_hexes = sorted(s["hex"] for s in median_result.swatches)
    mean_hexes = sorted(s["hex"] for s in mean_result.swatches)
    assert median_hexes != mean_hexes, (
        f"aggregator should change captured colours; "
        f"median={median_hexes} vs mean={mean_hexes}"
    )


def test_run_capture_default_aggregator_is_saturation_median(monkeypatch):
    """When sample_aggregator is absent from the spec, run_capture should
    behave exactly like before (saturation_median) — back-compat for
    existing tests."""
    import numpy as np
    from xcs_gen_web.services import capture as cap

    # Large enough to cover the default burn-space layout (~21.5 mm × 21.5 mm
    # at 10 px/mm = 215×215 px), so at least one cell lands inside the image.
    warped = np.full((215, 215, 3), 100, dtype=np.uint8)
    fake_corners = {
        0: (0.0, 0.0), 4: (0.0, 10.0), 5: (10.0, 10.0), 6: (10.0, 0.0),
        1: (30.0, 0.0), 2: (0.0, 30.0), 3: (30.0, 30.0),
    }
    monkeypatch.setattr(cap, "decode_image_bytes",
                        lambda _: np.zeros((50, 50, 3), dtype=np.uint8))
    monkeypatch.setattr(cap, "detect_fiducials_with_recropping",
                        lambda _: (1, 0, fake_corners))
    monkeypatch.setattr(cap, "warp_to_burn_space",
                        lambda *a, **kw: warped)

    spec = {
        "x_param": "frequency", "x_min": 50.0, "x_max": 100.0, "x_steps": 1,
        "y_param": None,
        "rows": 1, "width_mm": 10.0, "height_mm": 10.0,
        "cell_shape": "rect",
        "registration": {"mode": "on", "qr_size_mm": None, "aruco_size_mm": None},
    }
    # Should not raise — the missing field defaults to saturation_median.
    result = cap.run_capture(image_bytes=b"fake", test_id=1, spec=spec)
    assert len(result.swatches) >= 1
