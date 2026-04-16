"""Convert raster images (PNG/JPG) to SVG via vtracer.

The goal is to feed the output into the existing SVG-layers pipeline without
any other changes. vtracer does color quantization + region tracing; the
three most impactful tuning knobs are exposed via RasterTraceOptions.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

import vtracer
from PIL import Image


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
    # 0 = disabled, 2-256 = PIL-quantize the image to this many palette entries
    # BEFORE handing it to vtracer. The single most effective way to force a
    # low layer count on photos / raster images; vtracer then traces the
    # already-flat palette instead of inventing dozens of near-matching colors.
    max_colors: int = 0


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
    fmt = image_format.lower().lstrip(".")
    if fmt in ("jpeg",):
        fmt = "jpg"
    if fmt not in ("png", "jpg"):
        raise ValueError(f"Unsupported image format: {image_format}")

    # Optional pre-quantization to cap the palette before vtracer sees it.
    # PIL's MEDIANCUT produces a small palette that vtracer traces cleanly,
    # avoiding the dozens-of-near-identical-shades problem on photos.
    if opts.max_colors and opts.max_colors >= 2:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        has_alpha = img.mode == "RGBA"
        # PIL's quantize requires an RGB input; composite alpha against white
        # first so transparent PNGs don't get black background after flatten.
        if has_alpha:
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        else:
            img = img.convert("RGB")
        img = img.quantize(colors=opts.max_colors, method=Image.Quantize.MEDIANCUT).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        image_bytes = buf.getvalue()
        fmt = "png"

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
