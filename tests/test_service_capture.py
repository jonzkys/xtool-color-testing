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
    monkeypatch.setattr(cap, "detect_fiducials", lambda _: (99, 0, {0: (0.0, 0.0), 1: (10.0, 0.0), 2: (0.0, 10.0), 3: (10.0, 10.0)}))

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
    monkeypatch.setattr(cap, "detect_fiducials", lambda _: (42, 0, {}))
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
