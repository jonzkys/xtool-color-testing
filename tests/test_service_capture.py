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
    monkeypatch.setattr(cap, "detect_fiducials", lambda _: (99, {0: (0.0, 0.0), 1: (10.0, 0.0), 2: (0.0, 10.0), 3: (10.0, 10.0)}))

    spec = {
        "width_mm": 40.0, "height_mm": 20.0,
        "x_param": "power", "x_min": 10, "x_max": 100, "x_steps": 5,
        "rows": 1,
    }
    with pytest.raises(cap.CaptureError, match="test #99"):
        cap.run_capture(image_bytes=b"fake", test_id=42, spec=spec)
