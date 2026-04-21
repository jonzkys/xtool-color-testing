from __future__ import annotations

from xcs_gen_web.services import capture


def test_module_exports():
    assert hasattr(capture, "run_capture")
    assert hasattr(capture, "CaptureError")
    assert hasattr(capture, "CaptureResult")
