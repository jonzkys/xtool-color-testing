"""Fiducial layout: QR top-left + 3 ArUco corners.

Burn-space coordinates (top-left origin; mm). Returned positions are the
top-left corner of each marker's bounding box.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MARKER_MARGIN_MM = 1.5

QR_SIZE_DEFAULT_MM = 5.0
ARUCO_SIZE_DEFAULT_MM = 2.0

# ArUco IDs assigned to each corner. The QR sits at top-left; the ArUcos
# at the other three corners carry IDs 1, 2, 3.
ARUCO_ID_TOP_RIGHT = 1
ARUCO_ID_BOTTOM_LEFT = 2
ARUCO_ID_BOTTOM_RIGHT = 3


@dataclass
class MarkerPosition:
    x: float
    y: float
    size: float
    marker_id: int  # 0 for QR (by convention); 1/2/3 for ArUcos


@dataclass
class RegistrationLayout:
    qr: MarkerPosition | None
    arucos: list[MarkerPosition]


def registration_reservation_mm(
    mode: Literal["on", "off"],
    *,
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
) -> tuple[float, float]:
    """Returns (x_shift_mm, y_shift_mm) that the grid must inset by.

    With QR at top-left and ArUcos at the other corners, the grid is
    bounded on the top and left by the QR (bigger of the two), and on
    top by the top-right ArUco's required clearance. We take the max
    of QR-bounded and ArUco-bounded clearance for each axis.
    """
    if mode == "off":
        return 0.0, 0.0
    qr_size = qr_size_mm or QR_SIZE_DEFAULT_MM
    aruco_size = aruco_size_mm or ARUCO_SIZE_DEFAULT_MM
    x_shift = qr_size + MARKER_MARGIN_MM
    y_shift = max(qr_size, aruco_size) + MARKER_MARGIN_MM
    return x_shift, y_shift


def compute_layout(
    *,
    grid_x: float, grid_y: float,
    grid_w: float, grid_h: float,
    mode: Literal["on", "off"] = "on",
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
) -> RegistrationLayout:
    if mode == "off":
        return RegistrationLayout(qr=None, arucos=[])
    qr_size = qr_size_mm or QR_SIZE_DEFAULT_MM
    aruco_size = aruco_size_mm or ARUCO_SIZE_DEFAULT_MM

    # QR top-left, inset from grid by the margin
    qr_x = grid_x - qr_size - MARKER_MARGIN_MM
    qr_y = grid_y - qr_size - MARKER_MARGIN_MM

    # ArUcos at three other corners, each inset by margin
    tr = MarkerPosition(
        x=grid_x + grid_w + MARKER_MARGIN_MM,
        y=grid_y - aruco_size - MARKER_MARGIN_MM,
        size=aruco_size, marker_id=ARUCO_ID_TOP_RIGHT,
    )
    bl = MarkerPosition(
        x=grid_x - aruco_size - MARKER_MARGIN_MM,
        y=grid_y + grid_h + MARKER_MARGIN_MM,
        size=aruco_size, marker_id=ARUCO_ID_BOTTOM_LEFT,
    )
    br = MarkerPosition(
        x=grid_x + grid_w + MARKER_MARGIN_MM,
        y=grid_y + grid_h + MARKER_MARGIN_MM,
        size=aruco_size, marker_id=ARUCO_ID_BOTTOM_RIGHT,
    )
    return RegistrationLayout(
        qr=MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0),
        arucos=[tr, bl, br],
    )
