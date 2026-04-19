"""Render QR and ArUco registration markers into an XCSProject.

QR is generated via segno, rasterized to a bit grid, and emitted as a set
of filled rects on the annotation layer. ArUco markers are generated via
cv2.aruco at render time (IDs 1, 2, 3 from DICT_4X4_50; QR occupies ID 0
slot logically).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import segno

from ..builder import build_device_entry, build_rect_display
from ..model import (
    ANNOTATION_LAYER_COLOR,
    ProcessingParams,
    Rect,
    XCSProject,
)
from .layout import RegistrationLayout
from .qr_payload import encode_id_only, encode_inline


def qr_payload_for_test(
    *,
    test_id: str,
    x_param: str, x_min: float, x_max: float, x_steps: int,
    y_param: str | None, y_min: float, y_max: float, y_steps: int,
    grid_w: float, grid_h: float, rows: int, gap: float,
    base_params: ProcessingParams,
    kind: str = "grid",
    mode: str = "inline",
) -> str:
    """Build a QR payload string for one param test.

    mode = "inline" -> full spec, "id_only" -> just {"v":1,"id":...}.
    """
    if mode == "id_only":
        return encode_id_only(test_id)

    spec: dict[str, Any] = {
        "id": test_id,
        "t": kind,
        "x": {"p": x_param, "min": x_min, "max": x_max, "n": x_steps},
        "grid": {"w": grid_w, "h": grid_h, "rows": rows, "gap": gap},
        "b": {
            "p": base_params.power,
            "s": base_params.speed,
            "f": base_params.mopa_frequency,
            "d": base_params.density,
            "r": base_params.repeat,
            "pw": base_params.pulse_width,
            "l": base_params.processing_light_source,
        },
    }
    if y_param is not None:
        spec["y"] = {"p": y_param, "min": y_min, "max": y_max, "n": y_steps}

    return encode_inline(spec)


def _qr_bits(text: str) -> np.ndarray:
    """Render a QR code as a 2-D numpy array of booleans (True = dark module).

    Uses segno with ECC level M for balance of density and robustness.
    """
    qr = segno.make(text, error="m")
    matrix = np.array(qr.matrix, dtype=bool)
    return matrix


def _aruco_bits(marker_id: int) -> np.ndarray:
    """Render an ArUco marker (DICT_4X4_50) as a bool matrix with 1-module border.

    The returned matrix is (marker_size + 2) x (marker_size + 2) including
    the mandatory black border, where marker_size = 4 for DICT_4X4_50.
    True = dark (filled) module.
    """
    import cv2

    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    # generateImageMarker returns a grayscale image at specified pixel size.
    # Request (side_bits * 10) pixels and then downsample to bits by taking
    # the min value per block.
    bits = 6  # 4x4 marker + 1-module border on each side
    scale = 10
    img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, bits * scale)
    # Downsample: each block is `scale` px; dark if all black.
    out = np.zeros((bits, bits), dtype=bool)
    for r in range(bits):
        for c in range(bits):
            block = img[r * scale:(r + 1) * scale, c * scale:(c + 1) * scale]
            out[r, c] = bool(block.mean() < 128)
    return out


def _emit_bit_matrix(
    project: XCSProject,
    *,
    bits: np.ndarray,
    origin_x: float,
    origin_y: float,
    total_size: float,
    annotation_params: ProcessingParams,
) -> None:
    """Add one filled annotation-layer Rect per dark bit in `bits`."""
    rows, cols = bits.shape
    cell = total_size / cols  # assume square
    for r in range(rows):
        for c in range(cols):
            if not bits[r, c]:
                continue
            elem = Rect(
                x=origin_x + c * cell,
                y=origin_y + r * cell,
                width=cell,
                height=cell,
                params=annotation_params,
                processing_type="COLOR_FILL_ENGRAVE",
                is_fill=True,
                layer_color=ANNOTATION_LAYER_COLOR,
            )
            # Add as an extra_display so it joins the annotation stream
            # (rather than as project.elements which would mix with the
            # gradient layer). Build the display + device entry directly.
            disp = build_rect_display(elem)
            project.extra_displays.append(disp)
            project.extra_device_entries.append(
                build_device_entry(
                    elem.id, "RECT", elem.processing_type,
                    annotation_params, is_fill=True,
                )
            )


def emit_registration_markers(
    project: XCSProject,
    *,
    layout: RegistrationLayout,
    qr_text: str,
    annotation_params: ProcessingParams,
) -> None:
    """Add QR + ArUco markers to `project` on the annotation layer.

    All marker modules are emitted as filled rects using `annotation_params`
    (typically blue-diode settings). Caller is responsible for constructing
    `layout` and `qr_text` via compute_layout() and qr_payload_for_test().
    """
    if layout.qr is None:
        return

    # QR
    qr_bits = _qr_bits(qr_text)
    _emit_bit_matrix(
        project,
        bits=qr_bits,
        origin_x=layout.qr.x,
        origin_y=layout.qr.y,
        total_size=layout.qr.size,
        annotation_params=annotation_params,
    )

    # ArUco (if any)
    for marker in layout.aruco_markers:
        bits = _aruco_bits(marker.marker_id)
        _emit_bit_matrix(
            project,
            bits=bits,
            origin_x=marker.x,
            origin_y=marker.y,
            total_size=marker.size,
            annotation_params=annotation_params,
        )
