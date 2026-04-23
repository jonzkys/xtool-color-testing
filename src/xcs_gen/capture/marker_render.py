"""Render QR and ArUco registration markers into an XCSProject.

QR is generated via segno; ArUco markers via opencv-contrib.  Both are
rasterized to a bit grid and emitted as a single BITMAP display on the
annotation layer.

Using BITMAP instead of N rects per module keeps the .xcs file small
and stays well below XCS's per-project display-element limit (which
appears to cap around 750 rects before processing fails).
"""

from __future__ import annotations

import io

import cv2
import numpy as np
import segno
from PIL import Image

from ..model import (
    ANNOTATION_LAYER_COLOR,
    Bitmap,
    ProcessingParams,
    XCSProject,
)
from .layout import MarkerPosition, RegistrationLayout
from .qr_payload import encode_id

# Oversample factor: each logical marker module (QR/ArUco bit) is rendered
# at this many source-PNG pixels. Higher = crisper module edges but larger
# base64 payload. 10 px/module is plenty for any downstream decoding.
_PIXELS_PER_MODULE = 10

_ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)


def render_aruco_bits(marker_id: int, modules_side: int = 6) -> np.ndarray:
    """Render ArUco marker as a (side, side) boolean array (True = dark).

    modules_side is the total with border; for DICT_4X4 this is 6 (4x4 +
    1-module black border on each side).
    """
    # cv2.aruco.generateImageMarker returns an N×N uint8 image; N is
    # modules_side * pixels_per_module. We want the logical bit grid, so
    # we render at 1 px per module and threshold.
    img = cv2.aruco.generateImageMarker(_ARUCO_DICT, marker_id, modules_side, borderBits=1)
    return img < 128  # True where dark


def _qr_bits(text: str) -> np.ndarray:
    """Render a QR code as a 2-D numpy array of booleans (True = dark module).

    Uses segno with ECC level M for balance of density and robustness.
    """
    qr = segno.make(text, error="m")
    matrix = np.array(qr.matrix, dtype=bool)
    return matrix


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


def emit_aruco(
    project: XCSProject, *,
    position: MarkerPosition,
    annotation_params: ProcessingParams,
    modules_side: int = 6,
) -> None:
    bits = render_aruco_bits(position.marker_id, modules_side=modules_side)
    _emit_bitmap(
        project, bits=bits,
        origin_x=position.x, origin_y=position.y,
        total_size=position.size,
        annotation_params=annotation_params,
    )


def emit_registration_markers(
    project: XCSProject,
    *,
    layout: RegistrationLayout,
    test_id: int,
    annotation_params: ProcessingParams,
    retest_index: int = 0,
) -> None:
    """Emit the QR (id + retest index) plus any ArUco corners on the
    annotation layer.

    ``retest_index`` defaults to 0 so callers that don't care about the
    retest feature (older unit tests, svg-stack callers that never
    burn a gradient test) don't need to plumb the value through.
    """
    if layout.qr is None:
        return
    qr_text = encode_id(test_id, retest_index)
    _emit_bitmap(
        project, bits=_qr_bits(qr_text),
        origin_x=layout.qr.x, origin_y=layout.qr.y,
        total_size=layout.qr.size, annotation_params=annotation_params,
    )
    for ar in layout.arucos:
        emit_aruco(project, position=ar, annotation_params=annotation_params)
