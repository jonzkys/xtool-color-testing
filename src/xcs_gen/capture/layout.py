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

PERIMETER_STRIP_WIDTH_MM = 3.0
PERIMETER_STRIP_INSET_MM = 1.0   # gap between strip endpoint and adjacent marker edge

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
class PerimeterStripSegment:
    """One side of the perimeter clean-pass strip.

    ``side`` ∈ {"top", "right", "bottom", "left"}. Coords are
    burn-space mm; the segment is conceptually the centre-line of
    the strip (the renderer expands by ``width_mm / 2`` on each
    side to get the burned rectangle)."""
    side: str
    x0: float
    y0: float
    x1: float
    y1: float
    width_mm: float


@dataclass
class PerimeterStrip:
    segments: list[PerimeterStripSegment]


@dataclass
class RegistrationLayout:
    qr: MarkerPosition | None
    arucos: list[MarkerPosition]
    perimeter_strip: PerimeterStrip | None = None


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
    with_perimeter_strip: bool = False,
    perimeter_strip_width_mm: float = PERIMETER_STRIP_WIDTH_MM,
    perimeter_strip_inset_mm: float = PERIMETER_STRIP_INSET_MM,
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

    strip: PerimeterStrip | None = None
    if mode == "on" and with_perimeter_strip and qr_x >= 0 and qr_y >= 0:
        # Place each strip's centre-line just outside the grid by
        # half the strip width plus a small margin so the burned band
        # doesn't crash into the grid cells.
        offset = perimeter_strip_width_mm / 2.0 + MARKER_MARGIN_MM
        seg_top = PerimeterStripSegment(
            side="top",
            x0=qr_x + qr_size + perimeter_strip_inset_mm,
            y0=grid_y - offset,
            x1=tr.x - perimeter_strip_inset_mm,
            y1=grid_y - offset,
            width_mm=perimeter_strip_width_mm,
        )
        seg_right = PerimeterStripSegment(
            side="right",
            x0=grid_x + grid_w + offset,
            y0=tr.y + tr.size + perimeter_strip_inset_mm,
            x1=grid_x + grid_w + offset,
            y1=br.y - perimeter_strip_inset_mm,
            width_mm=perimeter_strip_width_mm,
        )
        seg_bottom = PerimeterStripSegment(
            side="bottom",
            x0=br.x - perimeter_strip_inset_mm,
            y0=grid_y + grid_h + offset,
            x1=bl.x + bl.size + perimeter_strip_inset_mm,
            y1=grid_y + grid_h + offset,
            width_mm=perimeter_strip_width_mm,
        )
        seg_left = PerimeterStripSegment(
            side="left",
            x0=grid_x - offset,
            y0=bl.y - perimeter_strip_inset_mm,
            x1=grid_x - offset,
            y1=qr_y + qr_size + perimeter_strip_inset_mm,
            width_mm=perimeter_strip_width_mm,
        )
        # Reject if any segment ended up degenerate (grid too small).
        segs = [seg_top, seg_right, seg_bottom, seg_left]
        if all(
            ((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2) ** 0.5 > 5.0
            for s in segs
        ):
            strip = PerimeterStrip(segments=segs)

    return RegistrationLayout(
        qr=MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0),
        arucos=[tr, bl, br],
        perimeter_strip=strip,
    )
