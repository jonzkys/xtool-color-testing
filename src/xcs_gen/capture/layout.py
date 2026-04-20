"""Compute position of the registration QR marker in burn-space mm.

Coordinates use the same convention as the rest of xcs_gen: (x, y) top-left
of each marker, all values in bed-mm.

Prior versions also emitted three ArUco corner markers in "full" mode to
redundantly reference the homography. Those were never wired into the
capture pipeline (pyzbar produces 4 QR corners that are already
mathematically sufficient for a homography), so they've been removed to
free up substrate space. The ``mode`` field is retained for backwards
compatibility but all non-"off" values now behave identically.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# Default QR dimensions by payload mode. User can override per-test via
# RegistrationConfig.qr_size_mm when tweaking for a specific substrate.
_QR_SIZE_INLINE_MM = 12.0
_QR_SIZE_ID_ONLY_MM = 7.0

# Margin from grid edge to marker edge. Public because capture pipeline needs it
# to translate from QR-anchored frame to grid-origin frame.
MARKER_MARGIN_MM = 1.5

# Supported QR positions relative to the gradient grid. Bottom-left is
# intentionally omitted — axis tick labels live in that corner.
QrPosition = Literal["top-left", "top-right", "bottom-right", "left-middle"]


def _default_qr_size_mm(qr_mode: str) -> float:
    return _QR_SIZE_INLINE_MM if qr_mode == "inline" else _QR_SIZE_ID_ONLY_MM


def registration_reservation_mm(
    mode: str,
    qr_mode: str,
    *,
    position: QrPosition = "top-left",
    qr_size_mm: float | None = None,
    grid_h_mm: float = 0.0,
) -> tuple[float, float]:
    """How much space the registration QR needs as (x_shift_mm, y_shift_mm).

    Returns (0, 0) if mode == "off". Otherwise returns the amount the grid
    origin must be shifted right/down so the QR doesn't land at negative
    coordinates on the canvas:

      - top-left:     shift both X and Y by qr_size + margin
      - top-right:    shift only Y (QR is to the right of the grid already)
      - bottom-right: no shift (QR sits below + right of the grid)
      - left-middle:  shift X by qr_size + margin, shift Y only by the amount
                      the QR extends above the grid when grid_h < qr_size

    ``grid_h_mm`` is only used for the left-middle case; callers can omit it
    for the other positions.
    """
    if mode == "off":
        return 0.0, 0.0
    qr_size = qr_size_mm if qr_size_mm is not None else _default_qr_size_mm(qr_mode)
    reserve = qr_size + MARKER_MARGIN_MM
    if position == "top-left":
        return reserve, reserve
    if position == "top-right":
        return 0.0, reserve
    if position == "bottom-right":
        return 0.0, 0.0
    if position == "left-middle":
        # QR centred on grid; half of (qr_size - grid_h) sticks above the grid
        # when the grid is shorter than the QR. No Y shift needed otherwise.
        overhang = max(0.0, (qr_size - grid_h_mm) / 2)
        return reserve, overhang
    raise ValueError(f"unknown qr position: {position!r}")


@dataclass
class MarkerPosition:
    """A physical marker's top-left position and edge length in mm."""
    x: float
    y: float
    size: float
    marker_id: int = 0


@dataclass
class RegistrationLayout:
    """Registration marker set for one param test — QR only post-ArUco-removal."""
    qr: MarkerPosition | None = None  # None if mode == "off"


def compute_layout(
    *,
    grid_x: float,
    grid_y: float,
    grid_w: float,
    grid_h: float,
    mode: Literal["auto", "compact", "full", "off"] = "auto",
    qr_mode: Literal["inline", "id_only"] = "inline",
    position: QrPosition = "top-left",
    qr_size_mm: float | None = None,
) -> RegistrationLayout:
    """Compute the QR marker position for a test grid placed at ``(grid_x, grid_y)``.

    All non-"off" modes behave identically (the distinction between "compact"
    and "full" was only meaningful when ArUco corners were emitted, which
    they no longer are).
    """
    if mode == "off":
        return RegistrationLayout()

    qr_size = qr_size_mm if qr_size_mm is not None else _default_qr_size_mm(qr_mode)

    if position == "top-left":
        qr_x = grid_x - qr_size - MARKER_MARGIN_MM
        qr_y = grid_y - qr_size - MARKER_MARGIN_MM
    elif position == "top-right":
        qr_x = grid_x + grid_w + MARKER_MARGIN_MM
        qr_y = grid_y - qr_size - MARKER_MARGIN_MM
    elif position == "bottom-right":
        qr_x = grid_x + grid_w + MARKER_MARGIN_MM
        qr_y = grid_y + grid_h + MARKER_MARGIN_MM
    elif position == "left-middle":
        qr_x = grid_x - qr_size - MARKER_MARGIN_MM
        qr_y = grid_y + (grid_h - qr_size) / 2
    else:
        raise ValueError(f"unknown qr position: {position!r}")

    return RegistrationLayout(qr=MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0))
