"""Convert raster images (PNG/JPG) to SVG via vtracer.

The goal is to feed the output into the existing SVG-layers pipeline without
any other changes. vtracer does color quantization + region tracing; the
three most impactful tuning knobs are exposed via RasterTraceOptions.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

import vtracer


@dataclass
class RasterTraceOptions:
    """vtracer tuning knobs that affect the resulting layer count / detail.

    Defaults balance color fidelity and a tractable layer count for laser
    workflows. Users can tweak via the UI if the auto result isn't what they want.
    """

    # 1-8. Lower = fewer distinct colors = fewer layers.
    color_precision: int = 4
    # 0-255. Higher = merge more similar colors into one layer.
    layer_difference: int = 32
    # 0-100. Drops regions with fewer pixels than this; kills noise.
    filter_speckle: int = 8


def png_to_svg(image_bytes: bytes, *, image_format: str = "png",
               options: RasterTraceOptions | None = None) -> str:
    """Vectorize a raster image into an SVG string.

    Args:
        image_bytes: raw image bytes (PNG or JPEG).
        image_format: "png" or "jpg" / "jpeg".
        options: vtracer tuning knobs, uses sensible defaults if None.

    Returns:
        SVG string ready to hand to the existing SVG-layers endpoints.
    """
    opts = options or RasterTraceOptions()
    # vtracer takes the format as lowercase "png" / "jpg"
    fmt = image_format.lower().lstrip(".")
    if fmt in ("jpeg",):
        fmt = "jpg"
    if fmt not in ("png", "jpg"):
        raise ValueError(f"Unsupported image format: {image_format}")

    return vtracer.convert_raw_image_to_svg(
        image_bytes,
        img_format=fmt,
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        color_precision=opts.color_precision,
        layer_difference=opts.layer_difference,
        filter_speckle=opts.filter_speckle,
    )


def decode_base64_image(data_url_or_base64: str) -> tuple[bytes, str]:
    """Decode a base64 string (optionally a data URL) into raw bytes + format.

    Returns (bytes, format) where format is "png" or "jpg".
    """
    if data_url_or_base64.startswith("data:"):
        # e.g. "data:image/png;base64,iVBORw0..."
        header, _, payload = data_url_or_base64.partition(",")
        mime = header[5:].split(";", 1)[0]  # "image/png"
        fmt = mime.split("/", 1)[1] if "/" in mime else "png"
    else:
        payload = data_url_or_base64
        fmt = "png"
    return base64.b64decode(payload), fmt
