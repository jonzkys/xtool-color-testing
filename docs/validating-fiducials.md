# Validating fiducials on a burned strip

After Task 18, every generated test carries one id-only QR at the top-left plus three ArUco markers (IDs 1/2/3) at the other corners. This doc covers the hands-on validation loop.

## Procedure

1. Create a test via the Tests page (or the CLI). Confirm `registration.mode == "on"`.
2. Generate its `.xcs` via `POST /api/tests/{id}/generate` and burn on a small blank (e.g. 25×50 mm).
3. Photograph the burn under even lighting; any modern phone camera works. Include the whole strip plus a few mm of substrate border.
4. Run the validator:

   ```
   python scripts/validate_fiducials.py /path/to/photo.jpg
   ```

## Expected output

```
QR id: 42
  marker 0: (123.0, 84.0)
  marker 1: (1812.3, 88.1)
  marker 2: (128.4, 1024.6)
  marker 3: (1814.9, 1031.2)
```

- `QR id` matches the test's DB id (non-zero positive int).
- Four marker entries print (`0` is the QR top-left anchor; `1/2/3` are ArUco centres).
- No exceptions.

The helper also writes `fiducials_debug.png` — the raw BGR frame (post-ICC-transform) that the pipeline saw.

## Troubleshooting

- **No QR id found**: the QR is too small/blurred or the substrate reflects too much — retake with more even lighting.
- **`insufficient ArUco markers`**: at least 2 of the 3 ArUcos must be detected; re-burn with `aruco_size_mm` bumped up (default 2.0 mm).
- **Marker coords are scrambled**: the QR's polygon was rotated; the pipeline assumes roughly upright burns. Recrop/rotate the photo so the strip is aligned with the image axes.
