#!/usr/bin/env python3
"""One-off helper: decode a burned-strip photo, print id + marker positions.

Usage: python scripts/validate_fiducials.py <photo.jpg>
"""

from __future__ import annotations

import sys

import cv2

from xcs_gen_web.capture_pipeline import decode_image_bytes, detect_fiducials


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_fiducials.py <photo>", file=sys.stderr)
        return 2
    with open(sys.argv[1], "rb") as f:
        img = decode_image_bytes(f.read())
    qr_id, corners = detect_fiducials(img)
    print(f"QR id: {qr_id}")
    for k in sorted(corners):
        print(f"  marker {k}: {corners[k]}")
    cv2.imwrite("fiducials_debug.png", img)
    return 0


if __name__ == "__main__":
    sys.exit(main())
