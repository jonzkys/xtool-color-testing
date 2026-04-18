"""Compute positions of registration markers (QR + optional ArUco) in burn-space mm.

Coordinates use the same convention as the rest of xcs_gen: (x, y) top-left
of each marker, all values in bed-mm.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# When in "auto" mode, the test switches from compact to full if BOTH dims
# exceed this threshold. Below that, compact (QR-only) mode is used to
# conserve substrate space.
AUTO_FULL_THRESHOLD_MM = 80.0

# QR dimensions by payload mode, chosen to burn reliably on blue-diode.
_QR_SIZE_INLINE_MM = 12.0
_QR_SIZE_ID_ONLY_MM = 7.0

# ArUco marker physical size in full mode.
_ARUCO_SIZE_MM = 5.0

# Margin from grid edge to marker edge. Public because capture pipeline needs it
# to translate from QR-anchored frame to grid-origin frame.
MARKER_MARGIN_MM = 1.5


def registration_reservation_mm(mode: str, qr_mode: str) -> float:
    """How much space the registration block needs at the top-left, in mm.

    Returns 0 if mode == "off". Otherwise returns qr_size + MARKER_MARGIN_MM,
    which is sufficient for both compact and full mode (the ArUco corner
    markers in full mode are smaller than the QR, so the QR reservation
    covers both).
    """
    if mode == "off":
        return 0.0
    qr_size = _QR_SIZE_INLINE_MM if qr_mode == "inline" else _QR_SIZE_ID_ONLY_MM
    return qr_size + MARKER_MARGIN_MM


@dataclass
class MarkerPosition:
    """A physical marker's top-left position and edge length in mm."""
    x: float
    y: float
    size: float
    marker_id: int  # 0..3, identifies which corner


@dataclass
class RegistrationLayout:
    """All registration markers for one param test."""
    qr: MarkerPosition | None = None  # None if mode == "off"
    aruco_markers: list[MarkerPosition] = field(default_factory=list)


def compute_layout(
    *,
    grid_x: float,
    grid_y: float,
    grid_w: float,
    grid_h: float,
    mode: Literal["auto", "compact", "full", "off"] = "auto",
    qr_mode: Literal["inline", "id_only"] = "inline",
) -> RegistrationLayout:
    """Compute marker positions for a test grid placed at (grid_x, grid_y)
    with dimensions (grid_w, grid_h).

    In "auto" mode, upgrades to full only when BOTH grid_w AND grid_h are
    strictly greater than ``AUTO_FULL_THRESHOLD_MM`` (i.e. ``>``, not ``>=``).
    A grid where either dimension equals the threshold exactly remains in
    compact (QR-only) mode.

    Returns a RegistrationLayout with QR position and zero or three ArUco
    marker positions depending on mode.
    """
    if mode == "off":
        return RegistrationLayout()

    effective_mode = mode
    if mode == "auto":
        effective_mode = "full" if (grid_w > AUTO_FULL_THRESHOLD_MM and grid_h > AUTO_FULL_THRESHOLD_MM) else "compact"

    qr_size = _QR_SIZE_INLINE_MM if qr_mode == "inline" else _QR_SIZE_ID_ONLY_MM

    # QR always sits at the top-left corner, outside the grid, offset by margin.
    qr_x = grid_x - qr_size - MARKER_MARGIN_MM
    qr_y = grid_y - qr_size - MARKER_MARGIN_MM
    # Corner 0 = top-left (QR).
    qr = MarkerPosition(x=qr_x, y=qr_y, size=qr_size, marker_id=0)

    layout = RegistrationLayout(qr=qr)

    if effective_mode == "full":
        # Three ArUco markers at top-right, bottom-right, bottom-left corners.
        # IDs 1, 2, 3 — QR carries logical id 0.
        tr = MarkerPosition(
            x=grid_x + grid_w + MARKER_MARGIN_MM,
            y=grid_y - _ARUCO_SIZE_MM - MARKER_MARGIN_MM,
            size=_ARUCO_SIZE_MM,
            marker_id=1,
        )
        br = MarkerPosition(
            x=grid_x + grid_w + MARKER_MARGIN_MM,
            y=grid_y + grid_h + MARKER_MARGIN_MM,
            size=_ARUCO_SIZE_MM,
            marker_id=2,
        )
        bl = MarkerPosition(
            x=grid_x - _ARUCO_SIZE_MM - MARKER_MARGIN_MM,
            y=grid_y + grid_h + MARKER_MARGIN_MM,
            size=_ARUCO_SIZE_MM,
            marker_id=3,
        )
        layout.aruco_markers = [tr, br, bl]

    return layout
