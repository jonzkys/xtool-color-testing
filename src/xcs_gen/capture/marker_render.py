"""Render QR and ArUco registration markers into an XCSProject.

QR is generated via segno, rasterized to a bit grid, and emitted as a
single BITMAP display on the annotation layer. ArUco markers are
generated via cv2.aruco at render time (IDs 1, 2, 3 from DICT_4X4_50;
QR occupies ID 0 slot logically) and emitted the same way — one BITMAP
per marker.

Using BITMAP instead of N rects per module keeps the .xcs file small
and stays well below XCS's per-project display-element limit (which
appears to cap around 750 rects before processing fails).
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np
import segno
from PIL import Image

from ..model import (
    ANNOTATION_LAYER_COLOR,
    Bitmap,
    ProcessingParams,
    XCSProject,
)
from .layout import RegistrationLayout
from .qr_payload import encode_id_only, encode_inline

# Oversample factor: each logical marker module (QR/ArUco bit) is rendered
# at this many source-PNG pixels. Higher = crisper module edges but larger
# base64 payload. 10 px/module is plenty for any downstream decoding.
_PIXELS_PER_MODULE = 10


def qr_payload_for_test(
    *,
    test_id: str,
    x_param: str, x_min: float, x_max: float, x_steps: int,
    y_param: str | None, y_min: float, y_max: float, y_steps: int,
    grid_w: float, grid_h: float, rows: int, gap: float,
    grid_offset_x_mm: float,
    grid_offset_y_mm: float,
    base_params: ProcessingParams,
    material_id: str | None = None,
    kind: str = "grid",
    mode: str = "inline",
) -> str:
    """Build a QR payload string for one param test.

    mode = "inline" -> full spec, "id_only" -> just {"v":1,"id":...}.

    ``grid_offset_x_mm`` / ``grid_offset_y_mm`` record where the test grid
    sits relative to the QR's top-left corner. These are necessary for
    the ingest endpoint to sample cells correctly — the Y offset in
    particular depends on summary-text height, which the endpoint can't
    recompute without them.

    ``material_id`` tags the burn with the material it was printed on.
    Without this, captured palette entries can't be scoped correctly —
    the same (power, speed) produces different colours on stainless vs
    brass vs anodized aluminium, so the palette would be meaningless if
    all materials were mixed together.
    """
    if mode == "id_only":
        return encode_id_only(test_id)

    spec: dict[str, Any] = {
        "id": test_id,
        "t": kind,
        "x": {"p": x_param, "min": x_min, "max": x_max, "n": x_steps},
        "grid": {
            "w": grid_w, "h": grid_h, "rows": rows, "gap": gap,
            "ox": grid_offset_x_mm, "oy": grid_offset_y_mm,
        },
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
    if material_id:
        spec["m"] = material_id
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


def _bits_to_png_bytes(bits: np.ndarray) -> tuple[bytes, int, int]:
    """Render a bit matrix as a black-on-white PNG.

    Each module becomes an N×N block of pure black (0) or white (255)
    pixels, where N = _PIXELS_PER_MODULE. Returns (png_bytes, width, height).
    """
    rows, cols = bits.shape
    w = cols * _PIXELS_PER_MODULE
    h = rows * _PIXELS_PER_MODULE
    # 255 where bit is False (background), 0 where bit is True (dark module)
    pixels = np.where(bits, 0, 255).astype(np.uint8)
    # Upsample via nearest-neighbor repetition (no interpolation → sharp edges)
    pixels = pixels.repeat(_PIXELS_PER_MODULE, axis=0).repeat(_PIXELS_PER_MODULE, axis=1)
    img = Image.fromarray(pixels, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), w, h


def _emit_bitmap(
    project: XCSProject,
    *,
    bits: np.ndarray,
    origin_x: float,
    origin_y: float,
    total_size: float,
    annotation_params: ProcessingParams,
) -> None:
    """Emit a single BITMAP display representing the bit matrix."""
    png_bytes, w_px, h_px = _bits_to_png_bytes(bits)
    bmp = Bitmap(
        x=origin_x,
        y=origin_y,
        width=total_size,
        height=total_size,
        png_bytes=png_bytes,
        origin_width=w_px,
        origin_height=h_px,
        params=annotation_params,
        processing_type="COLOR_ENGRAVE",
        layer_color=ANNOTATION_LAYER_COLOR,
    )
    project.bitmaps.append(bmp)


def emit_registration_markers(
    project: XCSProject,
    *,
    layout: RegistrationLayout,
    qr_text: str,
    annotation_params: ProcessingParams,
) -> None:
    """Add QR + ArUco markers to `project` on the annotation layer.

    Each marker is emitted as a single BITMAP display carrying its bit
    matrix as an embedded PNG. Caller is responsible for constructing
    `layout` and `qr_text` via compute_layout() and qr_payload_for_test().
    """
    if layout.qr is None:
        return

    _emit_bitmap(
        project,
        bits=_qr_bits(qr_text),
        origin_x=layout.qr.x,
        origin_y=layout.qr.y,
        total_size=layout.qr.size,
        annotation_params=annotation_params,
    )

    for marker in layout.aruco_markers:
        _emit_bitmap(
            project,
            bits=_aruco_bits(marker.marker_id),
            origin_x=marker.x,
            origin_y=marker.y,
            total_size=marker.size,
            annotation_params=annotation_params,
        )
