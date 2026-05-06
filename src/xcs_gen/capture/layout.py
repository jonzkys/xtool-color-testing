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

PATCH_SIZE_DEFAULT_MM = 5.0
PATCH_GAP_DEFAULT_MM = 1.0
PATCH_BORDER_DEFAULT_MM = 2.0

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
class CalibrationPatch:
    label: str           # "light" | "mid" | "dark"
    x: float             # top-left, mm
    y: float
    width_mm: float
    height_mm: float


@dataclass
class CalibrationCleanPassBBox:
    x: float
    y: float
    width_mm: float
    height_mm: float


@dataclass
class CalibrationStrip:
    patches: list[CalibrationPatch]
    clean_pass_bbox: CalibrationCleanPassBBox


@dataclass
class RegistrationLayout:
    qr: MarkerPosition | None
    arucos: list[MarkerPosition]
    calibration_strip: CalibrationStrip | None = None


def registration_reservation_mm(
    mode: Literal["on", "off"],
    *,
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
) -> tuple[float, float]:
    """Returns (x_shift_mm, y_shift_mm) that the grid must inset by.

    Both axes use max(qr, aruco) + margin so the reservation is symmetric
    and covers the bottom-left ArUco even when aruco_size > qr_size.
    """
    if mode == "off":
        return 0.0, 0.0
    qr_size = qr_size_mm if qr_size_mm is not None else QR_SIZE_DEFAULT_MM
    aruco_size = aruco_size_mm if aruco_size_mm is not None else ARUCO_SIZE_DEFAULT_MM
    x_shift = max(qr_size, aruco_size) + MARKER_MARGIN_MM
    y_shift = max(qr_size, aruco_size) + MARKER_MARGIN_MM
    return x_shift, y_shift


def compute_layout(
    *,
    grid_x: float, grid_y: float,
    grid_w: float, grid_h: float,
    mode: Literal["on", "off"] = "on",
    qr_size_mm: float | None = None,
    aruco_size_mm: float | None = None,
    with_calibration_strip: bool = False,
    patch_count: int = 3,
    patch_size_mm: float = PATCH_SIZE_DEFAULT_MM,
    patch_gap_mm: float = PATCH_GAP_DEFAULT_MM,
    patch_border_mm: float = PATCH_BORDER_DEFAULT_MM,
    patch_labels: tuple[str, ...] = ("light", "mid", "dark"),
) -> RegistrationLayout:
    if mode == "off":
        return RegistrationLayout(qr=None, arucos=[])
    qr_size = qr_size_mm if qr_size_mm is not None else QR_SIZE_DEFAULT_MM
    aruco_size = aruco_size_mm if aruco_size_mm is not None else ARUCO_SIZE_DEFAULT_MM

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

    strip: CalibrationStrip | None = None
    if with_calibration_strip:
        strip_w = (
            patch_count * patch_size_mm
            + (patch_count - 1) * patch_gap_mm
        )
        clean_w = strip_w + 2 * patch_border_mm
        clean_h = patch_size_mm + 2 * patch_border_mm
        margin = MARKER_MARGIN_MM
        avail_x_start = qr_x + qr_size + margin
        avail_x_end = tr.x - margin
        if avail_x_end - avail_x_start < clean_w:
            strip = None
        else:
            clean_x = avail_x_start + (avail_x_end - avail_x_start - clean_w) / 2
            clean_y = grid_y - clean_h - margin
            patches: list[CalibrationPatch] = []
            for i, label in enumerate(patch_labels[:patch_count]):
                px = clean_x + patch_border_mm + i * (patch_size_mm + patch_gap_mm)
                py = clean_y + patch_border_mm
                patches.append(CalibrationPatch(
                    label=label, x=px, y=py,
                    width_mm=patch_size_mm, height_mm=patch_size_mm,
                ))
            strip = CalibrationStrip(
                patches=patches,
                clean_pass_bbox=CalibrationCleanPassBBox(
                    x=clean_x, y=clean_y,
                    width_mm=clean_w, height_mm=clean_h,
                ),
            )

    return RegistrationLayout(
        qr=MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0),
        arucos=[tr, bl, br],
        calibration_strip=strip,
    )
